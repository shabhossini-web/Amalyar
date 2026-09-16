// ساعتِ روز — **تک‌منبعِ** قالب، نرمال‌سازی و فهرستِ گام‌دار.
//
// چرا اینجا و نه داخلِ کامپوننت: تا امروز هر صفحه‌ای که ساعت می‌گرفت الگویِ
// `^([01]\d|2[0-3]):[0-5]\d$` را برای خودش دوباره می‌نوشت — داشبورد یکی،
// چینش یکی — و نرمال‌سازیِ ارقامِ فارسی فقط در یکی از آن‌ها بود. یعنی همان
// «۹:۵» که در فرمِ مراجعه به «09:05» تبدیل می‌شد، در پنلِ چینش خامْ به سرور
// می‌رفت و ۴۰۰ می‌گرفت. یک قاعده، یک فایل، و نگهبانِ CI که تکرارش را می‌گیرد.
import { toEnDigits } from './jalali.js';

/**
 * قالبِ پذیرفتهٔ سرور: ۲۴ساعته، دو رقمی، با دو نقطه.
 *
 * ⚠️ این تنها جای برنامه است که شکلِ ساعت تعریف می‌شود. هر جای دیگری که همین
 * الگو را دوباره بنویسد، روزی که قاعده عوض شود از قلم می‌افتد.
 */
export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/// ساعتِ معتبر؟ (خالی هم معتبر است — ساعت اختیاری است)
export const isTime = (v) => TIME_RE.test(String(v ?? ''));

/// «بد» یعنی چیزی نوشته شده ولی ساعت نیست؛ خالی بد نیست.
export const badTime = (v) => !!String(v ?? '').trim() && !isTime(String(v ?? '').trim());

/**
 * نرمال‌سازیِ ساعتِ تایپ‌شده: «۸:۵»، «830»، «۰۸۳۰»، «٠٨:٣٠» → «08:30».
 *
 * ⚠️ چرا input[type=time] نداریم: مرورگر قالبِ نمایشش را خودش تعیین می‌کند و
 * تغییرش با lang یا CSS ممکن نیست — کرومیوم همین‌جا «11:30 PM» می‌دهد. یعنی
 * همان فیلد روی اندروید/سافاری/ویندوز سه شکلِ متفاوت می‌شود، آن هم ۱۲ساعته.
 * پس مثلِ تاریخِ شمسی، ورودیِ متنی با نرمال‌سازیِ خودمان.
 *
 * ⚠️ رشتهٔ نامعتبر **دست‌نخورده** برمی‌گردد تا کاربر ببیند چه تایپ کرده، نه
 * اینکه نوشته‌اش بی‌صدا پاک شود یا به عددی که منظورش نبوده گرد شود.
 */
export function normTime(v) {
  const raw = toEnDigits(String(v ?? '')).trim();
  if (!raw) return '';
  const m = /^(\d{1,2})\s*[:.،]\s*(\d{1,2})$/.exec(raw) || /^(\d{1,2})(\d{2})$/.exec(raw);
  if (!m) return raw;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return raw;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/// «08:30» → دقیقهٔ روز (۵۱۰). نامعتبر → null.
export function timeToMin(v) {
  const t = String(v ?? '');
  if (!TIME_RE.test(t)) return null;
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
}

/// دقیقهٔ روز → «08:30» (بیرونِ ۲۴ ساعت می‌پیچد، نه اینکه بشکند).
export function minToTime(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * فهرستِ ساعت‌ها با گامِ دلخواه (پیش‌فرض ۱۵ دقیقه).
 *
 * ⚠️ `current` اگر روی گام نباشد (مثلِ ۰۹:۴۷ که کارشناس دستی زده) **درجا و
 * مرتب** به فهرست اضافه می‌شود. بدونِ این، کاربر پنل را باز می‌کرد و ساعتِ
 * خودش را نمی‌دید — و اولین کلیک آن را بی‌صدا به ۰۹:۴۵ گرد می‌کرد.
 */
export function timeSlots(step = 15, current = '') {
  const s = Math.max(1, Math.min(720, Math.round(step) || 15));
  const out = [];
  for (let m = 0; m < 1440; m += s) out.push(minToTime(m));
  const cur = timeToMin(normTime(current));
  if (cur != null && cur % s !== 0) {
    out.splice(Math.floor(cur / s) + 1, 0, minToTime(cur));
  }
  return out;
}

/// ساعتِ ذخیره‌شده (لاتین) → نمایشِ فارسی. فقط برای چشم، نه برای سرور.
export const faTime = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/**
 * مدت به دقیقه — همان فرمولِ سرور، برای پیش‌نمایشِ زندهٔ داخلِ فرم.
 * پایانِ کوچک‌تر از شروع = گذشتن از نیمه‌شب، نه عددِ منفی.
 */
export function durationMin(start, end) {
  const a = timeToMin(start);
  const b = timeToMin(end);
  if (a == null || b == null) return null;
  const d = b - a;
  return d < 0 ? d + 1440 : d;
}

/**
 * «۳ ساعت و ۲۵ دقیقه» — صفرِ بی‌معنی («۰ ساعت») نشان داده نمی‌شود.
 *
 * از W3.2 این‌جاست، نه در `Dashboard.jsx`: هم فهرستِ مراجعات و هم فرمِ ویزیت
 * (که به فایلِ خودش رفت) مدتِ عمل را همین‌طور می‌نویسند؛ دو نسخه یعنی روزی
 * یکی «۰ ساعت» بنویسد و دیگری ننویسد.
 */
export function faDuration(min) {
  if (min == null) return '';
  const fa = (n) => Number(n || 0).toLocaleString('fa-IR');
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${fa(m)} دقیقه`;
  if (!m) return `${fa(h)} ساعت`;
  return `${fa(h)} ساعت و ${fa(m)} دقیقه`;
}
