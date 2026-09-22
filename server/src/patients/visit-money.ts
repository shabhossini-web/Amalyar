import { summarize } from './billing.service';

/**
 * **مبلغ و ماندهٔ یک دسته مراجعه — با همان قاعده‌ای که صورت‌حساب دارد.**
 *
 * ⚠️ چرا لازم شد (ممیزیِ «یک دیتا در ویوهای مختلف»): سه جا این را حساب
 * می‌کردند و **یکی‌شان قاعده را ناقص داشت**:
 *
 * | کجا | مدلِ گلوبال را می‌دید؟ |
 * |---|---|
 * | `billing.summarize` (کارتِ مراجعه، فاکتور) | ✅ |
 * | `moneyOrderedIds` (سورت و فیلترِ «بدهکار») | ✅ |
 * | `visitStats` («ماندهٔ کل» و تفکیکِ طرفِ حساب) | ❌ |
 *
 * یعنی مراجعه‌ای با **مبلغِ توافقیِ گلوبال** (که اقلامش صفر یا جزئی است) در
 * کارتِ خودش ماندهٔ درست نشان می‌داد ولی در «ماندهٔ کلِ» بالای همان صفحه
 * اصلاً شمرده نمی‌شد — و بدتر، چون `groupBy` فقط مراجعه‌های **دارای قلم** را
 * برمی‌گرداند، مراجعهٔ گلوبالِ بی‌قلم از فهرستِ «بدهکار» هم می‌افتاد. جمعِ
 * بالای صفحه با جمعِ کارت‌های زیرش نمی‌خواند و هیچ خطایی هم نبود.
 *
 * ⚠️ `due` این‌جا **کلمپ نمی‌شود**: اضافه‌پرداخت منفی برمی‌گردد و تصمیمِ
 * «منفی را صفر بگیر» مالِ فراخوان است. جمعِ کلِ داشبورد باید کلمپ کند (وگرنه
 * اضافه‌پرداختِ یک بیمار بدهیِ بیمارِ دیگر را می‌پوشاند) ولی کارتِ صورت‌حساب
 * باید منفی را **نشان** بدهد.
 */
export type VisitMoney = { total: number; itemsTotal: number; paid: number; due: number };

/**
 * @param opts.allVisits هر مراجعهٔ دامنه در خروجی باشد، حتی بی‌قلم و بی‌پرداخت.
 *   سورت و صفحه‌بندی لازمش دارند (ردیفِ صفر هم باید مرتب شود)؛ آمار نه.
 */
export async function visitMoneyMap(
  prisma: any,
  where: any,
  opts: { allVisits?: boolean } = {},
): Promise<Map<number, VisitMoney>> {
  /**
   * ⚠️ **دامنه با `where` فیلتر می‌شود، نه با فهرستِ شناسه.** نسخهٔ اول همهٔ
   * شناسه‌های دامنه را می‌خواند و بعد `{ visitId: { in: ids } }` می‌زد —
   * برای نصبی با ده‌ها هزار مراجعه یعنی کشیدنِ کلِ فهرست در **هر** درخواستِ
   * داشبورد. `groupBy` خودش می‌تواند روی رابطه فیلتر کند.
   */
  const [charges, payments, globals] = await Promise.all([
    prisma.charge.groupBy({ by: ['visitId'], where: { visit: where }, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ['visitId'], where: { visit: where }, _sum: { amount: true } }),
    /* مراجعه‌های **گلوبال** جدا خوانده می‌شوند چون ممکن است هیچ قلمی نداشته
       باشند و در هیچ‌کدام از دو `groupBy` بالا نیایند — دقیقاً همان حالتی که
       از «ماندهٔ کل» می‌افتاد. مجموعه‌شان کوچک است. */
    prisma.visit.findMany({
      where: { ...where, pricingModel: 'global' },
      select: { id: true, globalAmount: true },
    }),
  ]);

  const charged = new Map<number, number>(charges.map((c: any) => [c.visitId, c._sum.amount ?? 0]));
  const paid = new Map<number, number>(payments.map((p: any) => [p.visitId, p._sum.amount ?? 0]));
  const global = new Map<number, number | null>(globals.map((v: any) => [v.id, v.globalAmount]));

  const ids = new Set<number>([...charged.keys(), ...paid.keys(), ...global.keys()]);
  if (opts.allVisits) {
    for (const v of await prisma.visit.findMany({ where, select: { id: true } })) ids.add(v.id);
  }

  const out = new Map<number, VisitMoney>();
  for (const id of ids) {
    /* عمداً از خودِ `summarize` — نه بازنویسیِ فرمولش. همین بازنویسی بود که
       `visitStats` را از بقیه جدا کرد. */
    out.set(id, summarize(
      [{ amount: charged.get(id) ?? 0 }],
      [{ amount: paid.get(id) ?? 0 }],
      global.has(id) ? { pricingModel: 'global', globalAmount: global.get(id) ?? null } : undefined,
    ));
  }
  return out;
}
