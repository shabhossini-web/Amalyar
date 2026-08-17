/**
 * دو مدلِ قیمت‌گذاریِ فاکتور (گلوبال / با کد):
 * - پیش‌فرض coded: جمعِ اقلام = مبلغِ فاکتور
 * - گلوبال: مبلغِ توافقی مبنای total/due است؛ جمعِ اقلام جدا (itemsTotal) برمی‌گردد
 * - فهرستِ مراجعات (enrich) و سورت/فیلترِ مالی همان عددِ گلوبال را می‌بینند
 * - اعتبارسنجی: گلوبالِ بی‌مبلغ و مدلِ ناشناخته رد می‌شوند
 * - برگشت به coded مبلغِ توافقی را پاک می‌کند
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'im' + randomBytes(3).toString('hex');
const PHONE = '09120000914';
const trash = { forms: [], visits: [] };

try {
  console.log('۱) مراجعه با دو قلم — مدلِ پیش‌فرض coded');
  const form = (await send('/forms', 'POST', { key: tag, title: 'فاکتورِ آزمون', scope: 'visit' })).json;
  trash.forms.push(form.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'فاکتور', phone: PHONE, opDate: new Date().toISOString(),
  })).json;
  trash.visits.push(visit.id);
  await send(`/visits/${visit.id}/charges`, 'POST', { kind: 'service', title: 'مانیتورینگ', quantity: 1, unitPrice: 3_000_000, serviceCode: '900000' });
  await send(`/visits/${visit.id}/charges`, 'POST', { kind: 'service', title: 'ستِ مصرفی', quantity: 2, unitPrice: 500_000 });
  let b = (await send(`/visits/${visit.id}/billing`, 'GET')).json;
  ok(b.pricingModel === 'coded', 'مدلِ پیش‌فرض coded است');
  ok(b.total === 4_000_000 && b.itemsTotal === 4_000_000, `جمعِ اقلام مبناست (${b.total})`);

  console.log('\n۲) گلوبال — مبلغِ توافقی مبنا می‌شود');
  const g = await send(`/visits/${visit.id}/billing/pricing`, 'POST', { pricingModel: 'global', globalAmount: 10_000_000 });
  ok(g.status === 201 || g.status === 200, `ذخیره شد (${g.status})`);
  b = g.json;
  ok(b.pricingModel === 'global' && b.globalAmount === 10_000_000, 'مدل و مبلغ برگشتند');
  ok(b.total === 10_000_000, '**total = مبلغِ توافقی، نه جمعِ اقلام**');
  ok(b.itemsTotal === 4_000_000, 'جمعِ اقلام جدا برمی‌گردد (برای نمایشِ تفاوت)');
  ok(b.due === 10_000_000, 'مانده از توافقی حساب می‌شود');

  await send(`/visits/${visit.id}/payments`, 'POST', { amount: 2_000_000, method: 'cash' });
  b = (await send(`/visits/${visit.id}/billing`, 'GET')).json;
  ok(b.due === 8_000_000, `پرداخت از توافقی کم می‌شود (${b.due})`);

  console.log('\n۳) فهرست و سورتِ مالی همان عدد را می‌بینند');
  const single = (await send(`/visits/${visit.id}`, 'GET')).json;
  ok(single.total === 10_000_000 && single.due === 8_000_000 && single.pricingModel === 'global',
    '**enrich (کارت/فهرست) total و due گلوبال دارد**');
  const list = (await send(`/visits?q=${PHONE}&sort=due&dir=desc&owing=1`, 'GET')).json;
  const row = (list.rows ?? list).find?.((r) => r.id === visit.id);
  ok(!!row && row.total === 10_000_000, 'مسیرِ سورت/فیلترِ مالی هم گلوبال را می‌بیند');

  console.log('\n۴) اعتبارسنجی');
  ok((await send(`/visits/${visit.id}/billing/pricing`, 'POST', { pricingModel: 'global' })).status === 400,
    'گلوبالِ بی‌مبلغ رد می‌شود');
  ok((await send(`/visits/${visit.id}/billing/pricing`, 'POST', { pricingModel: 'weird' })).status === 400,
    'مدلِ ناشناخته رد می‌شود');
  ok((await send(`/visits/${visit.id}/billing/pricing`, 'POST', { pricingModel: 'global', globalAmount: -5 })).status === 400,
    'مبلغِ منفی رد می‌شود');

  console.log('\n۵) برگشت به coded');
  b = (await send(`/visits/${visit.id}/billing/pricing`, 'POST', { pricingModel: 'coded' })).json;
  ok(b.pricingModel === 'coded' && b.globalAmount === null, 'مدل برگشت و مبلغِ توافقی پاک شد');
  ok(b.total === 4_000_000 && b.due === 2_000_000, `جمعِ اقلام دوباره مبناست (${b.total} / ماندهٔ ${b.due})`);
} finally {
  sql(`DELETE FROM payments WHERE visit_id IN (SELECT id FROM visits WHERE kind='${tag}')`);
  sql(`DELETE FROM charges WHERE visit_id IN (SELECT id FROM visits WHERE kind='${tag}')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}'`);
  sql(`DELETE FROM patients WHERE last_name='فاکتور' AND id NOT IN (SELECT patient_id FROM visits)`);
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
