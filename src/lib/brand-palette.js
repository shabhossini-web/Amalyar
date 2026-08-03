/**
 * خانوادهٔ رنگِ برند از **یک** رنگِ پایه.
 *
 * تا امروز رنگِ اپ برای همهٔ شرکت‌ها یکی بود: پنج بنفشِ ثابت در ۲۶۹ جای
 * CSS. حالا شرکت یک رنگ انتخاب می‌کند و بقیهٔ خانواده از همان مشتق می‌شود.
 *
 * ⚠️ افست‌ها از **خودِ رنگ‌های امروز** درآمده‌اند، نه از یک قاعدهٔ دل‌بخواه.
 * پس با رنگِ پیش‌فرض (`#7c3aed`) خروجی دقیقاً همان پنج بنفشِ قبلی است و
 * ظاهرِ نصب‌های موجود یک پیکسل هم عوض نمی‌شود. اگر این افست‌ها را «مرتب»
 * کنید (مثلاً همهٔ فام‌ها را با پایه یکی کنید) رنگِ امروز جابه‌جا می‌شود.
 *
 * دو مقدار برای هر سایه لازم است: hex برای جایی که رنگِ تخت می‌خواهد، و
 * سه‌تاییِ `r, g, b` برای جایی که CSS شفافیت روی همان رنگ می‌گذارد
 * (`rgba(var(--brand-rgb), .22)`). بدونِ سه‌تایی، هر شفافیت یک متغیرِ جدا
 * لازم داشت.
 */

export const DEFAULT_BRAND = '#7c3aed';

/** Δفام · اشباعِ مطلق · Δروشنایی — نسبت به پایه، بر حسبِ درصد. */
const FAMILY = {
  brand2: { dh: 8.62, s: 91.01, dl: 7.25 },   // روشن‌تر — گرادیان و حالتِ فعال
  soft: { dh: -3.81, s: 89.53, dl: 8.43 },    // لبه و حلقهٔ فوکوس
  mid: { dh: 1.27, s: 69.96, dl: -7.45 },     // سرِ گرادیان‌ها
  dark: { dh: 1.23, s: 69.3, dl: -15.69 },    // تیره‌ترین — ته‌رنگِ دکمه
};

/** `#rgb` و `#rrggbb` را می‌پذیرد؛ نامعتبر → `null` (تصمیمِ fallback با فراخوان است). */
export function parseHex(hex) {
  const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const s = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

function rgbToHsl([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B); const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0))
    : max === G ? (B - R) / d + 2
      : (R - G) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  const H = ((h % 360) + 360) % 360;
  const S = Math.min(100, Math.max(0, s)) / 100;
  const L = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = L - c / 2;
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(H / 60) % 6];
  return seg.map((v) => Math.round((v + m) * 255));
}

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * `{ brand, brand2, soft, mid, dark }` — هر کدام `{hex, rgb}`.
 * رنگِ نامعتبر → خانوادهٔ پیش‌فرض؛ رابط هیچ‌وقت بی‌رنگ نمی‌ماند.
 */
export function brandPalette(base) {
  const rgb = parseHex(base) ?? parseHex(DEFAULT_BRAND);
  const [h, , l] = rgbToHsl(rgb);
  const out = { brand: { hex: hex(rgb), rgb: rgb.join(', ') } };
  for (const [name, f] of Object.entries(FAMILY)) {
    const c = hslToHex(h + f.dh, f.s, l + f.dl);
    out[name] = { hex: hex(c), rgb: c.join(', ') };
  }
  return out;
}

/** روی `<html>` می‌نشیند تا کلِ CSS با یک تنظیم عوض شود. */
export function applyBrand(base, root = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!root) return null;
  const p = brandPalette(base);
  root.style.setProperty('--brand', p.brand.hex);
  root.style.setProperty('--brand-rgb', p.brand.rgb);
  root.style.setProperty('--brand-2', p.brand2.hex);
  root.style.setProperty('--brand-2-rgb', p.brand2.rgb);
  root.style.setProperty('--brand-soft', p.soft.hex);
  root.style.setProperty('--brand-soft-rgb', p.soft.rgb);
  root.style.setProperty('--brand-mid', p.mid.hex);
  root.style.setProperty('--brand-mid-rgb', p.mid.rgb);
  root.style.setProperty('--brand-dark', p.dark.hex);
  root.style.setProperty('--brand-dark-rgb', p.dark.rgb);
  return p;
}
