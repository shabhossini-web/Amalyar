import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService, apptStartBlock } from './appointments.service';
import { summarize } from './billing.service';
import { monthDayCounts } from './month-summary';
import { clinicTodayIso } from '../common/clinic-day';

/** ترتیبِ ستون‌ها روی تخته — از چپ به راستِ جریانِ کار. */
const LANES = [
  { key: 'booked', title: 'نوبت‌دار' },
  { key: 'present', title: 'حاضر' },
  { key: 'inVisit', title: 'در جریان' },
  { key: 'finished', title: 'تمام‌شده' },
  { key: 'absent', title: 'غایب' },
];

/** سقفِ ردیف‌های یک روز. بیشتر از این یعنی تخته دیگر تخته نیست. */
const MAX_ROWS = 200;

/**
 * **میزِ پذیرشِ روز** (W3.3، §۴.۵ سند) — تختهٔ ستونیِ امروز.
 *
 * ⚠️ **هیچ ماشینِ وضعیتی این‌جا نیست.** گذارها، قفلِ تراکنشی، رویدادها و
 * یادآوری‌ها همه در `AppointmentsService` می‌مانند و این سرویس فقط صدایشان
 * می‌زند. کپیِ دومِ ماشینِ وضعیت یعنی روزی تقویم و میز دو حرفِ متفاوت بزنند.
 *
 * ⚠️ **چرا کنترلرِ جدا و نه پایین‌آوردنِ گیتِ `calendar`:** `AppointmentsController`
 * با `@Feature('calendar')` (سطحِ سوپروایزر) بسته است و کلِ تقویمِ عمل‌ها و
 * قواعدِ برنامهٔ کاری هم پشتِ همان است. پایین‌آوردنش برای منشی، آن‌ها را هم
 * باز می‌کرد. دو کنترلر روی یک سرویس = دو سطحِ دسترسی بدونِ کپیِ منطق.
 */
@Injectable()
export class FrontDeskService {
  constructor(private prisma: PrismaService, private appts: AppointmentsService) {}

  /* 🔴 «امروز» به وقتِ **مطب** است نه کانتینر. نسخهٔ قبلی روزِ UTC را می‌داد
     ولی مرورگر روزِ محلی می‌فرستد؛ بینِ ۰۰:۰۰ تا ۰۳:۳۰ تهران این دو یک روز
     فرق داشتند و `isToday` غلط می‌شد، یعنی `canStart` برای **کلِ تخته**
     خاموش — هر شب سه ساعت و نیم، بی‌هیچ خطایی. `common/clinic-day.ts`. */
  private static todayIso() {
    return clinicTodayIso();
  }

  async day(date: string) {
    /* ⚠️ `deskToday` داده می‌شود چون این **تختهٔ یک روز** است: ردیفِ دیروز و
       ردیفِ پول‌نداده دکمهٔ شروع نمی‌گیرند. تقویم و پروندهٔ بیمار این دو قید
       را ندارند — آن‌جا کاربر یک نوبتِ مشخص را انتخاب کرده، نه یک ردیف از
       تختهٔ امروز، و دکمهٔ «قطعی شد» هم کنارِ دستش نیست. */
    const rows = await this.appts.day(date, FrontDeskService.todayIso());
    const capped = rows.length > MAX_ROWS;
    const shown = capped ? rows.slice(0, MAX_ROWS) : rows;
    const [billing, debt] = await Promise.all([this.billingFor(shown), this.debtFor(shown)]);

    const withBilling = shown.map((r: any) => {
      const linked = r.visitId ?? r.forVisitId ?? -1;
      return { ...r, billing: billing.get(linked) ?? null, debt: debt.get(r.patientId ?? -1)?.(linked) ?? null };
    });
    const isToday = date === FrontDeskService.todayIso();

    return {
      date,
      isToday,
      lanes: LANES.map((l) => ({ ...l, count: withBilling.filter((r: any) => r.lane === l.key).length })),
      /* لغوشده‌ها ستون ندارند — یک عدد کنارِ تخته‌اند. ستونِ ششم برای چیزی که
         کارِ امروز نیست، فقط عرضِ چهار ستونِ دیگر را می‌خورد. */
      cancelledCount: withBilling.filter((r: any) => r.lane === 'cancelled').length,
      /* ⚠️ `canStart` این‌جا **ساخته نمی‌شود**: خانه‌اش `AppointmentsService.view()`
         است، کنارِ `lane` و `nextOptions`. تا دیروز همین‌جا بود و هر میزِ
         دیگری نسخهٔ خودش را نوشته بود — سه قاعده برای یک دکمه. */
      rows: withBilling,
      truncated: capped,
      total: rows.length,
    };
  }

  /**
   * ⚠️ یک کوئری برای همهٔ ردیف‌ها، نه یکی به‌ازای هر کارت: تختهٔ یک روزِ شلوغ
   * ده‌ها ردیف دارد و N+1 این‌جا یعنی صفحه‌ای که سرِ ظهر باز نمی‌شود.
   */
  private async billingFor(rows: any[]) {
    const ids = [...new Set(rows.map((r: any) => r.visitId ?? r.forVisitId).filter(Boolean))] as number[];
    const out = new Map<number, any>();
    if (!ids.length) return out;
    const visits = await this.prisma.visit.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, opStatus: true, pricingModel: true, globalAmount: true,
        charges: { select: { amount: true } },
        payments: { select: { amount: true } },
      },
    });
    for (const v of visits) {
      /* مراجعهٔ لغوشده ماندهٔ ابدی نمی‌سازد — همان قاعدهٔ `live.service.ts`. */
      if (v.opStatus === 'cancelled') { out.set(v.id, null); continue; }
      out.set(v.id, summarize(v.charges, v.payments, v));
    }
    return out;
  }

  /**
   * **بدهیِ بیمار، نه بدهیِ نوبت** — ماندهٔ همهٔ مراجعه‌های دیگرِ همین بیمار.
   *
   * 🔴 باگِ واقعی که با نگاه‌کردن به تختهٔ یک روزِ کامل پیدا شد: چیپِ «مانده»
   * فقط وقتی می‌آمد که نوبت به یک مراجعه **وصل** باشد (`visitId`/`forVisitId`).
   * ولی نوبتِ تلفنی و نوبتِ روزِ بعد هیچ‌کدام مراجعه ندارند، و مراجعهٔ قبلیِ
   * تسویه‌نشده اصلاً ردیفی روی تختهٔ امروز ندارد. نتیجه: بیمار جلوی منشی
   * می‌ایستاد با یک‌میلیون‌و‌دویست بدهی و میز **هیچ** نشان نمی‌داد — درست همان
   * کاری که میزِ پذیرش برایش هست.
   *
   * ⚠️ مراجعهٔ **وصل‌شده** از این جمع کنار گذاشته می‌شود، وگرنه همان رقم دو بار
   * دیده می‌شود (یک‌بار «مانده»، یک‌بار «بدهیِ قبلی»). برای همین به‌جای عدد، یک
   * تابع برمی‌گردد که شناسهٔ مراجعهٔ وصل‌شده را می‌گیرد.
   *
   * ⚠️ یک کوئری برای کلِ تخته — همان قاعدهٔ `billingFor`.
   */
  private async debtFor(rows: any[]) {
    const out = new Map<number, (linkedVisitId: number) => { due: number; visits: number } | null>();
    const ids = [...new Set(rows.map((r: any) => r.patientId).filter(Boolean))] as number[];
    if (!ids.length) return out;
    const visits = await this.prisma.visit.findMany({
      where: { patientId: { in: ids }, opStatus: { not: 'cancelled' }, patient: { deletedAt: null } },
      select: {
        id: true, patientId: true, pricingModel: true, globalAmount: true,
        charges: { select: { amount: true } }, payments: { select: { amount: true } },
      },
    });
    const byPatient = new Map<number, { id: number; due: number }[]>();
    for (const v of visits) {
      const due = summarize(v.charges, v.payments, v).due;
      if (due <= 0) continue;
      const list = byPatient.get(v.patientId) ?? [];
      list.push({ id: v.id, due });
      byPatient.set(v.patientId, list);
    }
    for (const [pid, list] of byPatient) {
      out.set(pid, (linked: number) => {
        const rest = list.filter((v) => v.id !== linked);
        if (!rest.length) return null;
        return { due: rest.reduce((s, v) => s + v.due, 0), visits: rest.length };
      });
    }
    return out;
  }

  setStatus(id: number, status: string, user: any, cancel?: { reason?: string; note?: string }) {
    return this.appts.setStatus(id, status, user, cancel);
  }

  /**
   * نوبتِ حضوریِ **میز** — با `desk: true`، یعنی ظرفیت خبر می‌دهد و منع نمی‌کند.
   * چراییِ کامل در `AppointmentsService.walkIn`؛ خلاصه‌اش تصمیمِ مالک است:
   * «بیمار ممکن است بدون نوبتِ قبلی حضوری بیاید که اگر وقت بشود پذیرش می‌شود».
   */
  walkIn(dto: any, user: any) {
    return this.appts.walkIn(dto, user, { desk: true });
  }

  suggest(patientId: number, date: string, topicId?: number) {
    return this.appts.suggest(patientId, date, topicId);
  }

  /**
   * خلاصهٔ ماه برای **نشانهٔ روی تقویمِ انتخابِ تاریخ** — فقط شمارش.
   *
   * ⚠️ `CalendarService.month` این کار را نمی‌کند و نباید بکند: آن کلِ سطرها
   * را با نامِ بیمار می‌آورد و پشتِ فیچرِ `calendar` (سطحِ سوپروایزر) است.
   * منشی نه آن سطح را دارد نه آن حجم را لازم دارد.
   */
  month(year: number, month: number) {
    /* میزِ پذیرش روزش را با **نوبت** می‌سنجد، نه با عمل. لغوشده شمرده
       نمی‌شود — «این روز چقدر پُر است» یعنی چند نفر واقعاً می‌آیند. */
    return monthDayCounts(this.prisma, year, month, {
      apptWhere: { status: { not: 'cancelled' } },
    });
  }

  /**
   * **یک نوبت** — همان `view()`ِ تخته، برای پاپ‌آپی که از پرونده یا میزِ پزشک
   * باز می‌شود.
   *
   * 🔴 چرا این‌جا و نه `GET /appointments/:id`: آن کنترلر `@Feature('calendar')`
   * دارد که سطحش **سوپروایزر** است، و پاپ‌آپِ نوبت از میزِ پزشک و پروندهٔ
   * بیمار هم باز می‌شود — یعنی دقیقاً همان‌جایی که کاربر سطحِ کارشناس دارد.
   * پاپ‌آپ تا دیروز دکمه‌هایش را از کپیِ کلاینتیِ ماشینِ وضعیت می‌ساخت و به
   * `POST /appointments/:id/status` می‌زد؛ برای آن کاربر **۴۰۳** می‌گرفت.
   * دکمه‌ای که کار نمی‌کند از نبودنِ دکمه بدتر است.
   */
  async one(id: number) {
    const row = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, code: true, firstName: true, lastName: true, phone: true } },
        topic: { select: { id: true, name: true, color: true } },
      },
    });
    if (!row) throw new NotFoundException('نوبت پیدا نشد');
    /* همان قیدِ تخته: پاپ‌آپ از همین در وارد می‌شود (`/frontdesk/.../start`)،
       پس دکمه‌اش باید دقیقاً همان چیزی را بگوید که آن در می‌پذیرد — وگرنه
       دکمه‌ای می‌سازیم که با زدنش ۴۰۰ می‌دهد. */
    return this.appts.view(row, FrontDeskService.todayIso());
  }

  /**
   * **شروعِ مراجعه از میز** — «رسید» و «شروع» در یک کلیک.
   *
   * 🔴 چرا ترکیبی است و نه صدازدنِ سادهٔ `startVisit`:
   * `startVisit` اگر نوبت از قبل `visitId` داشته باشد **زودتر برمی‌گردد**
   * (`appointments.service.ts:289`) و هرگز به خطی که `arrived` می‌نویسد
   * نمی‌رسد. و `intake.service.ts:1736` هنگامِ تأییدِ ثبت‌نام دقیقاً همین را
   * می‌کند: نوبت را `confirmed` **با** `visitId` می‌گذارد. یعنی برای هر
   * بیماری که از ثبت‌نامِ آنلاین آمده، «شروع» کارت را از ستونِ «نوبت‌دار»
   * تکان نمی‌داد — دقیقاً همان معیارِ پذیرشِ این بسته.
   *
   * ⚠️ آن برگشتِ زودهنگام **باگ نیست**: برای «بازکردنِ» مراجعهٔ شروع‌شده درست
   * است. چیزی که یکی گرفته شده «شروع» و «بازکردن» است؛ میز این دو را جدا
   * می‌کند — «بازکردن» هیچ وضعیتی را دست نمی‌زند.
   *
   * ⚠️ اتمیک نیست و لازم هم نیست: اگر بینِ دو گام بشکند، بیمار `arrived`
   * می‌ماند بدونِ مراجعه — حالتی **دیدنی** (کارت در ستونِ «حاضر»، دکمه سرِ
   * جایش) و قابلِ تکرار. دنبالِ تراکنشِ گم‌شده نگردید.
   */
  async start(id: number, user: any) {
    const row = await this.prisma.appointment.findUnique({
      where: { id }, select: { id: true, status: true, date: true, patientId: true },
    });
    if (!row) throw new NotFoundException('نوبت پیدا نشد');
    /* ⚠️ شرط‌ها این‌جا **نوشته نمی‌شوند**: `apptStartBlock` همان قاعده‌ای است
       که `canStart` روی کارت‌ها را می‌سازد و `startVisit` هم با آن قفل است.
       نسخهٔ قبلی همین سه چک را دستی داشت و درست هم بود — ولی وقتی تقویم
       قاعدهٔ خودش را نوشت، «درست»بودنِ این یکی هیچ کمکی نکرد.
       ⚠️ `deskToday` یعنی «سیاستِ تخته را هم اعمال کن» (پول‌نداده + امروز). */
    const block = apptStartBlock(row, FrontDeskService.todayIso());
    if (block) throw new BadRequestException(block);
    if (row.status === 'confirmed') await this.appts.setStatus(id, 'arrived', user);
    const result = await this.appts.startVisit(id, user);
    const fresh = await this.prisma.appointment.findUnique({
      where: { id }, include: { patient: { select: { id: true, code: true, firstName: true, lastName: true, phone: true } }, topic: { select: { id: true, name: true, color: true } } },
    });
    return { ...result, appointment: fresh ? this.appts.view(fresh) : null };
  }
}
