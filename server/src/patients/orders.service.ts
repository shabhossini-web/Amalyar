import { ORDER_LABELS, EXCLUSIVE_DECISION } from './labels';
import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../config/settings.service';
import { SmsService } from '../sms/sms.service';
import { TenantContext } from '../tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../work/events.service';
import { closeWork } from '../work/work-processor';
import { LEVEL } from '../common/levels';
import { scopedPatientWhere } from '../common/own-scope';
import { toEnDigits } from '../common/identity';
import { sniffMime } from '../common/file-type';
import { RateLimitService } from '../common/rate-limit.service';
import { StorageService } from '../storage/storage.service';
import { emitSms, orderTokenIn } from '../reminders/send-reminders';

/** چهار نوعِ سفارشِ بالینی — کلیدِ مسیر و جدول. */
export const ORDER_KINDS = ['lab', 'imaging', 'consult', 'referral'] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

/** وضعیت‌هایی که «پاسخ رسیده» — پس از این‌ها فقط افزودن معنا دارد، نه پاسخِ تازه. */
const ANSWERED_STATUSES = ['answered', 'in_review', 'reviewed'];
/** قرارداد §۵ — سقفِ فایلِ پاسخ به‌ازای هر سفارش و حجمِ هر فایل. */
const MAX_ANSWER_FILES = 5;
const MAX_ANSWER_BYTES = 10 * 1024 * 1024;
/* پیامِ رو به بیمار ارقامِ فارسی می‌گیرد — عددِ لاتین وسطِ جملهٔ فارسی غلط می‌نشیند. */
const faNum = (n: number) => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[+d]);

const FA: Record<OrderKind, string> = {
  lab: 'درخواستِ آزمایش',
  imaging: 'درخواستِ تصویربرداری',
  consult: 'درخواستِ مشاوره',
  referral: 'نامهٔ ارجاع',
};

/**
 * ساختِ مدرکِ پاسخِ سفارش — **تابعِ خالص روی هر clientِ Prisma**.
 *
 * ⚠️ عمداً از کلاس بیرون آمد (پی‌گیریِ W1.10): ترمیمِ دادهٔ تاریخی باید از
 * **همین** تابع بگذرد، و ترمیم در workerی اجرا می‌شود که Nest و DIِ
 * tenant-scoped ندارد — فقط یک `PrismaClient`ِ کوتاه‌عمر. اگر به‌جایش در
 * هستهٔ ترمیم کپی می‌شد، همان چیزی می‌شد که قانونِ مرکزیِ W1.10 منع می‌کند:
 * دو نسخه که روزی از هم واگرا می‌شوند.
 *
 * idempotent است — مدرکِ هم‌محتوا دوباره ساخته نمی‌شود، پس دوباره‌دواندنش بی‌خطر.
 */
export async function answerDocuments(
  kind: OrderKind, row: any, data: any, tx: any, actorId: number | null,
): Promise<number> {
  let made = 0;
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
    made += 1;
    await tx.document.create({ data: { ...where, visitId: row.visitId, category,
      title: `پاسخ ${FA[kind]}`, fileName: type === 'text' ? `${kind}-${row.id}.txt` : new URL(value).hostname,
      mimeType: type === 'text' ? 'text/plain; charset=utf-8' : 'text/uri-list',
      size: type === 'text' ? Buffer.byteLength(value) : 0,
      sha256: type === 'text' ? createHash('sha256').update(value).digest('hex') : '', uploadedById: actorId,
    } });
  }
  return made;
}

/** delegateِ Prisma برای هر نوعِ سفارش — هستهٔ ترمیم هم همین نگاشت را لازم دارد. */
export const ORDER_DELEGATE: Record<OrderKind, string> = {
  lab: 'labOrder', imaging: 'imagingOrder', consult: 'consultOrder', referral: 'referralOrder',
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
    private storage: StorageService,
    private rateLimit: RateLimitService,
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
      ...scopedPatientWhere(user),
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
    const rows = await db.document.findMany({ where: { refType: `${kind}_order`, refId: row.id,
      patientId: row.patientId, deletedAt: null }, orderBy: { id: 'asc' } });
    /* «چه کسی فرستاد» و «تازه پس از بررسی» — شیت تا امروز همه را یک‌جا و بی‌نشان می‌چید و
       صدای جراح کنارِ عکسِ بیمار «پاسخ» دیده می‌شد. */
    const documents = rows.map((d: any) => ({
      ...d,
      from: d.uploadedById ? 'staff' : 'patient',
      requestNote: !!d.uploadedById && String(d.mimeType ?? '').startsWith('audio/'),
      fresh: !!row.reviewedAt && !d.uploadedById && d.createdAt > row.reviewedAt,
    }));
    return { ...this.view(kind, row), documents };
  }

  /** مدارکِ بیمار پس از آخرین تصمیمِ بررسی. */
  private newSinceReview(kind: OrderKind, row: any, tx: any): Promise<number> {
    if (!row.reviewedAt) return Promise.resolve(0);
    return tx.document.count({ where: { refType: `${kind}_order`, refId: row.id, patientId: row.patientId,
      deletedAt: null, uploadedById: null, createdAt: { gt: row.reviewedAt } } });
  }

  /** An answer and its immutable record documents share the order lock and outbox transaction. */
  private answerDocuments(kind: OrderKind, row: any, data: any, tx: any, actorId: number | null) {
    return answerDocuments(kind, row, data, tx, actorId);
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
    /* «پاسخ» فقط مدرکِ غیرصوتی است. صدایی که کارکنان روی همین سفارش ضبط می‌کنند توضیحِ
       **درخواست** است («ناشتا بروید»، «فقط لگن»): تا ۱۴۰۵/۰۸/۰۴ وضعیت را «پاسخ آمد» می‌کرد،
       بیمار دیگر نمی‌توانست پاسخ بفرستد و صدا را هم هرگز نمی‌شنید (گزارشِ مالک). */
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
        if (!String(doc.mimeType ?? '').startsWith('audio/')) changed = true;
      }
    }
    return changed;
  }

  async review(kind: OrderKind, id: number, dto: any, user: any) {
    const status = dto?.status;
    if (!['in_review', 'reviewed', 'needs_action'].includes(status)) throw new BadRequestException('وضعیت بررسی نامعتبر است');
    const raw = typeof dto?.reviewNote === 'string' ? dto.reviewNote.trim().slice(0, 4000) : '';
    /* دلیلِ «ناقص است» اجباری است چون **بیمار همان را می‌خواند** و باید بداند
       دوباره چه بفرستد. «بررسی شد» اجباری نیست: خلاصهٔ جواب در خودِ سفارش
       (`resultText`/`answerText`) نشسته و اجبارِ یادداشتِ دوم فقط مسیر را
       می‌بست — کاربر دکمه را می‌زد و چیزی ثبت نمی‌شد (گزارشِ مالک ۱۴۰۵/۰۶/۳۰).
       خالی که باشد خودِ سرور برچسبِ پیش‌فرض می‌گذارد، تا `reviewNote` هیچ‌وقت
       تهی نماند و ردِ ممیزی خوانا بماند. */
    if (status === 'needs_action' && !raw) throw new BadRequestException('دلیلِ ناقص‌بودن را بنویسید — بیمار همان را می‌بیند');
    const note = status === 'reviewed' ? (raw || 'بررسی شد') : raw;
    return this.prisma.$transaction(async tx => {
      const row = await this.locked(kind, id, tx);
      await this.assertAccess(row.patientId, user, tx);
      if (row.status === status && (status === 'in_review' || row.reviewNote === note)) return this.withDocuments(kind, row, tx);
      /* سفارشِ «بررسی شد» که بیمار بعدش چیزِ تازه فرستاده دوباره بررسی‌پذیر است — وگرنه کارِ
         «بررسیِ نتیجه» باز می‌شد ولی شیت دکمه‌ای نداشت و سرور هم رد می‌کرد. */
      const reopened = row.status === 'reviewed' && await this.newSinceReview(kind, row, tx) > 0;
      if (!['answered', 'in_review'].includes(row.status) && !reopened) throw new ConflictException('این سفارش اکنون آماده بررسی نیست');
      const fresh = await this.table(kind, tx).update({ where: { id }, data: { status,
        ...(status !== 'in_review' ? { reviewNote: note, reviewedById: user.id, reviewedAt: new Date() } : {}),
      } });
      if (status !== 'in_review') await this.events.emit({ type: `order.${status}`, patientId: row.patientId,
        visitId: row.visitId, refType: `${kind}_order`, refId: id, actorId: user.id,
        payload: status === 'needs_action' ? { reason: note } : undefined }, tx);
      /* کارِ «بررسیِ نتیجه» **همین‌جا** بسته می‌شود، نه با پردازشگرِ یک دقیقهٔ بعد:
         همان چیزی است که قاعدهٔ `order.reviewed` / `order.needs_action` می‌بندد
         (`work-rules.ts`) و پردازشگر بعداً روی کارِ بسته no-op است. دلیلش صفحهٔ
         «امروز» است — کاربر از همان ردیفِ کار «بررسی شد» می‌زند و اگر ردیف تا
         یک دقیقه بماند، فکر می‌کند ثبت نشده و دوباره می‌زند (بازخوردِ مالک:
         هشداری که کلیک شد باید همان لحظه جواب بگیرد). */
      if (status !== 'in_review') await closeWork(tx, { refType: `${kind}_order`, refId: id, type: 'review_result' }, user.id);
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
    return { ...row, kind, kindFa: FA[kind], statusFa: ORDER_LABELS[row.status] ?? row.status, summary: this.summary(kind, row) };
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
      /* **سفارش همان تصمیم است** (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳): دراپ‌داونِ تصمیم دیگر چیپِ
         درخواست ندارد، پس کلیدِ همین نوع این‌جا روی مراجعه می‌نشیند — گزارش‌هایی که
         «ویزیت‌هایی که آزمایش خواستند» را از `decisions` می‌خوانند چیزی گم نمی‌کنند.
         «پیگیری لازم نیست» کنار می‌رود: درخواستِ باز یعنی جوابی که باید دیده شود.
         فقط ویزیت — فرمِ عمل تصمیمِ درمانی ندارد. */
      if (visitId) {
        const v = await tx.visit.findUnique({ where: { id: visitId }, select: { kind: true, decisions: true } });
        if (v && v.kind !== 'surgery') {
          const next = [...new Set([...(v.decisions ?? []).filter((d: string) => d !== EXCLUSIVE_DECISION), kind])];
          if (next.length !== (v.decisions ?? []).length || next.some((d) => !(v.decisions ?? []).includes(d))) {
            await tx.visit.update({ where: { id: visitId }, data: { decisions: next } });
          }
        }
      }
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
    /* ⚠️ `sendForStaff` نه `send`: این دکمهٔ پنلِ کارکنان است و باید **علتِ واقعیِ** ردِ پیامک را ببیند (کلید/خط تنظیم
       نیست، اعتبار، متنِ ردِ ملی‌پیامک)، نه ۵۰۳ِ کلیِ عمومی که برای ورودِ ناشناس ساخته شده — گزارشِ آمادگیِ فروش،
       بندِ ۳. ردِ قطعی در production **پرتاب** می‌شود؛ تا امروز همین‌جا قورت داده نمی‌شد و ثبتِ «نرفت» و کارِ
       «ارسالِ دوباره»ی پایین فقط بیرون از production می‌دوید. «نتیجه نامعلوم» (قطعِ شبکه) عمداً ثبت نمی‌شود: شاید
       پیام رفته باشد و «ارسالِ دوباره» تکراری می‌سازد؛ همان خطا به کارمند می‌رسد. */
    let res: { sent: boolean; stub: boolean; detail?: string };
    try {
      res = await this.sms.sendForStaff(to, text);
    } catch (e: any) {
      /* «نامعلوم» با `code` جدا می‌شود تا رابط آن را «ناموفق» نخواند و به ارسالِ دوباره (= پیامِ احتمالاً تکراری) دعوت نکند. */
      if (e?.smsOutcome === 'unknown') {
        throw new ServiceUnavailableException({ message: `سفارش ثبت شد؛ ${String(e.message ?? 'نتیجهٔ ارسال مشخص نشد')}`, code: 'SMS_UNKNOWN' });
      }
      if (e?.smsOutcome !== 'rejected' && e?.smsOutcome !== 'unconfigured') throw e;
      res = { sent: false, stub: false, detail: String(e.message ?? '') };
    }
    const delivered = res.sent || res.stub;
    const reason = (res.detail || 'سرویس پیامک ارسال را نپذیرفت').slice(0, 300);
    /* سفارش فقط وقتی «فرستاده‌شده» است که پیامک واقعاً (یا آزمایشی) رفته باشد — پیامِ نرفته آن را «ارسال‌شده» نمی‌کند. */
    if (delivered) {
      await this.prisma.$transaction(async tx => {
        const current = await this.locked(kind, id, tx);
        await this.table(kind, tx).update({ where: { id }, data: {
          status: current.status === 'draft' ? 'sent' : current.status, sentAt: new Date(),
        } });
      });
    }
    const rem = await this.prisma.reminder.create({
      data: {
        patientId: row.patientId, visitId: row.visitId ?? null, kind: 'notice',
        dueAt: new Date(), phone: to, text,
        status: delivered ? 'sent' : 'failed', sentAt: delivered ? new Date() : null,
        ...(delivered ? {} : { error: reason }),
      },
    }).catch(() => null);
    /* W2.2: پیامکی که همین‌جا نرفت ← کارِ «ارسالِ دوباره» برای منشی (work-rules: sms.failed). */
    if (!delivered) {
      await this.events.emit({
        type: 'sms.failed', patientId: row.patientId, visitId: row.visitId ?? null, actorId: user?.id ?? null,
        ...(rem ? { refType: 'reminder', refId: rem.id } : { refType: `${kind}_order`, refId: id }),
        payload: { kind: 'notice', error: reason, direct: true },
      });
    }
    await this.audit.record({
      actorId: user?.id, action: `order.${kind}.send`, entityType: `${kind}_order`, entityId: id,
      after: { to, sent: res.sent, stub: res.stub },
    });
    /* سفارش ذخیره است و همه‌چیز ثبت شد؛ ولی پاسخِ «ok» دروغ است وقتی پیامک نرفته — کارمند علتِ واقعی را می‌بیند. */
    if (!delivered) throw new ServiceUnavailableException(`سفارش ثبت شد ولی پیامک نرفت — ${reason}`);
    await this.supersedeFailedLinks(row, rem?.id ?? null, user);
    return { ok: true, to, url, sent: res.sent, stub: res.stub };
  }

  /**
   * همین لینک حالا رفت ← ردیف‌های «نرفت»ِ قبلیِ همان لینک کنار می‌روند و کارِ «ارسالِ دوباره»شان بسته می‌شود.
   *
   * ⚠️ شیت پس از ردِ پیامک باز می‌ماند و کارمند همان «ثبت و ارسال» را دوباره می‌زند؛ اگر ردیفِ «نرفت»ِ قبلی و کارش
   * می‌ماندند، منشی بعداً «ارسالِ دوباره» را می‌زد و بیمار همان لینک را دو بار می‌گرفت. فقط ردیف‌های همان پرونده که
   * دقیقاً همین توکن را دارند، و فقط `failed` (نه «نامعلوم» — آن را آدم باید ببیند).
   */
  private async supersedeFailedLinks(row: any, keepId: number | null, user: any) {
    try {
      const stale = await this.prisma.reminder.findMany({
        where: { patientId: row.patientId, kind: 'notice', status: 'failed', text: { contains: `/o/${row.token}` },
          ...(keepId ? { id: { not: keepId } } : {}) },
        select: { id: true, patientId: true, visitId: true, appointmentId: true, kind: true, text: true },
      });
      for (const r of stale) {
        if (orderTokenIn(r.text) !== row.token) continue;
        const done = await this.prisma.reminder.updateMany({ where: { id: r.id, status: 'failed' },
          data: { status: 'cancelled', error: 'همین لینک بعداً با موفقیت فرستاده شد' } });
        if (done.count) await emitSms(this.prisma, r, 'sms.cancelled', { reason: 'superseded', actorId: user?.id ?? null });
      }
    } catch { /* پیامک رفته است؛ پاک‌سازیِ ردیفِ قدیمی نباید پاسخِ موفق را خراب کند */ }
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
        reviewNote: row.status === 'needs_action' ? row.reviewNote ?? null : null,
        /* توضیحِ صوتیِ پزشک برای همین درخواست — بیمار باید بشنودش (فقط صدای کارکنان، نه فایلِ خودِ بیمار). */
        voices: (await this.prisma.document.findMany({
          where: { refType: `${kind}_order`, refId: row.id, patientId: row.patientId, deletedAt: null,
            uploadedById: { not: null }, mimeType: { startsWith: 'audio/' } },
          select: { id: true, title: true }, orderBy: { id: 'asc' },
        })).map((d) => ({ id: d.id, title: d.title })),
        /* آنچه بیمار تا حالا فرستاده — صفحهٔ بیمار شمارش را نشان می‌دهد تا «دوباره بفرستم؟» حدسی نباشد. */
        sentFiles: await this.patientFileCount(kind, row, this.prisma),
      };
    }
    throw new NotFoundException('این نشانی معتبر نیست یا منقضی شده');
  }

  /** پخشِ توضیحِ صوتیِ پزشک در صفحهٔ عمومی — فقط صدای کارکنانِ متصل به همین توکن. */
  async publicVoice(token: string, documentId: number) {
    for (const kind of ORDER_KINDS) {
      const row = await this.table(kind).findUnique({ where: { token } });
      if (!row) continue;
      const doc = await this.prisma.document.findFirst({ where: { id: documentId, refType: `${kind}_order`, refId: row.id,
        patientId: row.patientId, deletedAt: null, uploadedById: { not: null }, mimeType: { startsWith: 'audio/' } } });
      if (!doc) throw new NotFoundException('فایل پیدا نشد');
      return { mimeType: doc.mimeType, stream: this.storage.stream(doc.sha256) };
    }
    throw new NotFoundException('این نشانی معتبر نیست یا منقضی شده');
  }

  /**
   * ثبتِ پاسخ توسطِ خودِ بیمار (لینک/متن/فایلِ جواب).
   *
   * ⚠️ **فایل هم خودش یک پاسخِ کامل است.** جوابِ آزمایش معمولاً فقط یک عکس یا
   * PDF است و متنی ندارد؛ تا دیروز اگر بیمار فقط فایل می‌گذاشت این‌جا
   * «متن یا لینکِ پاسخ را وارد کنید» می‌گرفت و مجبور می‌شد چیزی بنویسد.
   * پس شرطِ خالی‌نبودن حالا مدارکِ پیوست‌شده را هم می‌بیند.
   *
   * ⚠️ **`append` وضعیت و تصمیمِ بررسی را دست نمی‌زند** (قرارداد §۵): بیمار که
   * بعد از بررسیِ پزشک صفحهٔ دومِ جواب را می‌فرستد، نباید `reviewNote` و
   * `reviewedAt`ِ ثبت‌شده را پاک کند — آن تصمیم روی موادِ همان‌موقع گرفته شده و
   * سندِ پرونده است. فقط مدرکِ تازه ساخته می‌شود و یک رویداد می‌رود تا کارِ
   * بررسی دوباره باز شود.
   */
  async publicAnswer(token: string, dto: any) {
    for (const kind of ORDER_KINDS) {
      const row = await this.table(kind).findUnique({ where: { token } });
      if (!row) continue;
      if (kind === 'referral') throw new BadRequestException('برای نامهٔ ارجاع پاسخی ثبت نمی‌شود');
      const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      const text = str(dto?.text);
      const link = str(dto?.link, 500);
      const append = dto?.append === true;
      return this.prisma.$transaction(async tx => {
        const current = await this.locked(kind, row.id, tx);
        if (!await tx.patient.findFirst({ where: { id: current.patientId, deletedAt: null }, select: { id: true } })) throw new NotFoundException('پرونده پیدا نشد');
        /* فقط موادِ خودِ بیمار — صدای پزشک روی همین سفارش «پاسخ» نیست. */
        const files = await this.patientFileCount(kind, current, tx);
        if (!text && !link && !files) throw new BadRequestException('متن، لینک یا فایلِ پاسخ را بفرستید');
        /* پس از «ناقص است» همان موادِ قبلی دوباره «پاسخ» نمی‌شود: باید چیزِ تازه‌ای آمده باشد. */
        if (current.status === 'needs_action' && !text && !link && !await this.newSinceReview(kind, current, tx)) {
          throw new BadRequestException('پزشک پاسخِ قبلی را ناقص دانسته — فایل یا توضیحِ تازه بفرستید');
        }
        /* متنِ خالیِ ارسالِ دوم متنِ قبلی را پاک نمی‌کند. */
        const keep = (v: string, k: string) => v || current[k] || null;
        const data: any = kind === 'consult' ? { answerText: keep(text, 'answerText'), answerLink: keep(link, 'answerLink') }
          : { resultText: keep(text, 'resultText'), resultLink: keep(link, 'resultLink'),
            resultUser: str(dto?.user, 120) || current.resultUser || null, resultPass: str(dto?.pass, 120) || current.resultPass || null };

        if (['sent', 'needs_action'].includes(current.status)) {
          await this.answered(kind, current, data, tx, null);
          return { ok: true, status: 'answered' };
        }
        if (!append) throw new ConflictException('پاسخ قبلاً ثبت شده یا سفارش آماده پاسخ نیست');
        if (!ANSWERED_STATUSES.includes(current.status)) throw new ConflictException('این سفارش آماده پاسخ نیست');

        /* افزودنِ متن/لینکِ تازه — مدرکِ تکراری دوباره ساخته نمی‌شود، پس
           دوبار زدنِ همان دکمه کارِ بررسی را الکی باز نمی‌کند. */
        const made = await this.answerDocuments(kind, current, data, tx, null);
        if (!made) {
          /* «افزودن» پس از بارگذاریِ فایل: فایل‌ها همان لحظهٔ بارگذاری ثبت شده‌اند (`publicUpload`) و
             کارِ بررسی را هم باز کرده‌اند. تا ۱۴۰۵/۰۸/۰۴ این‌جا خطای «قبلاً ثبت شده» می‌آمد در حالی که
             فایل‌ها واقعاً رسیده بودند — بیمار گیج می‌شد و دوباره می‌فرستاد (گزارشِ مالک). */
          const recent = await tx.document.count({ where: { refType: `${kind}_order`, refId: current.id,
            patientId: current.patientId, deletedAt: null, uploadedById: null, contentText: null, externalUrl: null,
            createdAt: { gt: new Date(Date.now() - 2 * 3600_000) } } });
          /* فقط «افزودنِ» بی‌متن و بی‌لینک: همان متنِ تکراری هنوز ۴۰۰ است (دوبار زدنِ دکمه). */
          if (!recent || text || link) throw new BadRequestException('چیزی برای افزودن نیست — همین پاسخ قبلاً ثبت شده');
          return { ok: true, status: current.status, appended: 0, files: recent };
        }
        await this.reopenReview(kind, current, tx, `order.${kind}.appended`, { added: made });
        return { ok: true, status: current.status, appended: made };
      });
    }
    throw new NotFoundException('این نشانی معتبر نیست یا منقضی شده');
  }

  /**
   * آپلودِ فایلِ پاسخ از صفحهٔ عمومیِ بیمار (قرارداد §۵).
   *
   * ⚠️ مسیرش زیرِ همان `public/order`ِ موجود است نه یک پیشوندِ تازه — یک سطحِ
   * عمومی برای یک چیز.
   *
   * سه گاردی که هرکدام جلوی یک سوءاستفادهٔ مشخص را می‌گیرند:
   * ۱. نوع از **بایت‌های فایل** سنجیده می‌شود (`sniffMime`)، نه از هدرِ کلاینت —
   *    مسیرِ دانلود همان `mimeType` را در `Content-Type` می‌گذارد و برای عکس
   *    `inline` می‌دهد، پس دروغِ کلاینت یعنی هرچه او بخواهد در مرورگرِ کارکنان.
   * ۲. سقفِ ۵ فایل به‌ازای هر سفارش، وگرنه این نشانیِ بی‌احراز یک انبارِ آزاد است.
   * ۳. `draft` رد می‌شود: توکنِ سفارشی که هنوز برای بیمار نرفته نباید فایل بگیرد.
   *
   * ⚠️ فایل همین‌جا به سفارش **وصل** می‌شود (`refType`/`refId`) ولی وضعیت را جلو
   * نمی‌برد: بیمار سه صفحهٔ جواب را جدا آپلود می‌کند و یک‌بار «ثبت» می‌زند —
   * یک گذارِ وضعیت، نه سه تا. تنها استثنا سفارشِ **پاسخ‌داده‌شده** است که دیگر
   * مرحلهٔ «ثبت» ندارد؛ آن‌جا خودِ فایل افزودن است و کارِ بررسی را باز می‌کند.
   */
  async publicUpload(token: string, file: { originalname?: string; mimetype?: string; buffer?: Buffer; size?: number }) {
    for (const kind of ORDER_KINDS) {
      const row = await this.table(kind).findUnique({ where: { token } });
      if (!row) continue;
      if (kind === 'referral') throw new BadRequestException('برای نامهٔ ارجاع پاسخی ثبت نمی‌شود');
      this.rateLimit.hit(`order-upload:${token}`, MAX_ANSWER_FILES * 4, 15 * 60_000);

      if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
      if ((file.size ?? file.buffer.length) > MAX_ANSWER_BYTES) {
        throw new BadRequestException(`حجمِ فایل بیش از ${faNum(MAX_ANSWER_BYTES / 1024 / 1024)} مگابایت است`);
      }
      const mime = sniffMime(file.buffer);
      if (!mime) throw new BadRequestException('فقط عکس (JPG/PNG/WebP/HEIC)، PDF یا صدای ضبط‌شده بفرستید');

      const { sha256, size } = await this.storage.save(file.buffer);
      return this.prisma.$transaction(async tx => {
        const current = await this.locked(kind, row.id, tx);
        if (!await tx.patient.findFirst({ where: { id: current.patientId, deletedAt: null }, select: { id: true } })) throw new NotFoundException('پرونده پیدا نشد');
        if (current.status === 'draft') throw new ConflictException('این سفارش هنوز برای شما ارسال نشده است');
        if (await this.patientFileCount(kind, current, tx) >= MAX_ANSWER_FILES) {
          throw new BadRequestException(`برای هر درخواست حداکثر ${faNum(MAX_ANSWER_FILES)} فایل می‌شود فرستاد`);
        }
        const doc = await tx.document.create({ data: {
          patientId: current.patientId, visitId: current.visitId,
          refType: `${kind}_order`, refId: current.id,
          category: kind === 'lab' ? 'lab' : kind === 'imaging' ? 'imaging' : 'report',
          title: mime.startsWith('audio/') ? `توضیحِ صوتیِ پاسخ ${FA[kind]}` : `پاسخ ${FA[kind]}`,
          fileName: (file.originalname || '').slice(0, 200) || 'file',
          mimeType: mime, sha256, size,
        } });
        if (ANSWERED_STATUSES.includes(current.status)) {
          await this.reopenReview(kind, current, tx, `order.${kind}.appended`, { documentId: doc.id });
        } else {
          await this.audit.record({ actorId: null, action: `order.${kind}.file`, entityType: `${kind}_order`,
            entityId: current.id, after: { documentId: doc.id, size } }, tx);
        }
        return { id: doc.id, name: doc.fileName, size: doc.size };
      });
    }
    throw new NotFoundException('این نشانی معتبر نیست یا منقضی شده');
  }

  /** فایل‌های **خودِ بیمار** روی این سفارش — صدا/عکسی که کارکنان پیوست کرده‌اند جزوِ سقف و «پاسخ» نیست. */
  private patientFileCount(kind: OrderKind, row: any, tx: any): Promise<number> {
    return tx.document.count({ where: { refType: `${kind}_order`, refId: row.id,
      patientId: row.patientId, deletedAt: null, contentText: null, externalUrl: null, uploadedById: null } });
  }

  /**
   * موادِ تازه روی سفارشی که قبلاً پاسخ داده شده: وضعیت و `reviewNote` دست
   * نمی‌خورند، ولی `order.answered` می‌رود تا کارِ بررسی دوباره باز شود.
   */
  private async reopenReview(kind: OrderKind, row: any, tx: any, action: string, after: any) {
    const visit = row.visitId ? await tx.visit.findUnique({ where: { id: row.visitId },
      select: { surgeon: { select: { person: { select: { account: { select: { id: true, status: true } } } } } } } }) : null;
    const doctor = visit?.surgeon?.person?.account;
    await this.events.emit({ type: 'order.answered', patientId: row.patientId, visitId: row.visitId,
      refType: `${kind}_order`, refId: row.id, actorId: null,
      payload: { doctorId: doctor?.status === 'active' ? doctor.id : null, again: true },
    }, tx);
    await this.audit.record({ actorId: null, action, entityType: `${kind}_order`,
      entityId: row.id, before: { status: row.status }, after }, tx);
  }
}
