/**
 * نگهبانِ آیکونِ ماژول‌ها (W3.7) — **هیچ آیکونی برای دو ماژول**.
 *
 * ⚠️ چرا لازم است: تا W3.7 کاتالوگِ کاشی‌ها `Wave` را برای سه ماژول (پرتالِ
 * جراح، دستیارِ هوشمند، پنلِ کارشناسی)، `Book` را برای سه‌تا و `Chart`/`Clock`
 * را برای دوتا به کار می‌برد. نتیجه‌اش این بود که کاشی‌ها از هم تفکیک نمی‌شدند
 * و کاربر هر بار باید **می‌خواند** — یعنی آیکون هیچ کاری نمی‌کرد.
 *
 * تکرار از راهِ بی‌دقتی برنمی‌گردد، از راهِ **کم‌فروشی** برمی‌گردد: کسی که
 * ماژولِ تازه‌ای اضافه می‌کند نزدیک‌ترین آیکونِ موجود را برمی‌دارد چون ساختنِ
 * یکی تازه کار دارد. این اسکریپت همان لحظه جلویش را می‌گیرد.
 *
 * چکِ دوم به‌همان اندازه مهم است: آیکونی که در `tools.jsx` نام برده شده ولی از
 * `icons.jsx` صادر نشده، در JSX می‌شود `undefined` و React **کلِ صفحه را
 * می‌اندازد** — نه خطای بیلد، نه هشدار، فقط صفحهٔ سفید. یک غلطِ تایپی کافی است.
 *
 * اجرا از ریشهٔ مخزن:  node scripts/verify-module-icons.js
 */
import fs from 'node:fs';

const CATALOG = 'src/app/tools.jsx';
const ICONS = 'src/ui/icons.jsx';

const catalog = fs.readFileSync(CATALOG, 'utf8');
const icons = fs.readFileSync(ICONS, 'utf8');

/* کامنت‌ها اول برداشته می‌شوند وگرنه یک `icon: X`ِ نمونه در توضیحات هم
   شمرده می‌شود. خط‌ها با فاصله جایگزین می‌شوند تا شمارهٔ خط نلغزد. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const body = strip(catalog);

/* هر کاشی یک `key: '…'` و یک `icon: X` روی همان خط دارد (HERO هم همین شکل). */
const entries = [];
body.split('\n').forEach((line, i) => {
  const k = line.match(/key: '([^']+)'/);
  const ic = line.match(/icon: ([A-Za-z][A-Za-z0-9]*)/);
  if (k && ic) entries.push({ key: k[1], icon: ic[1], line: i + 1 });
});

const bad = [];

if (entries.length < 10) {
  bad.push(`${CATALOG}: فقط ${entries.length} کاشی پیدا شد — الگوی کاتالوگ عوض شده و این نگهبان دیگر چیزی نمی‌بیند`);
}

/* ① هیچ آیکونی برای دو ماژول. */
const byIcon = new Map();
for (const e of entries) {
  if (!byIcon.has(e.icon)) byIcon.set(e.icon, []);
  byIcon.get(e.icon).push(e.key);
}
for (const [icon, keys] of byIcon) {
  if (keys.length > 1) {
    bad.push(`آیکونِ «${icon}» برای ${keys.length} ماژول: ${keys.join('، ')} — یکی تازه در ${ICONS} بساز، از کاشیِ دیگر قرض نگیر`);
  }
}

/* ② هر آیکونِ نام‌برده باید واقعاً صادر شده باشد، وگرنه رندر `undefined` می‌شود. */
const exported = new Set([...icons.matchAll(/export const ([A-Za-z][A-Za-z0-9]*)\s*=/g)].map((m) => m[1]));
for (const e of entries) {
  if (!exported.has(e.icon)) {
    bad.push(`${CATALOG}:${e.line} — آیکونِ «${e.icon}» (ماژولِ ${e.key}) از ${ICONS} صادر نشده`);
  }
}

/* ③ هر آیکونِ نام‌برده باید ایمپورت هم شده باشد — ESLint این را می‌گیرد، ولی
      پیامِ این‌جا می‌گوید **کدام ماژول** قربانی می‌شود. */
const imported = new Set(
  (body.match(/import \{([^}]*)\} from '\.\.\/ui\/icons\.jsx'/) ?? [, ''])[1]
    .split(',').map((x) => x.trim()).filter(Boolean),
);
for (const e of entries) {
  if (exported.has(e.icon) && !imported.has(e.icon)) {
    bad.push(`${CATALOG}:${e.line} — آیکونِ «${e.icon}» (ماژولِ ${e.key}) ایمپورت نشده`);
  }
}

if (bad.length) {
  console.error('آیکونِ ماژول‌ها:\n  ' + bad.join('\n  '));
  process.exit(1);
}
console.log(`module icons ok — ${entries.length} ماژول، ${byIcon.size} آیکونِ یکتا`);
