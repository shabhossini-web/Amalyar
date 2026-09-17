import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../config/settings.service';
import { SmsService } from '../sms/sms.service';
import { TenantContext } from '../tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../work/events.service';
import { LEVEL } from '../common/levels';
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
  private table(kind: OrderKind, client: any = this.prisma): any {
    if (!ORDER_KINDS.includes(kind)) throw new BadRequestException('نوعِ سفارش نامعتبر است');
    const map = {
      lab: client.labOrder,
      imaging: client.imagingOrder,
      consult: client.consultOrder,
      referral: client.referralOrder,
    };
    const t = (map as any)[kind];
    if (!t) throw new BadRequestException('نوعِ سفارش نامعتبر است');
    return t;
  }

  private async assertAccess(patientId: number, user: any, db: any = this.prisma) {
    const patient = await db.patient.findFirst({ where: { id: patientId, deletedAt: null,
      ...((user?.level ?? 0) < LEVEL.SUPERVISOR ? { visits: { some: { techId: user?.id ?? -1 } } } : {}),
    }, select: { id: true } });
    if (!patient) throw new NotFoundException('پرونده پیدا نشد');
  }

  private async locked(kind: OrderKind, id: number, tx: any) {
    this.table(kind, tx); // Validate before selecting a fixed SQL identifier.
    const table = { lab: 'lab_orders', imaging: 'imaging_orders', consult: 'consult_orders', referral: 'referral_orders' }[kind];
    await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
    const row = await this.table(kind, tx).findUnique({ where: { id } });
    if (!row) throw new NotFoundException('سفارش پیدا نشد');
    return row;
  }

  private async withDocuments(kind: OrderKind, row: any, db: any = this.prisma) {
    const documents = await db.document.findMany({ where: { refType: `${kind}_order`, refId: row.id,
      patientId: row.patientId, deletedAt: null }, orderBy: { id: 'asc' } });
    return { ...this.view(kind, row), documents };
  }

  /** An answer and its immutable record documents share the order lock and outbox transaction. */
  private async answerDocuments(kind: OrderKind, row: any, data: any, tx: any, actorId: number | null) {
    const category = kind === 'lab' ? 'lab' : kind === 'imaging' ? 'imaging' : 'report';
    const text = data.resultText ?? data.answerText;
    const link = data.resultLink ?? data.answerLink;
    if (link) {
      let url: URL;
      try { url = new URL(link); } catch { throw new BadRequestException('نشانی پاسخ معتبر نیست'); }
      if (!['https:', 'http:'].includes(url.protocol)) throw new BadRequestException('فقط لینک http/https پذیرفته می‌شود');
    }
    for (const [type, value] of [['text', text], ['link', link]] as const) {
      if (!value) continue;
      const where = { patientId: row.patientId, refType: `${kind}_order`, refId: row.id, deletedAt: null,
        ...(type === 'text' ? { contentText: value } : { externalUrl: value,
          externalUser: data.resultUser ?? null, externalPass: data.resultPass ?? null }) };
      if (await tx.document.findFirst({ where })) continue;
      await tx.document.create({ data: { ...where, visitId: row.visitId, category,
        title: `پاسخ ${FA[kind]}`, fileName: type === 'text' ? `${kind}-${row.id}.txt` : new URL(value).hostname,
        mimeType: type === 'text' ? 'text/plain; charset=utf-8' : 'text/uri-list',
        size: type === 'text' ? Buffer.byteLength(value) : 0,
        sha256: type === 'text' ? createHash('sha256').update(value).digest('hex') : '', uploadedById: actorId,
      } });
    }
  }

  private async answered(kind: OrderKind, row: any, data: any, tx: any, actorId: number | null) {
    await this.answerDocuments(kind, row, data, tx, actorId);
    const fresh = await this.table(kind, tx).update({ where: { id: row.id }, data: {
      ...data, status: 'answered', reviewNote: null, reviewedAt: null, reviewedById: null,
    } });
    const visit = row.visitId ? await tx.visit.findUnique({ where: { id: row.visitId },
      select: { surgeon: { select: { person: { select: { account: { select: { id: true, status: true } } } } } } } }) : null;
    const doctor = visit?.surgeon?.person?.account;
    await this.events.emit({ type: 'order.answered', patientId: row.patientId, visitId: row.visitId,
      refType: `${kind}_order`, refId: row.id, actorId,
      payload: { doctorId: doctor?.status === 'active' ? doctor.id : null, again: row.status !== 'sent' && row.status !== 'draft' },
    }, tx);
    await this.audit.record({ actorId, action: `order.${kind}.answered`, entityType: `${kind}_order`,
      entityId: row.id, before: { status: row.status }, after: { status: 'answered' } }, tx);
    return fresh;
  }

  private async attachFiles(kind: OrderKind, row: any, ids: unknown, tx: any) {
    if (ids === undefined) return false;
    if (!Array.isArray(ids) || ids.length > 5 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new BadRequestException('شناسه مدارک نامعتبر است');
    }
    let changed = false;
    for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
      await tx.$queryRaw`SELECT id FROM documents WHERE id = ${id} FOR UPDATE`;
      const doc = await tx.document.findFirst({ where: { id, patientId: row.patientId, deletedAt: null } });
      if (!doc || doc.visitId !== row.visitId || (doc.refType && (doc.refType !== `${kind}_order` || doc.refId !== row.id))) {
        throw new BadRequestException('مدرک متعلق به این سفارش و مراجعه نیست');
      }
      if (!doc.refType) {
        await tx.document.update({ where: { id }, data: { refType: `${kind}_order`, refId: row.id,
          category: kind === 'lab' ? 'lab' : kind === 'imaging' ? 'imaging' : 'report' } });
        changed = true;
      }
    }
    return changed;
  }

  async review(kind: OrderKind, id: number, dto: any, user: any) {
    const status = dto?.status;
    if (!['in_review', 'reviewed', 'needs_action'].includes(status)) throw new BadRequestException('وضعیت بررسی نامعتبر است');
    const note = typeof dto?.reviewNote === 'string' ? dto.reviewNote.trim().slice(0, 4000) : '';
    if (status !== 'in_review' && !note) throw new BadRequestException('تصمیم یا دلیل بررسی را وارد کنید');
    return this.prisma.$transaction(async tx => {
      const row = await this.locked(kind, id, tx);
      await this.assertAccess(row.patientId, user, tx);
      if (row.status === status && (status === 'in_review' || row.reviewNote === note)) return this.withDocuments(kind, row, tx);
      if (!['answered', 'in_review'].includes(row.status)) throw new ConflictException('این سفارش اکنون آماده بررسی نیست');
      const fresh = await this.table(kind, tx).update({ where: { id }, data: { status,
        ...(status !== 'in_review' ? { reviewNote: note, reviewedById: user.id, reviewedAt: new Date() } : {}),
      } });
      if (status !== 'in_review') await this.events.emit({ type: `order.${status}`, patientId: row.patientId,
        visitId: row.visitId, refType: `${kind}_order`, refId: id, actorId: user.id,
        payload: status === 'needs_action' ? { reason: note } : undefined }, tx);
      await this.audit.record({ actorId: user.id, action: `order.${kind}.${status}`, entityType: `${kind}_order`,
        entityId: id, before: { status: row.status }, after: { status, reviewNote: note } }, tx);
      return this.withDocuments(kind, fresh, tx);
    });
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
  async listForVisit(visitId: number, user: any) {
    const visit = await this.prisma.visit.findUnique({ where: { id: visitId }, select: { patientId: true } });
    if (!visit) throw new NotFoundException('مراجعه پیدا نشد');
    await this.assertAccess(visit.patientId, user);
    const out: any[] = [];
    for (const kind of ORDER_KINDS) {
      const rows = await this.table(kind).findMany({ where: { visitId }, orderBy: { id: 'desc' } });
      out.push(...await Promise.all(rows.map((r: any) => this.withDocuments(kind, r))));
    }
    return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async listForPatient(patientId: number, user: any) {
    await this.assertAccess(patientId, user);
    const out: any[] = [];
    for (const kind of ORDER_KINDS) {
      const rows = await this.table(kind).findMany({ where: { patientId }, orderBy: { id: 'desc' } });
      out.push(...await Promise.all(rows.map((r: any) => this.withDocuments(kind, r))));
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
    return { ...common, specialty: str(dto.specialty, 120), doctorName: str(dto.doctorName, 120),
      answerText: str(dto.answerText), answerLink: str(dto.answerLink, 500) };
  }

  async create(kind: OrderKind, dto: any, user: any) {
    const patientId = Number(dto?.patientId ?? 0);
    const visitId = dto?.visitId ? Number(dto.visitId) : null;
    const patient = await this.prisma.patient.findFirst({ where: { id: patientId, deletedAt: null }, select: { id: true } });
    if (!patient) throw new BadRequestException('پرونده پیدا نشد');
    await this.assertAccess(patientId, user);
    if (visitId) {
      const v = await this.prisma.visit.findFirst({ where: { id: visitId, patientId }, select: { id: true } });
      if (!v) throw new BadRequestException('مراجعهٔ انتخابی برای این بیمار نیست');
    }
    const data = Object.fromEntries(Object.entries(this.clean(kind, dto ?? {})).filter(([, v]) => v !== undefined));
    return this.prisma.$transaction(async tx => {
      const row = await this.table(kind, tx).create({ data: { ...data, patientId, visitId, token: this.token() } });
      const filesAdded = await this.attachFiles(kind, row, dto?.documentIds, tx);
      const hasAnswer = filesAdded || ['resultText', 'resultLink', 'answerText', 'answerLink'].some(k => (data as any)[k]);
      const fresh = hasAnswer ? await this.answered(kind, row, data, tx, user.id) : row;
      await this.audit.record({ actorId: user.id, action: `order.${kind}.create`, entityType: `${kind}_order`,
        entityId: row.id, after: { patientId, visitId } }, tx);
      return this.withDocuments(kind, fresh, tx);
    });
  }

  async update(kind: OrderKind, id: number, dto: any, user: any) {
    return this.prisma.$transaction(async tx => {
      const row = await this.locked(kind, id, tx);
      await this.assertAccess(row.patientId, user, tx);
      const data = Object.fromEntries(Object.entries(this.clean(kind, dto ?? {})).filter(([, v]) => v !== undefined));
      const filesAdded = await this.attachFiles(kind, row, dto?.documentIds, tx);
      const changed = filesAdded || ['resultText', 'resultLink', 'answerText', 'answerLink', 'resultUser', 'resultPass']
        .some(k => k in data && data[k] !== row[k]);
      const hasAnswer = filesAdded || ['resultText', 'resultLink', 'answerText', 'answerLink'].some(k => ({ ...row, ...data })[k]);
      const fresh = changed && hasAnswer ? await this.answered(kind, row, { ...data,
        ...Object.fromEntries(['resultText', 'resultLink', 'answerText', 'answerLink', 'resultUser', 'resultPass']
          .filter(k => k in row).map(k => [k, k in data ? data[k] : row[k]])),
      }, tx, user.id) : await this.table(kind, tx).update({ where: { id }, data });
      await this.audit.record({ actorId: user.id, action: `order.${kind}.update`, entityType: `${kind}_order`,
        entityId: id, after: { answered: changed && hasAnswer } }, tx);
      return this.withDocuments(kind, fresh, tx);
    });
  }

  async remove(kind: OrderKind, id: number, user: any) {
    return this.prisma.$transaction(async tx => {
      const row = await this.locked(kind, id, tx);
      await this.assertAccess(row.patientId, user, tx);
      if (['answered', 'in_review', 'reviewed', 'needs_action'].includes(row.status)) throw new ConflictException('سفارش پاسخ‌دار حذف نمی‌شود');
      await this.table(kind, tx).delete({ where: { id } });
      await this.audit.record({ actorId: user.id, action: `order.${kind}.delete`, entityType: `${kind}_order`, entityId: id,
        before: { patientId: row.patientId, visitId: row.visitId } }, tx);
      return { ok: true };
    });
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
    await this.assertAccess(row.patientId, user);
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
    await this.prisma.$transaction(async tx => {
      const current = await this.locked(kind, id, tx);
      await this.table(kind, tx).update({ where: { id }, data: {
        status: current.status === 'draft' ? 'sent' : current.status, sentAt: new Date(),
      } });
    });
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
      return this.prisma.$transaction(async tx => {
        const current = await this.locked(kind, row.id, tx);
        if (!await tx.patient.findFirst({ where: { id: current.patientId, deletedAt: null }, select: { id: true } })) throw new NotFoundException('پرونده پیدا نشد');
        if (!['sent', 'needs_action'].includes(current.status)) throw new ConflictException('پاسخ قبلاً ثبت شده یا سفارش آماده پاسخ نیست');
        const data: any = kind === 'consult' ? { answerText: text || null, answerLink: link || null }
          : { resultText: text || null, resultLink: link || null,
            resultUser: str(dto?.user, 120) || null, resultPass: str(dto?.pass, 120) || null };
        await this.answered(kind, current, data, tx, null);
        return { ok: true };
      });
    }
    throw new NotFoundException('این نشانی معتبر نیست یا منقضی شده');
  }
}
