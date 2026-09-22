/**
 * نگهبانِ «یک ماشینِ وضعیت» — ایستا، بی‌سرور، برای CI.
 *
 * خواهرِ `verify-status-labels.js`: آن یکی می‌گوید **متنِ** وضعیت کپی نشود،
 * این یکی می‌گوید **منطقِ** وضعیت کپی نشود.
 *
 * 🔴 سه کپیِ واقعی که این نگهبان برایشان نوشته شد — هر سه قاعدهٔ «آیا
 * «شروعِ ویزیت» ممکن است؟» را از نو نوشته بودند و هر سه فرق داشتند:
 *
 *   `FrontDeskService.start()`   امروز + نه `held` + نه لغو/نیامد   ✅ درست
 *   `Calendar.jsx`               فقط نه لغو/نیامد                   ❌
 *   `POST /appointments/:id/visit` فقط نه لغو                       ❌
 *
 * یعنی تقویم برای نوبتِ **پول‌نداده** و نوبتِ **هفتهٔ آینده** دکمهٔ «شروعِ
 * ویزیت» نشان می‌داد — و دکمه مرده نبود: مسیرِ سرورش هم همان شرط‌ها را
 * نداشت، پس مراجعه‌ای واقعی با تاریخِ **امروز** ساخته می‌شد از بیماری که
 * هنوز پرداخت نکرده بود.
 *
 * و کپیِ چهارم در `thing-popups.jsx` بود: `!['done','cancelled','noshow']`
 * — که یعنی بیماری که منشی اشتباهی «نیامد» زده، از پروندهٔ بیمار و میزِ
 * پزشک هیچ راهِ برگشتی نداشت، در حالی که خودِ سرور
 * `APPT_TRANSITIONS.noshow = ['confirmed']` را مجاز می‌داند.
 *
 * قاعده‌ای که اعمال می‌شود:
 *   ۱) کلاینت شرطِ چندوضعیتی نمی‌نویسد — دکمه‌ها از `nextOptions`ِ سرور.
 *   ۲) کلاینت `canStart` را **نمی‌سازد**، فقط می‌خواند.
 *   ۳) سرور هم `canStart` را فقط در یک فایل می‌سازد.
 *
 * اجرا از ریشهٔ مخزن:  node scripts/verify-state-machine.js
 */
import fs from 'node:fs';
import path from 'node:path';

/** خانهٔ یگانهٔ قاعده. */
const HOME = path.join('server', 'src', 'patients', 'appointments.service.ts');

const APPT = ['held', 'confirmed', 'arrived', 'noshow', 'done', 'cancelled'];

const walk = (dir, re) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), re)
    : re.test(e.name) ? [path.join(dir, e.name)] : []));

/* کامنت‌ها حذف می‌شوند وگرنه نگهبان روی توضیحِ خودِ همین قاعده گیر می‌کند —
   همان تله‌ای که نگهبانِ آیکون‌ها یک‌بار خورد و بیلد را قرمز کرد. */
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/^\s*\/\/.*$/gm, '');

const bad = [];

/* ۱) شرطِ چندوضعیتی در کلاینت — `['done','cancelled'].includes(st)` و
      خویشاوندانش. یک وضعیت به‌تنهایی مجاز است (مثلِ `st === 'cancelled'`
      برای یک استایل)؛ **دو تا یعنی ماشینِ وضعیت**. */
for (const file of walk('src', /\.(jsx?|mjs)$/)) {
  const src = strip(fs.readFileSync(file, 'utf8'));
  src.split('\n').forEach((line, i) => {
    const arr = /\[([^\]]*)\]\s*\.\s*includes\s*\(/.exec(line);
    if (!arr) return;
    const hit = APPT.filter((k) => new RegExp(`['"\`]${k}['"\`]`).test(arr[1]));
    if (hit.length >= 2) bad.push(`${file}:${i + 1}: شرطِ چندوضعیتیِ نوبت (${hit.join('، ')})`);
  });
}

/* ۲) کلاینت `canStart` را نمی‌سازد. خواندنش (`row.canStart`) آزاد است؛
      ساختنش (`canStart:` یا `canStart =`) یعنی کپیِ قاعده. */
for (const file of walk('src', /\.(jsx?|mjs)$/)) {
  const src = strip(fs.readFileSync(file, 'utf8'));
  src.split('\n').forEach((line, i) => {
    if (/(^|[^.\w])canStart\s*[:=][^=]/.test(line)) {
      bad.push(`${file}:${i + 1}: \`canStart\` در کلاینت ساخته شده — باید از سرور بیاید`);
    }
  });
}

/* ۳) سرور هم یک خانه دارد. */
for (const file of walk(path.join('server', 'src'), /\.ts$/)) {
  if (file === HOME) continue;
  const src = strip(fs.readFileSync(file, 'utf8'));
  src.split('\n').forEach((line, i) => {
    if (/(^|[^.\w])canStart\s*[:=][^=]/.test(line)) {
      bad.push(`${file}:${i + 1}: \`canStart\` بیرون از ${HOME} ساخته شده`);
    }
  });
}

if (bad.length) {
  console.error('ماشینِ وضعیتِ نوبت کپی شده:\n  ' + bad.join('\n  '));
  console.error('\nراهِ درست: دکمه‌ها از `row.nextOptions` (برچسبِ اقدام همراهش می‌آید)،');
  console.error('و «شروعِ ویزیت» از `row.canStart` / `row.startHint`.');
  console.error(`تنها خانهٔ قاعده: ${HOME} → apptStartBlock()`);
  process.exit(1);
}
console.log('state machine ok — ماشینِ وضعیتِ نوبت فقط یک خانه دارد');
