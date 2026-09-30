import { Injectable } from '@nestjs/common';
import { APPT_LABELS, OP_LABELS } from '../patients/labels';
import { PrismaService } from '../prisma/prisma.service';
import { FeaturesService } from '../features/features.service';
import { LEVEL } from '../common/levels';
import { isUnrestricted, ownVisitWhere } from '../common/own-scope';
import { AvailabilityService } from '../patients/availability.service';
import { WorkService } from './work.service';
import { canAccess } from '../auth/access-check';
import { CLINIC_TZ, clinicTodayIso, todayRangeUtc } from '../common/clinic-day';

/* سقفِ فهرستِ کارها روی «امروز»: هشت تا برای «کارهای من»؛ نمای تیم کمی بیشتر چون صفِ
   همه است — ولی نه آن‌قدر که عمل‌ها و نوبت‌های امروز زیرش گم شوند. فهرستِ کامل (و
   فیلترِ هر شخص) در `/app/work` است و فیلترِ «مالِ کیست» همین صفحه هم از سرور می‌پرسد. */
const WORK_LIMIT = 8;
const TEAM_WORK_LIMIT = 12;

/**
 * نوعِ مراجعه به فارسی — برای چیپِ هر ردیف در «امروز». مطب ویزیت و عمل را در یک فهرست
 * دارد و تا دیروز همه «ویزیت» خوانده می‌شدند؛ ردیفی با «بیمارستان پارس» ویزیت بود و یک
 * بیمار یک‌بار «در انتظار» و یک‌بار «انجام شد» می‌آمد بی‌آنکه معلوم باشد کدام عمل است
 * (بازبینیِ UX ۱۴۰۵/۰۷). نوعِ ناشناخته عنوانِ فرمِ خودش را می‌گیرد، نه «عمل».
 */
/* ساعتِ «اکنون» به وقتِ مطب (`HH:MM`) — فرمتر یک‌بار ساخته می‌شود (ساختنِ `Intl` گران است). */
const HHMM = new Intl.DateTimeFormat('en-GB', { timeZone: CLINIC_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const nowHHMM = (at: Date) => HHMM.format(at);

const KIND_FA: Record<string, string> = {
  surgery: 'عمل', clinic: 'ویزیت', followup: 'پیگیری', consult: 'مشاوره',
};

/**
 * رویدادِ دامنه به فارسی — کارتِ «رویدادِ پردازش‌نشده» در نمای استثنا تا دیروز نوعِ خامِ
 * انگلیسی (`appointment.cancelled`) را نشان می‌داد. کلید همان `RULES`ِ `work-rules.ts` است؛
 * نوعِ تازه‌ای که این‌جا نیامده «رویدادِ سامانه» می‌خورد، نه کلیدِ خام.
 */
const EVENT_FA: Record<string, string> = {
  'order.answered': 'پاسخِ سفارش رسید',
  'order.reviewed': 'سفارش بررسی شد',
  'order.needs_action': 'نتیجه باید دوباره فرستاده شود',
  'form.answered': 'پاسخِ فرمِ بیمار رسید',
  'form.reviewed': 'پاسخِ فرم بررسی شد',
  'form.unanswered': 'فرمِ پیگیری بی‌پاسخ ماند',
  'pathway.step_overdue': 'مرحلهٔ مسیرِ درمان عقب افتاد',
  'pathway.step_closed': 'مرحلهٔ مسیرِ درمان بسته شد',
  'intake.submitted': 'ثبت‌نامِ تازه رسید',
  'intake.returned': 'ثبت‌نام برای اصلاح برگشت',
  'intake.approved': 'ثبت‌نام تأیید شد',
  'intake.rejected': 'ثبت‌نام رد شد',
  'intake.approve_failed': 'تأییدِ ثبت‌نام ناتمام ماند',
  'intake.approval_sync_pending': 'تأییدِ ثبت‌نام در انتظارِ هم‌گام‌سازی',
  'intake.approval_synced': 'تأییدِ ثبت‌نام هم‌گام شد',
  'appointment.held': 'نوبت نگه داشته شد',
  'appointment.confirmed': 'نوبت قطعی شد',
  'appointment.cancelled': 'نوبت لغو شد',
  'appointment.noshow': 'بیمار سرِ نوبت نیامد',
  'appointment.started': 'مراجعه از نوبت شروع شد',
  'visit.unconfirmed': 'وضعیتِ مراجعه ثبت نشده',
  'visit.done': 'مراجعه انجام شد',
  'visit.postponed': 'مراجعه موکول شد',
  'visit.cancelled': 'مراجعه لغو شد',
  'report.missing': 'گزارشِ مراجعه ثبت نشده',
  'report.uploaded': 'گزارشِ مراجعه بارگذاری شد',
  'usage.unconfirmed': 'مصرفِ اقلام تأیید نشده',
  'usage.confirmed': 'مصرفِ اقلام تأیید شد',
  'invoice.ready': 'آمادهٔ صدورِ فاکتور',
  'invoice.issued': 'فاکتور صادر شد',
  'sms.failed': 'پیامک نرسید',
  'sms.sent': 'پیامک رفت',
};

/**
 * صفحهٔ «امروز» (W2.3) — یک پاسخ برای «الان چه کار کنم؟».
 *
 * هر بخش **جدا گیت می‌شود** و اگر کاربر اجازه‌اش را نداشته باشد خالی برمی‌گردد،
 * نه اینکه کلِ صفحه ۴۰۳ شود: کارشناسِ سطح ۲ باید کارها و عمل‌های خودش را ببیند
 * بی‌آنکه تقویم یا ثبت‌نام‌ها برایش باز باشد. گیت از همان `FeaturesService.forUser`
 * می‌آید که لانچر می‌خواند — نه محاسبهٔ دوبارهٔ `level >= min` (قانونِ ۳).
 *
 * ⚠️ **همهٔ عددها این‌جا حساب می‌شوند** (قانونِ ۱۵): کلاینت هیچ شمارشی نمی‌کند،
 * فقط عددِ آماده را کنارِ برچسبش می‌گذارد.
 *
 * ⚠️ چرا نوبت‌ها را از `AppointmentsService` نمی‌گیرد: `PatientsModule` خودش
 * `WorkModule` را import می‌کند (برای `EventsService`)، و وارونه‌اش حلقهٔ
 * ماژولی می‌سازد. پس این‌جا فقط یک projectionِ کوچکِ خواندنی است، نه منطقِ
 * تازه — قاعدهٔ نوبت‌ها همچنان مالِ همان سرویس است.
 */
@Injectable()
export class TodayService {
  constructor(
    private prisma: PrismaService,
    private work: WorkService,
    private features: FeaturesService,
  ) {}

  /* «امروز» از `clinic-day` — نه ساعتِ کانتینر. */
  private static dayBounds(now: Date): [Date, Date] {
    return todayRangeUtc(now);
  }

  async today(user: any) {
    const now = new Date();
    const [start, end] = TodayService.dayBounds(now);
    const level = user?.level ?? 0;

    /* گیتِ بخش‌ها. اگر خواندنِ فیچرها شکست بخورد، صفحه نباید بیفتد: فقط کارها می‌ماند. */
    let can = (_key: string) => false;
    try {
      const rows = await this.features.forUser(user);
      const map = new Map(rows.map((r: any) => [r.key, !!r.allowed]));
      can = (key: string) => map.get(key) === true;
    } catch { /* fail-soft: بخش‌های دیگر خالی می‌مانند */ }

    /* «مراجعه‌های امروز» برای هر کسی که مراجعه‌ای به نامِ خودش دارد: مدیرِ داشبورد، کارشناس،
       و (بستهٔ ۵) پزشکِ متصل به تعریفِ جراح — `visitsToday` خودش با own-scope (techId یا
       surgeonId) می‌بندد، پس این فقط می‌گوید بخش رندر شود یا نه. */
    const seesVisits = can('dashboard') || can('tech') || can('surgeon');
    /* نمای استثنا (W2.5) فقط از سوپروایزر به بالا: این بخش دربارهٔ **کارِ دیگران**
       است — چیزی که از دستِ تیم افتاده — نه کارِ خودِ کاربر. */
    const seesExceptions = level >= LEVEL.SUPERVISOR;
    /* سوپرادمین بی‌محدودیت است (قانونِ ۲۹): «کارهای من»ِ او «کارهای تیم» است — صفِ
       `inbox`ش خودش همه را دارد — به‌علاوهٔ تفکیکِ «مالِ کیست» برای فیلترِ بالای فهرست.
       رابط سطح را حساب نمی‌کند؛ همین `team` را می‌خواند (قانونِ ۳). */
    const team = isUnrestricted(user);
    const [counts, items, visits, appointments, intakePending, exceptions, canProcess, canCreateVisit, bookingOn] = await Promise.all([
      this.work.counts(user, { owners: team }),
      this.work.list(user, { scope: 'inbox', limit: team ? TEAM_WORK_LIMIT : WORK_LIMIT }),
      seesVisits ? this.visitsToday(user, level, start, end) : Promise.resolve([]),
      can('calendar') ? this.appointmentsToday(start) : Promise.resolve([]),
      can('formgen')
        ? this.prisma.intakeSubmission.count({ where: { status: 'pending_approval' } })
        : Promise.resolve(0),
      seesExceptions ? this.exceptions(now, user) : Promise.resolve(null),
      /* «پردازشِ صف» روی کارتِ رویدادِ گیرکرده — سرور تصمیم می‌گیرد (قانونِ ۳): مجوزِ
         `work.process` (پیش‌فرض سوپرادمین)، نه حدسِ سطح در رابط. بیرونِ `exceptions`
         می‌ماند تا آن شیء همگن (`{count, items}`) بماند. */
      seesExceptions ? canAccess(this.prisma, user, 'work', ['work.process']).catch(() => false) : Promise.resolve(false),
      /* دکمهٔ «+» — افزودنِ سریعِ مراجعهٔ دستی از همین صفحه (بازخوردِ مالک ۱۴۰۵/۰۷/۰۱).
         همان دو گاردی که `POST /visits` دارد (ماژولِ `dashboard` + مجوزِ
         `patients.create`)، نه حدسِ سطح در رابط (قانونِ ۳): دکمه‌ای که به ۴۰۳
         می‌خورد بدتر از نبودنش است. */
      canAccess(this.prisma, user, 'dashboard', ['patients.create']).catch(() => false),
      /* «نوبت‌دهی دارد؟» — همان قاعدهٔ `IntakeService.bookingOn()`: دست‌کم یک برنامهٔ کاریِ فعال. */
      can('calendar')
        ? this.prisma.availabilityRule.count({ where: { active: true } }).then((n) => n > 0).catch(() => false)
        : Promise.resolve(false),
    ]);
    /* بخشِ نوبت‌ها فقط برای نصبی که **نوبت‌دهی** دارد — نه هر کسی که «تقویمِ عمل‌ها» را باز
       می‌کند. شرکتی که برنامهٔ کاری ندارد هر روز «۰ نوبتِ امروز» و «امروز نوبتی نیست» می‌دید
       (بازبینیِ UX ۱۴۰۵/۰۷). نوبتی که با این همه امروز ثبت شده باشد، بخش را باز می‌کند. */
    const apptSection = can('calendar') && (bookingOn || appointments.length > 0);

    /* «بعدی» = نزدیک‌ترین چیزی که ساعت دارد و **هنوز نرسیده** — عمل یا نوبت، هرکدام زودتر؛
       با نامِ بیمار. تا بازبینیِ UX (۱۴۰۵/۰۷) زودترین ساعتِ کلِ روز بود و عصر هم «اولین ساعت
       08:30» را نشان می‌داد. انجام‌شده، لغوشده و «نیامد» دیگر «بعدی» نیستند. */
    const clock = nowHHMM(now);
    const upcoming = [
      ...visits.filter((v) => v.opStartTime && v.opStatus === 'pending')
        .map((v) => ({ at: v.opStartTime as string, name: v.fullName, patientId: v.patientId, kind: 'visit' as const })),
      ...appointments.filter((a) => a.time && !['cancelled', 'done', 'noshow'].includes(a.status))
        .map((a) => ({ at: a.time as string, name: a.fullName, patientId: a.patientId, kind: 'appointment' as const })),
    ].filter((x) => x.at >= clock).sort((a, b) => a.at.localeCompare(b.at));
    const next = upcoming[0] ?? null;
    const nextAt = next?.at ?? null;

    return {
      now: now.toISOString(),
      user: { jobRole: user?.jobRole ?? null, level },
      team,
      /* دسته‌های «مالِ کیست» (هر شخص، هر صفِ نقش، بی‌مسئول) با شمار و `filter`ِ آماده
         برای `GET /work` — به ترتیبِ شمار. برای غیرِ سوپرادمین خالی. */
      owners: counts.team ? counts.owners ?? [] : [],
      brief: {
        work: counts.total,
        overdue: counts.overdue,
        visits: visits.length,
        appointments: appointments.filter((a) => a.status !== 'cancelled').length,
        intakePending,
        nextAt,
        next,
      },
      work: items,
      visits,
      appointments,
      exceptions,
      canProcess,
      canCreateVisit,
      /* «امروز»ِ مطب (YYYY-MM-DD) — تاریخِ پیش‌فرضِ «+»، همان تعریفی که فهرستِ امروز با آن فیلتر می‌شود. */
      clinicToday: clinicTodayIso(now),
      sections: { visits: seesVisits, appointments: apptSection, intake: can('formgen'), exceptions: seesExceptions },
    };
  }

  /**
   * **نمای استثنا** (W2.5) — چهار چیزی که هیچ‌کس خبردار نمی‌شود چون هیچ‌کس مسئولش نیست.
   *
   * معیارِ پذیرشِ سند: «هیچ کارِ باز بدونِ مسئول > ۲۴ ساعت نماند». این نما همان
   * را دیدنی می‌کند، به‌علاوهٔ سه شکافِ دیگر که لایهٔ کار خودش نمی‌بیند:
   *
   * | ردیف | یعنی چه | چرا خطرناک است |
   * |---|---|---|
   * | `unowned` | کارِ باز که هیچ‌کس برنداشته و از ۲۴ ساعت گذشته | در صفِ نقش مانده و همه فکر می‌کنند مالِ دیگری است |
   * | `stuckEvents` | رویدادِ پردازش‌نشدهٔ قدیمی‌تر از یک ساعت | pipelineِ رویداد←کار ایستاده؛ **هیچ کارِ تازه‌ای ساخته نمی‌شود** |
   * | `unreviewed` | نتیجهٔ سفارش که ۴۸ ساعت است پاسخ آمده و بررسی نشده | بیمار منتظرِ تصمیم است و کسی نمی‌داند |
   * | `halfApproved` | ثبت‌نامِ `approved` بدونِ مراجعه | تأیید نیمه‌کاره مانده (D04) — پول گرفته شده، پرونده نیست |
   *
   * فقط **خواندنی** و سقف‌دار (۵ نمونه از هر ردیف)؛ عددِ کل جدا می‌آید تا «۵ تا»
   * با «۵۰ تا» اشتباه نشود.
   *
   * هر نمونه **می‌گوید مالِ کیست و به چه چیزی گره خورده** (`patient`, `refType/refId`,
   * `kind`): مالک دید هشدارِ «نتیجهٔ بررسی‌نشده» فقط یک عدد و یک ساعت بود و معلوم
   * نبود کدام بیمار — هشداری که نگوید مالِ چیست، کلیک‌شدنی هم نیست.
   */
  private async exceptions(now: Date, user: any) {
    const ago = (h: number) => new Date(now.getTime() - h * 3600_000);
    const NOT_PATIENT = { OR: [{ ownerRole: null }, { ownerRole: { not: 'patient' } }] };
    const unownedWhere = {
      AND: [{ state: { in: ['open', 'blocked'] } }, NOT_PATIENT, { ownerAccountId: null }, { createdAt: { lt: ago(24) } }],
    };
    const stuckWhere = { processedAt: null, at: { lt: ago(1) } };
    /* ⚠️ «تأییدِ نیمه‌کاره» = تأیید شد ولی مراجعه ساخته نشد. ولی فرمِ
       **زیرپرونده** (`scope='record'`: نظرسنجی، فرمِ تکمیلی) عمداً مراجعه
       نمی‌سازد — قاعدهٔ خودِ مخزن در پنج جا `makesVisit = scope !== 'record'`
       است. بدونِ این استثنا هر پاسخِ **سالمِ** زیرپرونده یک هشدارِ دروغین در
       نمای استثنای مدیر می‌شد، و نمای استثنا معیارِ تصمیم است: اگر کسی به
       «۴۰ تأییدِ نیمه‌کاره» اعتماد کند و «درستشان کن» بزند، دادهٔ سالم را خراب
       می‌کند. (گزارشِ لِینِ الف، ۱۴۰۵/۰۶/۲۶.)
       ⚠️ `form: null` (فرمِ حذف‌شده) عمداً **می‌ماند**: همان‌جا هم پیش‌فرضِ
       `makesVisit` روشن است (`intake.service.ts:1609`). */
    const halfWhere = {
      status: 'approved',
      visitId: null,
      OR: [{ form: null }, { form: { scope: { not: 'record' } } }],
    };

    const [unownedCount, unowned, stuckCount, stuck, halfCount, half] = await Promise.all([
      this.prisma.workItem.count({ where: unownedWhere }),
      this.prisma.workItem.findMany({
        where: unownedWhere, orderBy: { createdAt: 'asc' }, take: 5,
        select: {
          id: true, type: true, title: true, ownerRole: true, dueAt: true, createdAt: true,
          patientId: true, visitId: true, refType: true, refId: true,
        },
      }),
      this.prisma.domainEvent.count({ where: stuckWhere }),
      this.prisma.domainEvent.findMany({
        where: stuckWhere, orderBy: { at: 'asc' }, take: 5,
        select: { id: true, type: true, at: true, patientId: true, visitId: true },
      }),
      this.prisma.intakeSubmission.count({ where: halfWhere }),
      this.prisma.intakeSubmission.findMany({
        where: halfWhere, orderBy: { reviewedAt: 'desc' }, take: 5,
        select: {
          id: true, patientId: true, amount: true, reviewedAt: true, createdAt: true,
          patient: { select: { id: true, code: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    /* خلاصهٔ مراجعه و «پاپ‌آپِ خودِ کار شدنی است؟» همان‌که صفِ کار دارد (`WorkService.targets`،
       R1/R6): بی‌آن «ثبتِ وضعیت»ِ ردیفِ بی‌مسئول پرسشِ «عملِ آینده» را دور می‌زد و مسیرِ پنلِ
       کارشناس را برای عملی باز می‌کرد که کارشناس ندارد (۴۰۴). */
    const [unreviewed, byPatient, targetOf] = await Promise.all([
      this.unreviewedOrders(ago(48)),
      this.patientsById([...unowned.map((w) => w.patientId), ...stuck.map((e) => e.patientId)]),
      this.work.targets(user, unowned),
    ]);

    return {
      unowned: {
        count: unownedCount,
        items: unowned.map((w) => ({ ...w, patient: byPatient.get(w.patientId ?? -1) ?? null, ...targetOf(w) })),
      },
      stuckEvents: {
        count: stuckCount,
        items: stuck.map((e) => ({ ...e, typeFa: EVENT_FA[e.type] ?? 'رویدادِ سامانه', patient: byPatient.get(e.patientId ?? -1) ?? null })),
      },
      unreviewed,
      halfApproved: { count: halfCount, items: half.map(({ patient, ...i }) => ({ ...i, patient: TodayService.person(patient) })) },
    };
  }

  /** نمایهٔ کوتاهِ بیمار برای هر نمونهٔ استثنا — همان شکلی که ردیفِ کار می‌دهد. */
  private static person(p: { id: number; code: string; firstName: string | null; lastName: string | null } | null | undefined) {
    return p ? { id: p.id, code: p.code, fullName: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() } : null;
  }

  /** `WorkItem` و `DomainEvent` رابطهٔ Prisma به بیمار ندارند؛ یک کوئری برای همه. */
  private async patientsById(ids: (number | null | undefined)[]) {
    const uniq = [...new Set(ids.filter((x): x is number => !!x))];
    if (!uniq.length) return new Map<number, ReturnType<typeof TodayService.person>>();
    const rows = await this.prisma.patient.findMany({
      where: { id: { in: uniq } }, select: { id: true, code: true, firstName: true, lastName: true },
    });
    return new Map(rows.map((p) => [p.id, TodayService.person(p)]));
  }

  /**
   * نتیجه‌هایی که آمده‌اند و بررسی نشده‌اند.
   *
   * ⚠️ روی **خودِ سفارش** حساب می‌شود نه روی کارِ باز: اگر کارِ `review_result`
   * به هر دلیلی ساخته نشده باشد (همان `stuckEvents` بالا)، دقیقاً همان موردی است
   * که باید دیده شود — نمایی که فقط کارها را بشمارد، شکافِ خودش را نمی‌بیند.
   */
  private async unreviewedOrders(before: Date) {
    /* `any` مثلِ `OrdersService.table()`: سه مدلِ هم‌شکل، ولی TypeScript اجتماعِ
       delegateهای Prisma را قابلِ فراخوانی نمی‌داند. */
    const kinds: { key: string; table: any; fa: string }[] = [
      { key: 'lab_order', table: this.prisma.labOrder, fa: 'آزمایش' },
      { key: 'imaging_order', table: this.prisma.imagingOrder, fa: 'تصویربرداری' },
      { key: 'consult_order', table: this.prisma.consultOrder, fa: 'مشاوره' },
    ];
    const where = { status: 'answered', updatedAt: { lt: before } };
    let count = 0;
    const items: any[] = [];
    for (const k of kinds) {
      count += await k.table.count({ where });
      if (items.length < 5) {
        const rows = await k.table.findMany({
          where, orderBy: { updatedAt: 'asc' }, take: 5 - items.length,
          select: {
            id: true, patientId: true, visitId: true, updatedAt: true,
            patient: { select: { id: true, code: true, firstName: true, lastName: true } },
          },
        });
        items.push(...rows.map(({ patient, ...r }: any) => ({
          ...r, refType: k.key, kind: k.key.replace(/_order$/, ''), kindFa: k.fa, patient: TodayService.person(patient),
        })));
      }
    }
    return { count, items };
  }

  /** عمل‌های امروز — دامنهٔ دید مثلِ خودِ فهرستِ مراجعات: زیرِ سوپروایزر فقط مالِ خودش. */
  private async visitsToday(user: any, level: number, start: Date, end: Date) {
    const [rows, forms] = await Promise.all([this.prisma.visit.findMany({
      where: {
        opDate: { gte: start, lte: end },
        opStatus: { not: 'cancelled' },
        patient: { deletedAt: null },
        ...(level >= LEVEL.SUPERVISOR ? {} : ownVisitWhere(user)),
      },
      orderBy: [{ opStartTime: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      take: 40,
      select: {
        id: true, seq: true, kind: true, opStartTime: true, opStatus: true,
        hospitalName: true, surgeonName: true,
        patient: { select: { id: true, code: true, firstName: true, lastName: true } },
        /* کارشناسِ مسئول — مهم‌ترین سؤالِ مدیرِ شرکت دربارهٔ عملِ امروز (بازبینیِ UX ۱۴۰۵/۰۷). */
        tech: { select: { username: true, person: { select: { firstName: true, lastName: true } } } },
      },
    }),
    /* عنوانِ فرمِ هر نوعِ ناشناخته — «فرمِ پیگیریِ ارتوپدی» → «پیگیریِ ارتوپدی». */
    this.prisma.formDef.findMany({ where: { scope: 'visit', visitKind: { not: null } }, select: { visitKind: true, title: true } })
      .catch(() => [] as { visitKind: string | null; title: string }[])]);
    const formTitle = new Map(forms.map((f) => [f.visitKind, f.title.replace(/^فرمِ?\s+/, '').trim()]));
    return rows.map((v) => ({
      id: v.id,
      patientId: v.patient.id,
      code: `${v.patient.code}-V${v.seq}`,
      fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
      kind: v.kind,
      kindFa: KIND_FA[v.kind] ?? (formTitle.get(v.kind) || v.kind),
      opStartTime: v.opStartTime,
      opStatus: v.opStatus,
      /* برچسب از `labels.ts` می‌آید، نه از نگاشتِ کلاینتی — قانونِ «یک وضعیت،
         یک برچسب». `Today.jsx` تا دیروز نسخهٔ خودش را داشت. */
      opStatusFa: OP_LABELS[v.opStatus] ?? v.opStatus,
      hospitalName: v.hospitalName,
      surgeonName: v.surgeonName,
      techName: v.tech ? (`${v.tech.person?.firstName ?? ''} ${v.tech.person?.lastName ?? ''}`.trim() || v.tech.username || null) : null,
    }));
  }

  /** نوبت‌های امروز — نامِ بیمار فقط برای نوبتی که به پرونده وصل شده. */
  private async appointmentsToday(start: Date) {
    /* `start` خودش نیمه‌شبِ UTCِ روزِ مطب است (`todayRangeUtc`) — همان
       قراردادِ ستونِ `DATE`ِ نوبت. */
    const d = start;
    const rows = await this.prisma.appointment.findMany({
      where: { date: d },
      orderBy: [{ startMin: { sort: 'asc', nulls: 'last' } }, { seq: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      take: 60,
      select: {
        id: true, startMin: true, seq: true, status: true, visitId: true,
        patient: { select: { id: true, firstName: true, lastName: true } },
        topic: { select: { name: true } },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      time: a.startMin != null ? AvailabilityService.minToHHMM(a.startMin) : null,
      seq: a.seq,
      status: a.status,
      statusFa: APPT_LABELS[a.status] ?? a.status,
      visitId: a.visitId,
      patientId: a.patient?.id ?? null,
      /* نوبتی که هنوز به پرونده وصل نشده اسمی ندارد که این‌جا نشان داده شود؛
         نامِ داخلِ پاسخِ ثبت‌نام هنوز تأیید نشده و نباید مثلِ پرونده دیده شود. */
      fullName: a.patient ? `${a.patient.firstName} ${a.patient.lastName}`.trim() : null,
      topic: a.topic?.name ?? null,
    }));
  }

}
