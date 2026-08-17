/** چکِ چشمی: تبِ «جراحیِ داخلِ مطب» در تعاریف + پیشنهادِ کدِ داخلی در صورت‌حساب. */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then((r) => r.json());

const tag = 'iw' + randomBytes(3).toString('hex');
const CODE = 'UIX-' + tag.slice(2, 6).toUpperCase();
const ic = await send('/internal-codes', 'POST', { code: CODE, name: `بخیهٔ ${tag}`, price: 450_000 });
const form = await send('/forms', 'POST', { key: tag, title: 'مطبِ چشمی', scope: 'visit' });
const visit = await send('/visits', 'POST', {
  kind: tag, firstName: 'بیمارِ', lastName: 'بخیه', phone: '09120000917', opDate: new Date().toISOString(),
});

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

  console.log('۱) تعاریف پایه');
  await page.goto(BASE + '/app/definitions');
  await page.waitForTimeout(1800);
  const tabBtn = page.locator('button:has-text("جراحیِ داخلِ مطب")').first();
  ok(await tabBtn.count() === 1, '**تبِ «جراحیِ داخلِ مطب» هست**');
  await tabBtn.click();
  await page.waitForTimeout(1500);
  const row = page.locator('.df-row', { hasText: `بخیهٔ ${tag}` }).first();
  ok(await row.count() === 1, 'کدِ ساخته‌شده در فهرست دیده می‌شود');
  ok((await row.locator('small').innerText()).includes(CODE), 'با خودِ کد و مبلغ');

  console.log('\n۲) صورت‌حساب — پیشنهادِ کدِ داخلی');
  await page.goto(BASE + '/app/dashboard');
  await page.waitForTimeout(2200);
  const search = page.locator('input[placeholder*="جستجو"], input[type="search"]').first();
  if (await search.count()) { await search.fill('بخیه'); await page.waitForTimeout(1200); }
  const card = page.locator('article, .db-card', { hasText: 'بیمارِ بخیه' }).first();
  ok(await card.count() >= 1, 'کارتِ مراجعه پیدا شد');
  await card.locator('button[title="صورت‌حساب"]').first().click();
  await page.waitForTimeout(1500);
  const codeInput = page.locator('.bl-codesearch input').first();
  ok(await codeInput.count() === 1, 'ورودیِ جستجوی کد هست');
  await codeInput.fill(CODE.slice(0, 5));
  await page.waitForTimeout(900);
  const hit = page.locator('.bl-hits button', { hasText: `بخیهٔ ${tag}` }).first();
  ok(await hit.count() === 1, '**کدِ داخلی در پیشنهادها آمد**');
  ok(await hit.locator('.bl-internal-tag').count() === 1, 'با نشانِ «داخلی»');
  await hit.click();
  await page.waitForTimeout(400);
  ok(await page.locator('.bl-picked .bl-internal-tag').count() === 1, 'بعد از انتخاب هم نشانِ داخلی می‌ماند');
  const price = await page.locator('.bl-sheet input[placeholder="۰"]').first().inputValue().catch(() => '');
  ok(String(price) === '450000', `**مبلغِ مصوبِ کد خودکار پر شد (${price})**`);
  ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
} finally {
  await browser.close();
  sql(`DELETE FROM charges WHERE visit_id=${visit.id}`);
  await fetch(API + `/visits/${visit.id}`, { method: 'DELETE', headers: A }).catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}'`);
  sql(`DELETE FROM patients WHERE last_name='بخیه' AND id NOT IN (SELECT patient_id FROM visits)`);
  await fetch(API + `/forms/${form.id}`, { method: 'DELETE', headers: A }).catch(() => {});
  sql(`DELETE FROM internal_codes WHERE code='${CODE}'`);
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
