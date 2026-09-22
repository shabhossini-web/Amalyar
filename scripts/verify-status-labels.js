/**
 * نگهبانِ «یک وضعیت، یک برچسب» — ایستا، بی‌سرور، برای CI.
 *
 * 🔴 چرا نوشته شد (بازخوردِ مالک ۱۴۰۵/۰۶/۳۱: «همهٔ داده‌ها باید منبعشان یکی
 * باشد»): دیتابیس از اول یکی بود؛ چیزی که یکی نبود **زبانش** بود. هر صفحهٔ
 * کلاینت نگاشتِ فارسیِ خودش را داشت و با سرور نمی‌خواند:
 *
 *   `arrived`   → سرور «در مطب»  · میز پزشک و صفحهٔ امروز «رسید»
 *   `held`      → سرور «در انتظارِ پرداخت» · آن‌ها «رزرو»
 *   `done` (مراجعه) → سرور «انجام شد» · داشبورد و پرونده «تمام‌شده»
 *   `cancelled` (مراجعه) → سرور «لغو» · داشبورد و پرونده «کنسل»
 *
 * یعنی یک بیمار در دو میز دو وضعیتِ متفاوت داشت. هیچ‌کدام باگِ منطقی نبود و
 * هیچ تستی هم نمی‌گرفتش — چون هر صفحه به‌تنهایی درست بود.
 *
 * قاعده‌ای که این نگهبان اعمال می‌کند: **کلاینت نگاشتِ فارسیِ وضعیت ندارد.**
 * برچسبِ یک ردیف همراهِ خودش می‌آید (`statusFa`, `opStatusFa`, `kindFa`) و
 * فهرستِ کاملِ گزینه‌ها از `/config.statuses`. تنها خانهٔ متن‌ها:
 * `server/src/patients/labels.ts`.
 *
 * ⚠️ معیار عمداً «سه کلید از یک مجموعه» است نه «یک کلید»: `pending` در
 * `Reminders.jsx` معنای دیگری دارد («در صف») و `done` در جای دیگر هم می‌آید.
 * سه‌تایی‌شدن یعنی واقعاً همان مجموعه بازنویسی شده، نه هم‌نامیِ تصادفی.
 *
 * اجرا از ریشهٔ مخزن:  node scripts/verify-status-labels.js
 */
import fs from 'node:fs';
import path from 'node:path';

const SETS = [
  { name: 'وضعیتِ نوبت (APPT_LABELS)', keys: ['held', 'confirmed', 'arrived', 'noshow', 'done', 'cancelled'] },
  { name: 'وضعیتِ مراجعه (OP_LABELS)', keys: ['pending', 'done', 'cancelled'] },
  { name: 'نوعِ سندِ بالینی (NOTE_KIND_LABELS)', keys: ['history', 'visit', 'op', 'progress', 'discharge', 'consult'] },
];
const MIN_HITS = 3;

/* فایل‌هایی که عمداً مستثنا هستند — با دلیل، نه با سکوت. */
const ALLOW = new Set([
  // هنوز هیچ. هر افزودنی به این فهرست باید دلیلش همین‌جا نوشته شود.
]);

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name))
    : /\.(jsx?|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []));

/* کامنت‌ها حذف می‌شوند وگرنه نگهبان روی توضیحِ خودِ همین قاعده گیر می‌کند —
   دقیقاً همان تله‌ای که نگهبانِ آیکون‌ها یک‌بار خورد. */
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/^\s*\/\/.*$/gm, '');

const bad = [];
for (const file of walk('src')) {
  if (ALLOW.has(file)) continue;
  const src = strip(fs.readFileSync(file, 'utf8'));
  for (const set of SETS) {
    const hits = set.keys.filter((k) => new RegExp(`\\b${k}\\s*:\\s*['"\`][^'"\`]*[\\u0600-\\u06FF]`).test(src));
    if (hits.length >= MIN_HITS) {
      bad.push(`${file}: نگاشتِ فارسیِ «${set.name}» (${hits.join('، ')})`);
    }
  }
}

if (bad.length) {
  console.error('نگاشتِ فارسیِ وضعیت در کلاینت — برچسب باید از سرور بیاید:\n  ' + bad.join('\n  '));
  console.error('\nراهِ درست: برچسبِ ردیف از خودِ ردیف (`statusFa`/`opStatusFa`/`kindFa`)،');
  console.error('فهرستِ کاملِ گزینه‌ها از `useStatusList()` (`/config.statuses`).');
  console.error('تنها خانهٔ متن‌ها: server/src/patients/labels.ts');
  process.exit(1);
}
console.log(`status labels ok — ${SETS.length} مجموعه، هیچ نگاشتِ کلاینتی`);
