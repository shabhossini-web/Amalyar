/**
 * جراحیِ داخلِ مطب — کدهای داخلی + دو نظامِ کد روی فاکتورِ «با کد»:
 * - CRUD کدِ داخلی در تعاریف پایه (کد یکتا، مبلغِ مصوب)
 * - قلمِ فاکتور با codeSystem=internal فقط با کدِ تعریف‌شده و فعال پذیرفته می‌شود
 * - کدِ کتاب همچنان فقط رقمی است؛ منبعِ کد روی قلم می‌ماند
 * - جستجوی /internal-codes?q= برای انتخاب در صورت‌حساب
 * - حذفِ کدِ استفاده‌شده → غیرفعال، نه حذف
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

const tag = 'ic' + randomBytes(3).toString('hex');
const CODE = 'OFC-' + tag.slice(2, 6).toUpperCase();
const trash = { forms: [], visits: [], codes: [] };

try {
  console.log('۱) تعریفِ کدِ داخلی');
  const created = await send('/internal-codes', 'POST', { code: CODE.toLowerCase(), name: `تزریقِ ${tag}`, price: 800_000 });
  ok(created.status === 201 || created.status === 200, `ساخته شد (${created.status})`);
  trash.codes.push(created.json.id);
  ok(created.json.code === CODE, '**کد نرمال (uppercase) ذخیره می‌شود**');
  ok((await send('/internal-codes', 'POST', { code: CODE, name: 'تکراری', price: 1 })).status === 400,
    'کدِ تکراری رد می‌شود');
  const hits = (await send(`/internal-codes?q=${CODE.slice(0, 5)}`, 'GET')).json;
  ok(hits.some((h) => h.code === CODE), 'جستجو با کد پیدا می‌کند');
  const byName = (await send(`/internal-codes?q=${encodeURIComponent('تزریقِ ' + tag)}`, 'GET')).json;
  ok(byName.some((h) => h.code === CODE), 'جستجو با نام هم پیدا می‌کند');

  console.log('\n۲) قلمِ فاکتور با دو نظامِ کد');
  const form = (await send('/forms', 'POST', { key: tag, title: 'داخلِ مطب', scope: 'visit' })).json;
  trash.forms.push(form.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'مطبی', phone: '09120000916', opDate: new Date().toISOString(),
  })).json;
  trash.visits.push(visit.id);

  const chInternal = await send(`/visits/${visit.id}/charges`, 'POST', {
    kind: 'service', title: 'تزریق', quantity: 1, unitPrice: 800_000, serviceCode: CODE, codeSystem: 'internal',
  });
  ok(chInternal.status === 201 || chInternal.status === 200, `قلم با کدِ داخلی ثبت شد (${chInternal.status})`);
  const chBook = await send(`/visits/${visit.id}/charges`, 'POST', {
    kind: 'service', title: 'مانیتورینگ', quantity: 1, unitPrice: 1_000_000, serviceCode: '900000', codeSystem: 'book',
  });
  ok(chBook.status === 201 || chBook.status === 200, 'قلم با کدِ کتاب هم ثبت شد');
  const b = (await send(`/visits/${visit.id}/billing`, 'GET')).json;
  const rowI = b.charges.find((c) => c.serviceCode === CODE);
  const rowB = b.charges.find((c) => c.serviceCode === '900000');
  ok(rowI?.codeSystem === 'internal' && rowB?.codeSystem === 'book', '**منبعِ کد روی هر قلم مانده**');

  console.log('\n۳) قاعده‌های سخت');
  ok((await send(`/visits/${visit.id}/charges`, 'POST', {
    kind: 'service', title: 'کدِ ناموجود', quantity: 1, unitPrice: 1000, serviceCode: 'NOPE-99', codeSystem: 'internal',
  })).status === 400, 'کدِ داخلیِ تعریف‌نشده رد می‌شود');
  ok((await send(`/visits/${visit.id}/charges`, 'POST', {
    kind: 'service', title: 'کدِ کتابِ حرفی', quantity: 1, unitPrice: 1000, serviceCode: 'ABC-1', codeSystem: 'book',
  })).status === 400, 'کدِ کتاب باید رقمی باشد');
  await send(`/internal-codes/${created.json.id}`, 'PATCH', { active: false });
  ok((await send(`/visits/${visit.id}/charges`, 'POST', {
    kind: 'service', title: 'غیرفعال', quantity: 1, unitPrice: 1000, serviceCode: CODE, codeSystem: 'internal',
  })).status === 400, '**کدِ غیرفعال هم رد می‌شود**');
  await send(`/internal-codes/${created.json.id}`, 'PATCH', { active: true });

  console.log('\n۴) حذفِ کدِ استفاده‌شده = غیرفعال‌سازی');
  const del = (await send(`/internal-codes/${created.json.id}`, 'DELETE')).json;
  ok(del.deactivated === true, 'به‌جای حذف، غیرفعال شد (در فاکتور استفاده شده)');
  const after = (await send(`/internal-codes?q=${CODE.slice(0, 5)}`, 'GET')).json.find((h) => h.code === CODE);
  ok(after && after.active === false && after.usedCount === 1, `و شمارِ استفاده‌اش پیداست (${after?.usedCount})`);
} finally {
  sql(`DELETE FROM charges WHERE visit_id IN (SELECT id FROM visits WHERE kind='${tag}')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}'`);
  sql(`DELETE FROM patients WHERE last_name='مطبی' AND id NOT IN (SELECT patient_id FROM visits)`);
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM internal_codes WHERE code='${CODE}'`);
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
