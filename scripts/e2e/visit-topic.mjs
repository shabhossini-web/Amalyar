/**
 * **موضوعِ ویزیت** — ویزیتِ اولیه / پست‌آپ / زیبایی. مرحلهٔ ۱ از `docs/BOOKING.md`.
 *
 * ⚠️ چرا موضوع جدا از `Visit.kind` است و این آزمون همان را نگه می‌دارد:
 * `kind` تعیین می‌کند **کدام فرم** رندر شود (فرمِ ویزیت در برابر فرمِ جراحی)؛
 * موضوع دسته‌بندیِ **داخلِ** همان فرم است. ویزیتِ اولیه و پست‌آپ هر دو همان
 * فرمِ ویزیت را می‌گیرند ولی روزِ کاریِ متفاوتی دارند. اگر یکی می‌شدند، برای
 * هر موضوع یک فرمِ کامل لازم بود و هر تغییرِ فرم چندبار تکرار می‌شد.
 *
 * ادعا روی **خواندنِ بعد از نوشتن** است، نه پاسخِ POST — همان درسی که از
 * باگِ گم‌شدنِ `extra` گرفتیم.
 */
import { chromium } from 'playwright-core';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — سرور را ری‌استارت کنید'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());
const send = (p, method, body) => fetch(API + p, { method, headers: A, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

/* نامِ تصادفی — `name` یکتاست و اجرای دوم نباید به ردیفِ اجرای اول بخورد. */
const tag = Math.random().toString(36).slice(2, 7);
const NAME = `پست‌آپِ ${tag}`;
const cleanup = [];

console.log('۱) موضوع تعریف می‌شود و در فهرست می‌آید');
const made = (await send('/visit-topics', 'POST', { name: NAME, notes: 'ویزیتِ بعد از عمل' })).json;
if (!made?.id) { console.error('موضوع ساخته نشد:', JSON.stringify(made)); process.exit(1); }
cleanup.push(made.id);
let list = await get('/visit-topics');
ok(list.some((t) => t.id === made.id && t.name === NAME), `در فهرست هست («${NAME}»)`);
ok(list.find((t) => t.id === made.id)?.visitCount === 0, 'شمارشِ مراجعه صفر است');

console.log('\n۲) نامِ تکراری رد می‌شود');
const dup = await send('/visit-topics', 'POST', { name: NAME });
ok(dup.status >= 400, `نامِ تکراری ۴۰۰ گرفت (${dup.status})`);

console.log('\n۳) موضوع روی مراجعه می‌نشیند و بعد از خواندنِ دوباره هست');
const [kinds, sur, hos] = await Promise.all([
  get('/forms/visit-kinds'), get('/surgeons'), get('/hospitals'),
]);
const visit = (await send('/visits', 'POST', {
  kind: kinds[0]?.kind, firstName: 'موضوعِ', lastName: 'ویزیت',
  surgeonId: (sur.rows ?? sur)[0]?.id, hospitalId: (hos.rows ?? hos)[0]?.id,
  opDate: new Date().toISOString(), topicId: made.id,
})).json;
if (!visit?.id) { console.error('مراجعه ساخته نشد:', JSON.stringify(visit)); process.exit(1); }
let fresh = await get(`/visits/${visit.id}`);
ok(fresh.topicId === made.id, `موضوع ذخیره شد (${fresh.topicId})`);
ok(fresh.topicName === NAME, `و نامش هم از سرور می‌آید، نه از حدسِ کلاینت («${fresh.topicName}»)`);

console.log('\n۴) موضوع با ویرایش عوض و برداشته می‌شود');
const other = (await send('/visit-topics', 'POST', { name: `زیباییِ ${tag}` })).json;
cleanup.push(other.id);
await send(`/visits/${visit.id}`, 'PATCH', { topicId: other.id });
fresh = await get(`/visits/${visit.id}`);
ok(fresh.topicId === other.id, `ویرایش موضوع را عوض کرد (${fresh.topicName})`);
await send(`/visits/${visit.id}`, 'PATCH', { topicId: null });
fresh = await get(`/visits/${visit.id}`);
ok(fresh.topicId === null, 'و `null` صریح آن را برمی‌دارد');

console.log('\n۵) موضوعِ نامعتبر پذیرفته نمی‌شود');
const bad = await send(`/visits/${visit.id}`, 'PATCH', { topicId: 99999999 });
ok(bad.status >= 400, `موضوعِ ناموجود ۴۰۰ گرفت (${bad.status})`);

console.log('\n۶) موضوعِ استفاده‌شده حذفِ سخت نمی‌شود — خاموش می‌شود');
/* ⚠️ FK روی SetNull است، پس حذفِ سخت مراجعه را نمی‌بَرد ولی موضوعش را بی‌صدا
   پاک می‌کند و «این ویزیتِ اولیه بود یا پست‌آپ؟» بی‌جواب می‌ماند. */
await send(`/visits/${visit.id}`, 'PATCH', { topicId: made.id });
const del = await send(`/visit-topics/${made.id}`, 'DELETE');
ok(del.json?.deactivated === true, `چون مراجعه دارد فقط خاموش شد (${del.json?.visitCount} مراجعه)`);
list = await get('/visit-topics');
ok(list.some((t) => t.id === made.id && t.active === false), 'هنوز در فهرست هست ولی غیرفعال');
fresh = await get(`/visits/${visit.id}`);
ok(fresh.topicId === made.id, '**و موضوعِ مراجعهٔ ثبت‌شده دست‌نخورده ماند**');

console.log('\n۷) موضوعِ بی‌استفاده واقعاً حذف می‌شود');
const del2 = await send(`/visit-topics/${other.id}`, 'DELETE');
ok(del2.json?.deactivated === false, 'حذفِ سخت انجام شد');
list = await get('/visit-topics');
ok(!list.some((t) => t.id === other.id), 'و از فهرست رفت');

console.log('\n۸) در فرمِ مراجعه به‌شکلِ فیلدِ هسته‌ای قابلِ روشن‌کردن است');
const def = await get(`/forms/visit.${kinds[0]?.kind}`);
const row = (def.fields ?? []).find((f) => f.key === 'topicId');
ok(!!row, 'ردیفِ `topicId` در کاتالوگِ فرم هست');
ok(row?.builtin === true, 'و هسته‌ای است، نه فیلدِ سفارشی');

console.log('\n۹) وقتی روشن باشد، در فرمِ داشبورد کشیده می‌شود');
/* ادعا روی حالتِ دیده‌شده: کاتالوگ‌بودن کافی نیست، باید رندر شود. */
if (row) await send(`/forms/fields/${row.id}`, 'PATCH', { active: true });
const b = await chromium.launch({
  executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const p = await (await b.newContext({ viewport: { width: 420, height: 900 }, locale: 'fa-IR' })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
try {
  await p.goto(UI + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => localStorage.setItem('amalyar_token', t), login.accessToken);
  /* ⚠️ دیپ‌لینک به مراجعهٔ **خودِ همین آزمون** — «اولین کارتِ فهرست» ممکن
     است جامانده‌ی سوئیتِ دیگری با نوعِ دیگری باشد و برچسبِ موضوع را نداشته
     باشد؛ یک‌بار دقیقاً همین‌طور قرمز شد. */
  await p.goto(UI + `/app/dashboard?patient=${visit.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2400);
  const sheet = await p.locator('.db-sheet').innerText();
  ok(/موضوعِ ویزیت/.test(sheet), 'برچسبِ «موضوعِ ویزیت» در فرم دیده می‌شود');
  ok(new RegExp(NAME).test(sheet), `و موضوعِ تعریف‌شده در گزینه‌ها هست («${NAME}»)`);
} finally {
  await b.close();
}

console.log('\n' + '─'.repeat(50));
console.log(`قبول: ${pass}   رد: ${fail}`);
console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
await fetch(API + `/visits/${visit.id}`, { method: 'DELETE', headers: A });
for (const id of cleanup) await fetch(API + `/visit-topics/${id}`, { method: 'DELETE', headers: A });
process.exit(fail || errs.length ? 1 : 0);
