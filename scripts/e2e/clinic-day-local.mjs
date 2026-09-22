/**
 * **«امروز» یک تعریف دارد — به وقتِ مطب.**
 *
 * 🔴 باگِ واقعی: سرور روی کانتینرِ **UTC** می‌دود و کاربر در تهران (+۳:۳۰).
 * `FrontDeskService.todayIso()` روزِ UTC را می‌داد ولی مرورگر روزِ محلی را
 * می‌فرستد — پس بینِ ۰۰:۰۰ تا ۰۳:۳۰ تهران این دو **یک روز** فرق داشتند،
 * `isToday` غلط می‌شد و `canStart` برای **کلِ تخته** خاموش. یعنی هر شب سه
 * ساعت و نیم هیچ بیماری از میزِ پذیرش شروع نمی‌شد و هیچ خطایی هم دیده
 * نمی‌شد — همان پنجره‌ای که شیفتِ شب واقعاً کار می‌کند.
 *
 * این آزمون **بدونِ سرور و دیتابیس** است چون مسئله محاسباتی است: لحظه‌های
 * مرزی را مستقیم به تابع می‌دهیم. سنجهٔ زنده (`w3-3-front-desk`) نمی‌تواند
 * این را بگیرد، چون ساعتِ ماشینِ CI را نمی‌شود جابه‌جا کرد.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

const mod = require('./dist/common/clinic-day.js');
const { clinicTodayIso, clinicDateIso, dayUtc, dayRangeUtc, todayRangeUtc, CLINIC_TZ } = mod;

console.log('۱) پیش‌فرض و مرزها');
ok(CLINIC_TZ === 'Asia/Tehran',
  `پیش‌فرضِ منطقهٔ زمانی «Asia/Tehran» است، نه UTC (${CLINIC_TZ})`);

/* ۲۱:۳۰ UTC = ۰۱:۰۰ فردا به وقتِ تهران — همان پنجره‌ای که میز را می‌شکست. */
const night = new Date('2026-09-22T21:30:00.000Z');
ok(clinicDateIso(night, 'Asia/Tehran') === '2026-09-23',
  '🔴 ۲۱:۳۰ UTC در تهران «فردا»ست', clinicDateIso(night, 'Asia/Tehran'));
ok(clinicDateIso(night, 'UTC') === '2026-09-22',
  '… و همان لحظه به وقتِ UTC هنوز «دیروز» — یعنی اختلاف واقعی است');

/* ۲۰:۰۰ UTC = ۲۳:۳۰ همان روز در تهران — هنوز نباید بپرد. */
ok(clinicDateIso(new Date('2026-09-22T20:00:00.000Z'), 'Asia/Tehran') === '2026-09-22',
  '۲۰:۰۰ UTC هنوز همان روز است (۲۳:۳۰ تهران)');
/* ۲۰:۳۰ UTC = دقیقاً ۰۰:۰۰ تهران. */
ok(clinicDateIso(new Date('2026-09-22T20:30:00.000Z'), 'Asia/Tehran') === '2026-09-23',
  'و ۲۰:۳۰ UTC دقیقاً نیمه‌شبِ تهران است');

console.log('\n۲) بازه همچنان نیمه‌شبِ UTC است — قراردادِ ذخیره‌سازی عوض نشده');
const [s, e] = dayRangeUtc('2026-09-23');
ok(s.toISOString() === '2026-09-23T00:00:00.000Z', `شروع نیمه‌شبِ UTC (${s.toISOString()})`);
ok(e.toISOString() === '2026-09-23T23:59:59.999Z', `پایان ۲۳:۵۹:۵۹٫۹۹۹ (${e.toISOString()})`);
ok(dayUtc('2026-09-23').getTime() === s.getTime(), '`dayUtc` همان مرزِ ستونِ DATE را می‌دهد');
const [ts] = todayRangeUtc(night);
ok(ts.toISOString() === '2026-09-23T00:00:00.000Z',
  '🔴 بازهٔ «امروز» در آن لحظه روزِ تهران است نه روزِ UTC', ts.toISOString());
ok(clinicTodayIso(night) === '2026-09-23', '`clinicTodayIso` همان را می‌گوید');

console.log('\n۳) هیچ تعریفِ دومی از «امروز» در سرور نماند');
/* ⚠️ نگهبانِ ایستا کنارِ آزمونِ محاسباتی: بدونش کافی بود کسی یک
   `setHours(0,0,0,0)` تازه بنویسد تا هشتمین تعریفِ «امروز» ساخته شود و این
   آزمون همچنان سبز بماند. */
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((x) => (x.isDirectory() ? walk(path.join(dir, x.name))
    : x.name.endsWith('.ts') ? [path.join(dir, x.name)] : []));
const ALLOW = new Set([path.join('server', 'src', 'common', 'clinic-day.ts')]);
const strays = [];
for (const f of walk(path.join('server', 'src'))) {
  if (ALLOW.has(f)) continue;
  const src = fs.readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '');
  src.split('\n').forEach((line, i) => {
    if (/set(UTC)?Hours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(line)) strays.push(`${f}:${i + 1}`);
  });
}
ok(strays.length === 0,
  'نیمه‌شب فقط در `common/clinic-day.ts` ساخته می‌شود',
  strays.join('، '));

console.log('\n' + '─'.repeat(50));
console.log(`قبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
