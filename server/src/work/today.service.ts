import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeaturesService } from '../features/features.service';
import { LEVEL } from '../common/levels';
import { ownVisitWhere } from '../common/own-scope';
import { AvailabilityService } from '../patients/availability.service';
import { WorkService } from './work.service';
import { canAccess } from '../auth/access-check';

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

  private static dayBounds(now: Date): [Date, Date] {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setHours(23, 59, 59, 999);
    return [start, end];
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
    const [counts, items, visits, appointments, intakePending, exceptions, canProcess] = await Promise.all([
      this.work.counts(user),
      this.work.list(user, { scope: 'inbox', limit: 8 }),
      seesVisits ? this.visitsToday(user, level, start, end) : Promise.resolve([]),
      can('calendar') ? this.appointmentsToday(start) : Promise.resolve([]),
      can('formgen')
        ? this.prisma.intakeSubmission.count({ where: { status: 'pending_approval' } })
        : Promise.resolve(0),
      seesExceptions ? this.exceptions(now) : Promise.resolve(null),
      /* «پردازشِ صف» روی کارتِ رویدادِ گیرکرده — سرور تصمیم می‌گیرد (قانونِ ۳): مجوزِ
         `work.process` (پیش‌فرض سوپرادمین)، نه حدسِ سطح در رابط. بیرونِ `exceptions`
         می‌ماند تا آن شیء همگن (`{count, items}`) بماند. */
      seesExceptions ? canAccess(this.prisma, user, 'work', ['work.process']).catch(() => false) : Promise.resolve(false),
    ]);

    /* «کارِ بعدی» = نزدیک‌ترین چیزی که ساعت دارد — عمل یا نوبت، هرکدام زودتر. */
    const nextAt = [
      ...visits.filter((v) => v.opStartTime).map((v) => v.opStartTime as string),
      ...appointments.filter((a) => a.time && a.status !== 'cancelled').map((a) => a.time as string),
    ].sort()[0] ?? null;

    return {
      now: now.toISOString(),
      user: { jobRole: user?.jobRole ?? null, level },
      brief: {
        work: counts.total,
        overdue: counts.overdue,
        visits: visits.length,
        appointments: appointments.filter((a) => a.status !== 'cancelled').length,
        intakePending,
        nextAt,
      },
      work: items,
      visits,
      appointments,
      exceptions,
      canProcess,
      sections: { visits: seesVisits, appointments: can('calendar'), intake: can('formgen'), exceptions: seesExceptions },
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
  private async exceptions(now: Date) {
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

    const [unreviewed, byPatient] = await Promise.all([
      this.unreviewedOrders(ago(48)),
      this.patientsById([...unowned.map((w) => w.patientId), ...stuck.map((e) => e.patientId)]),
    ]);

    return {
      unowned: { count: unownedCount, items: unowned.map((w) => ({ ...w, patient: byPatient.get(w.patientId ?? -1) ?? null })) },
      stuckEvents: { count: stuckCount, items: stuck.map((e) => ({ ...e, patient: byPatient.get(e.patientId ?? -1) ?? null })) },
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
    const rows = await this.prisma.visit.findMany({
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
      },
    });
    return rows.map((v) => ({
      id: v.id,
      patientId: v.patient.id,
      code: `${v.patient.code}-V${v.seq}`,
      fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
      kind: v.kind,
      opStartTime: v.opStartTime,
      opStatus: v.opStatus,
      hospitalName: v.hospitalName,
      surgeonName: v.surgeonName,
    }));
  }

  /** نوبت‌های امروز — نامِ بیمار فقط برای نوبتی که به پرونده وصل شده. */
  private async appointmentsToday(start: Date) {
    const d = new Date(`${start.toISOString().slice(0, 10)}T00:00:00.000Z`);
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
      visitId: a.visitId,
      patientId: a.patient?.id ?? null,
      /* نوبتی که هنوز به پرونده وصل نشده اسمی ندارد که این‌جا نشان داده شود؛
         نامِ داخلِ پاسخِ ثبت‌نام هنوز تأیید نشده و نباید مثلِ پرونده دیده شود. */
      fullName: a.patient ? `${a.patient.firstName} ${a.patient.lastName}`.trim() : null,
      topic: a.topic?.name ?? null,
    }));
  }

}
