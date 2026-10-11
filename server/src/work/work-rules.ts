/**
 * قواعدِ «رویداد ← کار» — **خالص**، بدونِ Prisma و Nest، تا با یک `node -e` سنجیده شود.
 *
 * هر رویدادِ دامنه (`DomainEvent`) یا کاری می‌سازد/تازه می‌کند (`upserts`) یا کارِ
 * بازی را می‌بندد (`closes`) یا هیچ. کلیدِ یکتا طبقِ `docs/plan/CONTRACTS.md` §۱:
 * `${type}:${refType}:${refId}` — رویدادِ تکراری همان کار را **باز نگه می‌دارد**،
 * دومی نمی‌سازد.
 *
 * ⚠️ این‌جا فقط «چه کاری برای چه نقشی» است؛ اینکه رویداد کِی و کجا `emit`
 * می‌شود کارِ W2.2 (یک خط در هر سرویس) است. قاعدهٔ تازه = یک ردیف در `RULES`
 * + یک سنجه در `scripts/e2e/w2-1-work-layer.mjs`.
 */

export interface DomainEventLike {
  id?: number;
  type: string;
  patientId?: number | null;
  visitId?: number | null;
  appointmentId?: number | null;
  refType?: string | null;
  refId?: number | null;
  payload?: any;
  actorId?: number | null;
  at?: Date;
}

export interface WorkUpsert {
  reopen?: boolean;
  type: string;
  title: string;
  ownerRole?: string | null;
  ownerAccountId?: number | null;
  patientId?: number | null;
  visitId?: number | null;
  appointmentId?: number | null;
  refType?: string | null;
  refId?: number | null;
  dueAt?: Date | null;
  priority?: number;
  note?: string | null;
  idempotencyKey: string;
  sourceEventId?: number | null;
}

export interface WorkClose {
  type?: string;
  refType: string;
  refId: number;
}

export interface RuleOutcome {
  upserts: WorkUpsert[];
  closes: WorkClose[];
}

const DAY = 24 * 3600 * 1000;
const inDays = (n: number, from: Date = new Date()) => new Date(from.getTime() + n * DAY);

/** برچسبِ فارسیِ نوعِ سفارش برای عنوانِ کار. */
const ORDER_FA: Record<string, string> = {
  lab_order: 'آزمایش',
  imaging_order: 'تصویربرداری',
  consult_order: 'مشاوره',
  referral_order: 'ارجاع',
};

/** ارجاعِ کار = ارجاعِ رویداد؛ اگر رویداد ارجاعِ آزاد ندارد، مراجعه یا بیمار. */
function refOf(e: DomainEventLike): { refType: string; refId: number } | null {
  if (e.refType && e.refId) return { refType: e.refType, refId: e.refId };
  if (e.appointmentId) return { refType: 'appointment', refId: e.appointmentId };
  if (e.visitId) return { refType: 'visit', refId: e.visitId };
  if (e.patientId) return { refType: 'patient', refId: e.patientId };
  return null;
}

/**
 * برچسبِ فارسیِ **مالکِ** کار — کلیدها دقیقاً همان‌هایی‌اند که `RULES` پایین
 * `ownerRole` می‌دهد.
 *
 * ⚠️ چرا این‌جا و نه در کلاینت: نسخهٔ کلاینتی‌اش `admin` را نداشت (که همین فایل
 * صادرش می‌کند) و در عوض سه نقشِ هرگز-صادرنشده داشت — یعنی رابطِ فارسی کلیدِ
 * خامِ `admin` را چاپ می‌کرد. برچسب کنارِ جایی می‌ماند که کلید ساخته می‌شود.
 *
 * ⚠️ و چرا `JOB_ROLES` کافی نیست: آن مجموعهٔ نقشِ **کارکنان** است و نه `admin`
 * دارد نه `patient` — دو مالکی که لایهٔ کار واقعاً می‌سازد.
 */
export const OWNER_ROLE_FA: Record<string, string> = {
  admin: 'مدیر',
  doctor: 'پزشک',
  secretary: 'منشی',
  technician: 'کارشناس',
  patient: 'خودِ بیمار',
};

const key = (type: string, ref: { refType: string; refId: number }) => `${type}:${ref.refType}:${ref.refId}`;

function base(e: DomainEventLike, type: string, ref: { refType: string; refId: number }): Omit<WorkUpsert, 'title'> {
  return {
    type,
    patientId: e.patientId ?? null,
    visitId: e.visitId ?? null,
    appointmentId: e.appointmentId ?? null,
    refType: ref.refType,
    refId: ref.refId,
    idempotencyKey: key(type, ref),
    sourceEventId: e.id ?? null,
    priority: 1,
  };
}

type Rule = (e: DomainEventLike, ref: { refType: string; refId: number }) => RuleOutcome;

const upsert = (u: WorkUpsert): RuleOutcome => ({ upserts: [u], closes: [] });
const close = (ref: { refType: string; refId: number }, ...types: string[]): RuleOutcome => ({
  upserts: [],
  closes: types.length ? types.map((type) => ({ ...ref, type })) : [ref],
});
const none: RuleOutcome = { upserts: [], closes: [] };

/**
 * جدولِ قواعد. `ownerAccountId` وقتی رویداد شخصِ مشخصی دارد (`payload.techId`،
 * `payload.doctorId`) پر می‌شود؛ وگرنه کار در **صفِ نقش** می‌ماند تا کسی بردارد.
 *
 * ⚠️ **`reopen` روی کارهای آشکارساز** (`work-detectors.ts`: عملِ بی‌وضعیت، گزارشِ
 * نیامده، مصرفِ تأییدنشده، فرمِ بی‌پاسخ، گامِ عقب‌افتادهٔ مسیر). آشکارساز فقط وقتی
 * دوباره رویداد می‌دهد که **خودِ مشکل هنوز هست** (هفته‌ای یک‌بار به‌ازای هر ref)؛
 * پس کاری که با «بستن بدونِ اقدام» بسته شده — یا عملی که «موکول» شد و تاریخِ تازه‌اش
 * هم گذشت — باید دوباره باز شود. بی‌این، همان کار برای همیشه «انجام‌شده» می‌ماند و
 * یادآوری دیگر هرگز نمی‌آمد (بازبینیِ UX، company-01). بازپخشِ رویدادِ قدیمی همچنان
 * بازش نمی‌کند (`upsertWork` شناسهٔ رویداد را می‌سنجد).
 */
export const RULES: Record<string, Rule> = {
  /* ── سفارش‌های بالینی (D02) ── */
  'order.answered': (e, ref) => ({ upserts: [{
    ...base(e, 'review_result', ref),
    title: `بررسیِ نتیجهٔ ${ORDER_FA[ref.refType] ?? 'سفارش'}`,
    ownerRole: 'doctor',
    ownerAccountId: e.payload?.doctorId ?? null,
    dueAt: inDays(1, e.at),
    priority: 2,
    reopen: true,
  }], closes: [{ ...ref, type: 'upload_result' }] }),
  'order.reviewed': (_e, ref) => close(ref, 'review_result', 'upload_result'),
  'order.needs_action': (e, ref) => ({
    upserts: [{
      ...base(e, 'upload_result', ref),
      title: `ارسالِ دوبارهٔ نتیجهٔ ${ORDER_FA[ref.refType] ?? 'سفارش'}`,
      ownerRole: 'patient',
      reopen: true,
      dueAt: inDays(3, e.at),
      note: e.payload?.reason ?? null,
    }],
    closes: [{ ...ref, type: 'review_result' }],
  }),

  /* ── فرم‌های زیرپرونده/پیگیری (D01) ── */
  'form.answered': (e, ref) => ({
    upserts: [{ ...base(e, 'review_form', ref), title: 'بررسیِ پاسخِ فرمِ بیمار', ownerRole: 'doctor', dueAt: inDays(1, e.at) }],
    closes: [{ ...ref, type: 'follow_up_unanswered' }],
  }),
  'form.reviewed': (_e, ref) => close(ref, 'review_form'),
  'form.unanswered': (e, ref) => upsert({
    ...base(e, 'follow_up_unanswered', ref),
    title: 'تماس با بیمار — فرمِ پیگیری بی‌پاسخ مانده',
    ownerRole: 'secretary',
    dueAt: e.at ?? new Date(),
    priority: 2,
    reopen: true,
  }),

  /* ── مسیرِ درمان (W4.2) ──
     «عدمِ پاسخ»: گامی که `escalateDays` روز بعد از موعدش هنوز باز است.
     ⚠️ مسئولِ کار **همان نقشِ گام** است، نه یک نقشِ ثابت: گامِ «مراقبتِ پس از
     عمل» مالِ پرستار است و گامِ «ویزیتِ پیگیری» مالِ پزشک؛ فرستادنِ هر دو به
     یک صف یعنی یکی‌شان همیشه در صفِ اشتباه بماند. */
  'pathway.step_overdue': (e, ref) => upsert({
    ...base(e, 'pathway_step', ref),
    title: `پیگیریِ مرحلهٔ «${String(e.payload?.title ?? 'مسیرِ درمان')}»`,
    ownerRole: (e.payload?.ownerRole as string) ?? null,
    dueAt: e.at ?? new Date(),
    priority: 2,
    reopen: true,
  }),
  /* گامی که بالاخره بسته شد، کارِ پیگیری‌اش را هم می‌بندد. */
  'pathway.step_closed': (_e, ref) => close(ref, 'pathway_step'),

  /* ── ثبت‌نام (D04) ── */
  /* ⚠️ `reopen`: ثبت‌نامی که برای اصلاح برگشته بود (کارش با `intake.returned` بسته شد) با
     ارسالِ دوبارهٔ بیمار همان کار را **باز** می‌کند — کلیدِ یکتا همان است، پس بی‌این یک
     ثبت‌نامِ اصلاح‌شده بی‌صدا از صفِ کارِ منشی غیب می‌شد. بازپخشِ رویدادِ قدیمی بازش نمی‌کند. */
  'intake.submitted': (e, ref) => upsert({
    ...base(e, 'approve_intake', ref),
    title: 'بررسی و تأییدِ ثبت‌نام',
    ownerRole: 'secretary',
    dueAt: inDays(1, e.at),
    priority: 2,
    reopen: true,
  }),
  /* برگشت برای اصلاح: کار منتظرِ بیمار است نه منشی. */
  'intake.returned': (_e, ref) => close(ref, 'approve_intake'),
  'intake.approved': (_e, ref) => close(ref, 'approve_intake', 'repair_intake'),
  'intake.rejected': (_e, ref) => close(ref, 'approve_intake'),
  'intake.approve_failed': (e, ref) => upsert({
    ...base(e, 'repair_intake', ref),
    title: 'تأییدِ نیمه‌کاره — پرداخت/مراجعه باید بازبینی شود',
    ownerRole: 'admin',
    dueAt: e.at ?? new Date(),
    priority: 3,
    note: e.payload?.error ?? null,
  }),
  'intake.approval_sync_pending': (e, ref) => upsert({
    ...base(e, 'repair_intake', ref),
    title: 'همگام‌سازی یادآوری‌های پس از تأیید ثبت‌نام',
    ownerRole: 'admin', dueAt: e.at ?? new Date(), priority: 2,
    note: 'تأیید و پرداخت ثبت شده‌اند؛ یادآوری نوبت و برنامه مراجعه را بررسی کنید.',
  }),
  'intake.approval_synced': (_e, ref) => close(ref, 'repair_intake'),

  /* ── نوبت‌ها ── */
  'appointment.held': (e, ref) => upsert({
    ...base(e, 'confirm_appointment', ref),
    title: 'تأییدِ نوبتِ رزروشده',
    ownerRole: 'secretary',
    dueAt: e.payload?.date ? new Date(e.payload.date) : inDays(1, e.at),
  }),
  'appointment.confirmed': (_e, ref) => close(ref, 'confirm_appointment'),
  'appointment.cancelled': (_e, ref) => close(ref, 'confirm_appointment', 'call_patient'),
  'appointment.noshow': (e, ref) => upsert({
    ...base(e, 'call_patient', ref),
    title: 'تماس با بیمارِ غایب و تعیینِ نوبتِ تازه',
    ownerRole: 'secretary',
    dueAt: e.at ?? new Date(),
    priority: 2,
  }),
  'appointment.started': (_e, ref) => close(ref, 'confirm_appointment', 'call_patient'),

  /* ── عمل و کارشناس (D07, U-tech) ── */
  'visit.unconfirmed': (e, ref) => upsert({
    ...base(e, 'confirm_surgery_done', ref),
    title: 'وضعیتِ عمل ثبت نشده — انجام شد یا موکول؟',
    ownerRole: 'technician',
    ownerAccountId: e.payload?.techId ?? null,
    dueAt: e.at ?? new Date(),
    priority: 2,
    reopen: true,
  }),
  'visit.done': (_e, ref) => close(ref, 'confirm_surgery_done'),
  /* «موکول شد» (پنلِ کارشناسی، ۱۴۰۵/۰۷/۰۵) هم جوابِ همین پرسش است — عمل دیگر «بی‌وضعیت» نیست؛
     اگر تاریخِ تازه هم بگذرد و ثبت نشود، آشکارساز دوباره می‌پرسد. */
  'visit.postponed': (_e, ref) => close(ref, 'confirm_surgery_done'),
  'visit.cancelled': (_e, ref) => close(ref, 'confirm_surgery_done', 'complete_report', 'confirm_usage'),
  /* مطب (`payload.clinic`): گزارش همان شرحِ عمل است و کارِ پزشک — نه کارشناس (work-detectors).
     شرکت: «گزارشِ خدمت» — شرکت عمل انجام نمی‌دهد، خدمتی حینِ عمل می‌دهد و گزارشِ همان را
     برای بیمه و پرونده بارگذاری می‌کند (مالک، ۱۴۰۵/۰۷/۰۵: «این‌ها را از هم تفکیک کن»). */
  'report.missing': (e, ref) => upsert({
    ...base(e, 'complete_report', ref),
    title: e.payload?.clinic ? 'شرحِ عمل هنوز نوشته نشده' : 'گزارشِ خدمت هنوز بارگذاری نشده',
    ownerRole: e.payload?.clinic ? 'doctor' : 'technician',
    ownerAccountId: (e.payload?.clinic ? e.payload?.doctorId : e.payload?.techId) ?? null,
    dueAt: inDays(1, e.at),
    reopen: true,
  }),
  'report.uploaded': (_e, ref) => close(ref, 'complete_report'),
  'usage.unconfirmed': (e, ref) => upsert({
    ...base(e, 'confirm_usage', ref),
    title: 'تأییدِ مصرفِ سرِ عمل',
    ownerRole: 'technician',
    ownerAccountId: e.payload?.techId ?? null,
    dueAt: inDays(1, e.at),
    reopen: true,
  }),
  'usage.confirmed': (_e, ref) => close(ref, 'confirm_usage'),
  /* ── تحویلِ دوطرفه (مالک، ۱۴۰۵/۰۷/۱۱) ── راننده «تحویل دادم» زده و تا پایانِ روزِ تحویل کارشناس
     «تحویل گرفتم» نزده (work-detectors؛ ref = خودِ حواله). کارِ **دفتر** است نه کارشناس: دفتر
     باید زنگ بزند و بفهمد ست کجاست — کارشناسی که تأیید نمی‌زند همان کسی نیست که یادآوری را
     می‌خواند. */
  'delivery.unconfirmed': (e, ref) => upsert({
    ...base(e, 'confirm_delivery', ref),
    title: `تحویلِ ست تأیید نشده — ${e.payload?.code ? `حوالهٔ ${e.payload.code}` : 'حواله'}${e.payload?.techName ? ` (${e.payload.techName})` : ''}`,
    ownerRole: 'secretary',
    dueAt: e.at ?? new Date(),
    priority: 2,
    note: e.payload?.place ? `تحویلِ راننده در ${e.payload.place}` : null,
    reopen: true,
  }),
  'delivery.confirmed': (_e, ref) => close(ref, 'confirm_delivery'),

  /* ── مالی ── */
  'invoice.ready': (e, ref) => upsert({
    ...base(e, 'issue_invoice', ref),
    title: 'پرونده آمادهٔ صدورِ فاکتور است',
    ownerRole: 'admin',
    dueAt: inDays(2, e.at),
  }),
  'invoice.issued': (_e, ref) => close(ref, 'issue_invoice'),

  /* ── پیامک (N4) ── */
  'sms.failed': (e, ref) => upsert({
    ...base(e, 'resend_sms', ref),
    title: `پیامک نرفت${e.payload?.kind ? ` (${e.payload.kind})` : ''} — بررسی و ارسالِ دوباره`,
    ownerRole: 'secretary',
    dueAt: e.at ?? new Date(),
    priority: 2,
    note: e.payload?.error ?? null,
  }),
  'sms.sent': (_e, ref) => close(ref, 'resend_sms'),
  /* ردیفِ «نرفت» کنار رفت (لغو در دفترِ پیام‌ها، یا همان لینک بعداً از شیتِ سفارش رفت) — کارِ «ارسالِ دوباره»ی
     بازمانده یعنی پیامِ تکراری برای بیمار. */
  'sms.cancelled': (_e, ref) => close(ref, 'resend_sms'),
};

export function rulesFor(e: DomainEventLike): RuleOutcome {
  const rule = RULES[e.type];
  if (!rule) return none;
  const ref = refOf(e);
  if (!ref) return none;
  return rule(e, ref);
}

export const KNOWN_EVENT_TYPES = Object.keys(RULES);
