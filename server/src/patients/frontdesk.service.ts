import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService, APPT_LABELS } from './appointments.service';
import { summarize } from './billing.service';

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

  private static todayIso() {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

  async day(date: string) {
    const rows = await this.appts.day(date);
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
      rows: withBilling.map((r: any) => ({
        ...r,
        /* «شروع» فقط برای بیمارِ امروز که پرونده دارد و وضعیتش اجازه می‌دهد.
           مشتقِ سرور است تا دکمه و مجوز یک حرف بزنند (قانون ۱۵). */
        canStart: isToday && ['confirmed', 'arrived'].includes(r.status) && r.patientId != null,
      })),
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
    if (row.date.toISOString().slice(0, 10) !== FrontDeskService.todayIso()) {
      /* `startVisit` وقتی `forVisitId` دارد `opDate` را با **امروز** بازنویسی
         می‌کند؛ میز همان صفحه‌ای است که کسی روی ردیفِ دیروز کلیک می‌کند. */
      throw new BadRequestException('از میزِ پذیرش فقط نوبتِ همین امروز شروع می‌شود');
    }
    if (row.status === 'held') {
      /* `held → confirmed` یعنی «پرداخت دیده شد» — ادعایی که باید کلیکِ عمدی
         باشد، نه اثرِ جانبیِ «شروع». */
      throw new BadRequestException('اول «قطعی شد» را بزنید، بعد شروع');
    }
    if (row.status === 'cancelled' || row.status === 'noshow') {
      throw new BadRequestException(`نوبتِ «${APPT_LABELS[row.status]}» شروع نمی‌شود`);
    }
    if (row.status === 'confirmed') await this.appts.setStatus(id, 'arrived', user);
    const result = await this.appts.startVisit(id, user);
    const fresh = await this.prisma.appointment.findUnique({
      where: { id }, include: { patient: { select: { id: true, code: true, firstName: true, lastName: true, phone: true } }, topic: { select: { id: true, name: true, color: true } } },
    });
    return { ...result, appointment: fresh ? this.appts.view(fresh) : null };
  }
}
