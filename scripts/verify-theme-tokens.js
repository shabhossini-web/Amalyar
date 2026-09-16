/**
 * نگهبانِ دو-تمی (W3.6) — رنگِ خام در CSS یعنی نقطه‌ای که با تم نمی‌چرخد.
 *
 * ⚠️ چرا لازم است: تا W3.6 اپ تک‌تمِ تیره بود و ۶۰۰ جای CSS نوشته بود
 * `rgba(255, 255, 255, .05)` — یعنی «کمی روشن‌تر از زمینه». آن فرض فقط روی
 * زمینهٔ تیره درست بود. حالا همه `rgba(var(--veil-rgb), α)` هستند و با تم
 * می‌چرخند؛ این اسکریپت جلوی **برگشتنشان** را می‌گیرد. بدونِ نگهبان، اولین
 * کامپوننتِ تازه‌ای که از روی فایلِ قدیمی کپی شود دوباره سفیدِ خام می‌آورد و
 * فقط در تمِ روشن — که کسی هر روز بازش نمی‌کند — دیده می‌شود.
 *
 * اجرا از ریشهٔ مخزن:  node scripts/verify-theme-tokens.js
 */
import fs from 'node:fs';
import path from 'node:path';

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const css = walk('src').filter((f) => f.endsWith('.css'));
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

const bad = [];

/* ① پردهٔ سفیدِ خام. `#fff` عمداً مجاز است: متنِ روی دکمهٔ گرادیانِ برند در هر
      دو تم سفید می‌ماند. فقط `rgba(255,255,255,α)` که «سطح» می‌سازد ممنوع است. */
for (const f of css) {
  strip(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
    if (/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/.test(line)) {
      bad.push(`${f}:${i + 1} — پردهٔ سفیدِ خام؛ rgba(var(--veil-rgb), α) بنویسید`);
    }
  });
}

/* ② خاکستریِ ثابتِ متن. این‌ها توکنِ متن دارند و در تمِ روشن باید تیره شوند.
   ⚠️ سه شدتِ آخر رنگِ **معنایی**اند نه خاکستری (`#5eead4` سبزِ «تسویه»،
   `#fbbf24` کهربای «در انتظار»، `#ddd6fe` بنفشِ کنترل‌ها) و هگزِ خامشان در تمِ
   روشن ۱٫۲–۱٫۴:۱ می‌داد — یعنی عملاً نامرئی. جایشان `--green-text` /
   `--amber-text` / `--brand-text` است که مقدارِ تیره‌شان دقیقاً همین هگزهاست. */
const GREY = /#(f2f0fc|cfc9e8|b8b3d6|9aa2c0|8f88b5|7d77a3|6f679a|c7c2df|7d76a0|9a93bb|c9c2e4)\b/i;
/* ⚠️ این سه فقط در جایگاهِ **متن** ممنوع‌اند، نه در جایگاهِ پُرکننده: کهربای
   `#fbbf24` به‌عنوانِ زمینهٔ چیپ در هر دو تم درست است (مرکّبش `--ink-bright`
   می‌شود). پس الگو به `color:` مقید است، وگرنه نگهبان پُرکننده‌های سالم را
   قرمز می‌کند و اولین واکنش «خاموشش کن» می‌شود. */
const TEXT_ONLY = /color:\s*#(5eead4|fbbf24|ddd6fe)\b/i;
for (const f of css) {
  /* ⚠️ `index.css` استثناست: **تعریفِ** خودِ توکن‌ها آن‌جاست و باید hex باشد. */
  if (f === 'src/index.css') continue;
  strip(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
    const m = line.match(GREY);
    if (m) bad.push(`${f}:${i + 1} — خاکستریِ ثابتِ ${m[0]}؛ var(--text1|2|3) بنویسید`);
    const t = line.match(TEXT_ONLY);
    if (t) bad.push(`${f}:${i + 1} — شدتِ معناییِ خام ${t[0]}؛ var(--green-text|--amber-text|--brand-text) بنویسید`);
  });
}

/* ③ هر سه توکنِ تم باید در هر سه بلوک اعلام شده باشند، وگرنه یکی از تم‌ها
      مقدارِ تمِ دیگر را به ارث می‌برد و بی‌صدا خراب می‌شود. */
const idx = fs.readFileSync('src/index.css', 'utf8');
const block = (sel) => {
  const i = idx.indexOf(sel);
  if (i < 0) return null;
  return idx.slice(i, idx.indexOf('\n}', i));
};
const MUST = ['--bg', '--bg2', '--text1', '--text2', '--text3', '--veil-rgb', '--sheen-rgb', '--shadow-card', '--cyan'];
for (const sel of [':root {', ':root[data-theme="light"] {', '.theme-dark {']) {
  const b = block(sel);
  if (!b) { bad.push(`src/index.css — بلوکِ ${sel} پیدا نشد`); continue; }
  for (const t of MUST) {
    if (!new RegExp(`\\${t}\\s*:`).test(b)) bad.push(`src/index.css — ${sel} توکنِ ${t} را ندارد`);
  }
}

/* ④ توکنی که خودش را صدا بزند (`--text1: var(--text1)`).
      ⚠️ این یک باگِ واقعیِ همین بسته بود: جایگزینیِ دسته‌جمعیِ خاکستری‌ها،
      **تعریفِ** خودِ توکن‌ها را هم عوض کرد. CSS ارجاعِ حلقوی را بی‌هیچ خطایی
      دور می‌اندازد و به مقدارِ اولیه برمی‌گردد — یعنی متنِ تمِ تیره **سیاه** شد
      و در کنسول هیچ خبری نبود. فقط سنجهٔ کنتراست گرفتش (نسبت ۱.۰۵). */
for (const f of css) {
  strip(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
    const m = line.match(/(--[\w-]+)\s*:\s*var\(\s*(--[\w-]+)\s*[,)]/);
    if (m && m[1] === m[2]) bad.push(`${f}:${i + 1} — ${m[1]} خودش را صدا می‌زند (ارجاعِ حلقوی، بی‌صدا به مقدارِ اولیه برمی‌گردد)`);
  });
}

if (bad.length) {
  console.error('رنگِ خام یا توکنِ جاافتاده:\n  ' + bad.slice(0, 40).join('\n  ')
    + (bad.length > 40 ? `\n  … و ${bad.length - 40} مورد دیگر` : ''));
  process.exit(1);
}
console.log(`theme tokens ok — ${css.length} شیوه‌نامه، سه بلوکِ تم کامل`);
