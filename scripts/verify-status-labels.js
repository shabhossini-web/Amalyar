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
  { name: 'وضعیتِ سفارش (ORDER_LABELS)', keys: ['draft', 'sent', 'answered', 'in_review', 'reviewed', 'needs_action'] },
  { name: 'وضعیتِ یادآوری (REMINDER_LABELS)', keys: ['pending', 'sending', 'sent', 'simulated', 'failed', 'uncertain'] },
  { name: 'نوعِ یادآوری (REMINDER_KIND_LABELS)', keys: ['next_visit', 'surgery', 'appointment', 'pre_op_care', 'post_op_care', 'follow_up', 'notice', 'dispatch'] },
  { name: 'وضعیتِ ثبت‌نام (INTAKE_LABELS)', keys: ['pending_fill', 'pending_payment', 'pending_approval', 'approved', 'rejected', 'expired'] },
];
const MIN_HITS = 3;

/* فایل‌هایی که عمداً مستثنا هستند — با دلیل، نه با سکوت. */
const ALLOW = new Set([
  /* ⚠️ اینها **برچسب نیستند، جمله‌اند** — متنی که به خودِ بیمار نشان داده
     می‌شود («پاسخ ثبت شد؛ تیمِ درمان بررسی می‌کند.»). هم‌کلید بودنشان با
     وضعیتِ سفارش تصادفی نیست، ولی کارشان فرق دارد: یکی وضعیت را **نام**
     می‌برد و دیگری برای بیمار **توضیح** می‌دهد. */
  path.join('src', 'lib', 'terms.js'),
]);

/** سرور — خانهٔ مجاز و استثناهای مستند. */
const SERVER_ALLOW = new Set([
  path.join('server', 'src', 'patients', 'labels.ts'),
  /* ⚠️ `APPT_ACTIONS` عمداً واژگانِ **دوم** است و نباید یکی شود:
     `APPT_LABELS` می‌گوید «الان کجاست» («در مطب») و این می‌گوید «اگر بزنی چه
     می‌شود» («رسید»). میزِ پذیرش دکمه است، پس فعل می‌خواهد نه صفت. */
  path.join('server', 'src', 'patients', 'appointments.service.ts'),
]);

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name))
    : /\.(jsx?|mjs|ts)$/.test(e.name) ? [path.join(dir, e.name)] : []));

/* کامنت‌ها حذف می‌شوند وگرنه نگهبان روی توضیحِ خودِ همین قاعده گیر می‌کند —
   دقیقاً همان تله‌ای که نگهبانِ آیکون‌ها یک‌بار خورد. */
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * جفت‌های `کلید: 'متنِ فارسی'` را به **گروه‌های هم‌آبجکت** می‌شکند.
 *
 * ⚠️ شمارشِ فایل‌به‌فایل کافی نبود و دو آژیرِ دروغین می‌داد: `pathway.service`
 * دو نگاشتِ **متفاوت** دارد (`EPISODE_FA` و `STEP_FA`) که رویِ‌هم `pending`،
 * `done` و `cancelled` را می‌سازند بی‌آنکه هیچ‌کدام وضعیتِ مراجعه باشند.
 * آژیرِ دروغین بدتر از نبودِ نگهبان است: اولین واکنشِ هرکس خاموش‌کردنش است.
 */
const groups = (src) => {
  const out = [];
  let cur = [];
  let end = 0;
  const re = /(\w+)\s*:\s*['"`][^'"`]*[\u0600-\u06FF][^'"`]*['"`]/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    /* هر `}` یا `;` بینِ دو جفت یعنی از یک آبجکت بیرون آمده‌ایم. */
    if (cur.length && /[};]/.test(src.slice(end, m.index))) { out.push(cur); cur = []; }
    cur.push(m[1]);
    end = m.index + m[0].length;
  }
  if (cur.length) out.push(cur);
  return out;
};

const bad = [];
const scan = (root, label, allow) => {
  for (const file of walk(root)) {
    if (allow.has(file)) continue;
    for (const keys of groups(strip(fs.readFileSync(file, 'utf8')))) {
      const have = new Set(keys);
      for (const set of SETS) {
        const hits = set.keys.filter((k) => have.has(k));
        if (hits.length >= MIN_HITS) {
          bad.push(`${file}: ${label} «${set.name}» (${hits.join('، ')})`);
        }
      }
    }
  }
};
scan('src', 'نگاشتِ فارسیِ', ALLOW);

/* ⚠️ **سرور هم گشته می‌شود، نه فقط کلاینت.** نسخهٔ اولِ این نگهبان فقط `src`
   را می‌دید و برای همین چهار نگاشتِ دومِ داخلِ `live.service.ts` را ندید —
   یکی‌شان (`OP_STATUS_FA.cancelled = 'لغو شد'`) حتی با `OP_LABELS` خودِ سرور
   نمی‌خواند، یعنی یک عمل در `/visits/:id` «لغو» بود و در `/patients/:id/live`
   «لغو شد». کپیِ دومِ سرور دقیقاً همان‌قدر واگرا می‌شود که کپیِ کلاینت. */
scan(path.join('server', 'src'), 'کپیِ دومِ سرور از', SERVER_ALLOW);

if (bad.length) {
  console.error('نگاشتِ فارسیِ وضعیت در کلاینت — برچسب باید از سرور بیاید:\n  ' + bad.join('\n  '));
  console.error('\nراهِ درست: برچسبِ ردیف از خودِ ردیف (`statusFa`/`opStatusFa`/`kindFa`)،');
  console.error('فهرستِ کاملِ گزینه‌ها از `useStatusList()` (`/config.statuses`).');
  console.error('تنها خانهٔ متن‌ها: server/src/patients/labels.ts');
  process.exit(1);
}
console.log(`status labels ok — ${SETS.length} مجموعه، یک خانه (کلاینت و سرور)`);
