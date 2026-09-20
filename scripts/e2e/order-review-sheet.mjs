/**
 * پاسخِ بیمار در شیتِ سفارش + تصمیمِ بررسی — سرورِ زنده + مرورگرِ واقعی.
 *
 * باگِ میدانی (مالک، ۱۴۰۵/۰۶/۲۹): عکسی که بیمار برای مشاوره/آزمایش فرستاده بود
 * از داخلِ فرمِ سفارش دیده نمی‌شد («فرم خالی از عکس»)، و پزشک هیچ دکمه‌ای برای
 * «بررسی شد» نداشت — سفارش تا ابد «نتیجه آمد — بررسی نشده» می‌ماند و پرونده
 * «۲ نتیجه آمده و بررسی نشده» را نگه می‌داشت.
 *
 *  باید بیفتد:
 *   - شیتِ سفارشِ پاسخ‌داده‌شده بندانگشتیِ عکسِ بیمار را **واقعاً** رندر کند (naturalWidth > 0)
 *   - وضعیتِ «نتیجه آمد — بررسی نشده» دیده شود
 *   - «بررسی شد» با یادداشت، سفارش را `reviewed` کند و کارِ `review_result` بسته شود
 *  نباید بیفتد:
 *   - «بررسی شد» بدونِ یادداشت درخواستی به سرور بفرستد
 *   - هیچ خطای JS/کنسول (کوکی پیش از اولین ناوبری — قاعدهٔ README)
 */
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const H = { Authorization: 'Bearer ' + login.accessToken };
const send = (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

/* PNGِ ۱×۱ واقعی — همان چیزی که دوربینِ موبایل می‌دهد، در کوچک‌ترین شکلش. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

console.log('۱) سفارشِ آزمایش که بیمار با عکس جواب داده');
/* بلوکِ «تصمیم/سفارش‌ها» فقط در فرمِ **ویزیت** است (نه عمل) — پس ویزیت لازم است؛
   نوعِ clinic اگر در این نصب فرم ندارد، مثلِ postop-visit ساخته می‌شود. */
const kinds = (await send('/forms/visit-kinds')).json ?? [];
if (!kinds.some((k) => (k.kind ?? k.key) === 'clinic')) await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
const visit = (await send('/visits', 'POST', {
  kind: 'clinic', firstName: 'بیمارِ', lastName: 'شیتِ سفارش', phone: '09120000955', opDate: new Date().toISOString(),
})).json;
ok('مراجعه ساخته شد', !!visit?.id, JSON.stringify(visit).slice(0, 160));
const order = (await send('/orders/lab', 'POST', { patientId: visit.patientId, visitId: visit.id, tests: ['CBC diff', 'ESR'] })).json;
ok('سفارشِ آزمایش با توکنِ عمومی', !!order?.id && !!order?.token, JSON.stringify(order).slice(0, 160));
const sent = (await send(`/orders/lab/${order.id}/send`, 'POST')).json;
ok('برای بیمار فرستاده شد (stub)', sent?.ok === true, JSON.stringify(sent));

const fd = new FormData();
fd.append('file', new Blob([PNG], { type: 'image/png' }), 'result.png');
const up = await fetch(`${API}/public/order/${order.token}/files`, { method: 'POST', body: fd });
ok('بیمار عکسِ جواب را فرستاد', up.ok, `HTTP ${up.status}`);
const ans = await fetch(`${API}/public/order/${order.token}/answer`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '', link: '', user: '', pass: '' }),
}).then((r) => r.json());
ok('پاسخ با فایلِ تنها ثبت شد', ans?.status === 'answered', JSON.stringify(ans));

const byVisit = async () => ((await send(`/orders?visitId=${visit.id}`)).json ?? []).find((o) => o.kind === 'lab' && o.id === order.id);
let row = await byVisit();
ok('سفارش «answered» و مدرکِ عکس همراهش می‌آید', row?.status === 'answered' && (row?.documents ?? []).some((d) => String(d.mimeType).startsWith('image/')),
  `status=${row?.status} docs=${(row?.documents ?? []).map((d) => d.mimeType).join(',')}`);

/* کارِ «بررسیِ نتیجه» از رویدادِ order.answered ساخته می‌شود (work-rules). workerِ
   رویداد هر چند دقیقه یک‌بار می‌دود، پس مثلِ w2-2 پردازش با `/work/process` صدا زده می‌شود. */
const reviewWork = async () => {
  await send('/work/process', 'POST');
  const r = (await send(`/work?scope=patient&patientId=${visit.patientId}&limit=50`)).json;
  return Array.isArray(r) ? r : (r?.items ?? []);
};
let work = [];
for (let i = 0; i < 6 && !(work = await reviewWork()).some((w) => w.type === 'review_result'); i++) await sleep(500);
ok('کارِ بررسیِ نتیجه باز است', work.some((w) => w.type === 'review_result' && ['open', 'blocked'].includes(w.state ?? 'open')),
  JSON.stringify(work.map((w) => [w.type, w.state])).slice(0, 200));

console.log('\n۲) مرورگر — شیتِ سفارش عکسِ بیمار و دکمهٔ بررسی را دارد');
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 950 }, locale: 'fa-IR' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
try {
  /* کوکیِ نشست **پیش از** اولین ناوبری (README: مسابقهٔ ۴۰۱ در کنسول). */
  await browserLogin(page, login.accessToken);
  await page.goto(`${UI}/app/dashboard?patient=${visit.id}`, { waitUntil: 'networkidle' });
  await page.locator('.db-orders .db-order').first().waitFor({ timeout: 15000 });
  await page.locator('.db-orders .db-order button').first().click();
  await page.locator('.od-sheet').waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);

  const status = await page.locator('.od-status').innerText().catch(() => '');
  ok('وضعیتِ «نتیجه آمد — بررسی نشده» در شیت', status.includes('بررسی نشده'), status);
  const thumbLoaded = await page.waitForFunction(() => {
    const i = document.querySelector('.od-doc-thumb img');
    return !!i && i.naturalWidth > 0;
  }, null, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('**بندانگشتیِ عکسِ بیمار واقعاً رندر شد** (باگِ «فرم خالی از عکس»)', thumbLoaded);
  ok('دکمه‌های تصمیم هستند', (await page.getByRole('button', { name: 'بررسی شد', exact: true }).count()) === 1
    && (await page.getByRole('button', { name: /ناقص است/ }).count()) === 1);

  await page.getByRole('button', { name: 'بررسی شد', exact: true }).click();
  await page.waitForTimeout(600);
  row = await byVisit();
  ok('بدونِ یادداشت چیزی به سرور نرفت', row?.status === 'answered' && (await page.locator('.od-sheet').count()) === 1, `status=${row?.status}`);

  await page.locator('.od-review textarea').fill('نرمال — نیاز به اقدام ندارد');
  await page.getByRole('button', { name: 'بررسی شد', exact: true }).click();
  await page.locator('.od-sheet').waitFor({ state: 'detached', timeout: 8000 });
  row = await byVisit();
  ok('**سفارش reviewed شد و یادداشت نشست**', row?.status === 'reviewed' && row?.reviewNote === 'نرمال — نیاز به اقدام ندارد',
    `status=${row?.status} note=${row?.reviewNote}`);

  for (let i = 0; i < 6 && (work = await reviewWork()).some((w) => w.type === 'review_result' && ['open', 'blocked'].includes(w.state ?? 'open')); i++) await sleep(500);
  ok('کارِ بررسیِ نتیجه با رویدادِ order.reviewed بسته شد', !work.some((w) => w.type === 'review_result' && ['open', 'blocked'].includes(w.state ?? 'open')),
    JSON.stringify(work.map((w) => [w.type, w.state])).slice(0, 200));

  console.log('\n۳) بدونِ خطای جاوااسکریپت');
  ok('هیچ خطای JS/کنسول', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

console.log(`\nقبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
