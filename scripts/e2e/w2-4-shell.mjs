/**
 * W2.4 — پوستهٔ سراسری در مرورگرِ واقعی:
 * - نوارِ بالا روی چند صفحهٔ /app هست و منوی پروفایل **یک‌بار** رندر می‌شود (نه دوبار)
 * - Ctrl+K پالتِ جستجو را باز می‌کند؛ تایپِ نام ← نتیجه از /search/patients ← Enter پرونده را باز می‌کند
 * - Escape می‌بندد؛ `/` وقتی در فیلدی نیستی باز می‌کند و وقتی در فیلدی هستی باز نمی‌کند
 * - زنگ: شمارنده بعد از ساختِ کار بالا می‌رود؛ «انجام شد» از کشو آن را پایین می‌آورد
 * - صفحهٔ /app/work فهرست را نشان می‌دهد
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { browserLogin } from './lib/browser-login.mjs';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'sh' + randomBytes(3).toString('hex');
const trash = { visits: [], forms: [], work: [] };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[console.${m.type()}] ${m.text()}`); });
page.on('response', (r) => { if (r.url().includes('/api/work') && r.request().method() !== 'GET') console.log(`    ↳ ${r.request().method()} ${r.url().replace(API, '')} → ${r.status()}`); });

try {
  await browserLogin(page, login.accessToken, { ui: UI });
  const form = (await send('/forms', 'POST', { key: tag, title: `ویزیتِ ${tag}`, scope: 'visit' })).json;
  trash.forms.push(form.id);
  const visit = (await send('/visits', 'POST', { kind: tag, firstName: 'گلنار', lastName: `پوسته‌${tag}`, phone: '09120000913', opDate: new Date().toISOString() })).json;
  trash.visits.push(visit.id);
  const patientId = visit.patientId ?? visit.patient?.id;

  console.log('۱) نوارِ سراسری');
  await page.goto(UI + '/app/dashboard', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sh-bar', { timeout: 15000 });
  ok(await page.locator('.sh-bar').count() === 1, 'نوارِ بالا روی داشبورد هست');
  ok(await page.locator('.pm-chip').count() === 1, 'منوی پروفایل دقیقاً یک‌بار رندر شده (نه دوبار)');
  await page.goto(UI + '/app/reminders', { waitUntil: 'networkidle' });
  ok(await page.locator('.sh-bar').count() === 1 && await page.locator('.pm-chip').count() === 1, 'روی یادآوری‌ها هم هست — صفحه‌ای که قبلاً هیچ منویی نداشت');

  console.log('\n۲) جستجوی سراسری');
  await page.keyboard.press('Control+K');
  await page.waitForSelector('#gs-input', { timeout: 5000 });
  ok(await page.locator('#gs-input').evaluate((el) => el === document.activeElement), 'Ctrl+K پالت را باز می‌کند و فوکوس داخلِ آن است');
  await page.keyboard.type(`پوسته‌${tag}`);
  await page.waitForSelector('#gs-list li[role="option"]', { timeout: 8000 });
  const names = await page.locator('#gs-list li[role="option"] .gs-name').allTextContents();
  ok(names.some((n) => n.includes(`پوسته‌${tag}`)), `نتیجه از /search/patients آمد (${names.length})`);
  await page.keyboard.press('Enter');
  await page.waitForURL(`**/app/patients/${patientId}`, { timeout: 8000 });
  ok(page.url().endsWith(`/app/patients/${patientId}`), 'Enter پروندهٔ همان بیمار را باز کرد');
  ok(await page.locator('#gs-input').count() === 0, 'و پالت بسته شد');
  await page.keyboard.press('/');
  await page.waitForSelector('#gs-input', { timeout: 5000 });
  ok(true, '«/» بیرونِ فیلد پالت را باز می‌کند');
  await page.keyboard.press('Escape');
  ok(await page.locator('#gs-input').count() === 0, 'Escape می‌بندد');
  await page.goto(UI + '/app/work', { waitUntil: 'networkidle' });
  await page.focus('#wk-new-title');
  await page.keyboard.type('/');
  ok(await page.locator('#gs-input').count() === 0 && (await page.inputValue('#wk-new-title')) === '/', '**نباید بیفتد:** «/» داخلِ فیلد پالت را باز نمی‌کند و خودِ حرف تایپ می‌شود');
  await page.fill('#wk-new-title', '');

  console.log('\n۳) زنگِ کارها');
  const before = (await send('/work/counts', 'GET')).json;
  const created = (await send('/work', 'POST', { title: `تماس با گلنار ${tag}`, patientId, priority: 2 })).json;
  trash.work.push(created.id);
  await page.evaluate(() => window.dispatchEvent(new Event('amalyar:work-changed')));
  await page.waitForFunction((n) => { const b = document.querySelector('#wb-btn .wb-badge'); return b && Number(b.dataset.count) >= n; }, before.total + 1, { timeout: 8000 });
  ok(true, `شمارندهٔ زنگ به ${before.total + 1} رسید`);
  await page.click('#wb-btn');
  await page.waitForSelector('.wb-menu .wk-row', { timeout: 8000 });
  const row = page.locator(`.wb-menu .wk-row[data-work-id="${created.id}"]`);
  ok(await row.count() === 1, 'کارِ تازه در کشوی زنگ است');
  ok((await row.locator('.wk-patient').textContent()).includes('گلنار'), 'با نامِ بیمار (enrichِ سرور)');
  await row.locator('.wk-btn.primary').click();
  const gone = await page.waitForFunction((id) => !document.querySelector(`.wb-menu .wk-row[data-work-id="${id}"]`), created.id, { timeout: 8000 }).then(() => true).catch(() => false);
  ok(gone, 'ردیف بعد از «انجام شد» از کشو رفت');
  const after = (await send('/work/counts', 'GET')).json;
  ok(after.total === before.total, '«انجام شد» از کشو کار را بست و شمارنده برگشت');
  ok((await send(`/work?scope=mine&state=done`, 'GET')).json.some((w) => w.id === created.id), 'در سرور done است');

  console.log('\n۴) سلامتِ صفحه');
  ok(errors.length === 0, `بدونِ خطای جاوااسکریپت (${errors.length})`);
  if (errors.length) console.log(errors.slice(0, 3));
} finally {
  await browser.close().catch(() => {});
  for (const id of trash.work) await send(`/work/${id}`, 'PATCH', { action: 'cancel', reason: 'e2e' }).catch(() => {});
  for (const v of trash.visits) await send(`/visits/${v}`, 'DELETE').catch(() => {});
  for (const f of trash.forms) await send(`/forms/${f}`, 'DELETE').catch(() => {});
}
console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
