/**
 * تم و چگالیِ رابط — تنها جایی که تصمیم می‌گیرد اپ روشن باشد یا تیره.
 *
 * ⚠️ **تا W3.6 عمل‌یار تک‌تمِ تیره بود.** حالا دو تم دارد، و قاعده‌اش این است:
 * تیره برای حوزه‌هایی که کارشان اتاقِ عمل و شبِ بیمارستان است (`ionm`,
 * `implant`)، روشن برای مطب (`clinic`) که زیرِ نورِ روز و کنارِ پروندهٔ کاغذی کار
 * می‌کند. سوییچ برای همه هست — پیش‌فرض حدس است، نه حکم (`DECISIONS.md` #۳).
 *
 * ⚠️ صفحه‌های **ورودی** (لندینگ، ورود، لانچر) همیشه تیره می‌مانند و شیشه و نئونشان
 * را نگه می‌دارند (§۴.۸ سندِ بازبینی): آن‌ها ویترین‌اند نه میزِ کار. این کار با
 * کلاسِ `theme-dark` انجام می‌شود که توکن‌های تیره را دوباره اعلام می‌کند — نه با
 * دست‌کاریِ `data-theme` هنگامِ رفت‌وآمد، که هم چشمک می‌زد هم انتخابِ کاربر را
 * پاک می‌کرد.
 *
 * ⚠️ چرا `localStorage` و نه سرور: این یک **ترجیحِ نمایشی** است، نه داده. نشست در
 * کوکیِ HttpOnly است (قانون ۶) و تم هیچ ربطی به احراز ندارد؛ نگه‌داشتنش روی
 * دستگاه یعنی یک رفت‌وبرگشتِ کمتر پیش از اولین رنگ‌آمیزی. اگر روزی باید بینِ
 * دستگاه‌ها همگام شود، جایش `settings` همان شرکت است نه این‌جا.
 */

const THEME_KEY = 'amalyar_theme';
const DENSITY_KEY = 'amalyar_density';

export const THEMES = ['dark', 'light'];
export const DENSITIES = ['cozy', 'compact'];

/** حوزه‌هایی که پیش‌فرضشان روشن است — بقیه تیره (`DECISIONS.md` #۳). */
const LIGHT_VERTICALS = new Set(['clinic']);

/* ⚠️ هر خواندن/نوشتنِ storage در try/catch است: در حالتِ ناشناسِ سافاری و وقتی
   کاربر کوکی/سایت‌دیتا را بسته، دسترسی **پرتاب می‌کند** — و آن‌وقت کلِ اپ سرِ یک
   ترجیحِ رنگ بالا نمی‌آمد. */
const read = (k) => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, v); } catch { /* حالتِ ناشناس — ترجیح فقط همین نشست می‌ماند */ }
};

/** تمِ ذخیره‌شدهٔ کاربر، یا `null` اگر خودش انتخابی نکرده. */
export const storedTheme = () => (THEMES.includes(read(THEME_KEY)) ? read(THEME_KEY) : null);
export const storedDensity = () => (DENSITIES.includes(read(DENSITY_KEY)) ? read(DENSITY_KEY) : null);

/**
 * تمِ مؤثر: انتخابِ کاربر مقدم است، بعد پیش‌فرضِ حوزه.
 * ⚠️ `vertical`ِ ناشناخته → تیره، نه خطا: حوزهٔ تازه‌ای که هنوز تصمیمی برایش
 * گرفته نشده باید مثلِ امروز کار کند.
 */
export const resolveTheme = (vertical, stored = storedTheme()) =>
  stored ?? (LIGHT_VERTICALS.has(vertical) ? 'light' : 'dark');

export const resolveDensity = (stored = storedDensity()) => stored ?? 'cozy';

/** صفتِ `data-theme` روی `<html>` — همان جایی که `brand-palette.js` رنگِ برند را می‌گذارد. */
export function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : 'dark';
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t;
  return t;
}

export function applyDensity(density) {
  const d = DENSITIES.includes(density) ? density : 'cozy';
  if (typeof document !== 'undefined') document.documentElement.dataset.density = d;
  return d;
}

/** انتخابِ صریحِ کاربر — هم اعمال می‌شود هم می‌ماند. */
export function setTheme(theme) {
  const t = applyTheme(theme);
  write(THEME_KEY, t);
  return t;
}

export function setDensity(density) {
  const d = applyDensity(density);
  write(DENSITY_KEY, d);
  return d;
}
