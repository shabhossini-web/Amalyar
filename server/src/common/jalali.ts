/**
 * تبدیلِ تقویمِ شمسی → میلادی (الگوریتمِ jalaali-js).
 *
 * سمتِ سرور فقط برای وارد کردنِ دادهٔ قدیمی لازم است: ملک‌طب تاریخ‌ها را به‌شکلِ
 * رشتهٔ شمسی («1405/05/07») ذخیره می‌کرد. سامانه خودش همه‌جا DateTime نگه
 * می‌دارد و تبدیلِ نمایشی سمتِ کلاینت است.
 *
 * ⚠️ این هسته **عینِ** `src/lib/jalali.js` است و باید عین بماند. یک‌بار از روی
 * حافظه بازنویسی شد و جدولِ `breaks` و نوعِ تقسیم (`~~` به‌جای Math.floor) فرق
 * کرد؛ نتیجه تاریخ‌هایی یک سال عقب بود که هیچ خطایی نمی‌داد. گاردِ CI حالا
 * تبدیل را با چند تاریخِ مرجع می‌سنجد.
 */
const div = (a: number, b: number): number => ~~(a / b);
const mod = (a: number, b: number): number => a - ~~(a / b) * b;

function jalCal(jy: number) {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jump = 0;
  for (let i = 1; i < breaks.length; i += 1) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

/** «1405/05/07» یا «۱۴۰۵/۵/۷» → Date (نیمه‌شبِ UTC). نامعتبر → null. */
export function jalaliStrToDate(str: unknown): Date | null {
  if (str === null || str === undefined) return null;
  const s = String(str)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .trim()
    .replace(/[-.]/g, '/');
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (!m) return null;
  const [jy, jm, jd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  try {
    const g = d2g(j2d(jy, jm, jd));
    const out = new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
    return Number.isNaN(out.getTime()) ? null : out;
  } catch {
    return null;
  }
}

/**
 * **تنها جایی که یک تاریخِ ورودی به `Date` تبدیل می‌شود.**
 *
 * ⚠️ چرا لازم شد: قرارِ سامانه این است که شمسی فقط در مرورگر زندگی کند و روی
 * سیم همیشه ISO برود. ولی فرمِ عمومیِ بیمار و شیتِ تأییدِ ادمین مقدارِ `JDate`
 * را **خام** می‌فرستادند. سرور هم `new Date('1405/05/14')` می‌ساخت و آن را
 * سالِ ۱۴۰۵ **میلادی** می‌فهمید — حدودِ ۶۲۰ سال پیش. و هیچ خطایی نمی‌داد:
 * مراجعه با موفقیت ثبت می‌شد و بعد از تقویم و هر گزارشِ بازه‌ای **ناپدید**
 * بود. تاریخِ غلطی که خطا بدهد دردسر است؛ تاریخِ غلطی که موفق شود، دادهٔ
 * از‌دست‌رفته است.
 *
 * قاعده — بدونِ حدسِ مبهم:
 *   • سالِ کمتر از ۱۷۰۰ **قطعاً** تاریخِ میلادیِ یک بیمار یا عمل نیست، پس
 *     شمسی است. بازهٔ واقعیِ شمسی (۱۳۰۰–۱۵۰۰) و میلادی (۱۹۰۰–۲۱۰۰) هیچ
 *     هم‌پوشانی ندارند، پس این تشخیص ابهام ندارد — برخلافِ حدس‌زدن از روی
 *     جداکننده (`/` در برابر `-`) که هر دو تقویم به کار می‌برند.
 *   • ISOِ سالم → همان.
 *   • هیچ‌کدام → `undefined`ِ صریح، تا فراخوان تصمیم بگیرد؛ نه `Invalid Date`
 *     که بی‌صدا در ستون بنشیند.
 */
export function toDateValue(input: unknown): Date | null | undefined {
  if (input === null) return null;
  if (input === undefined || input === '') return undefined;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? undefined : input;

  const s = String(input).trim();
  if (!s) return undefined;

  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime()) && iso.getUTCFullYear() >= 1700) return iso;

  // یا شمسی است، یا اصلاً تاریخ نیست.
  return jalaliStrToDate(s) ?? undefined;
}

/**
 * میلادی → شمسی: `[jy, jm, jd]`.
 *
 * ⚠️ روی **UTC** خوانده می‌شود نه ساعتِ محلیِ سرور: تاریخ‌های ما نیمه‌شبِ UTC
 * ذخیره می‌شوند، و اگر با `getMonth()` محلی خوانده شوند، سرورِ با منطقهٔ زمانیِ
 * منفی یک روز عقب می‌رود و «۱ مرداد» در گزارش «۳۱ تیر» می‌شود.
 *
 * از همان هستهٔ `jalCal`/`g2d`/`d2g` استفاده می‌کند که `jalaliStrToDate` هم
 * می‌کند — دو هستهٔ موازی یعنی دو تقویمِ کمی متفاوت.
 */
export function toJalali(date: Date): [number, number, number] {
  const jdn = g2d(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return [jy, 1 + div(k, 31), mod(k, 31) + 1];
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return [jy, 7 + div(k, 30), mod(k, 30) + 1];
}

/**
 * تاریخِ میلادیِ ISO در **متنِ آزاد** (۲۰۲۶-۰۹-۰۱) → شمسی با ارقامِ فارسی (۱۴۰۵/۰۶/۱۰).
 *
 * برای خروجیِ مدلِ زبانی: حتی وقتی ورودی شمسی است، مدل گاهی به میلادی
 * برمی‌گردد (گزارشِ مالک روی خلاصهٔ ارجاع، ۱۴۰۵/۰۶/۲۹). فقط سال‌های
 * ۱۹۰۰–۲۰۹۹ گرفته می‌شوند تا کدِ ملی، شمارهٔ فاکتور و تاریخِ شمسیِ خودِ
 * متن دست نخورد؛ ماه/روزِ نامعتبر همان‌طور می‌ماند.
 */
export function jalalizeDates(text: string): string {
  const fa = (n: number, w = 2) => String(n).padStart(w, '0').replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[+x]);
  return String(text ?? '').replace(/(?<!\d)((?:19|20)\d{2})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/g, (m, y, mo, d) => {
    const mm = Number(mo), dd = Number(d);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return m;
    const date = new Date(Date.UTC(Number(y), mm - 1, dd));
    if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== mm - 1) return m;
    const [jy, jm, jd] = toJalali(date);
    return `${fa(jy, 4)}/${fa(jm)}/${fa(jd)}`;
  });
}

/**
 * بازهٔ میلادیِ یک ماهِ شمسی: `[شروع, پایان]` — هر دو نیمه‌شبِ UTC، پایان
 * **ابتدای روزِ اولِ ماهِ بعد** (بازهٔ نیم‌باز).
 *
 * ⚠️ عمداً از `jMonthDays` استفاده نمی‌کند: طولِ اسفند به کبیسه بستگی دارد و
 * تکرارِ آن منطق یعنی یک تقویمِ دوم که ممکن است با اولی اختلاف پیدا کند. با
 * «اولِ ماهِ بعد» طولِ ماه اصلاً لازم نیست.
 */
export function jalaliMonthRange(jy: number, jm: number): [Date, Date] {
  const start = d2g(j2d(jy, jm, 1));
  const ny = jm === 12 ? jy + 1 : jy;
  const nm = jm === 12 ? 1 : jm + 1;
  const end = d2g(j2d(ny, nm, 1));
  return [
    new Date(Date.UTC(start.gy, start.gm - 1, start.gd)),
    new Date(Date.UTC(end.gy, end.gm - 1, end.gd)),
  ];
}
