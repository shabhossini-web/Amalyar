/**
 * بازهٔ تعهدِ دارایی — **خالص**، بدونِ Prisma و Nest.
 *
 * جدا شده تا هم سرویس از آن بخواند هم آزمون مستقیم صدایش بزند؛ همان دلیلی که
 * `stock-math` جدا شد. این‌جا هیچ چیزی از دیتابیس لازم نیست: ورودی یک شیءِ
 * حواله است و خروجی دو تاریخ.
 */
const HOUR = 3600_000;

/** «HH:MM» روی یک روز → لحظهٔ دقیق. ساعتِ نامعتبر یا خالی → خودِ روز. */
export function at(day: Date, hhmm?: string | null): Date {
  const base = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ''));
  if (!m) return base;
  return new Date(base.getTime() + Number(m[1]) * HOUR + Number(m[2]) * 60_000);
}

/**
 * بازهٔ تعهدِ یک حواله — از کِی تا کِی دارایی گرفتار است.
 *
 * ⚠️ **این تابع جای قاعدهٔ «همان روز» را گرفت.** یک دستگاه در یک روز بینِ چند
 * بیمارستان می‌چرخد؛ اگر اشتراکِ روز را تعارض بشماریم، چرخشِ عادیِ روزانه
 * مسدود می‌شود و کاربر یاد می‌گیرد هشدار را نادیده بگیرد.
 *
 * پایانِ بازه سه حالت دارد، به ترتیبِ اعتبار:
 *   ۱. **آزادسازیِ کارشناس** — واقعیت است، هرچه باشد همان درست است.
 *   ۲. ساعتِ پایانِ عمل — برنامه است، تا وقتی واقعیت نیامده.
 *   ۳. انتهای روز — محافظه‌کارانه، چون ندانستن نباید به «آزاد است» ترجمه شود.
 *
 * به پایان، `turnaroundHours` اضافه می‌شود: ستی که تازه برگشته هنوز استریل
 * نشده و اعزامش یعنی فرستادنِ ستِ کثیف به اتاقِ عمل.
 */
export function windowOf(t: any, turnaroundHours?: number | null): [Date, Date] {
  const day = t.plannedFor ?? t.visit?.opDate ?? t.sentAt;
  const from = t.windowFrom ?? at(day, t.visit?.cargoDueTime ?? t.visit?.opStartTime);
  const rawTo = t.windowTo
    ?? t.releasedAt
    ?? (t.visit?.opEndTime ? at(day, t.visit.opEndTime) : null)
    ?? new Date(at(day, null).getTime() + 24 * HOUR - 1);
  const to = new Date(Math.max(+rawTo, +from) + (turnaroundHours ?? 0) * HOUR);
  return [from, to];
}

/** هم‌پوشانیِ دو بازه — مرزِ مشترک تعارض نیست («تا ۱۲» و «از ۱۲» پشتِ هم‌اند). */
export const overlaps = (a: [Date, Date], b: [Date, Date]) => +a[0] < +b[1] && +b[0] < +a[1];
