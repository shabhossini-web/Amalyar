/**
 * نوعِ نصب + بستهٔ خدمات از `/config` — سرورِ زنده + Postgres.
 * قاعدهٔ خالص را `tenant-profile-unit.mjs` می‌سنجد؛ این‌جا فقط سیم‌کشی: همان قاعده
 * واقعاً از دو ردیفِ تنظیماتِ همین تنانت خوانده می‌شود و مسیرِ قدیمیِ «تغییرِ حوزه»
 * ردیفِ خدمات را جا نمی‌گذارد.
 *
 *  باید بیفتد:
 *   - ردیفِ `services`ِ دوخدمته در `/config` دیده می‌شود (خواننده واقعاً وصل است)
 *   - `PATCH /config/vertical` ردیفِ `services` را پاک می‌کند (ردیفِ جامانده = دو منبعِ ناهم‌خوان)
 *   - سوییچ به مطب ← `kind: clinic` و بی‌خدمت
 *  نباید بیفتد:
 *   - فیلدهای قدیمیِ `/config` (`vertical`, `verticalLabel`, `defaultKind`) سرِ جایشان‌اند
 *   - خواندنِ `/config` هیچ ردیفی در `features` عوض نمی‌کند
 *   - نصبِ بی‌ردیفِ خدمات ← شرکتی با همان یک خدمتِ `vertical`
 */
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
let pass = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { Authorization: 'Bearer ' + login.accessToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const cfg = async () => (await send('/config')).json;
const features = () => sql(`SELECT string_agg(key||':'||min_level||':'||enabled, ',' ORDER BY key) FROM features`);

const c0 = await cfg();
const v0 = c0.vertical;
const servicesRow0 = sql(`SELECT value FROM settings WHERE key='services'`);
try {
  console.log('۱) فیلدهای قدیمی و نصبِ بی‌ردیف (نباید بیفتد)');
  ok('vertical/verticalLabel/defaultKind سرِ جایشان‌اند', !!c0.vertical && !!c0.verticalLabel && !!c0.defaultKind, JSON.stringify({ v: c0.vertical, d: c0.defaultKind }));
  sql(`DELETE FROM settings WHERE key='services'`);
  const f0 = features();
  const c1 = await cfg();
  const want = c1.vertical === 'clinic' ? { kind: 'clinic', services: [] } : { kind: 'company', services: [c1.vertical] };
  ok('بی‌ردیفِ خدمات ← همان یک خدمتِ vertical', same({ kind: c1.kind, services: c1.services }, want), JSON.stringify({ kind: c1.kind, services: c1.services }));
  ok('کاتالوگِ نوع‌ها و خدمات از سرور می‌آید', same(c1.kinds?.map((k) => k.key), ['clinic', 'company']) && same(c1.serviceCatalog?.map((k) => k.key), ['ionm', 'implant']));
  ok('خواندنِ /config ماژول‌ها را دست نمی‌زند', features() === f0);

  console.log('\n۲) ردیفِ دوخدمته روی یک شرکت (باید بیفتد)');
  let r = await send('/config/vertical', 'PATCH', { vertical: 'ionm' });
  ok('سوییچ به ionm', r.status === 200, String(r.status));
  sql(`INSERT INTO settings (key, value) VALUES ('services', '["implant","ionm"]') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const c2 = await cfg();
  ok('**/config بستهٔ دوخدمته را از ردیفِ همین تنانت می‌خواند**', c2.kind === 'company' && same(c2.services, ['ionm', 'implant']), JSON.stringify(c2.services));
  ok('برچسبِ پروفایل هر دو خدمت را می‌گوید', /نورومانیتورینگ/.test(c2.profileLabel) && /ایمپلنت/.test(c2.profileLabel), c2.profileLabel);
  ok('vertical همچنان خدمتِ اصلی است، نه «company»', c2.vertical === 'ionm');

  console.log('\n۳) مسیرِ قدیمیِ «تغییرِ حوزه» ردیف را جا نمی‌گذارد (باید بیفتد)');
  r = await send('/config/vertical', 'PATCH', { vertical: 'implant' });
  ok('سوییچ به implant', r.status === 200, String(r.status));
  ok('**ردیفِ services پاک شد**', sql(`SELECT count(*) FROM settings WHERE key='services'`) === '0');
  const c3 = await cfg();
  ok('شرکتی با [ایمپلنت]', c3.kind === 'company' && same(c3.services, ['implant']), JSON.stringify(c3.services));

  console.log('\n۴) مطب');
  sql(`INSERT INTO settings (key, value) VALUES ('services', '["ionm"]') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  r = await send('/config/vertical', 'PATCH', { vertical: 'clinic' });
  const c4 = await cfg();
  ok('**مطب ← kind=clinic و بی‌خدمت**', c4.kind === 'clinic' && same(c4.services, []), JSON.stringify({ k: c4.kind, s: c4.services }));
  sql(`INSERT INTO settings (key, value) VALUES ('services', '["ionm"]') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const c5 = await cfg();
  ok('ردیفِ جامانده روی مطب اثری ندارد', c5.kind === 'clinic' && same(c5.services, []));
} finally {
  await send('/config/vertical', 'PATCH', { vertical: v0 });
  sql(`DELETE FROM settings WHERE key='services'`);
  if (servicesRow0) sql(`INSERT INTO settings (key, value) VALUES ('services', '${servicesRow0.replace(/'/g, "''")}')`);
}
console.log(`\nسبز: ${pass}  قرمز: ${fails.length}`);
if (fails.length) process.exit(1);
