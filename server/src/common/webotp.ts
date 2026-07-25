/**
 * میزبانِ اتصالِ WebOTP — تک‌منبعِ حقیقت.
 *
 * خطِ آخرِ پیامکِ کدِ یکبارمصرف باید دقیقاً `@<host> #<code>` باشد و مرورگر تنها
 * وقتی کد را خودکار پر می‌کند که `<host>` **عیناً** برابرِ میزبانِ صفحه باشد؛
 * زیردامنه هم فرق می‌کند (`amalyar.com` ≠ `tenant.amalyar.com`). پس این مقدار
 * باید از میزبانِ واقعیِ همان درخواست بیاید، نه از یک ثابتِ سراسری.
 */
const HOSTNAME =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * میزبان را نرمال و اعتبارسنجی می‌کند؛ اگر معتبر نبود `null`.
 * پورت و نقطهٔ پایانی حذف می‌شوند. چون خروجی به الگوی سخت‌گیرانهٔ بالا محدود است،
 * هیچ فاصله یا خطِ جدیدی نمی‌تواند به متنِ پیامک تزریق شود.
 */
export function sanitizeWebOtpHost(value?: string | null): string | null {
  const host = (value ?? '').split(':')[0].trim().toLowerCase().replace(/\.$/, '');
  return HOSTNAME.test(host) ? host : null;
}

/** میزبانِ همین درخواست (هدرِ Host) — مبنای پویای اتصالِ WebOTP. */
export function webOtpHostFromRequest(req: { headers?: { host?: string } }): string | null {
  return sanitizeWebOtpHost(req?.headers?.host);
}
