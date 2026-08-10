/**
 * پالتِ رنگِ فرم — نگاشتِ توکن به رنگ، یک‌جا.
 *
 * ⚠️ در دیتابیس **توکن** ذخیره می‌شود نه هگز. دلیل: رنگِ برندِ هر نصب فرق
 * می‌کند و تمِ روشن/تاریک هم داریم؛ هگزِ ثابتی که امروز روی تمِ تاریک خوانا
 * است، فردا روی نصبِ دیگری ناخوانا می‌شود. با توکن، اصلاحِ یک رنگ در همین
 * فایل روی همهٔ کارت‌ها و همهٔ نصب‌ها اعمال می‌شود.
 *
 * ⚠️ فهرستِ توکن‌ها باید با `FORM_COLORS` در `forms.service.ts` **یکی** بماند.
 * توکنی که فقط سرور بشناسد، رنگی می‌سازد که مرورگر نمی‌تواند بکشد؛ توکنی که
 * فقط کلاینت بشناسد، ۴۰۰ می‌گیرد.
 *
 * هر رنگ سه نقش دارد چون کارت سه چیز لازم دارد: نوارِ کناری (`solid`)،
 * پس‌زمینهٔ کم‌رنگ (`soft`) و متنِ خوانا رویش (`ink`).
 */
export const FORM_COLORS = {
  violet: { fa: 'بنفش', solid: '#8b5cf6', soft: 'rgba(139, 92, 246, 0.14)', ink: '#c4b5fd' },
  teal: { fa: 'فیروزه', solid: '#14b8a6', soft: 'rgba(20, 184, 166, 0.14)', ink: '#5eead4' },
  amber: { fa: 'کهربا', solid: '#f59e0b', soft: 'rgba(245, 158, 11, 0.14)', ink: '#fcd34d' },
  rose: { fa: 'سرخ', solid: '#f43f5e', soft: 'rgba(244, 63, 94, 0.14)', ink: '#fda4af' },
  sky: { fa: 'آبی', solid: '#0ea5e9', soft: 'rgba(14, 165, 233, 0.14)', ink: '#7dd3fc' },
  lime: { fa: 'سبز', solid: '#84cc16', soft: 'rgba(132, 204, 22, 0.14)', ink: '#bef264' },
  fuchsia: { fa: 'ارغوانی', solid: '#d946ef', soft: 'rgba(217, 70, 239, 0.14)', ink: '#f0abfc' },
  slate: { fa: 'خاکستری', solid: '#64748b', soft: 'rgba(100, 116, 139, 0.16)', ink: '#cbd5e1' },
};

export const COLOR_KEYS = Object.keys(FORM_COLORS);

/**
 * رنگِ پشتیبان از روی کلید — **باید با `colorForKey` سمتِ سرور یکی باشد**،
 * وگرنه یک فرم در داشبورد یک رنگ و در فرم‌ساز رنگِ دیگری می‌گیرد.
 *
 * ⚠️ hashِ پایدار، نه ایندکسِ فهرست: اگر رنگ از ترتیبِ فرم‌ها می‌آمد، ساختنِ
 * یک فرمِ تازه رنگِ همهٔ کارت‌های قبلی را عوض می‌کرد و کاربر فکر می‌کرد
 * سامانه قاطی کرده.
 */
export function colorForKey(key) {
  let h = 0;
  const s = String(key ?? '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLOR_KEYS[h % COLOR_KEYS.length];
}

/** توکن → سه رنگ. توکنِ ناشناخته یا خالی → مشتق از کلید. */
export function formColor(token, fallbackKey = '') {
  return FORM_COLORS[token] ?? FORM_COLORS[colorForKey(fallbackKey)];
}
