import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../config/settings.service';
import { SmsService } from '../sms/sms.service';
import { TenantContext } from '../tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../work/events.service';
import { toEnDigits } from '../common/identity';

/** چهار نوعِ سفارشِ بالینی — کلیدِ مسیر و جدول. */
export const ORDER_KINDS = ['lab', 'imaging', 'consult', 'referral'] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

const FA: Record<OrderKind, string> = {
  lab: 'درخواستِ آزمایش',
  imaging: 'درخواستِ تصویربرداری',
  consult: 'درخواستِ مشاوره',
  referral: 'نامهٔ ارجاع',
};

/**
 * سفارش‌های بالینیِ زیرِ ویزیت.
 *
 * ⚠️ چهار **موجودیتِ جدا** (خواستهٔ صریحِ محصول) چون فیلدهاشان واقعاً فرق
 * دارد؛ ولی چرخه یکی است، پس لوله‌کشی‌اش (توکن، ارسالِ پیامک، دفترِ پیام،
 * audit) یک‌بار نوشته شده و روی delegateِ همان جدول کار می‌کند. این
 * «ادغامِ موجودیت» نیست — نکشیدنِ چهار نسخهٔ کپیِ یک کد است.
 */
@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private sms: SmsService,
    private tenant: TenantContext,
    private audit: AuditService,
    private events: EventsService,
  ) {}

  /* delegateِ prisma برای هر نوع. تایپِ اجتماعِ چهار delegate در Prisma
     قابلِ استفادهٔ مستقیم نیست؛ کاست عمدی و محدود به همین‌جاست. */
  private table(kind: OrderKind): any {
    const map = {
      lab: this.prisma.labOrder,
      imaging: this.prisma.imagingOrder,
      consult: this.prisma.consultOrder,
      referral: this.prisma.referralOrder,
    };
    const t = (map as any)[kind];
    if (!t) throw new BadRequestException('نوعِ سفارش نامعتبر است');
    return t;
  }

  private token() { return randomBytes(16).toString('base64url'); }

  /** خلاصهٔ یک‌خطی برای پیامک و فهرست — «چه چیزی درخواست شده». */
  private summary(kind: OrderKind, row: any): string {
    if (kind === 'lab') {
      const t = (row.tests ?? []).join('، ');
      return [t, row.note?.trim()].filter(Boolean).join(' — ') || 'آزمایش';
    }
    if (kind === 'imaging') {
      const m = (row.modalities ?? []).join('، ');
      return [m, row.region?.trim(), row.note?.trim()].filter(Boolean).join(' — ') || 'تصویربرداری';
    }
    return [row.specialty?.trim(), row.doctorName?.trim(), row.note?.trim()].filter(Boolean).join(' — ')
      || FA[kind];
  }

  private view(kind: OrderKind, row: any) {
    return { ...row, kind, kindFa: FA[kind], summary: this.summary(kind, row) };
  }

  /** فهرستِ سفارش‌های یک مراجعه — همهٔ چهار نوع با هم، تازه‌ترین اول. */
  async listForVisit(visitId: number) {
    const out: any[] = [];
    for (const kind of ORDER_KINDS) {
      const rows = await this.table(kind).findMany({ where: { visitId }, orderBy: { id: 'desc' } });
      out.push(...rows.map((r: any) => this.view(kind, r)));
    }
    return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async listForPatient(patientId: number) {
    const out: any[] = [];
    for (const kind of ORDER_KINDS) {
      const rows = await this.table(kind).findMany({ where: { patientId }, orderBy: { id: 'desc' } });
      out.push(...rows.map((r: any) => this.view(kind, r)));
    }
    return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** فیلدهای مجاز برای هر نوع — چیزی بیرونِ این‌ها به دیتابیس نمی‌رسد. */
  private clean(kind: OrderKind, dto: any) {
    const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) || null : undefined);
    const arr = (v: unknown) => (Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 80)))].slice(0, 40)
      : undefined);
    const date = (v: unknown) => {
      if (v === null) return null;
      if (typeof v !== 'string' || !v.trim()) return undefined;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخِ مهلت نامعتبر است');
      return d;
    };
    const common = { note: str(dto.note) };
    if (kind === 'lab') {
      return { ...common, tests: arr(dto.tests), dueDate: date(dto.dueDate),
        resultText: str(dto.resultText), resultLink: str(dto.resultLink, 500),
        resultUser: str(dto.resultUser, 120), resultPass: str(dto.resultPass, 120) };
    }
    if (kind === 'imaging') {
      return { ...common, modalities: arr(dto.modalities), region: str(dto.region, 200), dueDate: date(dto.dueDate),
        resultText: str(dto.resultText), resultLink: str(dto.resultLink, 500),
        resultUser: str(dto.resultUser, 120), resultPass: str(dto.resultPass, 120) };
    }
    if (kind === 'consult') {
      return { ...common, specialty: str(dto.specialty, 120), doctorName: str(dto.doctorName, 120),
        answerText: str(dto.answerText), answerLink: str(dto.answerLink, 500) };
    }
    return { ...common, specialty: str(dto.specialty, 120), doctorName: str(dto.doctorName, 120) };
  }

  async create(kind: OrderKind, dto: any, user: any) {
    const patientId = Number(dto?.patientId ?? 0);
    const visitId = dto?.visitId ? Number(dto.visitId) : null;
    const patient = await this.prisma.patient.findFirst({ where: { id: patientId, deletedAt: null }, select: { id: true } });
    if (!patient) throw new BadRequestException('پرونده پیدا نشد');
    if (visitId) {
      const v = await this.prisma.visit.findFirst({ where: { id: visitId, patientId }, select: { id: true } });
      if (!v) throw new BadRequestException('مراجعهٔ انتخابی برای این بیمار نیست');
    }
    const data = Object.fromEntries(Object.entries(this.clean(kind, dto ?? {})).filter(([, v]) => v !== undefined));
    const row = await this.table(kind).create({ data: { ...data, patientId, visitId, token: this.token() } });
    await this.audit.record({
      actorId: user?.id, action: `order.${kind}.create`, entityType: `${kind}_order`, entityId: row.id,
      after: { patientId, visitId },
    });
    return this.view(kind, row);
  }

  async update(kind: OrderKind, id: number, dto: any, user: any) {
    const row = await this.table(kind).findUnique({ where: { id } });
    if (!row) throw new NotFoundException('سفارش پیدا نشد');
    const data = Object.fromEntries(Object.entries(this.clean(kind, dto ?? {})).filter(([, v]) => v !== undefined));
    /* پاسخ که ثبت شد، وضعیت خودش جلو می‌رود — کاربر نباید یک کشوی جدا هم بزند. */
    const answered = ['resultText', 'resultLink', 'answerText', 'answerLink']
      .some((k) => typeof (data as any)[k] === 'string' && (data as any)[k]);
    if (answered) (data as any).status = 'answered';
    const fresh = await this.table(kind).update({ where: { id }, data });
    await this.audit.record({
      actorId: user?.id, action: `order.${kind}.update`, entityType: `${kind}_order`, entityId: id,
      after: { answered },
    });
    return this.view(kind, fresh);
  }

  async remove(kind: OrderKind, id: number, user: any) {
    const row = await this.table(kind).findUnique({ where: { id } });
    if (!row) throw new NotFoundException('سفارش پیدا نشد');
    await this.table(kind).delete({ where: { id } });
    await this.audit.record({
      actorId: user?.id, action: `order.${kind}.delete`, entityType: `${kind}_order`, entityId: id,
      before: { patientId: row.patientId, visitId: row.visitId },
    });
    return { ok: true };
  }

  /**
   * ارسالِ لینک به بیمار — همان قاعدهٔ `sendToPatient`ِ فرم‌ها: پیامک + ثبت
   * در دفترِ پیام‌های پرونده، تا «فرستادیم یا نه؟» جوابِ مکتوب داشته باشد.
   */
  async send(kind: OrderKind, id: number, user: any) {
    const row = await this.table(kind).findUnique({
      where: { id }, include: { patient: { select: { phone: true } } },
    });
    if (!row) throw new NotFoundException('سفارش پیدا نشد');
    const to = toEnDigits(String(row.patient?.phone ?? '')).replace(/[^0-9]/g, '');
    if (!/^09\d{9}$/.test(to)) {
      throw new BadRequestException('شمارهٔ موبایلِ معتبری در پرونده نیست — اول شماره را در پرونده اصلاح کنید');
    }
    const host = this.tenant.require().hostname;
    const url = `https://${host}/o/${row.token}`;
    const brand = await this.settings.brand().catch(() => ({ name: null as string | null }));
    const prefix = brand?.name ? `${brand.name}\n` : '';
    const text = `${prefix}${FA[kind]}:\n${this.summary(kind, row)}\n${url}`;
    const res = await this.sms.send(to, text);
    await this.table(kind).update({ where: { id }, data: { status: row.status === 'answered' ? 'answered' : 'sent', sentAt: new Date() } });
    const rem = await this.prisma.reminder.create({
      data: {
        patientId: row.patientId, visitId: row.visitId ?? null, kind: 'notice',
        dueAt: new Date(), phone: to, text,
        status: res.sent || res.stub ? 'sent' : 'failed', sentAt: new Date(),
      },
    }).catch(() => null);
    /* W2.2: پیامکی که همین‌جا نرفت ← کارِ «ارسالِ دوباره» برای منشی (work-rules: sms.failed). */
    if (!res.sent && !res.stub) {
      await this.events.emit({
        type: 'sms.failed', patientId: row.patientId, visitId: row.visitId ?? null, actorId: user?.id ?? null,
        ...(rem ? { refType: 'reminder', refId: rem.id } : { refType: `${kind}_order`, refId: id }),
        payload: { kind: 'notice', error: 'سرویس پیامک ارسال را نپذیرفت' },
      });
    }
    await this.audit.record({
      actorId: user?.id, action: `order.${kind}.send`, entityType: `${kind}_order`, entityId: id,
      after: { to, sent: res.sent, stub: res.stub },
    });
    return { ok: true, to, url, sent: res.sent, stub: res.stub };
  }

  /** صفحهٔ عمومیِ بیمار — بدونِ نامِ کارکنان و بدونِ شمارهٔ تماس. */
  async publicView(token: string) {
    for (const kind of ORDER_KINDS) {
      const row = await this.table(kind).findUnique({ where: { token } });
      if (!row) continue;
      const brand = await this.settings.brand().catch(() => ({ name: null as string | null }));
      return {
        kind, kindFa: FA[kind], clinic: brand?.name ?? null,
        summary: this.summary(kind, row),
        note: row.note ?? null,
        dueDate: row.dueDate ?? null,
        status: row.status,
        answered: !!(row.resultText || row.resultLink || row.answerText || row.answerLink),
      };
    }
    throw new NotFoundException('این نشانی معتبر نیست یا منقضی شده');
  }

  /** ثبتِ پاسخ توسطِ خودِ بیمار (لینک/متنِ جواب). */
  async publicAnswer(token: string, dto: any) {
    for (const kind of ORDER_KINDS) {
      const row = await this.table(kind).findUnique({ where: { token } });
      if (!row) continue;
      if (kind === 'referral') throw new BadRequestException('برای نامهٔ ارجاع پاسخی ثبت نمی‌شود');
      const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      const text = str(dto?.text);
      const link = str(dto?.link, 500);
      if (!text && !link) throw new BadRequestException('متن یا لینکِ پاسخ را وارد کنید');
      const data: any = kind === 'consult'
        ? { answerText: text || row.answerText, answerLink: link || row.answerLink }
        : {
          resultText: text || row.resultText, resultLink: link || row.resultLink,
          resultUser: str(dto?.user, 120) || row.resultUser, resultPass: str(dto?.pass, 120) || row.resultPass,
        };
      data.status = 'answered';
      await this.table(kind).update({ where: { id: row.id }, data });
      /* W2.2: پاسخِ بیمار ← کارِ «بررسیِ نتیجه» برای پزشک (work-rules: order.answered). */
      await this.events.emit({
        type: 'order.answered', patientId: row.patientId, visitId: row.visitId ?? null,
        refType: `${kind}_order`, refId: row.id, payload: { again: row.status === 'answered' },
      });
      return { ok: true };
    }
    throw new NotFoundException('این نشانی معتبر نیست یا منقضی شده');
  }
}
