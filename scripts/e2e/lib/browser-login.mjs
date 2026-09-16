/**
 * ورودِ مرورگری برای e2e های سرورِ زنده — بعد از حذفِ توکن از localStorage.
 *
 * اپ دیگر `amalyar_token` را نمی‌خواند؛ نشست فقط از کوکیِ HttpOnly می‌آید
 * (`server/src/auth/session-cookie.ts`). این کمک‌تابع همان کوکی‌ها را از توکنی
 * که آزمون از `/auth/login` گرفته می‌سازد و در مرورگر می‌نشاند — بدونِ ورودِ دوم
 * (سطلِ محدودیتِ ورود ۸ بار در ۱۵ دقیقه است؛ هر ورودِ اضافه آزمونِ بعدی را می‌سوزاند).
 *
 * کوکیِ نشست همان توکنِ دسترسی است؛ نشانِ CSRF هر مقداری باشد کافی است چون
 * سرور فقط برابریِ کوکی و هدر را می‌سنجد و اپ خودش آن را از کوکی می‌خواند.
 *
 * ⚠️ کوکی روی **هاستِ API ای که مرورگر صدا می‌زند** می‌نشیند؛ Vite باید با
 * `VITE_API_BASE` روی همان هاستِ UI (پیش‌فرض 127.0.0.1) بالا باشد وگرنه
 * `SameSite=Lax` کوکی را برای هاستِ دیگر نمی‌فرستد. (README همین پوشه)
 */
export const SESSION_COOKIE = 'amalyar_session';
export const CSRF_COOKIE = 'amalyar_csrf';

export function browserApiBase(ui = process.env.E2E_UI ?? 'http://127.0.0.1:5199') {
  if (process.env.E2E_BROWSER_API) return process.env.E2E_BROWSER_API.replace(/\/$/, '');
  const api = new URL(process.env.E2E_API ?? 'http://localhost:3101/api');
  api.hostname = new URL(ui).hostname;
  return api.toString().replace(/\/$/, '');
}

/** کوکی‌های نشست را برای هاستِ API در همان contextِ صفحه می‌نشاند. */
export async function browserLogin(page, accessToken, { ui } = {}) {
  if (!accessToken) throw new Error('browserLogin: توکن خالی است — ورودِ سمتِ Node انجام نشده');
  /* ⚠️ کوکی روی **ریشهٔ** مبدأِ API (`/`) می‌نشیند، نه روی `/api/`: سرور هم با
     path=/ می‌فرستد. با path=/api/، صفحهٔ UI در `/app/…` کوکیِ CSRF را در
     `document.cookie` نمی‌دید و هر درخواستِ تغییردهنده ۴۰۳ می‌گرفت — باگِ
     واقعی که با e2eِ پوستهٔ سراسری (W2.4) لو رفت. */
  const url = new URL(browserApiBase(ui));
  url.pathname = '/';
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: accessToken, url: url.toString(), httpOnly: true, sameSite: 'Lax' },
    { name: CSRF_COOKIE, value: `e2e-${Date.now().toString(36)}`, url: url.toString(), httpOnly: false, sameSite: 'Lax' },
  ]);
}
