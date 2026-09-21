// نگهبانِ CSSِ چانک‌ها — هر صفحهٔ lazy باید CSSِ چیزی را که استفاده می‌کند خودش
// (یا CSSِ ورودی) بیاورد.
//
// ⚠️ چرا: تا پیش از lazy‌شدنِ مسیرها (قانون ۲۱) همهٔ CSSها در یک باندل بودند و
// هیچ صفحه‌ای لازم نبود بداند استایلش از کجا می‌آید. بعد از آن، فرمِ عمومیِ
// بیمار که `definitions.css` را هرگز ایمپورت نکرده بود، `.pf-field` را از دست
// داد و برچسب و باکس روی هم افتادند (اسکرین‌شاتِ کاربر، اندروید). هیچ بیلدی و
// هیچ آزمونِ APIای این را نمی‌گیرد — فقط چشم. این اسکریپت همان چشم است:
// برای هر ریشهٔ چانک (`import('…')`)، کلاس‌هایی را که ماژول‌هایش استفاده می‌کنند
// با کلاس‌هایی که CSSِ ورودی + CSSِ خودِ چانک تعریف می‌کند مقایسه می‌کند.
//
// فقط کلاسی گزارش می‌شود که **جایی در `src/` تعریف شده** ولی به این چانک
// نمی‌رسد؛ نامِ بی‌استایل (هوکِ آزمون، حالتِ پویا) خطا نیست.
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(SRC);
const cssFiles = files.filter((f) => f.endsWith('.css'));
const jsFiles = files.filter((f) => /\.(jsx|js)$/.test(f));

const stripCss = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
// کامنت‌های JS: بلوکی و خطی. `//` داخلِ رشته (مثلِ URL) با شرطِ «بعد از : یا کوتیشن نباشد» جدا می‌شود.
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

// کلاس‌های تعریف‌شده در هر CSS
const defined = new Map();
for (const f of cssFiles) {
  const set = new Set();
  for (const m of stripCss(fs.readFileSync(f, 'utf8')).matchAll(/\.([a-zA-Z_][\w-]*)/g)) set.add(m[1]);
  defined.set(f, set);
}
const definedAnywhere = new Set([...defined.values()].flatMap((s) => [...s]));

// ایمپورت‌های ایستا و پویای هر ماژول
const resolve = (from, spec) => {
  const p = path.normalize(path.join(path.dirname(from), spec));
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  for (const ext of ['.jsx', '.js', '/index.jsx', '/index.js']) if (fs.existsSync(p + ext)) return p + ext;
  return null;
};
const staticImports = new Map(); // ماژول → [ماژول/CSS]
const dynamicImports = new Set(); // ریشه‌های چانک
for (const f of jsFiles) {
  const txt = stripJs(fs.readFileSync(f, 'utf8'));
  const list = [];
  for (const m of txt.matchAll(/import\s+(?:[^'"]*?from\s+)?['"](\.[^'"]+)['"]/g)) { const p = resolve(f, m[1]); if (p) list.push(p); }
  for (const m of txt.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) { const p = resolve(f, m[1]); if (p) dynamicImports.add(p); }
  staticImports.set(f, list);
}

// ماژول‌های یک چانک (ایستا، ترنزیتیو) و CSSِ آن‌ها
const modsOf = (root) => {
  const seen = new Set(); const stack = [root];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !staticImports.has(f)) continue;
    seen.add(f);
    for (const d of staticImports.get(f)) if (!d.endsWith('.css')) stack.push(d);
  }
  return seen;
};
const cssOf = (mods) => { const out = new Set(); for (const m of mods) for (const d of staticImports.get(m) ?? []) if (d.endsWith('.css')) out.add(d); return out; };
const classesOf = (cssSet) => { const out = new Set(); for (const c of cssSet) for (const k of defined.get(c) ?? []) out.add(k); return out; };

// کلاس‌های استفاده‌شده در یک ماژول: className="…" · className={'…'} · className = '…' (پیش‌فرضِ prop)
// · className={`…`} (فقط تکه‌های ایستایی که به `${}` نچسبیده‌اند)
const DYN = '__DYN__';
const usedIn = (f) => {
  const txt = stripJs(fs.readFileSync(f, 'utf8'));
  const set = new Set();
  const take = (s) => { for (const c of s.split(/\s+/)) if (/^[a-zA-Z_][\w-]*$/.test(c)) set.add(c); };
  for (const m of txt.matchAll(/className\s*=\s*\{?\s*(["'])([^"']*)\1/g)) take(m[2]);
  for (const m of txt.matchAll(/className\s*=\s*\{\s*`([^`]*)`/g))
    take(m[1].replace(/\$\{[^}]*\}/g, DYN).split(/\s+/).filter((t) => !t.includes(DYN)).join(' '));
  return set;
};

// حالت‌های پویا که به‌عمد کنارِ کلاسِ اصلی تعریف می‌شوند، نه به‌تنهایی
const IGNORE = new Set(['bad', 'on', 'off', 'open', 'active', 'hidden', 'disabled', 'selected', 'zero']);

const entryMods = modsOf('src/main.jsx');
const entryCss = cssOf(entryMods);
const entryClasses = classesOf(entryCss);
const roots = [...dynamicImports].sort();
let bad = 0;
for (const root of roots) {
  const mods = modsOf(root);
  const avail = new Set([...entryClasses, ...classesOf(cssOf(mods))]);
  const orphans = new Map();
  for (const m of mods) for (const c of usedIn(m))
    if (!avail.has(c) && !IGNORE.has(c) && definedAnywhere.has(c)) orphans.set(c, [...(orphans.get(c) ?? []), path.basename(m)]);
  if (!orphans.size) continue;
  bad += orphans.size;
  console.error(`\n✘ ${root}`);
  for (const [c, where] of orphans) {
    const owners = cssFiles.filter((f) => defined.get(f).has(c));
    console.error(`    .${c}  ← ${[...new Set(where)].join(', ')}  |  تعریف در ${owners.join(', ')}`);
  }
}
if (bad) {
  console.error(`\n${bad} کلاس به چانکِ خودش نمی‌رسد. راهِ درست: CSSِ مالکِ آن کلاس را در همان صفحه/کامپوننت ایمپورت کن،`);
  console.error('یا اگر پوستهٔ مشترکِ چند چانک است، به src/index.css ببر (مثلِ .pf-field و .db-field).');
  process.exit(1);
}

// ── چکِ دوم: **ریشهٔ کوتاه فقط یک مالک دارد** ──
//
// 🔴 باگِ واقعی (۱۴۰۵/۰۶/۳۰): `src/ui/filedrop.css` هم `.fd` داشت و
// `src/app/frontdesk.css` هم. چون هر دو روی میزِ پذیرش لود می‌شوند (فرمِ مراجعه
// کامپوننتِ آپلود را می‌آورد)، ریشهٔ **صفحه** `display:flex; flex-direction:column`
// کامپوننتِ آپلود را می‌گرفت: هدرِ میز به‌جای هم‌عرضِ تخته، ۶۶۰ پیکسل و وسطِ صفحه
// می‌شد و `.fd-btn` هم دو تعریفِ رقیب داشت. نه بیلد می‌گرفتش نه هیچ سنجهٔ APIای —
// فقط با اندازه‌گیریِ `getBoundingClientRect` در مرورگر پیدا شد.
//
// قاعده: انتخاب‌گری که **فقط** یک کلاسِ ≤۴ کاراکتری است یک «فضای نام» است و باید
// در دقیقاً یک فایل تعریف شود. `src/ui/press.css` عمداً مستثناست: آن فایل کلاسِ
// دکمه‌های فایل‌های دیگر را فهرست می‌کند تا افکتِ فشار بگیرند، نه اینکه مالکشان باشد.
const NS_EXEMPT = new Set(['src/ui/press.css'].map((f) => path.normalize(f)));
const owners = new Map(); // ریشه → [فایل‌ها]
for (const f of cssFiles) {
  if (NS_EXEMPT.has(path.normalize(f))) continue;
  const text = stripCss(fs.readFileSync(f, 'utf8'));
  for (const m of text.matchAll(/(?:^|[},])\s*([^{}@/][^{}]*?)\s*\{/g)) {
    for (const one of m[1].split(',')) {
      const hit = /^\.([a-z][a-z0-9-]{0,3})$/.exec(one.trim());
      if (hit) owners.set(hit[1], [...new Set([...(owners.get(hit[1]) ?? []), f])]);
    }
  }
}
const clashes = [...owners].filter(([, fs2]) => fs2.length > 1);
if (clashes.length) {
  for (const [name, fs2] of clashes) console.error(`✘ ریشهٔ «.${name}» در ${fs2.length} فایل تعریف شده: ${fs2.join(' · ')}`);
  console.error('\nریشهٔ کوتاه = فضای نامِ یک صفحه/کامپوننت. یکی از دو طرف باید پیشوندِ بلندتر بگیرد');
  console.error('(نمونه: کامپوننتِ آپلود از `fd-` به `fdrop-` رفت تا میزِ پذیرش `fd-` را نگه دارد).');
  process.exit(1);
}
console.log(`css chunks ok — ${roots.length} chunk root(s), entry css = ${entryCss.size} file(s), ${owners.size} namespace root(s)`);
