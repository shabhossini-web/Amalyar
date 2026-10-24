/**
 * جستجوی دوبخشیِ «کدام کلمه فیلتر شد؟» (`src/lib/filterBisect.js`) — بدونِ مرورگر و سرور.
 *
 *  باید بیفتد:
 *   - کلمهٔ بدِ تنها: در هر جای متن (اول، وسط، آخر، تک‌کلمه‌ای) دقیقاً همان کلمه پیدا شود
 *   - دو کلمهٔ چسبیده («قرعه کشی»): تکهٔ دوکلمه‌ای پیدا شود، نه یکی‌اش
 *   - تعدادِ آزمایش ≤ ۱ + ۲·⌈log₂ n⌉ و زیرِ سقفِ ۱۶ برای ۱۲۸ کلمه
 *  نباید بیفتد:
 *   - متنی که کلِ آن رد نمی‌شود («clean»): فقط یک آزمایش، بدونِ جستجو
 *   - خطای ارسال (اعتبار تمام / قطعِ شبکه): همان خطا بالا بیاید و جستجو بایستد
 */
import assert from 'node:assert/strict';
import { findFilteredSpan, wordsOf, PROBE_STEP_CAP } from '../../src/lib/filterBisect.js';

let count = 0;
const ok = (v, l) => { assert.ok(v, l); console.log('PASS ' + ++count + ' ' + l); };

/* فیلترِ ساختگی: متنی فیلتر می‌شود که تکهٔ بد را **پشت‌سرهم** داشته باشد (مثلِ اپراتور). */
const sim = (tokens, bad) => {
  const log = [];
  const has = (arr) => { for (let i = 0; i + bad.length <= arr.length; i++) if (bad.every((w, k) => arr[i + k] === w)) return true; return false; };
  const probe = async (a, b) => { log.push([a, b]); return has(a === undefined ? tokens : tokens.slice(a, b)); };
  return { probe, log };
};
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`);

for (const n of [1, 2, 3, 7, 16, 40, 128]) {
  for (const at of [0, Math.floor(n / 2), n - 1]) {
    const t = words(n); t[at] = 'BAD';
    const { probe, log } = sim(t, ['BAD']);
    const r = await findFilteredSpan(n, probe);
    ok(r.status === 'found' && r.start === at && r.end === at + 1, `n=${n} جای ${at}: دقیقاً همان کلمه`);
    const cap = 1 + 2 * Math.ceil(Math.log2(Math.max(2, n)));
    ok(log.length <= cap && log.length <= PROBE_STEP_CAP, `n=${n} جای ${at}: ${log.length} آزمایش ≤ ${cap}`);
  }
}
{
  const t = words(30); t[11] = 'قرعه'; t[12] = 'کشی';
  const r = await findFilteredSpan(30, sim(t, ['قرعه', 'کشی']).probe);
  ok(r.status === 'found' && r.start === 11 && r.end === 13, 'دو کلمهٔ چسبیده: تکهٔ دوکلمه‌ای');
}
{
  const { probe, log } = sim(words(20), ['BAD']);
  const r = await findFilteredSpan(20, probe);
  ok(r.status === 'clean' && log.length === 1, 'متنِ سالم: «clean» با یک آزمایش');
}
{
  let k = 0;
  const probe = async () => { if (++k === 3) throw new Error('اعتبارِ پنلِ پیامک کافی نیست'); return true; };
  let msg = '';
  await findFilteredSpan(40, probe).catch((e) => { msg = e.message; });
  ok(msg.includes('اعتبار') && k === 3, 'خطای ارسال: بالا می‌آید و جستجو همان‌جا می‌ایستد');
}
{
  const steps = []; const t = words(10); t[4] = 'BAD';
  await findFilteredSpan(10, sim(t, ['BAD']).probe, { onStep: (s) => steps.push(s) });
  ok(steps.every((s, i) => s === i + 1) && steps.length > 1, 'onStep: شمارهٔ ۱..k');
}
ok(JSON.stringify(wordsOf('سپری،  «کم‌چرب». (استحمام) ۴۸ ساعت؟')) === JSON.stringify(['سپری', 'کم‌چرب', 'استحمام', 'ساعت']), 'wordsOf: بی‌نشانه و بی‌رقم، نیم‌فاصله می‌ماند');
console.log(`\nسبز: ${count}`);
