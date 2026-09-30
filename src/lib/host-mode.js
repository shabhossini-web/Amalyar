/**
 * **ریشهٔ این دامنه چه نشان می‌دهد؟** — یک تعریف برای `App.jsx` (مسیرِ `/`) و صفحهٔ ورود.
 *
 *   'platform'  → کنسولِ مدیریتِ پلتفرم (`/platform-admin`)
 *   'marketing' → لندینگِ عمل‌یار
 *   'tenant'    → سایتِ معرفیِ شرکت اگر منتشر شده، وگرنه همان صفحهٔ ورود
 *
 * ⚠️ صفحهٔ ورود «بازگشت به سایت» را از همین می‌فهمد (بازبینیِ UX، بندِ ۱۱۱): روی دامنهٔ مطبی که
 * سایتش منتشر نشده، ریشه خودِ ورود است و پیوند کاربر را در یک دورِ بسته نگه می‌داشت. تعریفِ دوم
 * در صفحهٔ ورود یعنی روزی که یکی عوض شود، پیوند به جایی اشاره کند که ریشه دیگر نمی‌رود.
 */
export const MARKETING_HOSTS = new Set(['amalyar.com', 'www.amalyar.com', 'localhost', '127.0.0.1']);
export const PLATFORM_HOSTS = new Set(
  (import.meta.env.VITE_PLATFORM_HOSTS || 'admin-staging.amalyar.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
);

export function hostKind(hostname = typeof window === 'undefined' ? '' : window.location.hostname.toLowerCase()) {
  if (PLATFORM_HOSTS.has(hostname)) return 'platform';
  const forced = import.meta.env.VITE_TENANT_UI;
  const tenantMode = forced === 'true' || (forced !== 'false' && !!hostname && !MARKETING_HOSTS.has(hostname));
  return tenantMode ? 'tenant' : 'marketing';
}
