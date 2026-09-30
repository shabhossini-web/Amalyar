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
/* ⚠️ فهرست **سایه‌های همسایه** را هم دارد، نه فقط مقدارِ دقیقِ توکن‌ها. درسِ
   واقعی: `#f4f1ff` یک رقم با `#f2f0fc` (مقدارِ `--text1`) فرق داشت و نگهبان
   ندیدش — ولی چون رنگِ **ارثیِ** ریشهٔ پنج صفحه بود (`.cal`, `.acc`, `.df`,
   `.inv`, `.pf`), در تمِ روشن نامِ بیمار سفید روی سفید می‌شد و کلِ فهرست
   خالی به‌نظر می‌رسید. تقویمِ `JDate` هم قبلاً همین را خورده بود. */
const GREY = /#(f2f0fc|f4f1ff|e5e0ff|e6ddff|cfc9e8|b8b3d6|b7b0d4|a9a1d8|9aa2c0|8f88b5|8f88af|8982aa|837ca5|817aa2|7d77a3|8a84b0|5f5985|6f679a|6f688d|6b7280|c7c2df|7d76a0|9a93bb|c9c2e4)\b/i;
/* ⚠️ این سه فقط در جایگاهِ **متن** ممنوع‌اند، نه در جایگاهِ پُرکننده: کهربای
   `#fbbf24` به‌عنوانِ زمینهٔ چیپ در هر دو تم درست است (مرکّبش `--ink-bright`
   می‌شود). پس الگو به `color:` مقید است، وگرنه نگهبان پُرکننده‌های سالم را
   قرمز می‌کند و اولین واکنش «خاموشش کن» می‌شود. */
const TEXT_ONLY = /color:\s*#(5eead4|fbbf24|ddd6fe|fca5a5|fecaca)\b/i;
for (const f of css) {
  /* ⚠️ `index.css` استثناست: **تعریفِ** خودِ توکن‌ها آن‌جاست و باید hex باشد. */
  if (f === 'src/index.css') continue;
  strip(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
    const m = line.match(GREY);
    if (m) bad.push(`${f}:${i + 1} — خاکستریِ ثابتِ ${m[0]}؛ var(--text1|2|3) بنویسید`);
    const t = line.match(TEXT_ONLY);
    if (t) bad.push(`${f}:${i + 1} — شدتِ معناییِ خام ${t[0]}؛ var(--green-text|--amber-text|--brand-text|--red-text) بنویسید`);
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
const MUST = ['--bg', '--bg2', '--text1', '--text2', '--text3', '--veil-rgb', '--sheen-rgb', '--shadow-card',
  '--cyan', '--green-text', '--amber-text', '--brand-text', '--red-text',
  /* سطح‌های تم‌دار (⑥ پایین) — اگر یک بلوک جا بیندازدشان، آن تم مقدارِ تمِ دیگر را می‌گیرد. */
  '--well-bg', '--field-bg', '--field-bg-focus', '--row-bg', '--ghost-bg', '--ghost-bg-hover', '--ghost-shadow', '--ghost-shadow-active'];
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

/* ⑤ توکنی که **هیچ‌جا تعریف نشده** (`var(--muted, #b7b0d8)`).
      ⚠️ باگِ واقعی (بستهٔ ۶): `--muted` هرگز توکنِ این پروژه نبود، پس
      fallbackِ بنفشِ روشن همیشه برنده بود — در تمِ تیره درست به‌نظر می‌رسید
      و در تمِ روشن روی زمینهٔ روشن محو می‌شد. هیچ خطایی هم نمی‌داد، چون CSS
      برای توکنِ ناموجود دقیقاً همین fallback را می‌خواهد.
      «تعریف» یعنی `--x:` در یک CSS یا نامش در کدِ JS (اسپاتلایتِ `--mx`
      که `track` می‌نویسد، یا `style={{ '--x': … }}`). */
const jsSrc = walk('src').filter((f) => /\.(jsx?|mjs)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const defined = new Set();
for (const f of css) for (const m of strip(fs.readFileSync(f, 'utf8')).matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
for (const m of jsSrc.matchAll(/['"`](--[\w-]+)['"`]/g)) defined.add(m[1]);
for (const f of css) {
  strip(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!defined.has(m[1])) bad.push(`${f}:${i + 1} — ${m[1]} هیچ‌جا تعریف نشده (fallbackِ خام در هر دو تم برنده می‌شود)`);
    }
  });
}

/* ⑥ پُرِ سیاهِ خام (`background: rgba(0, 0, 0, α)`).
      ⚠️ بازبینیِ شیشه (۱۴۰۵/۰۷/۰۳): فیلدِ پروفایل، قابِ تب‌ها، انتخابگرِ سطحِ
      کاربران و گودهای ترابری/کارشناس با سیاهِ ۲۲–۳۵٪ ساخته شده بودند. ① سفیدِ خام
      را می‌گرفت ولی سیاه را نه، چون سیاه برای **سایه و پرده** در هر دو تم درست
      است. نتیجه: در تمِ روشن همین سیاه خاکستریِ کدر شد و فیلدِ خالی شبیهِ فیلدِ
      غیرفعال دیده می‌شد. حالا پُرِ سطح از `--well-bg` / `--field-bg` / `--row-bg`
      می‌آید؛ جایی که عمداً در هر دو تم تیره است (پردهٔ پشتِ مودال، نشانِ روی قرصِ
      رنگی، قابِ دوربین) کنارِ همان خط نوشته می‌شود «تیره در هر دو تم». سایه
      (`box-shadow`) و `index.css` بیرون از این قاعده‌اند. */
const DARK_OK = /تیره در هر دو تم/;
for (const f of css) {
  if (f === 'src/index.css') continue;
  const raw = fs.readFileSync(f, 'utf8').split('\n');
  strip(raw.join('\n')).split('\n').forEach((line, i) => {
    if (/background(-color)?\s*:[^;]*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/.test(line) && !DARK_OK.test(raw[i])) {
      bad.push(`${f}:${i + 1} — پُرِ سیاهِ خام؛ var(--well-bg|--field-bg|--row-bg) بنویسید، یا اگر عمداً در هر دو تم تیره است کنارش «تیره در هر دو تم»`);
    }
  });
}

/* ⑦ رنگِ متنِ روشنِ خام (`color: #6ee7b7`) — قاعده بر پایهٔ **روشنایی**، نه فهرست.
      ⚠️ بازبینیِ UX (۱۴۰۵/۰۷/۰۸): ۱۶۳ جا متنِ وضعیت، برچسب و خطا با شدت‌های
      ۳۰۰/۴۰۰ِ پالت نوشته شده بود — #6ee7b7 سبزِ «تسویه»، #fcd34d کهربای «در
      انتظار»، #fda4af و #f87171 رزِ «منقضی/خطا»، #c4b5fd بنفش، #67e8f9 سایان. ②
      فقط چند هگزِ مشخص را می‌شناخت و هر سایهٔ همسایه از چشمش می‌افتاد؛ روی زمینهٔ
      روشن این‌ها ۱٫۲ تا ۲٫۸ به ۱ می‌دهند — یعنی «پرداخت شد» یا «منقضی» عملاً نامرئی،
      در حالی که تمِ تیره کاملاً سالم به‌نظر می‌رسید. حالا هر `color:` هگزی که
      روشنایی‌اش از ۰٫۲۵ بیشتر است (جز `#fff`ِ روی دکمهٔ گرادیانِ برند) باید توکن
      باشد: `--green-text` / `--amber-text` / `--red-text` / `--brand-text` / `--cyan`
      / `rgb(var(--kind-sky))` / `--text1|2`. سطوحِ ورودی (لانچر و ورود، `.theme-dark`)
      همیشه تیره‌اند و بیرونِ این قاعده‌اند؛ متنِ روشن روی سطحی که عمداً در هر دو تم
      تیره است (توستِ خطا، آواتارِ گرادیانی) با «تیره در هر دو تم» در همان قاعده. */
const ALWAYS_DARK = new Set(['src/index.css', 'src/app/launcher.css', 'src/app/login.css']);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lumOf = (h) => {
  const x = h.length === 3 ? h.replace(/./g, '$&$&') : h;
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(x.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
for (const f of css) {
  if (ALWAYS_DARK.has(f)) continue;
  const raw = fs.readFileSync(f, 'utf8');
  const txt = strip(raw);
  for (const m of txt.matchAll(/(?<![-\w])color\s*:\s*#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1].toLowerCase();
    if (h === 'fff' || h === 'ffffff' || lumOf(h) < 0.25) continue;
    const line = txt.slice(0, m.index).split('\n').length;
    /* نشانِ «تیره در هر دو تم» هم در بدنهٔ همان قاعده پذیرفته است، هم روی همان خط (حتی بیرونِ آکولاد). */
    const rule = raw.slice(raw.lastIndexOf('{', m.index) + 1, raw.indexOf('}', m.index));
    if (DARK_OK.test(rule) || DARK_OK.test(raw.split('\n')[line - 1])) continue;
    bad.push(`${f}:${line} — متنِ روشنِ خام #${h} (در تمِ روشن محو می‌شود)؛ var(--green-text|--amber-text|--red-text|--brand-text|--cyan|--text1|--text2) بنویسید`);
  }
}

if (bad.length) {
  console.error('رنگِ خام یا توکنِ جاافتاده:\n  ' + bad.slice(0, 40).join('\n  ')
    + (bad.length > 40 ? `\n  … و ${bad.length - 40} مورد دیگر` : ''));
  process.exit(1);
}
console.log(`theme tokens ok — ${css.length} شیوه‌نامه، سه بلوکِ تم کامل`);
