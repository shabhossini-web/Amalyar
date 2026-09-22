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

export async function visitMoneyMap(prisma: any, where: any): Promise<Map<number, VisitMoney>> {
  const visits = await prisma.visit.findMany({
    where,
    select: { id: true, pricingModel: true, globalAmount: true },
  });
  const out = new Map<number, VisitMoney>();
  if (!visits.length) return out;

  const ids = visits.map((v: any) => v.id);
  const [charges, payments] = await Promise.all([
    prisma.charge.groupBy({ by: ['visitId'], where: { visitId: { in: ids } }, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ['visitId'], where: { visitId: { in: ids } }, _sum: { amount: true } }),
  ]);
  const charged = new Map<number, number>(charges.map((c: any) => [c.visitId, c._sum.amount ?? 0]));
  const paid = new Map<number, number>(payments.map((p: any) => [p.visitId, p._sum.amount ?? 0]));

  for (const v of visits) {
    /* عمداً از خودِ `summarize` — نه بازنویسیِ فرمولش. همین بازنویسی بود که
       `visitStats` را از بقیه جدا کرد. */
    out.set(v.id, summarize(
      [{ amount: charged.get(v.id) ?? 0 }],
      [{ amount: paid.get(v.id) ?? 0 }],
      { pricingModel: v.pricingModel, globalAmount: v.globalAmount },
    ));
  }
  return out;
}
