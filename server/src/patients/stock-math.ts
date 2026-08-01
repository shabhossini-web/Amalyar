/**
 * ریاضیِ خالصِ انبار — هیچ وابستگیِ Nest یا Prisma ندارد.
 *
 * جدا شده تا هم `InventoryService` و هم `AssetsService` از یک فرمول بخوانند
 * بدونِ اینکه به هم import کنند (که حلقهٔ وابستگی می‌ساخت). همان قاعدهٔ
 * «یک فرمول، یک جا» — نه دو تعریف از موجودیِ هر محل.
 */

/// محلِ پیش‌فرض وقتی لات محلی ثبت‌نشده دارد — تا موجودی زیرِ کلیدِ `null` گم نشود.
export const HOME_FALLBACK = 'انبارِ مرکزی';

/**
 * موجودی = جمعِ دفتر. عمداً ستونِ ذخیره‌شده نیست: عددِ کنارِ دفتر دیر یا زود
 * از دفتر جدا می‌افتد و آن‌وقت معلوم نیست کدام درست است.
 */
export function balanceOf(movements: { quantity: number }[]): number {
  return movements.reduce((sum, m) => sum + m.quantity, 0);
}

/**
 * موجودیِ تفکیک‌شده به محل — همان `balanceOf`، فقط گروه‌بندی‌شده.
 *
 * لازم است چون یک لاتِ ۲۰تایی می‌تواند ۱۲ عددش در ستِ بیمارستانِ الف باشد و ۸
 * عددش در انبار. «موجودی» هر دو را می‌شمارد ولی فقط ۸ تا **در دسترس** است، و
 * چینشی که این تفاوت را نبیند ستِ رفته را دوباره تعهد می‌کند.
 */
export function balanceByLocation(
  movements: { quantity: number; location: string | null }[],
  home: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of movements) {
    const key = m.location ?? home;
    map.set(key, (map.get(key) ?? 0) + m.quantity);
  }
  return map;
}
