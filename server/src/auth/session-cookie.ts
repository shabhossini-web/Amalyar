import type { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * کوکیِ نشست — جایگزینِ توکن در localStorage.
 *
 * ⚠️ چرا: توکنی که در storage است، با هر XSS خوانده و به بیرون فرستاده می‌شود.
 * کوکیِ HttpOnly برای اسکریپت نامرئی است؛ مرورگر خودش با هر درخواست
 * می‌فرستد. قیمتش دو چیز است که این‌جا حل شده‌اند:
 *
 * ۱. **CSRF** — کوکی را مرورگر برای هر سایتی که به API درخواست بزند می‌فرستد.
 *    `SameSite=Lax` بیشترِ حمله‌ها را می‌بندد، و برای درخواست‌های تغییردهنده
 *    یک نشانِ دومِ **خواندنی** (`CSRF_COOKIE`) لازم است که اسکریپتِ خودِ اپ در
 *    هدرِ `X-CSRF-Token` تکرار کند — سایتِ دیگر آن کوکی را نمی‌تواند بخواند.
 *    (الگوی double-submit؛ همان که پنلِ پلتفرم دارد.)
 *
 * ۲. **چندحسابی** (قانون ۶) — با توکنِ سمتِ کلاینت هر حساب توکنِ خودش را داشت.
 *    حالا مجموعهٔ نشست‌های «مرا به خاطر بسپار» در کوکیِ HttpOnlyِ دومی
 *    (`SESSION_SET_COOKIE`) به‌شکلِ JWTِ امضاشده می‌ماند و سوییچ سمتِ سرور
 *    انجام می‌شود: کلاینت فقط شناسهٔ حساب را می‌گوید، هیچ توکنی دستش نیست.
 *
 * توکن همچنان در بدنهٔ JSONِ ورود برمی‌گردد — برای کلاینت‌های غیرمرورگری
 * (اسکریپت‌های e2e، ابزارها) که با `Authorization: Bearer` می‌آیند. اپِ
 * مرورگر آن را **نمی‌خواند و ذخیره نمی‌کند**؛ ریسکِ storage از همین‌جا می‌رود.
 */
export const SESSION_COOKIE = 'amalyar_session';
export const SESSION_SET_COOKIE = 'amalyar_sessions';
export const CSRF_COOKIE = 'amalyar_csrf';
export const SESSION_TTL_DAYS = 30;
/** سقفِ حساب‌های هم‌زمان در یک مرورگر — هم‌اندازهٔ MAX_SESSIONS هر حساب. */
export const MAX_SET = 10;

export type SetEntry = { sid: string; sub: number };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie ?? '';
  for (const item of raw.split(';')) {
    const [key, ...rest] = item.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

export const cookieSecure = () => process.env.NODE_ENV === 'production';

/** «به خاطر بسپار» = ماندگار تا TTL؛ بدونِ آن = کوکیِ نشستِ مرورگر (با بستنِ مرورگر می‌رود). */
export function cookieBase(remember: boolean) {
  return {
    secure: cookieSecure(),
    sameSite: 'lax' as const,
    path: '/',
    ...(remember ? { maxAge: SESSION_TTL_DAYS * 86_400_000 } : {}),
  };
}

export const newCsrfToken = () => randomBytes(24).toString('hex');

/** کوکیِ نشستِ فعال + نشانِ CSRFِ تازه. نشان با هر ورود/سوییچ می‌چرخد. */
export function setSessionCookies(res: Response, accessToken: string, remember: boolean): string {
  const csrf = newCsrfToken();
  res.cookie(SESSION_COOKIE, accessToken, { httpOnly: true, ...cookieBase(remember) });
  res.cookie(CSRF_COOKIE, csrf, { httpOnly: false, ...cookieBase(remember) });
  return csrf;
}

export function clearSessionCookies(res: Response, includeSet = true) {
  const names = [SESSION_COOKIE, CSRF_COOKIE, ...(includeSet ? [SESSION_SET_COOKIE] : [])];
  for (const name of names) res.clearCookie(name, { path: '/' });
}

/** درخواستِ تغییردهنده‌ای که با کوکی احراز شده باید نشانِ CSRF را در هدر تکرار کند. */
export function needsCsrf(req: Request): boolean {
  return (req as any).authVia === 'cookie' && !SAFE_METHODS.has(req.method.toUpperCase());
}

export function csrfMatches(req: Request): boolean {
  const cookie = readCookie(req, CSRF_COOKIE);
  const h = req.headers['x-csrf-token'];
  const header = Array.isArray(h) ? h[0] : h;
  if (!cookie || !header) return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
