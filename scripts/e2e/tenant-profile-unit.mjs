/**
 * نوعِ نصب + بستهٔ خدمات — **یک قاعده، دو طرف** (`server/src/config/tenant-profile.ts`
 * و آینه‌اش `src/lib/profile.js`). خالص؛ بدونِ سرور و دیتابیس.
 *
 * زمینه (مالک، ۱۴۰۵/۰۷/۰۱): نصب یا مطب/کلینیک است یا شرکتی، و شرکت خودش
 * خدماتش را می‌چیند. نصب‌های فعلی ردیفِ `services` ندارند و باید بی‌هیچ تغییری
 * همان چیزی بمانند که بودند.
 *
 *  باید بیفتد:
 *   - ردیفِ `services`ی که خدمتِ آینه‌شده در `vertical` را ندارد کهنه است و نادیده
 *   - مطب با ردیفِ `services`ِ جامانده همچنان مطب است، بی‌خدمت
 *   - کلیدِ ناشناخته/تکراری/JSONِ خراب هرگز به بیرون نمی‌رسد
 *   - کلاینت با mockِ قدیمی (فقط `vertical`) همان پروفایلِ سرور را می‌سازد
 *  نباید بیفتد:
 *   - `ionm`/`implant` بی‌ردیف ← شرکتی با همان یک خدمت (نصب‌های فعلی)
 *   - بستهٔ دوخدمته به ترتیبِ ثابت، و نورومانیتورینگ خدمتِ اصلی (تصمیمِ واژگانِ مالک)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(mkdtempSync(join(tmpdir(), 'tp-')), 'tp.mjs');
execFileSync('npx', ['--yes', 'esbuild', resolve(root, 'server/src/config/tenant-profile.ts'),
  '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' });
const S = await import(pathToFileURL(out).href);
const C = await import(pathToFileURL(resolve(root, 'src/lib/profile.js')).href);

let pass = 0; const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fails.push(m); console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('۱) نصب‌های فعلی — بی‌ردیفِ خدمات (نباید بیفتد)');
ok(same(S.profileOf('ionm', null), { kind: 'company', services: ['ionm'], primary: 'ionm' }), 'ionm ← شرکتی [نورومانیتورینگ]');
ok(same(S.profileOf('implant', null), { kind: 'company', services: ['implant'], primary: 'implant' }), 'implant ← شرکتی [ایمپلنت]');
ok(same(S.profileOf('clinic', null), { kind: 'clinic', services: [], primary: 'clinic' }), 'clinic ← مطب/کلینیک');

console.log('\n۲) بستهٔ دوخدمته');
ok(same(S.profileOf('ionm', '["implant","ionm"]').services, ['ionm', 'implant']), 'ترتیبِ ثابت، نه ترتیبِ ذخیره');
ok(S.primaryOf(['implant', 'ionm']) === 'ionm' && S.primaryOf(['implant']) === 'implant', 'نورومانیتورینگ خدمتِ اصلیِ دوخدمته است (واژگانِ مالک)');
ok(S.profileLabel(S.profileOf('ionm', '["ionm","implant"]')) === 'شرکتی — نورومانیتورینگ و ایمپلنت و تجهیزات', 'برچسبِ پروفایل', S.profileLabel(S.profileOf('ionm', '["ionm","implant"]')));

console.log('\n۳) ردیفِ کهنه و خراب (باید بیفتد)');
ok(same(S.profileOf('implant', '["ionm"]').services, ['implant']), '**ردیفِ services بی‌خدمتِ vertical کهنه است — vertical برنده**');
ok(same(S.profileOf('clinic', '["ionm","implant"]'), { kind: 'clinic', services: [], primary: 'clinic' }), '**مطب با ردیفِ جامانده همچنان مطب و بی‌خدمت**');
ok(same(S.profileOf('ionm', '["dental"]').services, ['ionm']), 'کلیدِ ناشناخته دور ریخته می‌شود');
ok(same(S.profileOf('ionm', 'not json').services, ['ionm']), 'JSONِ خراب ← بازگشت به vertical');
ok(same(S.profileOf('ionm', '["ionm","ionm"]').services, ['ionm']), 'تکرار حذف می‌شود');
ok(same(S.normalizeServices({ 0: 'ionm' }), []), 'غیرِ آرایه ← خالی');

console.log('\n۴) کلاینت همان قاعده را آینه می‌کند');
const cases = [['ionm', null], ['implant', null], ['clinic', null], ['ionm', '["ionm","implant"]'], ['implant', '["ionm"]'], ['clinic', '["ionm"]']];
for (const [v, raw] of cases) {
  const srv = S.profileOf(v, raw);
  const fromServer = C.profileFromConfig({ vertical: srv.primary, kind: srv.kind, services: srv.services });
  ok(same(fromServer, { kind: srv.kind, services: srv.services }), `پاسخِ سرور دست‌نخورده عبور می‌کند (${v} / ${raw})`);
}
for (const v of ['ionm', 'implant', 'clinic']) {
  const srv = S.profileOf(v, null);
  ok(same(C.profileFromConfig({ vertical: v }), { kind: srv.kind, services: srv.services }), `**mockِ قدیمی (فقط vertical=${v}) = همان قاعدهٔ سرور**`);
}
ok(same(C.profileFromConfig(undefined), { kind: 'company', services: ['ionm'] }), 'پیش از رسیدنِ /config: پیش‌فرضِ سرور (ionm)');
ok(C.hasService({ vertical: 'ionm', kind: 'company', services: ['ionm', 'implant'] }, 'implant') && !C.hasService({ vertical: 'clinic' }, 'ionm'), 'hasService');
ok(same(S.SERVICE_ORDER, C.SERVICE_ORDER), 'ترتیبِ خدمات در دو طرف یکی است');

console.log('\n۵) پلانِ ماژول‌ها — اجتماعِ خدمات، سطحِ بازتر');
const both = S.featurePlanForProfile('company', ['ionm', 'implant']);
const ionm = S.featurePlanForProfile('company', ['ionm']);
const implant = S.featurePlanForProfile('company', ['implant']);
const clinic = S.featurePlanForProfile('clinic', []);
ok(Object.keys(ionm).every((k) => k in both) && Object.keys(implant).every((k) => k in both), 'پلانِ دوخدمته هر دو پلان را دارد');
ok(both.accounting === 4 && both.inventory === 2, '**سطحِ بازتر (حسابداری ۴، انبار ۲)**', JSON.stringify({ a: both.accounting, i: both.inventory }));
ok(both.dispatch === ionm.dispatch && !('dispatch' in implant), 'چینش از نورومانیتورینگ می‌آید');
ok(!('dispatch' in clinic) && clinic.dashboard === 4, 'مطب پلانِ خودش');
for (const base of ['access', 'users', 'frontdesk', 'pathway', 'work']) {
  ok([both, ionm, implant, clinic].every((pl) => base in pl), `ماژولِ پایهٔ «${base}» در هر پلان هست`);
}

console.log('\n۶) اعتبارسنجیِ درخواست');
ok(S.profileError('company', []) === 'دست‌کم یک خدمت انتخاب کنید', '**شرکتِ بی‌خدمت رد می‌شود**');
ok(S.profileError('clinic', ['ionm']) !== null, 'مطب با خدمت رد می‌شود');
ok(S.profileError('company', ['dental']) !== null && S.profileError('shop', []) !== null, 'کلیدِ ناشناخته رد می‌شود');
ok(S.profileError('company', ['implant', 'ionm']) === null && S.profileError('clinic', []) === null, 'درخواستِ درست می‌گذرد');
ok(same(S.requestedProfile('company', ['implant', 'ionm']), { kind: 'company', services: ['ionm', 'implant'], primary: 'ionm' }), 'درخواست به ترتیبِ ثابت و خدمتِ اصلی تمیز می‌شود');

console.log('\n۷) تغییرِ ماژول‌ها فقط جایی که عضویت عوض شده');
const P = (k, s) => S.requestedProfile(k, s);
const rows = (plan, over = {}) => Object.entries(plan).map(([key, minLevel]) => ({ key, minLevel, enabled: true, ...(over[key] ?? {}) }));
ok(same(S.featureChanges(P('company', ['ionm']), P('company', ['ionm']), rows(ionm)), []), 'پروفایلِ بی‌تغییر ← هیچ تغییری');
let ch = S.featureChanges(P('company', ['ionm']), P('company', ['ionm', 'implant']), rows(ionm));
ok(same(ch.map((c) => `${c.key}:${c.action}:${c.minLevel}`).sort(), ['accounting:relevel:4', 'inventory:relevel:2']), 'افزودنِ ایمپلنت ← فقط سطحِ پیش‌فرضِ حسابداری و انبار', JSON.stringify(ch));
ch = S.featureChanges(P('company', ['ionm']), P('company', ['ionm', 'implant']), rows(ionm, { inventory: { minLevel: 4 }, accounting: { enabled: false } }));
ok(!ch.some((c) => c.key === 'inventory'), '**سطحِ دست‌خورده دست نمی‌خورد**', JSON.stringify(ch));
ok(!ch.some((c) => c.key === 'accounting' && c.action === 'enable'), '**ماژولِ عمداً خاموش روشن نمی‌شود**', JSON.stringify(ch));
ch = S.featureChanges(P('company', ['ionm', 'implant']), P('company', ['implant']), rows(both));
ok(same(ch.filter((c) => c.action === 'disable').map((c) => c.key).sort(), ['dispatch', 'tech']), 'برداشتنِ نورومانیتورینگ ← چینش و پنلِ کارشناسی خاموش', JSON.stringify(ch));
ch = S.featureChanges(P('company', ['implant']), P('company', ['implant', 'ionm']), rows(implant, {}).concat([{ key: 'dispatch', minLevel: 4, enabled: false }]));
ok(ch.some((c) => c.key === 'dispatch' && c.action === 'enable') && ch.some((c) => c.key === 'tech' && c.action === 'create'), 'افزودنِ نورومانیتورینگ ← خاموشِ قبلی روشن، ردیفِ نبوده ساخته', JSON.stringify(ch));
ch = S.featureChanges(P('company', ['ionm']), P('clinic', []), rows(ionm).concat([{ key: 'legacy_x', minLevel: 3, enabled: true }]));
ok(!ch.some((c) => c.key === 'legacy_x'), 'ماژولی که در هیچ پلانی نیست دست نمی‌خورد');
ok(['dispatch', 'tech', 'inventory', 'transport'].every((k) => ch.some((c) => c.key === k && c.action === 'disable')), 'شرکت ← مطب: ماژول‌های شرکتی خاموش');

console.log(`\nسبز: ${pass}  قرمز: ${fails.length}`);
if (fails.length) process.exit(1);
