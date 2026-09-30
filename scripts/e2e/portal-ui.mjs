/** چکِ چشمیِ پروندهٔ الکترونیک (/p/<token>) روی موبایل. */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const tag = 'pu' + randomBytes(3).toString('hex');

const form = await fetch(API + '/forms', { method: 'POST', headers: A, body: JSON.stringify({ key: tag, title: 'ویزیتِ پرتالِ چشمی', scope: 'visit' }) }).then((r) => r.json());
const visit = await fetch(API + '/visits', {
  method: 'POST', headers: A,
  body: JSON.stringify({
    kind: tag, firstName: 'بیمارِ', lastName: 'چشمی', phone: '09120000812',
    /* بازبینیِ UX (بندِ ۱۰۰): «مراجعات» فقط گذشته است و فقط مراجعهٔ **انجام‌شده** به خلاصه لینک دارد؛
       مراجعهٔ امروزِ در انتظار «پیشِ‌رو»ست. پس مراجعهٔ این آزمون گذشته و انجام‌شده است. */
    opDate: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    nextVisitDate: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(),
  }),
}).then((r) => r.json());
await fetch(`${API}/visits/${visit.id}/status`, { method: 'PATCH', headers: A, body: JSON.stringify({ opStatus: 'done' }) });
const link = await fetch(`${API}/patients/${visit.patientId}/portal-link`, { method: 'POST', headers: A }).then((r) => r.json());

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${BASE}/p/${link.token}`);
await page.waitForTimeout(2200);
const text = await page.evaluate(() => document.body.innerText);
ok(text.includes('بیمارِ چشمی'), 'نامِ بیمار در سربرگ');
/* «کارهای شما» (W0/§۴.۶) بخشِ اول شد؛ بخش‌ها را با برچسب می‌گیریم نه با شماره. */
const tabsText = await page.locator('.po-tabs').innerText();
ok(['پیشِ‌رو', 'مراجعات', 'عمل‌ها', 'پیام‌ها'].every((t) => tabsText.includes(t)), 'بخش‌ها: پیشِ‌رو/مراجعات/عمل‌ها/پیام‌ها');
ok(text.includes('ویزیتِ بعدی'), 'ویزیتِ بعدی در «پیشِ‌رو»');
await page.locator('.po-tabs button', { hasText: 'مراجعات' }).click();
await page.waitForTimeout(400);
ok(await page.locator('a.po-row').count() >= 1, 'ردیفِ مراجعه لینک‌دار است (به خلاصه)');
await page.locator('.po-tabs button', { hasText: 'پیام‌ها' }).click();
await page.waitForTimeout(400);
ok(await page.locator('.po-notice').count() >= 1, 'فیدِ پیام‌ها پر است (یادآوریِ برنامه‌ریزی‌شده)');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 1, `بدونِ سرریزِ افقی (${overflow}px)`);
ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');

await page.screenshot({ path: '/tmp/claude-0/-home-user-malekteb/95ee6f0b-abd4-5243-b5cd-45d56a076bd0/scratchpad/portal.png' });
await browser.close();

await fetch(`${API}/visits/${visit.id}`, { method: 'DELETE', headers: A }).catch(() => {});
await fetch(`${API}/forms/${form.id}`, { method: 'DELETE', headers: A }).catch(() => {});

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
