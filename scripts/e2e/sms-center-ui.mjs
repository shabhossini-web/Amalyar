/** چکِ چشمی: گروهِ پیامک‌ها در تنظیمات، پنلِ سربرگ، نامِ شرکت زیرِ لوگوی لانچر. */
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
await fetch(API + '/settings', { method: 'PATCH', headers: A, body: JSON.stringify({ values: { brand_name: 'کلینیکِ آزمون' } }) });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(BASE + '/login');
  await page.waitForTimeout(1000);
  await page.fill('input[name="identifier"], input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'test1234');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/app**', { timeout: 15000 });

  console.log('۱) لانچر');
  await page.goto(BASE + '/app');
  await page.waitForTimeout(1500);
  ok(await page.locator('.lx-company:has-text("کلینیکِ آزمون")').count() === 1,
    '**نامِ شرکت زیرِ نشانِ عمل‌یار دیده می‌شود**');

  console.log('\n۲) تنظیماتِ شرکت');
  await page.goto(BASE + '/app/settings');
  await page.waitForTimeout(2000);
  ok(await page.locator('.st-group-head b:has-text("پیامک‌ها و زمان‌بندی")').count() === 1,
    'گروهِ «پیامک‌ها و زمان‌بندی» رندر شد');
  const smsGroup = page.locator('.st-group', { has: page.locator('b:has-text("پیامک‌ها و زمان‌بندی")') });
  ok(await smsGroup.locator('textarea').count() >= 6, 'متن‌های پیامک به‌شکلِ textarea');
  ok(await smsGroup.locator('input[inputmode="numeric"]').count() >= 5, 'زمان‌بندی‌ها به‌شکلِ عددی');
  ok(await page.locator('h3:has-text("سربرگِ شرکت")').count() === 1, 'پنلِ سربرگ هست');
  ok(await page.locator('.st-letterhead .st-file').count() === 1, 'دکمهٔ انتخابِ تصویرِ سربرگ');
  ok(await page.locator('label:has-text("سربرگ — شناسهٔ فایل")').count() === 0,
    '**کلیدهای پنهانِ سربرگ در فرمِ عمومی نیستند**');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `بدونِ سرریزِ افقی (${overflow}px)`);
  ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
} finally {
  await browser.close();
  execSync(`psql "${process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest'}" -qtA`,
    { input: "DELETE FROM settings WHERE key='brand_name'" });
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
