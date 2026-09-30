import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { APPT_LABELS as APPT_FA_MAP } from './labels';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../work/events.service';
import { PatientsService } from './patients.service';
import { FormsService } from './forms.service';
import { AvailabilityService } from './availability.service';
import { CANCEL_REASONS } from '../common/cancel-reasons';
import { RemindersService } from './reminders.service';
import { clinicTodayIso, dayUtc } from '../common/clinic-day';
import { jalaliText } from '../common/jalali';

/** برچسب‌های فارسیِ وضعیتِ نوبت — مشتقِ سرور (قانون ۱۵). */
/* ⚠️ خانه‌اش `labels.ts` است (تنها منبعِ برچسب‌های وضعیت). این‌جا فقط دوباره
   export می‌شود تا ایمپورت‌های موجود نشکنند و کسی وسوسه نشود نسخهٔ دوم بنویسد. */
export { APPT_LABELS } from './labels';

/**
 * گذارهای مجازِ وضعیت — ماشینِ وضعیتِ صریح، نه «هر چیزی به هر چیزی».
 *
 * ⚠️ بدونِ این، یک کلیکِ اشتباه `done` را به `held` برمی‌گرداند و نوبتی که
 * انجام شده دوباره در صفِ پذیرش سبز می‌شد. برگشتِ عمدی (`arrived` → `confirmed`)
 * مجاز است چون منشی گاهی اشتباهی «رسید» می‌زند.
 */
/**
 * برچسبِ **اقدام** — با `APPT_LABELS` یکی نیست و نباید یکی شود.
 * `APPT_LABELS` می‌گوید «الان کجاست» («در مطب»)، این می‌گوید «اگر بزنی چه می‌شود»
 * («ثبتِ رسیدن»). میزِ پذیرش دکمه است، پس فعل می‌خواهد نه صفت.
 */
export const APPT_ACTIONS: Record<string, string> = {
  held: 'برگرداندن به انتظارِ پرداخت',
  confirmed: 'قطعی‌کردن',
  arrived: 'ثبتِ رسیدن',
  done: 'پایانِ نوبت',
  noshow: 'ثبتِ غیبت',
  cancelled: 'لغوِ نوبت',
};
/**
 * هشدار: **فعل، نه جملهٔ خبری** (بازبینیِ UX، clinic-daily-20): «قطعی شد»، «رسید»، «تمام شد»، «نیامد» روی
 * دکمه خبر بودند نه کار — و روی بیمارِ «در مطب» دکمهٔ «قطعی شد» در واقع **برگرداندن** بود. معنای یک
 * گذار گاهی به **مبدأ** بسته است، پس این‌جا استثنای مبدأ‌به‌مقصد؛ بقیه همان `APPT_ACTIONS`.
 *
 * هشدار: `done` «پایانِ **نوبت**» است نه «پایانِ ویزیت»: این گذار فقط نوبت را می‌بندد و `Visit.opStatus`
 * را دست نمی‌زند، پس «پایانِ ویزیت» ادعای کاری را می‌کرد که رخ نمی‌دهد (میزِ پزشک همان لحظه
 * «ویزیت: در انتظار» نشان می‌دهد). «نوبت» هم در هر سه حوزه یکی است (`FLOW`) و سرور واژهٔ حوزه ندارد —
 * میزِ پذیرش در شرکت هم روشن است. هم‌خانوادهٔ «لغوِ نوبت».
 */
const APPT_ACTIONS_FROM: Record<string, Record<string, string>> = {
  arrived: { confirmed: 'برگرداندن به نوبت‌دار' },
  noshow: { confirmed: 'برگرداندن به نوبت‌دار' },
};
export const apptActionLabel = (from: string, to: string) => APPT_ACTIONS_FROM[from]?.[to] ?? APPT_ACTIONS[to] ?? to;

/**
 * ستونِ میزِ پذیرش — مشتقِ سرور (قانون ۱۵) و تک‌منبع.
 *
 * ⚠️ **«در جریان» هرگز از `visitId != null` به‌تنهایی مشتق نمی‌شود.**
 * `intake.service.ts:1736` هنگامِ تأییدِ ثبت‌نام روی نوبتِ **`confirmed`** هم
 * `visitId` می‌نویسد — بیمار هنوز خانه است. ملاک، وضعیتِ نوبت است و `visitId`
 * فقط داخلِ `arrived` تفکیک می‌کند.
 */
export function apptLane(status: string, visitId: number | null): string {
  if (status === 'arrived') return visitId ? 'inVisit' : 'present';
  if (status === 'done') return 'finished';
  if (status === 'noshow') return 'absent';
  if (status === 'cancelled') return 'cancelled';
  return 'booked';   // held | confirmed
}

/**
 * **چرا «شروعِ ویزیت» ممکن نیست — یک قاعده، یک جمله، برای دکمه و برای مجوز.**
 *
 * `null` یعنی مجاز است؛ رشته یعنی همان علتی که هم دکمه را خاموش می‌کند و هم
 * اگر کسی مستقیم به API بزند ۴۰۰ می‌گیرد. **دو در، یک قفل.**
 *
 * ⚠️ **ولی قفل دو حلقه دارد و یکی‌شان مالِ همه نیست.**
 *
 * | قاعده | کجا | چرا |
 * |---|---|---|
 * | لغوشده/نیامد/تمام‌شده شروع نمی‌شود | **همه‌جا** | ادعایی دربارهٔ چیزی که رخ نداده |
 * | نوبتِ بی‌پرونده شروع نمی‌شود | **همه‌جا** | مراجعه بی‌بیمار معنا ندارد |
 * | `held` (پول‌نداده) شروع نمی‌شود | فقط **تختهٔ میزِ پذیرش** | «پرداخت دیده شد» باید کلیکِ عمدیِ «قطعی شد» باشد، و آن دکمه همان‌جا کنارِ دست است |
 * | فقط نوبتِ **امروز** | فقط **تختهٔ میزِ پذیرش** | تخته یک‌روزه است؛ کلیک روی ردیفِ دیروز اشتباه است نه تصمیم |
 *
 * 🩹 **این تفکیک از دو شکستِ واقعی درآمد، نه از نظریه.** نسخهٔ اولِ این تابع
 * هر چهار قاعده را همه‌جا اعمال کرد و دو رفتارِ **عمدی** را شکست:
 * - نوبتی که برای مراجعهٔ هفتهٔ بعد گرفته شده و بیمار زودتر آمده: «شروع»
 *   تاریخِ مراجعه‌اش را امروز می‌کند («تاریخِ حضورِ واقعی») —
 *   `w1-5-appointment-visit-link` با فیکسچرِ +۷ روز تضمینش می‌کند.
 * - نوبتِ `held`ِ ثبت‌نامِ آنلاین که ادمین از پرونده شروعش می‌کند — همان
 *   سوییت، بندِ کارِ `confirm_appointment`.
 *
 * چیزی که واقعاً همه‌جا شکسته بود این‌ها بودند و مانده‌اند: تقویم برای نوبتِ
 * **«نیامد»** هم دکمه می‌داد، مسیرِ مستقیمِ `POST /appointments/:id/visit`
 * هیچ‌کدام از این‌ها را نداشت جز «لغو نباشد»، و پاپ‌آپِ نوبت اصلاً دکمه‌ای
 * نداشت.
 *
 * ⚠️ ترتیبِ چک‌ها عمدی است: **اول وضعیت، بعد تاریخ.** نوبتِ لغوشدهٔ دیروز
 * باید بگوید «لغوشده شروع نمی‌شود»، نه «فقط امروز» — علتِ اولی درست‌کردنی
 * نیست و پیامِ دومی کاربر را دنبالِ نخودِ سیاه می‌فرستد.
 */
export function apptStartBlock(
  a: { status: string; date: Date; patientId: number | null },
  deskToday?: string,
): string | null {
  if (a.status === 'cancelled' || a.status === 'noshow' || a.status === 'done') {
    return `نوبتِ «${APPT_FA_MAP[a.status] ?? a.status}» شروع نمی‌شود`;
  }
  if (a.patientId == null) return 'این نوبت هنوز به پرونده‌ای وصل نیست — اول ثبت‌نامش تأیید شود';
  /* از این‌جا به پایین **سیاستِ تخته** است، نه ثابتِ داده. */
  if (!deskToday) return null;
  if (a.status === 'held') return 'اول «قطعی شد» را بزنید، بعد شروع';
  if (a.date.toISOString().slice(0, 10) !== deskToday) {
    return 'از میزِ پذیرش فقط نوبتِ همین امروز شروع می‌شود';
  }
  return null;
}

export const APPT_TRANSITIONS: Record<string, string[]> = {
  held: ['confirmed', 'cancelled'],
  confirmed: ['arrived', 'noshow', 'cancelled'],
  arrived: ['done', 'confirmed', 'cancelled'],
  done: [],
  noshow: ['confirmed'], // «نیامد» اشتباه بود — برگشتش باید ممکن باشد
  cancelled: [],
};

/**
 * **میزِ پذیرش** — نوبت‌های یک روز و چرخهٔ حضورِ بیمار در مطب.
 * `docs/BOOKING.md` مرحلهٔ ۵: در انتظار ← در مطب ← ویزیت ← تمام.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private patients: PatientsService,
    private forms: FormsService,
    private availability: AvailabilityService,
    private reminders: RemindersService,
    private events: EventsService,
  ) {}

  /**
   * `deskToday` اختیاری است و فقط میزِ پذیرش می‌دهدش — تنها جایی که «امروز»
   * و «پول‌نداده» بخشی از قاعدهٔ شروع‌اند (جدولِ `apptStartBlock`).
   */
  view(a: any, deskToday?: string) {
    /* یک‌بار، نه دوبار: `view` روی تختهٔ ۲۰۰ ردیفی برای هر ردیف صدا زده
       می‌شود و هر فراخوانیِ اضافه یک فرمترِ `Intl` تازه می‌ساخت. */
    const startHint = apptStartBlock(a, deskToday);
    return {
      id: a.id,
      date: a.date.toISOString().slice(0, 10),
      startMin: a.startMin,
      time: a.startMin == null ? null : AvailabilityService.minToHHMM(a.startMin),
      seq: a.seq,
      status: a.status,
      statusLabel: APPT_FA_MAP[a.status] ?? a.status,
      note: a.note,
      patientId: a.patientId,
      patientCode: a.patient?.code ?? null,
      fullName: a.patient ? `${a.patient.firstName} ${a.patient.lastName}`.trim() : null,
      phone: a.patient?.phone ?? null,
      topicId: a.topicId,
      topicName: a.topic?.name ?? null,
      topicColor: a.topic?.color ?? null,
      visitId: a.visitId,
      forVisitId: a.forVisitId,
      /* گذارهای مجاز هم مشتقِ سرورند: دکمه‌های میزِ پذیرش از همین ساخته
         می‌شوند، نه از یک کپیِ کلاینتیِ ماشینِ وضعیت. */
      next: APPT_TRANSITIONS[a.status] ?? [],
      /* دکمه‌های میز: هر گذارِ مجاز با فعلِ خودش. برچسب این‌جا ساخته می‌شود تا
         نگاشتِ کلاینتیِ دوم (مثلِ آنکه در `Calendar.jsx` بود) لازم نشود. */
      nextOptions: (APPT_TRANSITIONS[a.status] ?? []).map((st) => ({
        status: st, label: apptActionLabel(a.status, st),
      })),
      lane: apptLane(a.status, a.visitId ?? null),
      /* «شروعِ ویزیت» هم مشتقِ سرور است — و این‌جا، کنارِ `lane` و
         `nextOptions`، نه در یک میزِ خاص. `startHint` علتِ خاموشی را همراه
         می‌آورد تا دکمه بی‌توضیح ناپدید نشود؛ کاربر باید بفهمد **چرا**. */
      canStart: startHint === null,
      startHint,
    };
  }

  private static readonly INCLUDE = {
    patient: { select: { id: true, code: true, firstName: true, lastName: true, phone: true } },
    topic: { select: { id: true, name: true, color: true } },
  } as const;

  /** نوبت‌های یک روز — مرتب به ساعت، بعد شمارهٔ صف. */
  async day(date: string, deskToday?: string) {
    const d = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
    const rows = await this.prisma.appointment.findMany({
      where: { date: d },
      orderBy: [{ startMin: { sort: 'asc', nulls: 'last' } }, { seq: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      include: AppointmentsService.INCLUDE,
    });
    return rows.map((r) => this.view(r, deskToday));
  }

  /**
   * «از همان ثبت، پیشنهادِ نوبت» — وضعیتِ یک روز برای نوبت‌گرفتنِ یک بیمار:
   * باز/بسته، حالت (اسلات/ظرفیت)، جاهای آزاد، و نوبتِ **فعالِ خودِ بیمار**
   * در همان روز (یعنی «دوباره نگیر»). خوراکِ پرامپتی که بعد از ذخیرهٔ
   * ویزیتِ دارای «ویزیتِ بعدی» باز می‌شود.
   *
   * `mode: 'none'` یعنی برای آن روز اصلاً قاعده‌ای نیست — نصبی که از
   * برنامهٔ کاری استفاده نمی‌کند همین را می‌گیرد و کلاینت پرامپت را
   * نشان نمی‌دهد (همان fail-softِ نوبت‌دهی).
   */
  async suggest(patientId: number, date: string, topicId?: number) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('پرونده پیدا نشد');
    const d = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخ نامعتبر است');

    const existing = await this.prisma.appointment.findFirst({
      where: { patientId, date: d, status: { in: ['held', 'confirmed', 'arrived', 'done'] } },
      orderBy: { id: 'asc' },
      include: AppointmentsService.INCLUDE,
    });
    const [jy, jm] = AppointmentsService.jalaliYm(d);
    const cal = await this.availability.month(jy, jm, { topicId });
    const day = cal.days.find((x: any) => x.date === date) ?? null;
    /* همان قاعدهٔ walkIn: وجودِ حتی یک پنجرهٔ اسلاتی یعنی انتخابِ ساعت لازم است. */
    const slots = (day?.windows ?? []).filter((w: any) => w.mode === 'slot').flatMap((w: any) => w.slots);
    /* نصبی که اصلاً برنامهٔ کاری ندارد باید ساکت بماند (fail-soft)؛ نصبی که
       دارد ولی این روزش باز نیست باید **بگوید** — این دو بدونِ scheduled از
       بیرون یکسان دیده می‌شدند. */
    const scheduled = (await this.prisma.availabilityRule.count({ where: { active: true } })) > 0;
    return {
      date,
      scheduled,
      open: !!day?.open,
      past: !!day?.past,
      closed: !!day?.closed,
      free: day?.free ?? 0,
      mode: slots.length ? 'slot' : ((day?.windows ?? []).length ? 'capacity' : 'none'),
      slots,
      existing: existing ? this.view(existing) : null,
    };
  }

  /**
   * نوبتِ حضوری — برای بیمارِ موجود.
   *
   * ⚠️ **دو مصرف‌کنندهٔ متفاوت دارد و قاعده‌شان یکی نیست.**
   *
   * `POST /appointments` (تقویم، رزروِ برنامه‌ریزی‌شده) از همان مسیرِ ظرفیت عبور
   * می‌کند: روزِ پر برای کارمند هم پر است، وگرنه تقویم دروغ می‌گوید و ظرفیتی
   * که مطب تعریف کرده بی‌معنا می‌شود.
   *
   * `POST /frontdesk/walk-in` (`desk: true`) فرق دارد، چون **آدم جلوی میز
   * ایستاده**. تصمیمِ مالک (۱۴۰۵/۰۶/۳۰): «بیمار ممکن است بدون نوبتِ قبلی حضوری
   * بیاید که اگر وقت بشود پذیرش می‌شود» — یعنی قاضیِ «وقت هست یا نه» خودِ
   * منشی است، نه یک قاعده. پس ظرفیت **خبر می‌دهد، منع نمی‌کند** و پاسخ
   * `beyondCapacity` برمی‌گرداند تا میز همان را بگوید.
   *
   * ⚠️ ولی دو چیز حتی سرِ میز هم رد می‌شوند، چون قضاوت نیستند بلکه اشتباه‌اند:
   * روزی که مطب صریحاً **تعطیل** اعلام کرده، و **اسلاتِ نام‌برده‌ای که پر است**
   * (دوبله‌کردنِ یک ساعتِ مشخص). بیمارِ فشرده‌شده شمارهٔ صف می‌گیرد، نه اسلاتِ
   * کسِ دیگر.
   */
  async walkIn(
    dto: { patientId: number; date: string; startMin?: number; topicId?: number; note?: string; visitId?: number },
    user: any,
    opts: { desk?: boolean } = {},
  ) {
    const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('پرونده پیدا نشد');
    /* پرونده‌ای که همین حالا از «ساختِ پروندهٔ تازه»ِ میزِ پذیرش ساخته شد، با مراجعهٔ امروزش می‌آید
       (بازبینیِ UX، clinic-daily-07): نوبتِ حضوری **هدفِ** همان مراجعه می‌شود (`forVisitId`)، تا
       «شروعِ ویزیت» همان را باز کند و مراجعهٔ دوم نسازد. */
    if (dto.visitId != null) {
      const target = await this.prisma.visit.findUnique({ where: { id: dto.visitId }, select: { patientId: true, opStatus: true } });
      if (!target || target.patientId !== dto.patientId) throw new BadRequestException('این مراجعه به پروندهٔ این بیمار تعلق ندارد');
      if (target.opStatus === 'cancelled') throw new BadRequestException('این مراجعه لغو شده است');
      const taken = await this.prisma.appointment.findFirst({
        where: { OR: [{ visitId: dto.visitId }, { forVisitId: dto.visitId }], status: { not: 'cancelled' } }, select: { id: true },
      });
      if (taken) throw new BadRequestException('این مراجعه از قبل نوبت دارد');
    }
    const d = new Date(`${dto.date}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخ نامعتبر است');

    const [jy, jm] = AppointmentsService.jalaliYm(d);
    const cal = await this.availability.month(jy, jm, { topicId: dto.topicId });
    const day = cal.days.find((x: any) => x.date === dto.date);
    if (!day) throw new BadRequestException('این روز در تقویم نیست');
    let beyondCapacity = false;
    if (!day.open) {
      if (day.past) throw new BadRequestException('این روز گذشته است');
      if (day.closed) throw new BadRequestException('این روز در برنامهٔ کاری تعطیل است');
      if (!opts.desk) throw new BadRequestException('این روز باز نیست یا جای آزاد ندارد');
      /* «قاعده‌ای نیست» با «قاعده هست و پر است» یکی نیست: اولی چیزی برای
         شکستن ندارد، دومی یعنی منشی عمداً یکی بیشتر پذیرفته و باید بداند. */
      beyondCapacity = day.windows.length > 0;
    }
    const slotMode = day.windows.some((w: any) => w.mode === 'slot');
    /* سرِ میز، نوبتِ بی‌ساعت مجاز است و شمارهٔ صف می‌گیرد؛ از تقویم نه. */
    const wantsSlot = slotMode && (dto.startMin != null || !opts.desk);
    if (wantsSlot) {
      const free = day.windows.filter((w: any) => w.mode === 'slot').flatMap((w: any) => w.slots)
        .find((sl: any) => sl.startMin === dto.startMin && !sl.taken);
      if (!free) throw new BadRequestException('این ساعت آزاد نیست');
    }

    try {
      const seq = wantsSlot ? null : await this.nextSeq(d);
      const appt = await this.prisma.$transaction(async (tx) => {
        const appt = await tx.appointment.create({
          data: {
            patientId: dto.patientId,
            forVisitId: dto.visitId ?? await this.patients.appointmentTarget(tx, dto.patientId, d),
            topicId: dto.topicId ?? null,
            date: d,
            startMin: wantsSlot ? dto.startMin ?? null : null,
            seq: wantsSlot ? null : seq,
            /* حضوری از قبل پولش را نداده که منتظرِ تأیید بماند — مستقیم قطعی. */
            status: 'confirmed',
            note: dto.note?.trim() || null,
          },
          include: AppointmentsService.INCLUDE,
        });
        await this.audit.record({
          actorId: user?.id, action: 'appointment.walkin', entityType: 'appointment', entityId: appt.id,
          after: { patientId: dto.patientId, date: dto.date, startMin: appt.startMin, forVisitId: appt.forVisitId },
        }, tx);
        return appt;
      });
      /* یادآوریِ «نوبتِ فردا» — عصرِ روزِ قبل. */
      await this.reminders.syncAppointment(appt.id);
      /* اگر این نوبت همان «ویزیتِ بعدیِ» ثبت‌شده روی یک مراجعه است، یادآوریِ
         next_visit دوبله می‌شد (هم «ویزیتِ بعدی نزدیک است» هم «نوبتِ فردا») —
         نسخهٔ نوبت‌دار دقیق‌تر است (ساعت دارد)، آن یکی خاموش می‌شود. */
      /* لغوِ سیستمی کلید را آزاد می‌کند (قاعدهٔ هرسِ `syncNextVisit`): اگر همین
         نوبت لغو یا «نیامد» شود، `syncNextVisit` باید بتواند همان یادآوری را با
         همان متن و موعد دوباره بکارد — با کلیدِ اشغال‌شده به ردیفِ لغوشده می‌خورد. */
      await this.prisma.reminder.updateMany({
        where: { patientId: dto.patientId, kind: 'next_visit', status: 'pending', visit: { nextVisitDate: d } },
        data: { status: 'cancelled', dedupeKey: null },
      });
      /* `beyondCapacity` فقط خبر است، نه خطا: میز با آن می‌گوید «بیش از ظرفیتِ
         امروز پذیرفته شد» تا منشی بداند چه کرده. */
      return { ...this.view(appt), beyondCapacity };
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException('همین حالا کسی این نوبت را گرفت');
      throw e;
    }
  }

  /**
   * شمارهٔ صفِ حالتِ ظرفیتی — «نوبتِ شما ۱۴ اُم».
   * ⚠️ تحتِ دو درخواستِ کاملاً همزمان ممکن است دو نفر یک شماره بگیرند؛ صف
   * را پذیرش به‌هرحال مرتب می‌کند و شماره راهنماست نه قفل — قفلِ واقعی
   * ظرفیتِ روز است که جدا شمرده می‌شود.
   */
  private async nextSeq(d: Date): Promise<number> {
    const max = await this.prisma.appointment.aggregate({
      where: { date: d, status: { in: ['held', 'confirmed', 'arrived', 'done'] } },
      _max: { seq: true },
    });
    return (max._max.seq ?? 0) + 1;
  }

  private static jalaliYm(d: Date): [number, number] {
    const parts = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', timeZone: 'UTC' })
      .formatToParts(d);
    return [
      Number(parts.find((x) => x.type === 'year')!.value.replace(/[^\d]/g, '')),
      Number(parts.find((x) => x.type === 'month')!.value),
    ];
  }

  /** گذارِ وضعیت — فقط گذارهای اعلام‌شده. */
  async setStatus(id: number, status: string, user: any, cancel?: { reason?: string; note?: string }) {
    const row = await this.prisma.appointment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('نوبت پیدا نشد');
    /* ⚠️ همان قاعدهٔ لغوِ مراجعه — و لغوِ نوبت **هم** مشمول است (تصمیمِ مالک):
       نوبت‌ها یادآوریِ روزِ قبل دارند، پس بیمارِ بی‌خبر منتظرِ پیامی می‌ماند
       که دیگر نمی‌آید. */
    const cancelling = status === 'cancelled' && row.status !== 'cancelled';
    if (cancelling && !CANCEL_REASONS[cancel?.reason ?? '']) {
      throw new BadRequestException('دلیلِ لغو را از فهرست انتخاب کنید');
    }
    const allowed = APPT_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `از «${APPT_FA_MAP[row.status] ?? row.status}» نمی‌شود به «${APPT_FA_MAP[status] ?? status}» رفت`,
      );
    }
    const updated = await this.prisma.appointment.update({
      where: { id },
      data: {
        status,
        ...(cancelling ? { cancelReason: cancel!.reason, cancelNote: cancel?.note ?? null } : {}),
        ...(row.status === 'cancelled' && status !== 'cancelled' ? { cancelReason: null, cancelNote: null } : {}),
      },
      include: AppointmentsService.INCLUDE,
    });
    await this.audit.record({
      actorId: user?.id, action: 'appointment.status', entityType: 'appointment', entityId: id,
      before: { status: row.status }, after: { status },
    });
    /* W2.2: noshow ← «تماس با غایب»؛ confirmed/cancelled ← بستنِ «تأییدِ نوبت» (work-rules). */
    await this.events.emit({
      type: `appointment.${status}`, appointmentId: id, patientId: row.patientId ?? null, visitId: row.visitId ?? null,
      actorId: user?.id ?? null, payload: { from: row.status, date: row.date },
    });
    /* لغو/نیامد → یادآوری باطل؛ برگشت به قطعی → دوباره کاشته می‌شود.
       ⚠️ این **از قبل** کار می‌کرد؛ آنچه نبود خبردادن به بیمار بود. */
    await this.reminders.syncAppointment(id);
    if (cancelling) {
      await this.reminders.notifyCancelled('appointment', row.patientId, cancel!.reason!, {
        when: jalaliText(row.date), // «۸ مهر ۱۴۰۵» — نه ISOِ میلادی (clinic-daily-12)
      });
    }
    /* قرینهٔ خاموشیِ walkIn: نوبتی که «ویزیتِ بعدی» را پوشش می‌داد اگر لغو یا
       نیامد شود، بیمار نباید بی‌یادآور بماند — next_visit همان مراجعه‌ها
       دوباره هم‌گام می‌شود (خودش می‌سنجد نوبتِ فعالِ دیگری هست یا نه). */
    if ((status === 'cancelled' || status === 'noshow') && row.patientId !== null) {
      const covered = await this.prisma.visit.findMany({
        where: { patientId: row.patientId, nextVisitDate: row.date },
        select: { id: true },
      });
      for (const v of covered) await this.reminders.syncNextVisit(v.id);
    }
    return this.view(updated);
  }

  /**
   * **شروعِ ویزیت** — کلیک روی نوبت، فرمِ همان مراجعه.
   *
   * اگر مراجعه از قبل هست (مسیرِ تأییدِ ثبت‌نام ساخته بودش) همان برمی‌گردد؛
   * وگرنه از خودِ نوبت ساخته می‌شود: تاریخ و ساعت و موضوع از نوبت. دوبار
   * کلیک مراجعهٔ دوم نمی‌سازد — `visitId` یک‌به‌یک است.
   */
  async startVisit(id: number, user: any) {
    // تعریف و اعتبارسنجیِ فرم بیرون از tx؛ داخل قفل هیچ queryِ اتصال دیگری نداریم.
    const source = await this.prisma.appointment.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('نوبت پیدا نشد');
    /**
     * ⚠️ **درِ دوم، همان قفلِ سراسری.** این متد از دو جا صدا زده می‌شود:
     * میزِ پذیرش (که سیاستِ تختهٔ خودش را هم اعمال می‌کند) و
     * `POST /appointments/:id/visit` که **هیچ شرطی نداشت** جز «لغو نباشد» —
     * پس تقویم برای نوبتِ **«نیامد»** هم دکمه می‌ساخت و آن دکمه کار می‌کرد.
     *
     * ⚠️ بدونِ `deskToday` صدا زده می‌شود: سیاستِ تخته (پول‌نداده + امروز)
     * مالِ این در نیست. شروعِ نوبتِ `held`ِ ثبت‌نامِ آنلاین از پرونده، و
     * شروعِ نوبتِ هفتهٔ بعد وقتی بیمار زودتر آمده، هر دو **عمدی**اند.
     *
     * ⚠️ نوبتی که از قبل `visitId` دارد مستثناست: آن «شروع» نیست، «بازکردنِ»
     * مراجعه‌ای است که قبلاً شروع شده.
     */
    if (!source.visitId) {
      const block = apptStartBlock(source);
      if (block) throw new BadRequestException(block);
    }
    let create: Awaited<ReturnType<PatientsService['prepareVisitCreation']>> | undefined;
    if (!source.visitId && !source.forVisitId && source.patientId && source.status !== 'cancelled') {
      const kinds = await this.forms.visitKinds();
      const kind = kinds.find((k) => k.kind === 'clinic')?.kind ?? kinds.find((k) => k.kind !== 'surgery')?.kind;
      if (!kind) throw new BadRequestException('فرمِ ویزیتِ غیرجراحی تعریف نشده است؛ ابتدا در فرم‌ساز یک فرمِ ویزیت فعال کنید');
      create = await this.patients.prepareVisitCreation({
        patientId: source.patientId, kind, topicId: source.topicId ?? undefined,
        opDate: source.date.toISOString(),
        opStartTime: source.startMin != null ? AvailabilityService.minToHHMM(source.startMin) : undefined,
      } as any, user, { skipFormValidation: true });
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${id} FOR UPDATE`;
        const row = await tx.appointment.findUnique({ where: { id } });
        if (!row) throw new NotFoundException('نوبت پیدا نشد');
        if (row.visitId) return { visitId: row.visitId, made: false };
        /* دوباره زیرِ قفل: بینِ خواندنِ `source` و گرفتنِ ردیف ممکن است کسی
           همان نوبت را لغو کرده باشد. */
        const locked = apptStartBlock(row);
        if (locked) throw new BadRequestException(locked);
        if (row.patientId !== source.patientId || row.forVisitId !== source.forVisitId
          || row.topicId !== source.topicId || row.startMin !== source.startMin || +row.date !== +source.date) {
          throw new ConflictException('نوبت هم‌زمان تغییر کرده است؛ صفحه را تازه کنید و دوباره شروع کنید');
        }
        let visitId: number;
        if (row.forVisitId) {
          const target = await tx.visit.findUnique({ where: { id: row.forVisitId } });
          if (!target || target.patientId !== row.patientId) throw new BadRequestException('مراجعهٔ هدف به پروندهٔ این بیمار تعلق ندارد');
          const linked = await tx.appointment.findUnique({ where: { visitId: target.id }, select: { id: true } });
          if (linked) throw new BadRequestException('این مراجعه از نوبتِ دیگری شروع شده است؛ همان نوبت را باز کنید');
          // تاریخِ حضور واقعی؛ وضعیتِ بالینی و تمام پاسخ‌های پیگیری حفظ می‌شوند.
          const today = dayUtc(clinicTodayIso());
          await tx.visit.update({ where: { id: target.id }, data: { opDate: today } });
          visitId = target.id;
        } else {
          if (!create) throw new ConflictException('اطلاعاتِ نوبت تغییر کرده است؛ دوباره تلاش کنید');
          visitId = (await create(tx)).id;
        }
        await tx.appointment.update({
          where: { id }, data: { visitId, ...(row.status === 'confirmed' ? { status: 'arrived' } : {}) },
        });
        await this.audit.record({
          actorId: user?.id, action: 'appointment.start_visit', entityType: 'appointment', entityId: id,
          after: { visitId, forVisitId: row.forVisitId },
        }, tx);
        await this.events.emit({
          type: 'appointment.started', appointmentId: id, patientId: row.patientId, visitId, actorId: user?.id ?? null,
        }, tx);
        return { visitId, made: !row.forVisitId };
      });
      if (result.made) await this.patients.afterVisitCreation(result.visitId);
      /* ویزیتِ پست‌آپی که با آمدنِ بیمار تاریخِ امروز گرفت: «ویزیتِ بعدی»ِ عمل هم همان
         می‌شود تا یادآوریِ تاریخِ قدیمی برای ویزیتی که برگزار شده نرود (همگامیِ دوطرفه). */
      else if (source.forVisitId) await this.patients.syncPostOpParent(result.visitId);
      return result;
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('این مراجعه هم‌زمان به نوبتِ دیگری وصل شد؛ صفحه را تازه کنید');
      throw e;
    }
  }
}
