/**
 * پاپ‌آپ‌های پرونده + نامِ نوعِ مراجعه — سرورِ زنده + مرورگرِ واقعی (بازخوردِ مالک ۱۴۰۵/۰۶/۲۹).
 *
 *  باید بیفتد:
 *   - نوارِ «الان کجاییم» برای دورهٔ عمل «عمل جراحی» بنویسد نه واژهٔ حوزه/«ویزیت»
 *   - تبِ مراجعات واژهٔ خنثی «مراجعه‌ها» باشد و هر کارت نوعِ خودش (عمل جراحی / ویزیت)
 *   - کلیک روی کارتِ مراجعه فرمِ همان مراجعه را **در همین صفحه** باز کند (نه پرش به داشبورد)
 *   - «کارِ بعدی» و هر نتیجهٔ بررسی‌نشده کلیک‌پذیر باشد و شیتِ همان سفارش را با عکسِ بیمار باز کند
 *   - «بررسی شد» از همان شیت هشدار را از پرونده بردارد
 *   - ردیفِ یادآوریِ خطِ زمان پاپ‌آپِ خودش را با متنِ کامل و «لغو» باز کند
 *  نباید بیفتد:
 *   - هیچ ردیفی به `/app/dashboard?patient=` نپرد؛ هیچ خطای JS/کنسول
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
const plusD = (n) => new Date(Date.now() + n * 864e5);

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const H = { Authorization: 'Bearer ' + login.accessToken };
const send = (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

console.log('۱) داده: ویزیت با یادآوریِ ویزیتِ بعدی + آزمایشِ پاسخ‌داده، و یک عملِ پیشِ رو');
const kinds = (await send('/forms/visit-kinds')).json ?? [];
if (!kinds.some((k) => (k.kind ?? k.key) === 'clinic')) await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
const v1 = (await send('/visits', 'POST', {
  kind: 'clinic', firstName: 'بیمارِ', lastName: 'پاپ‌آپ', phone: '09120000966',
  opDate: new Date().toISOString(), nextVisitDate: plusD(7).toISOString(),
})).json;
ok('ویزیت ساخته شد', !!v1?.id, JSON.stringify(v1).slice(0, 120));
const pid = v1.patientId;
const order = (await send('/orders/lab', 'POST', { patientId: pid, visitId: v1.id, tests: ['CBC diff'] })).json;
await send(`/orders/lab/${order.id}/send`, 'POST');
const fd = new FormData();
fd.append('file', new Blob([PNG], { type: 'image/png' }), 'cbc.png');
await fetch(`${API}/public/order/${order.token}/files`, { method: 'POST', body: fd });
const ans = await fetch(`${API}/public/order/${order.token}/answer`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '', link: '', user: '', pass: '' }),
}).then((r) => r.json());
ok('آزمایش با عکس پاسخ داده شد', ans?.status === 'answered', JSON.stringify(ans));
await send('/work/process', 'POST');
const surgeon = (await send('/surgeons')).json?.[0];
const hospital = (await send('/hospitals')).json?.[0];
const v2 = (await send('/visits', 'POST', {
  kind: 'surgery', patientId: pid, firstName: 'بیمارِ', lastName: 'پاپ‌آپ', phone: '09120000966',
  opDate: plusD(3).toISOString(), surgeonId: surgeon?.id, hospitalId: hospital?.id,
})).json;
ok('عملِ پیشِ رو روی همان پرونده', v2?.patientId === pid, JSON.stringify(v2).slice(0, 120));
const live = (await send(`/patients/${pid}/live`)).json;
const visitStep = live?.stage?.steps?.find((s) => s.key === 'visit');
ok('گامِ مراجعه نوعِ دوره را می‌گوید (surgery)', visitStep?.kind === 'surgery', JSON.stringify(visitStep));
ok('ردیفِ مراجعهٔ خطِ زمان نوع و کد دارد', live?.timeline?.items?.some((it) => it.type === 'visit' && it.kind === 'surgery' && /-V\d+$/.test(it.code ?? '')));
const rems = (await send(`/reminders?patientId=${pid}`)).json ?? [];
ok('دفترِ یادآوری‌ها به‌ازای بیمار فیلتر می‌شود', Array.isArray(rems) && rems.length > 0 && rems.every((r) => r.patientName), JSON.stringify(rems.map((r) => [r.kind, r.status])));

console.log('\n۲) مرورگر — نام‌ها و پاپ‌آپ‌ها');
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 950 }, locale: 'fa-IR' });
const page = await ctx.newPage();
const errors = [];
const navs = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(f.url()); });
try {
  await browserLogin(page, login.accessToken);
  await page.goto(`${UI}/app/patients/${pid}`, { waitUntil: 'networkidle' });
  await page.locator('.rc-stage').waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);

  const steps = await page.locator('.rc-step .rc-step-txt b').allInnerTexts();
  ok('**نوارِ مرحله «عمل جراحی» می‌گوید، نه «ویزیت»/واژهٔ حوزه**', steps.includes('عمل جراحی'), steps.join(' | '));
  ok('تبِ مراجعات واژهٔ خنثی دارد', (await page.getByRole('tab', { name: /مراجعه‌ها/ }).count()) === 1);
  const kindsSeen = await page.locator('.rc-kind').allInnerTexts();
  ok('هر کارت نوعِ خودش را می‌گوید (عمل جراحی + ویزیت)', kindsSeen.includes('عمل جراحی') && kindsSeen.includes('ویزیت'), kindsSeen.join(' | '));

  console.log('\n۳) کارتِ مراجعه → فرمِ همان مراجعه در همین صفحه');
  await page.locator('.rc-visit-btn').filter({ hasText: v1.code }).first().click();
  await page.locator('.db-sheet').waitFor({ timeout: 8000 });
  ok('فرمِ مراجعه به‌صورتِ پاپ‌آپ باز شد', (await page.locator('.db-sheet-head').innerText()).includes(v1.code));
  ok('هیچ پرشی به داشبورد نبود', !navs.some((u) => u.includes('/app/dashboard')), navs.join(' | '));
  await page.locator('.db-sheet .db-x').first().click();
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 8000 });

  console.log('\n۴) کارِ بعدی و هشدارِ «نتیجه آمده» → شیتِ همان سفارش');
  ok('عنوانِ کارِ بعدی کلیک‌پذیر است', (await page.locator('.rc-next-main .wk-open').count()) === 1);
  await page.locator('.rc-next-main .wk-open').click();
  await page.locator('.od-sheet').waitFor({ timeout: 8000 });
  const thumb = await page.waitForFunction(() => { const i = document.querySelector('.od-doc-thumb img'); return !!i && i.naturalWidth > 0; }, null, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('شیتِ سفارش با عکسِ بیمار از کارِ بعدی باز شد', thumb);
  await page.locator('.od-sheet .db-x').click();
  await page.locator('.od-sheet').waitFor({ state: 'detached', timeout: 8000 });
  ok('هر نتیجهٔ بررسی‌نشده یک دکمه است', (await page.locator('.rc-chip-list button').count()) === 1);
  await page.locator('.rc-chip-list button').first().click();
  await page.locator('.od-sheet').waitFor({ timeout: 8000 });
  await page.locator('.od-review textarea').fill('نرمال');
  await page.getByRole('button', { name: 'بررسی شد', exact: true }).click();
  await page.locator('.od-sheet').waitFor({ state: 'detached', timeout: 8000 });
  await page.locator('.rc-chip-list').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  ok('**بعد از بررسی، هشدار از پرونده رفت**', (await page.locator('.rc-chip-list').count()) === 0);

  console.log('\n۵) ردیفِ یادآوری → پاپ‌آپِ خودش با لغو');
  const remRow = page.locator('.rc-tl-row button').filter({ hasText: 'یادآوری' }).first();
  await remRow.click();
  await page.locator('.rc-pop-reminder').waitFor({ timeout: 8000 });
  const popText = await page.locator('.rc-pop-reminder').innerText();
  ok('پاپ‌آپِ یادآوری متن و وضعیت را دارد', popText.includes('در صف') && popText.length > 40, popText.slice(0, 120));
  await page.getByRole('button', { name: 'لغوِ این پیام', exact: true }).click();
  await page.locator('.rc-pop-reminder').waitFor({ state: 'detached', timeout: 8000 });
  await page.locator('.rc-tl-row').filter({ hasText: 'لغو شد' }).first().waitFor({ timeout: 8000 }).catch(() => {});
  ok('لغو در خطِ زمان نشست («لغو شد»)', (await page.locator('.rc-tl-row').filter({ hasText: 'لغو شد' }).count()) >= 1);

  console.log('\n۶) ردیفِ مراجعهٔ خطِ زمان → فرمِ همان مراجعه');
  await page.locator('.rc-tl-row button').filter({ hasText: v2.code }).first().click();
  await page.locator('.db-sheet').waitFor({ timeout: 8000 });
  ok('ردیفِ مراجعه فرمِ خودش را باز کرد', (await page.locator('.db-sheet-head').innerText()).includes(v2.code));
  await page.locator('.db-sheet .db-x').first().click();
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 8000 });

  console.log('\n۷) بدونِ خطا و بدونِ پرش');
  ok('هیچ خطای JS/کنسول', errors.length === 0, errors.slice(0, 2).join(' | '));
  ok('هیچ ناوبری‌ای به داشبورد', !navs.some((u) => u.includes('/app/dashboard')), navs.join(' | '));
} finally {
  await browser.close();
}

console.log(`\nقبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
