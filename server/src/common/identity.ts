/**
 * اعتبارسنجیِ شناسه‌های هویتی — تک‌منبعِ قاعده، تا هر جا کدِ ملی یا شبا گرفته
 * می‌شود (جراح، کارشناس، پروفایل) دقیقاً یک قانون اعمال شود.
 *
 * ⚠️ همین منطق در `src/lib/identity.js` برای فرانت تکرار شده تا کاربر پیش از
 * ارسال بازخورد بگیرد. اعتبارِ واقعی همین‌جاست؛ فرانت فقط تجربهٔ کاربری است.
 */

/**
 * ارقامِ فارسی/عربی → انگلیسی. کاربرِ فارسی‌زبان معمولاً با کیبوردِ فارسی عدد
 * می‌زند؛ بدونِ این تبدیل، کدِ ملیِ کاملاً درست «نامعتبر» اعلام می‌شد.
 */
export function toEnDigits(value?: string | null): string {
  return (value ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** کدِ ملیِ ایران: ۱۰ رقم با رقمِ کنترلیِ وزنی. */
export function isValidNationalId(value: string): boolean {
  const id = toEnDigits(value).replace(/[^0-9]/g, '');
  if (!/^\d{10}$/.test(id)) return false;
  // کدهای تک‌رقمی‌تکراری (۰۰۰۰۰۰۰۰۰۰ …) از نظر ریاضی معتبرند ولی واقعی نیستند.
  if (/^(\d)\1{9}$/.test(id)) return false;

  const check = Number(id[9]);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(id[i]) * (10 - i);
  const remainder = sum % 11;
  return remainder < 2 ? check === remainder : check === 11 - remainder;
}

/** شبا: IR + ۲۴ رقم، با آزمونِ mod-97 استانداردِ IBAN. */
export function isValidIban(value: string): boolean {
  const raw = toEnDigits(value).replace(/\s+/g, '').toUpperCase();
  const iban = raw.startsWith('IR') ? raw : `IR${raw}`;
  if (!/^IR\d{24}$/.test(iban)) return false;

  // چهار نویسهٔ نخست به انتها می‌روند و حروف به عدد تبدیل می‌شوند (A=10 … Z=35).
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

  // عددِ ۲۶ رقمی در Number جا نمی‌شود؛ باقی‌مانده تکه‌تکه گرفته می‌شود.
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

/** نرمال‌سازیِ شبا به شکلِ ذخیره‌سازی: `IR` + ۲۴ رقم، بدون فاصله. */
export function normalizeIban(value?: string | null): string | null {
  const raw = toEnDigits(value).replace(/\s+/g, '').toUpperCase();
  if (!raw) return null;
  return raw.startsWith('IR') ? raw : `IR${raw}`;
}

/**
 * شمارهٔ موبایلِ چسبانده‌شده یا خودکارپرشده → شکلِ محلیِ «09…» (آینهٔ `normalizeMobile` در
 * `src/lib/identity.js`؛ هر دو باید هم‌شکل بمانند).
 *
 * مالک (۱۴۰۵/۰۷/۱۵): «+98 912 526 8654» باید «09125268654» شود. فرانت همین را حینِ تایپ و پیست انجام می‌دهد؛
 * این‌جا همان قاعده سرور را هم می‌پوشاند تا لینکِ عمومی یا کلاینتِ دیگری که شمارهٔ بین‌المللی می‌فرستد
 * «شمارهٔ نامعتبر» نخورد.
 *  - ارقام لاتین؛ فاصله، خط‌تیره، پرانتز، نقطه و نویسه‌های جهت‌نما حذف؛
 *  - «+98…»، «0098…» و «98…»ِ دوازده‌رقمی → «0…» (صفرِ اضافیِ «+98 0912…» هم برداشته می‌شود)؛
 *  - ده‌رقمیِ «9…» (بدونِ صفر) → «09…».
 * چیزِ دیگری کوتاه یا بلند نمی‌شود؛ «۱۱ رقم بودن» کارِ اعتبارسنجی است.
 */
export function normalizeMobile(raw: unknown): string {
  const text = toEnDigits(String(raw ?? ''));
  const plus = /^[^0-9+]*\+/.test(text);
  let d = text.replace(/[^0-9]/g, '');
  if (plus && '98'.startsWith(d)) return `+${d}`; // «+»، «+9»، «+98» نیمه‌کاره (فقط حینِ تایپ در فرانت)
  if (plus && d.startsWith('98')) {
    const local = d.slice(2).replace(/^0+/, '');
    return local.length >= 10 ? `0${local}` : `+98${local}`;
  }
  if (d.startsWith('0098')) d = `0${d.slice(4).replace(/^0+/, '')}`;
  else if (d.length >= 12 && d.startsWith('98')) d = `0${d.slice(2).replace(/^0+/, '')}`;
  else if (/^9[^8]\d{8}$/.test(d)) d = `0${d}`; // «98…» پیشوندِ کشور است، نه ابتدای شماره
  return d;
}

/** موبایلِ معتبر (۱۱ رقمِ لاتین، با ۰۹) یا null. */
export function mobileOf(value: unknown): string | null {
  const d = normalizeMobile(value);
  return /^09\d{9}$/.test(d) ? d : null;
}

/**
 * شماره‌ای که پیامک‌های **یک ثبت‌نامِ عمومی** (لینکِ ادامه، برگشت/رد، یادآوریِ نوبتی که همان ثبت‌نام گرفته) به آن
 * می‌روند: شمارهٔ پرونده؛ و فقط اگر پرونده **هیچ** شماره‌ای ندارد، شماره‌ای که ثبت‌نام‌کننده در خودِ همان ثبت‌نام
 * نوشته (بستهٔ PS، PS12). فرمِ عمومی دیگر شماره را روی پروندهٔ موجود نمی‌نشاند — آن کار با تأییدِ کارکنان است —
 * ولی ثبت‌نام‌کننده باید کارِ خودش را ادامه دهد.
 *
 * هشدار: فقط برای پیامِ همان ثبت‌نام. پرتال و پیام‌های خودِ پرونده هرگز به شمارهٔ یک ثبت‌نام نمی‌روند — آن
 * شماره را هر کسی که کدِ ملی و نامِ خانوادگی را داشت می‌توانست بنویسد.
 */
export function submissionPhone(recordPhone: unknown, submissionData: unknown): string | null {
  return mobileOf(recordPhone) ?? (String(recordPhone ?? '').trim() ? null : mobileOf((submissionData as any)?.phone));
}
