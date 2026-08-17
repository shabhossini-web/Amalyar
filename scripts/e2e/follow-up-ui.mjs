/** چکِ چشمی: انتخابِ نقشِ پیگیری در فرم‌ساز + فیلدِ روزهای پیگیری در تعاریف. */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim();

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then((r) => r.json());

const tag = 'fw' + randomBytes(3).toString('hex');
const form = await send('/forms', 'POST', { key: tag, title: `پیگیریِ ${tag}`, scope: 'record' });

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

  console.log('۱) فرم‌ساز — نقشِ پیگیری');
  await page.goto(BASE + '/app/forms');
  await page.waitForTimeout(2000);
  await page.locator(`button:has-text("پیگیریِ ${tag}")`).first().click();
  await page.waitForTimeout(1200);
  const fuBox = page.locator('.fb-followup');
  ok(await fuBox.count() === 1, '**جعبهٔ «نقش در پیگیریِ پس از عمل» روی فرمِ زیرپرونده هست**');
  const kindSel = fuBox.locator('select').first();
  ok(await kindSel.locator('option').count() === 4, 'چهار گزینه: هیچ/عمومی/اختصاصیِ عمل/اختصاصیِ تشخیص');
  await kindSel.selectOption('general');
  await page.waitForTimeout(1200);
  ok(sql(`SELECT follow_up FROM form_defs WHERE id=${form.id}`) === 'general',
    '**انتخابِ «بخشِ عمومی» روی سرور نشست**');
  await kindSel.selectOption('procedure');
  await page.waitForTimeout(600);
  ok(await fuBox.locator('select').count() === 2, 'با «اختصاصیِ عمل» انتخابگرِ نوعِ عمل باز می‌شود');

  console.log('\n۲) تعاریف پایه — روزهای پیگیری');
  await page.goto(BASE + '/app/definitions');
  await page.waitForTimeout(1800);
  await page.locator('button:has-text("انواع عمل")').first().click();
  await page.waitForTimeout(1000);
  await page.locator('.df-add').click();
  await page.waitForTimeout(800);
  ok(await page.locator('label:has-text("روزهای فرمِ پیگیری")').count() === 1,
    '**فیلدِ «روزهای فرمِ پیگیری» در فرمِ نوعِ عمل هست**');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `بدونِ سرریزِ افقی (${overflow}px)`);
  ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
} finally {
  await browser.close();
  await fetch(API + `/forms/${form.id}`, { method: 'DELETE', headers: A }).catch(() => {});
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
