/**
 * **نگهبانِ ترکِ صفحه با تغییرِ ذخیره‌نشده** — برای جابه‌جایی‌های **برنامه‌ای** (`navigate()`).
 *
 * صفحه‌ای که پیش‌نویسِ ذخیره‌نشده دارد (فعلاً «تنظیمات») یک پرسش ثبت می‌کند و هر جای پوسته که
 * بی‌لینک جابه‌جا می‌کند (منوی پروفایل، جستجوی سراسری، زنگِ کارها) پیش از رفتن `canLeave()` را
 * می‌پرسد. ⚠️ بازبینیِ خصمانه (R11): نگهبانِ «تنظیمات» فقط کلیک روی `a[href]` را در فازِ capture
 * می‌گرفت؛ «پروفایلِ من»، «صفحهٔ امروز» و «افزودنِ حساب» در منوی پروفایل و نتیجهٔ جستجوی سراسری
 * `navigate()` می‌زدند و تغییراتِ ذخیره‌نشده بی‌پرسش دور ریخته می‌شد.
 *
 * یک پرسش در هر لحظه — آخرین ثبت‌کننده؛ در هر لحظه فقط یک صفحه زیرِ پوسته سوار است.
 */
let guard = null;

/**
 * ثبتِ پرسش — تابعی که `true` یعنی «برو» (مثلاً `() => window.confirm('…')`).
 * خروجی لغوِ همان ثبت است (برای پاک‌سازیِ `useEffect`).
 */
export function setLeaveGuard(ask) {
  guard = ask;
  return () => { if (guard === ask) guard = null; };
}

/**
 * اجازهٔ رفتن هست؟ `to` مقصد است؛ همان صفحه (فقط کوئری یا هش) پرسش نمی‌خواهد. بی‌`to` — خروج از
 * حساب، جابه‌جاییِ حساب — همیشه پرسیده می‌شود، چون صفحه هر چه باشد پیش‌نویس با آن می‌رود.
 */
export function canLeave(to) {
  if (!guard) return true;
  if (typeof to === 'string' && typeof window !== 'undefined') {
    try {
      if (new URL(to, window.location.href).pathname === window.location.pathname) return true;
    } catch { /* نشانیِ ناخوانا — بپرس */ }
  }
  return guard() !== false;
}

/** `navigate(to, opts)` پس از پرسش؛ `false` یعنی کاربر ماند. */
export function guardedNavigate(navigate, to, opts) {
  if (!canLeave(to)) return false;
  navigate(to, opts);
  return true;
}
