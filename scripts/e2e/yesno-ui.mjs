/**
 * چکِ چشمیِ فرمِ مستقیمِ زیرپرونده روی موبایل:
 * - تقویمِ «روزِ نوبت» نباید باشد (نظرسنجی مراجعه نمی‌سازد)
 * - بله/خیر باید دو پیلِ استایل‌دار باشد، نه دکمهٔ خامِ مرورگر
 */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtAc ${JSON.stringify(q)}`).toString().trim().split('\n')[0];

// ورود + ساختِ فرمِ نظرسنجی با بله/خیر + ارسالِ مستقیم به یک بیمارِ موجود
const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const tag = 'yn' + randomBytes(3).toString('hex');
const form = await fetch(API + '/forms', { method: 'POST', headers: A, body: JSON.stringify({ key: tag, title: 'نظرسنجیِ چشمی', scope: 'record' }) }).then((r) => r.json());
await fetch(`${API}/forms/${form.id}/fields`, { method: 'POST', headers: A, body: JSON.stringify({ key: 'refer', label: 'ما را به دیگران معرفی می‌کنید؟', type: 'bool', required: true }) });
await fetch(`${API}/forms/${form.id}/fields`, { method: 'POST', headers: A, body: JSON.stringify({ key: 'score', label: 'رضایتِ کلی', type: 'rating' }) });
/* بیمار از خودِ سوییت، نه «آخرین بیمارِ دیتابیس»: روی دیتابیسِ تازه بیماری نیست
   و `/intake/send` بدونِ بیمار توکن نمی‌دهد. */
const j = (path, init) => fetch(API + path, { headers: A, ...init }).then((r) => r.json());
const [kinds, surgeons, hospitals] = await Promise.all([j('/forms/visit-kinds'), j('/surgeons'), j('/hospitals')]);
const fixture = await j('/visits', { method: 'POST', body: JSON.stringify({
  kind: kinds[0]?.kind, firstName: 'بیمارِ', lastName: 'بله‌خیر', phone: '09120000914',
  surgeonId: (surgeons.rows ?? surgeons)[0]?.id, hospitalId: (hospitals.rows ?? hospitals)[0]?.id,
  opDate: new Date().toISOString(),
}) });
const patientId = fixture?.patientId;
const sent = await fetch(API + '/intake/send', { method: 'POST', headers: A, body: JSON.stringify({ patientId, formId: form.id }) }).then((r) => r.json());
console.log('توکن:', sent.token);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/f/${sent.token}`);
await page.waitForTimeout(2500);

const bodyText = await page.evaluate(() => document.body.innerText);
ok(!bodyText.includes('روزِ نوبت'), 'تقویمِ نوبت روی فرمِ زیرپرونده نیست');
const pills = page.locator('.dyn-yesno .dyn-pill');
ok(await pills.count() === 2, `دو پیلِ بله/خیر (${await pills.count()})`);
if (await pills.count() === 2) {
  const st = await pills.first().evaluate((el) => {
    const c = getComputedStyle(el);
    return { radius: c.borderRadius, border: c.borderWidth, cursor: c.cursor };
  });
  ok(st.radius.includes('99px') || parseInt(st.radius) > 20, `پیل گرد است (${st.radius})`);
  await pills.first().click();
  await page.waitForTimeout(300);
  ok(await page.locator('.dyn-yesno .dyn-pill.on').count() === 1, 'کلیک روی «بله» انتخابش می‌کند');
  await pills.nth(1).click();
  await page.waitForTimeout(300);
  const onTexts = await page.locator('.dyn-yesno .dyn-pill.on').allTextContents();
  ok(onTexts.length === 1 && onTexts[0] === 'خیر', 'کلیک روی «خیر» جای «بله» را می‌گیرد — تک‌انتخابی');
}
const stars = await page.locator('.dyn-star-btn').count();
ok(stars === 5, `پنج ستارهٔ امتیاز (${stars})`);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 1, `بدونِ سرریزِ افقی (${overflow}px)`);
ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');

await page.screenshot({ path: '/tmp/claude-0/-home-user-malekteb/95ee6f0b-abd4-5243-b5cd-45d56a076bd0/scratchpad/yesno.png', fullPage: false });
await browser.close();

// پاک‌سازی
const subId = sql(`SELECT id FROM intake_submissions WHERE token='${sent.token}'`);
if (subId) await fetch(`${API}/intake/submissions/${subId}`, { method: 'DELETE', headers: A });
await fetch(`${API}/forms/${form.id}`, { method: 'DELETE', headers: A });
if (fixture?.id) await fetch(`${API}/visits/${fixture.id}`, { method: 'DELETE', headers: A }).catch(() => {});

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
