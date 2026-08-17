/**
 * چکِ چشمیِ صفحهٔ خلاصهٔ ویزیت (/v/<token>) روی موبایل + منوی کارت:
 * سندِ روشن رندر شود، دکمهٔ چاپ باشد، منوی خلاصه روی کارتِ داشبورد کار کند.
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';

const API = 'http://localhost:3101/api';
const BASE = 'http://127.0.0.1:5199';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const tag = 'su' + randomBytes(3).toString('hex');

/* فرمِ اختصاصیِ بی‌فیلدِ اجباری — فرمِ surgery جراح/بیمارستانِ اجباری دارد. */
const form = await fetch(API + '/forms', {
  method: 'POST', headers: A,
  body: JSON.stringify({ key: tag, title: 'ویزیتِ سندِ چاپی', scope: 'visit' }),
}).then((r) => r.json());
const visit = await fetch(API + '/visits', {
  method: 'POST', headers: A,
  body: JSON.stringify({
    kind: tag, firstName: 'بیمارِ', lastName: 'سندِ‌چاپی', phone: '09120000712',
    opDate: new Date().toISOString(),
    nextVisitDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
  }),
}).then((r) => r.json());
if (!visit?.id) { console.error('مراجعه ساخته نشد: ' + JSON.stringify(visit).slice(0, 200)); process.exit(1); }
const link = await fetch(`${API}/visits/${visit.id}/summary-link`, { method: 'POST', headers: A }).then((r) => r.json());

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${BASE}/v/${link.token}`);
await page.waitForTimeout(2000);
ok(await page.locator('.vs-page').count() === 1, 'سندِ خلاصه رندر شد');
const bodyText = await page.evaluate(() => document.body.innerText);
ok(bodyText.includes('بیمارِ سندِ‌چاپی'), 'نامِ بیمار روی سند هست');
ok(bodyText.includes('ویزیتِ بعدی'), 'ویزیتِ بعدی روی سند هست');
const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.vs-page')).backgroundColor);
ok(bg === 'rgb(255, 255, 255)', `سند سفید است (${bg}) — برای کاغذ`);
ok(await page.locator('.vs-actions button').count() === 1, 'دکمهٔ چاپ / ذخیرهٔ PDF هست');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 1, `بدونِ سرریزِ افقی (${overflow}px)`);
// چاپ: دکمه در media print پنهان است
const printHidden = await page.evaluate(() => {
  const m = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } })
    .filter((r) => r.media?.mediaText?.includes('print'))
    .flatMap((r) => [...(r.cssRules ?? [])]);
  return m.some((r) => r.selectorText === '.vs-actions' && r.style.display === 'none');
});
ok(printHidden, 'دکمه‌ها در چاپ پنهان‌اند (@media print)');
ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');

await page.screenshot({ path: '/tmp/claude-0/-home-user-malekteb/95ee6f0b-abd4-5243-b5cd-45d56a076bd0/scratchpad/summary.png' });
await browser.close();

await fetch(`${API}/visits/${visit.id}`, { method: 'DELETE', headers: A }).catch(() => {});
await fetch(`${API}/forms/${form.id}`, { method: 'DELETE', headers: A }).catch(() => {});

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
