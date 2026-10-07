/**
 * اعتبارسنجیِ شناسه‌های هویتی — نسخهٔ فرانت برای بازخوردِ فوری هنگام تایپ.
 *
 * ⚠️ آینهٔ `server/src/common/identity.ts` است. اعتبارِ واقعی سمتِ سرور گرفته
 * می‌شود؛ این‌جا فقط تجربهٔ کاربری است. اگر قاعده‌ای عوض شد، هر دو باید عوض شوند.
 */

/** ارقامِ فارسی/عربی → انگلیسی. کاربر معمولاً با کیبوردِ فارسی عدد می‌زند. */
export const toEnDigits = (v) =>
  (v ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** کدِ ملیِ ایران: ۱۰ رقم با رقمِ کنترلیِ وزنی. */
export function isValidNationalId(value) {
  const id = toEnDigits(value).replace(/[^0-9]/g, '');
  if (!/^\d{10}$/.test(id)) return false;
  if (/^(\d)\1{9}$/.test(id)) return false; // ۰۰۰۰۰۰۰۰۰۰ و مانندش واقعی نیستند
  const check = Number(id[9]);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(id[i]) * (10 - i);
  const r = sum % 11;
  return r < 2 ? check === r : check === 11 - r;
}

/**
 * کدِ ملیِ **آزمایشی** — تصادفی ولی با رقمِ کنترلیِ معتبر، تا اعتبارسنجیِ همین
 * فایل و سرور رد شود. فقط برای بیمارِ تستی (خواستهٔ مالک، ۱۴۰۵/۰۶/۲۹؛ موقت).
 * ⚠️ متعلق به کسی نیست ولی می‌تواند تصادفاً با یک کدِ واقعی یکی باشد.
 */
export function randomNationalId() {
  let digits;
  do { digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)); }
  while (digits.every((d) => d === digits[0]));
  const sum = digits.reduce((acc, d, i) => acc + d * (10 - i), 0);
  const r = sum % 11;
  return `${digits.join('')}${r < 2 ? r : 11 - r}`;
}

/** شبا: IR + ۲۴ رقم، با آزمونِ mod-97 استانداردِ IBAN. */
export function isValidIban(value) {
  const raw = toEnDigits(value).replace(/\s+/g, '').toUpperCase();
  const iban = raw.startsWith('IR') ? raw : `IR${raw}`;
  if (!/^IR\d{24}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of numeric) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

/**
 * شمارهٔ موبایلِ **چسبانده‌شده یا خودکارپرشده** → شکلِ محلیِ «09…».
 *
 * مالک (۱۴۰۵/۰۷/۱۵): کیبوردِ اندروید شمارهٔ ذخیره‌شدهٔ کاربر را به‌شکلِ «+98 912 526 8654» پیشنهاد می‌دهد و
 * همان‌طور در کادر می‌نشست؛ اعتبارسنجی (`^09\d{9}$`) آن را نامعتبر می‌گفت. حالا هر کادرِ موبایل مقدار را از
 * همین تابع رد می‌کند:
 *  - ارقامِ فارسی/عربی → لاتین؛ فاصله، خط‌تیره، پرانتز، نقطه و نویسه‌های جهت‌نما (RLM/LRM/ZWNJ) حذف؛
 *  - «+98…»، «0098…» و «98…»ِ دوازده‌رقمی → «0…» (صفرِ اضافیِ «+98 0912…» هم برداشته می‌شود)؛
 *  - عددِ ده‌رقمیِ «9…» (بدونِ صفر) → «09…»؛
 *  - «+98…»ِ نیمه‌کار (کمتر از ده رقم بعد از ۹۸) همان‌طور با «+» می‌ماند تا کسی که شماره را دستی تایپ می‌کند
 *    علامتِ «+» را وسطِ کار گم نکند؛ به محضِ کامل‌شدن «0…» می‌شود.
 * هر چیزِ دیگر فقط از فاصله و نشانه پاک می‌شود و کوتاه نمی‌شود؛ سنجشِ «۱۱ رقم» کارِ اعتبارسنجی است.
 *
 * ⚠️ این تابع **حینِ تایپ** هم صدا زده می‌شود (onChange)، پس برای ورودیِ سالم (فقط رقم) همان رشته را بی‌تغییر
 * برمی‌گرداند — بازنویسیِ بی‌دلیلِ مقدار مکان‌نمای Gboard را می‌پراند (قانون ۱۳).
 * ⚠️ آینهٔ `normalizeMobile` در `server/src/common/identity.ts` است؛ هر دو باید هم‌شکل بمانند.
 */
export function normalizeMobile(raw) {
  const text = toEnDigits(String(raw ?? ''));
  /* «+» ممکن است پشتِ پرانتز یا نویسهٔ جهت‌نما بیاید: «(+98) 912…» یا «\u200e+98…». */
  const plus = /^[^0-9+]*\+/.test(text);
  let d = text.replace(/[^0-9]/g, '');
  if (plus && '98'.startsWith(d)) return `+${d}`; // «+»، «+9»، «+98» نیمه‌کاره: علامت می‌ماند تا کاربرِ در حالِ تایپ آن را گم نکند
  if (plus && d.startsWith('98')) {
    const local = d.slice(2).replace(/^0+/, '');
    return local.length >= 10 ? `0${local}` : `+98${local}`; // هنوز کامل نیست: «+98912…» می‌ماند تا کامل شود
  }
  if (d.startsWith('0098')) d = `0${d.slice(4).replace(/^0+/, '')}`;
  else if (d.length >= 12 && d.startsWith('98')) d = `0${d.slice(2).replace(/^0+/, '')}`;
  else if (/^9[^8]\d{8}$/.test(d)) d = `0${d}`; // «98…» پیشوندِ کشور است، نه ابتدای شماره
  return d;
}

/**
 * کادرِ «نامِ کاربری یا موبایل»: فقط وقتی با «+» شروع شود شمارهٔ بین‌المللی است و نرمال می‌شود؛ نامِ کاربری
 * (حتی تمام‌رقم) دست‌نخورده می‌ماند — حسابِ قدیمیِ تمام‌رقم هنوز با نامش وارد می‌شود.
 */
export const normalizeIdentifier = (v) => (/^[^0-9A-Za-z\u0600-\u06FF]*\+/.test(String(v ?? '')) ? normalizeMobile(v) : v);

/** موبایلِ ایران: ۱۱ رقم با پیشوندِ ۰۹. */
export const isValidPhone = (v) => /^09\d{9}$/.test(normalizeMobile(v));
