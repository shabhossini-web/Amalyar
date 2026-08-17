/**
 * تعرفه‌های سراسری (دیتابیسِ کنترل) + بخشِ نیروهای مسلح:
 * - ردیفِ سراسری در کنترل → در فهرستِ تعرفهٔ شرکت با نشانِ source='central'
 * - فی (priceOf) بدونِ هیچ ضریبِ محلی از سراسری حساب می‌شود
 * - ضریبِ اختصاصیِ شرکت برای همان (سال، بخش) بر سراسری مقدم است
 * - بخشِ «نیروهای مسلح» هم در سراسری هم در محلی پذیرفته می‌شود
 * - endpointهای پلتفرم بدونِ نشست ۴۰۱ می‌دهند
 */
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const CTRL = process.env.E2E_CTRL_DB ?? 'postgresql://amal:amal@localhost:5432/ctrl_ui';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (db, q) => execSync(`psql "${db}" -qtA`, { input: q }).toString().trim().split('\n')[0];

/* سالِ آزمایشی دور از واقعیت تا با دادهٔ کاربر نخورد. */
const YEAR = '1499';

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

try {
  console.log('۱) ردیفِ سراسری در کنترل');
  sql(CTRL, `INSERT INTO central_tariffs (year, sector, professional, technical, anesthesia)
             VALUES ('${YEAR}', 'military', 2000, 1000, 500)
             ON CONFLICT (year, sector) DO UPDATE SET professional=2000, technical=1000, anesthesia=500, active=true`);
  const list1 = (await send('/service-codes/tariffs', 'GET')).json;
  const central = list1.find((t) => t.year === YEAR && t.sector === 'military');
  ok(!!central, 'در فهرستِ تعرفهٔ شرکت دیده می‌شود');
  ok(central?.source === 'central', '**با نشانِ «سراسری»**');
  ok(central?.sectorLabel === 'نیروهای مسلح', 'برچسبِ بخش: نیروهای مسلح');

  console.log('\n۲) فی از ضریبِ سراسری');
  const hit = (await send('/service-codes?q=900', 'GET')).json?.[0];
  ok(!!hit?.code, `کدی از کتاب پیدا شد (${hit?.code ?? '—'})`);
  const p1 = (await send(`/service-codes/price?code=${hit.code}&year=${YEAR}&sector=military`, 'GET')).json;
  ok(p1?.price !== null && p1?.tariff?.sector === 'military' && p1?.tariff?.year === YEAR,
    '**فی بدونِ هیچ ضریبِ محلی، از سراسری حساب شد**');
  const want = Math.round((hit.rvuProfessional ?? 0) * 2000 / 1000) + Math.round((hit.rvuTechnical ?? 0) * 1000 / 1000);
  ok(p1?.price === want, `و مبلغ درست است (${p1?.price} = ${want})`);

  console.log('\n۳) ضریبِ اختصاصیِ شرکت مقدم است');
  const setRes = await send('/service-codes/tariffs', 'POST', {
    year: YEAR, sector: 'military', professional: 4000, technical: 2000, anesthesia: 1000,
  });
  ok(setRes.status === 201 || setRes.status === 200, `ضریبِ محلی با بخشِ نیروهای مسلح ثبت شد (${setRes.status})`);
  const list2 = (await send('/service-codes/tariffs', 'GET')).json;
  const rows = list2.filter((t) => t.year === YEAR && t.sector === 'military');
  ok(rows.length === 1 && rows[0].source === 'local', '**در فهرست فقط ردیفِ اختصاصی مانده (سراسری زیرش پنهان است)**');
  const p2 = (await send(`/service-codes/price?code=${hit.code}&year=${YEAR}&sector=military`, 'GET')).json;
  ok(p2?.price === want * 2, `فی حالا از ضریبِ اختصاصی است (${p2?.price} = ${want * 2})`);

  console.log('\n۴) پنلِ پلتفرم پشتِ نشست است');
  const g = await fetch(API + '/platform/tariffs');
  ok(g.status === 401, `GET بدونِ نشست: ${g.status}`);
  const po = await fetch(API + '/platform/tariffs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: YEAR, sector: 'private', professional: 1, technical: 1, anesthesia: 1 }),
  });
  ok(po.status === 401, `POST بدونِ نشست: ${po.status}`);
} finally {
  sql(DB, `DELETE FROM tariffs WHERE year='${YEAR}'`);
  sql(CTRL, `DELETE FROM central_tariffs WHERE year='${YEAR}'`);
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
