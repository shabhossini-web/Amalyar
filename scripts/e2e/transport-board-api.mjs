/**
 * تختهٔ روزِ حمل‌ونقل از راهِ **HTTP واقعی** — سرور، گاردها و ValidationPipe.
 *
 * سوییتِ سرویس‌محورِ `transport-board.mjs` کنترلر را دور می‌زند؛ یک بار همین خلأ باعث شد
 * `GET /routes/board` در تولید با «Validation failed (numeric string is expected)» بیفتد
 * و هیچ سنجه‌ای نبیندش. این سوییت درخواست را مثلِ مرورگر می‌فرستد.
 */
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); } };
const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }) }).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { Authorization: 'Bearer ' + login.accessToken, ...(b !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const day = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

const b = await send(`/routes/board?on=${day}`);
ok('GET /routes/board = ۲۰۰ (نه مسیرِ :id)', b.status === 200, `${b.status} ${JSON.stringify(b.json)?.slice(0, 160)}`);
ok('شکلِ پاسخ: hospitals / drivers / runs / summary', Array.isArray(b.json?.hospitals) && Array.isArray(b.json?.drivers) && Array.isArray(b.json?.runs) && typeof b.json?.summary?.hospitals === 'number');
const noOn = await send('/routes/board');
ok('بدونِ on → امروز، ۲۰۰', noOn.status === 200, String(noOn.status));
const bad = await send('/routes/board?on=zzz');
ok('تاریخِ نامعتبر → ۴۰۰ با پیامِ فارسی', bad.status === 400 && /تاریخ/.test(JSON.stringify(bad.json)), `${bad.status} ${JSON.stringify(bad.json)}`);
const empty = await send('/routes/board/delivery', 'POST', { on: day, hospitalId: 999999 });
ok('ثبتِ تحویل برای بیمارستانِ ناموجود → ۴۰۴ (نه ۵۰۰)', empty.status === 404, `${empty.status} ${JSON.stringify(empty.json)}`);
const rm = await send('/routes/board/delivery/999999', 'DELETE');
ok('حذفِ تحویلِ ناموجود → ۴۰۴', rm.status === 404, String(rm.status));
const rt = await send('/routes/board/transfer/999999', 'DELETE');
ok('برداشتنِ حوالهٔ ناموجود → ۴۰۴', rt.status === 404, String(rt.status));
const legacy = await Promise.all([`/routes/day?on=${day}`, `/routes/unassigned?on=${day}`, '/routes/pickup-queue', '/routes/stops/unassigned'].map((p) => send(p)));
ok('چهار درخواستِ بخشِ «مسیرِ راننده‌ها» هم ۲۰۰ است', legacy.every((r) => r.status === 200), JSON.stringify(legacy.map((r) => r.status)));

console.log(`\n${pass} سبز · ${fails.length} قرمز`);
if (fails.length) { console.log('قرمزها:\n - ' + fails.join('\n - ')); process.exit(1); }
