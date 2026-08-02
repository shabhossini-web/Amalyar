/**
 * هزینهٔ حملِ یک مسیر و سرشکنیِ آن روی عمل‌ها — **خالص**.
 *
 * ⚠️ دانهٔ هزینه هم مثلِ دانهٔ مسیر، **مسیر** است نه عمل: راننده یک قبضِ بنزین
 * برای کلِ روز دارد، نه یکی به‌ازای هر بیمارستان. «هزینهٔ حملِ این عمل» عددِ
 * ثبت‌شده نیست، **مشتق** است — و دقیقاً به همین دلیل این‌جا یک فرمول دارد.
 */

/** جمعِ سه قلم. مقدارِ خالی صفر است، نه خطا: مسیرِ بدونِ هزینه هم مسیر است. */
export function runTotal(r: { fuelCost?: number | null; driverFee?: number | null; otherCost?: number | null }): number {
  const n = (v: unknown) => {
    const x = Math.trunc(Number(v) || 0);
    return x > 0 ? x : 0;
  };
  return n(r.fuelCost) + n(r.driverFee) + n(r.otherCost);
}

/**
 * سرشکنیِ مبلغِ مسیر روی کلیدهای مقصد (شناسهٔ عمل).
 *
 * تقسیمِ مساوی است نه بر مبنای مسافت: مسافتِ واقعی را نداریم و تخمینِ ساختگی
 * بدتر از تقسیمِ صریحِ مساوی است.
 *
 * ⚠️ **باقی‌مانده گم نمی‌شود**: ۱۰۰٬۰۰۰ روی ۳ عمل می‌شود ۳۳٬۳۳۴ + ۳۳٬۳۳۳ +
 * ۳۳٬۳۳۳. اگر گرد می‌کردیم، جمعِ سرشکن با هزینهٔ ثبت‌شده نمی‌خواند و همان
 * اختلافِ یک‌تومانی اعتماد به گزارش را می‌برد.
 */
export function allocate(total: number, keys: (number | string)[]): Map<number | string, number> {
  const out = new Map<number | string, number>();
  const uniq = [...new Set(keys)];
  if (!uniq.length || total <= 0) return out;
  const base = Math.floor(total / uniq.length);
  let rest = total - base * uniq.length;
  for (const k of uniq) {
    out.set(k, base + (rest > 0 ? 1 : 0));
    if (rest > 0) rest -= 1;
  }
  return out;
}

/**
 * سهمِ هر عمل از هزینهٔ یک مسیر.
 *
 * یک عمل که هم توقفِ تحویل دارد هم توقفِ جمع‌آوری **یک‌بار** شمرده می‌شود؛
 * وگرنه رفت‌وبرگشت دو برابر هزینه می‌گرفت.
 *
 * توقف‌های بدونِ عمل (مثلاً بردنِ ستِ امانی به بیمارستان) سهمی نمی‌گیرند و
 * سهمشان روی عمل‌ها نمی‌افتد — بخشِ سرشکن‌نشده صریح برگردانده می‌شود تا در
 * گزارش «هزینهٔ عمومیِ حمل» بماند، نه اینکه بی‌سروصدا به گردنِ یک بیمار بیفتد.
 */
export function allocateRun(run: {
  fuelCost?: number | null;
  driverFee?: number | null;
  otherCost?: number | null;
  stops?: { transfers?: { visitId?: number | null }[] }[];
}) {
  const total = runTotal(run);
  const visitIds = [
    ...new Set(
      (run.stops ?? [])
        .flatMap((s) => s.transfers ?? [])
        .map((t) => t.visitId)
        .filter((v): v is number => typeof v === 'number'),
    ),
  ];
  const shares = allocate(total, visitIds);
  const allocated = [...shares.values()].reduce((s, v) => s + v, 0);
  return {
    total,
    visitIds,
    shares: visitIds.map((visitId) => ({ visitId, amount: shares.get(visitId) ?? 0 })),
    unallocated: total - allocated,
  };
}
