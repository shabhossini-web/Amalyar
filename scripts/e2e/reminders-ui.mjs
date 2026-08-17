/** چکِ چشمیِ صفحهٔ یادآوری‌ها + کاشیِ لانچر. */
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:5199';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE + '/login');
await page.waitForTimeout(1000);
await page.fill('input[name="identifier"], input[type="text"]', 'admin');
await page.fill('input[type="password"]', 'test1234');
await page.click('button[type="submit"]');
await page.waitForURL('**/app**', { timeout: 15000 });

await page.goto(BASE + '/app');
await page.waitForTimeout(1200);
ok(await page.locator('button:has-text("یادآوری‌ها")').count() >= 1, 'کاشیِ «یادآوری‌ها» در لانچر');

await page.goto(BASE + '/app/reminders');
await page.waitForTimeout(1800);
ok(await page.locator('.rm-head h1').count() === 1, 'صفحه باز شد');
ok(await page.locator('.rm-tabs button').count() === 3, 'سه وضعیت: در صف / رفته / نرفته');
ok(await page.locator('.rm-sweep').count() === 1, 'دکمهٔ «ارسالِ سررسیده‌ها» (سوپرادمین)');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 1, `بدونِ سرریزِ افقی (${overflow}px)`);
ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');

await browser.close();
console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
