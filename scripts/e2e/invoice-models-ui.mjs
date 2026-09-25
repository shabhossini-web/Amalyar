/** چکِ چشمی: تاگلِ گلوبال/باکد + دو دکمهٔ چاپ (رسمی/غیررسمی) در صورت‌حساب. */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
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

const tag = 'iu' + randomBytes(3).toString('hex');
const form = await send('/forms', 'POST', { key: tag, title: 'فاکتورِ چشمی', scope: 'visit' });
const visit = await send('/visits', 'POST', {
  kind: tag, firstName: 'بیمارِ', lastName: 'چشمی', phone: '09120000915', opDate: new Date().toISOString(),
});
await send(`/visits/${visit.id}/charges`, 'POST', { kind: 'service', title: 'خدمتِ نمایشی', quantity: 1, unitPrice: 1_000_000 });
await send(`/visits/${visit.id}/billing/pricing`, 'POST', { pricingModel: 'global', globalAmount: 9_000_000 });

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

  await page.goto(BASE + '/app/dashboard');
  await page.waitForTimeout(2200);
  const search = page.locator('input[placeholder*="جستجو"], input[type="search"]').first();
  if (await search.count()) { await search.fill('چشمی'); await page.waitForTimeout(1200); }
  const card = page.locator('article, .db-card', { hasText: 'بیمارِ چشمی' }).first();
  ok(await card.count() >= 1, 'کارتِ مراجعه پیدا شد');
  await card.locator('button[title="صورت‌حساب"]').first().click();
  await page.waitForTimeout(1500);

  ok(await page.locator('.bl-pricing-tabs button:has-text("گلوبال")').count() === 1, 'تاگلِ مدلِ قیمت‌گذاری هست');
  ok(await page.locator('.bl-pricing-tabs button.on:has-text("گلوبال")').count() === 1, '**گلوبال فعال نشان داده می‌شود**');
  ok(await page.locator('.bl-summary span:has-text("مبلغِ کل (گلوبال)")').count() === 1, 'برچسبِ جمعِ کل «گلوبال» شد');
  ok(await page.locator('.bl-pricing-note').count() === 1, 'یادداشتِ تفاوتِ جمعِ اقلام دیده می‌شود');
  /* دو دکمهٔ چاپِ رسمی/غیررسمی به **یک** دکمهٔ «صدور و چاپ فاکتور <نوعِ
     انتخاب‌شده>» تبدیل شد (InvoicePanel): نوع از حسابِ دریافت می‌آید، نه از
     دکمه. */
  /* صدور در تبِ «صدور فاکتور»ِ همان صورت‌حساب نشسته (Tabs)؛ تبِ پیش‌فرض «اقلام» است. */
  await page.locator('.db-modetabs button', { hasText: 'صدور فاکتور' }).click();
  await page.waitForTimeout(600);
  ok(await page.locator('button:has-text("صدور و چاپ فاکتور")').count() === 1, '**دکمهٔ صدور و چاپِ فاکتور هست**');
  ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
} finally {
  await browser.close();
  sql(`DELETE FROM charges WHERE visit_id=${visit.id}`);
  await fetch(API + `/visits/${visit.id}`, { method: 'DELETE', headers: A }).catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}'`);
  sql(`DELETE FROM patients WHERE last_name='چشمی' AND id NOT IN (SELECT patient_id FROM visits)`);
  await fetch(API + `/forms/${form.id}`, { method: 'DELETE', headers: A }).catch(() => {});
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
