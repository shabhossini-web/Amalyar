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
