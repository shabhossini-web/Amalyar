/**
 * دو رفعِ صفحهٔ تنظیمات:
 * - ورودِ تازه → بنرِ «پیکربندیِ شرکت خوانده نشد (۴۰۱)» نباید باشد
 *   (ConfigProvider بعد از ورود دوباره می‌خوانَد)
 * - بخشِ ایمپورت دیگر نامِ «ملک‌طب» ندارد (white-label)
 */
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

/* سناریوی دقیقِ گزارش: اپ **پیش از ورود** بالا می‌آید (fetch اولِ /config
   با ۴۰۱ می‌میرد)، بعد ورود، بعد مستقیم تنظیمات — بدونِ رفرش. */
await page.goto(BASE + '/login');
await page.waitForTimeout(1200);
await page.fill('input[name="identifier"], input[type="text"]', 'admin');
await page.fill('input[type="password"]', 'test1234');
await page.click('button[type="submit"]');
await page.waitForURL('**/app**', { timeout: 15000 });
ok(true, 'ورود انجام شد (بدونِ رفرشِ صفحه)');

await page.goto(BASE + '/app/settings');
await page.waitForTimeout(2200);
const failBanner = await page.locator('.st-fail').count();
ok(failBanner === 0, failBanner ? 'بنرِ ۴۰۱ هنوز هست!' : 'بنرِ «پیکربندی خوانده نشد» دیگر ظاهر نمی‌شود');
const verticals = await page.locator('.st-verticals button').count();
ok(verticals >= 2, `حوزه‌های کاری بارگذاری شدند (${verticals})`);

const bodyText = await page.evaluate(() => document.body.innerText);
ok(!bodyText.includes('ملک‌طب') && !bodyText.includes('ملک طب'), 'هیچ «ملک‌طب»ی روی صفحه نیست');
ok(bodyText.includes('سامانهٔ قبلی'), 'بخشِ ایمپورت «سامانهٔ قبلی» شد');
ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');

await browser.close();
console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
