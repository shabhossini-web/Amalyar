/**
 * چکِ چشمیِ ادامهٔ CRM (#45): کارتِ روندِ ماهانه با ۱۲ ستون، کارتِ
 * پیگیری‌نشده‌ها با ردیفِ واقعی و لینکِ پرونده، و دانلودِ واقعیِ CSV
 * (هم فهرست، هم فرم) از خودِ مرورگر.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'cu' + randomBytes(3).toString('hex');
const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

/* چیدمان: فرمِ پیگیری + نظرسنجیِ پرشده + عملِ انجام‌شدهٔ بی‌پیگیری. */
const trash = { forms: [], visits: [] };
const survey = (await send('/forms', 'POST', { key: `${tag}s`, title: 'نظرسنجیِ چشمی', scope: 'record' })).json;
trash.forms.push(survey.id);
await send(`/forms/${survey.id}/fields`, 'POST', { key: 'cuScore', label: 'رضایت', type: 'rating' });
const fu = (await send('/forms', 'POST', { key: `${tag}f`, title: 'پیگیریِ چشمی', scope: 'record' })).json;
trash.forms.push(fu.id);
await send(`/forms/${fu.id}`, 'PATCH', { followUp: 'general' });
const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ چشمی', scope: 'visit' })).json;
trash.forms.push(vform.id);
const visit = (await send('/visits', 'POST', {
  kind: tag, firstName: 'بیمارِ', lastName: 'چشمی‌سنج', phone: '09120000781',
  opDate: new Date(Date.now() - 9 * 864e5).toISOString(),
})).json;
trash.visits.push(visit.id);
sql(`UPDATE visits SET kind='surgery' WHERE id=${visit.id}`);
await send(`/visits/${visit.id}/status`, 'PATCH', { opStatus: 'done' });
/* یک پاسخِ پرشدهٔ نظرسنجی تا دکمهٔ CSVِ فرم هم ظاهر شود. */
await send('/intake/send', 'POST', { patientId: visit.patientId, formId: survey.id });
const stoken = sql(`SELECT token FROM intake_submissions WHERE patient_id=${visit.patientId} AND form_id=${survey.id} ORDER BY id DESC LIMIT 1`);
await fetch(API + `/public/intake/form/${stoken}/fill`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ values: { cuScore: '5' } }),
});

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(BASE + '/login');
  await page.waitForTimeout(1000);
  await page.fill('input[name="identifier"], input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'test1234');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/app**', { timeout: 15000 });

  console.log('۱) صفحهٔ CRM');
  await page.goto(BASE + '/app/crm');
  await page.waitForTimeout(2500);
  ok(await page.locator('.crm-card-head b:has-text("روندِ ماهانه")').count() === 1, 'کارتِ روندِ ماهانه هست');
  ok(await page.locator('.crm-months .crm-mbar').count() === 12, '**۱۲ ستونِ ماهِ شمسی**');
  ok(await page.locator('.crm-legend').count() >= 1, 'راهنمای نمودار');

  console.log('\n۲) پیگیری‌نشده‌ها');
  ok(await page.locator('.crm-card-head b:has-text("پیگیریِ پس از عمل")').count() === 1, 'کارتِ پیگیری هست');
  const row = page.locator('.crm-unf-row', { has: page.locator('b:has-text("بیمارِ چشمی‌سنج")') });
  ok(await row.count() === 1, '**ردیفِ عملِ بی‌پیگیری دیده می‌شود**');
  ok(await row.locator('.crm-chip').count() >= 1, 'چیپِ وضعیتِ پیامک روی ردیف');
  const href = await row.locator('a.crm-unf-name').getAttribute('href');
  ok(href === `/app/patients/${visit.patientId}`, `لینکِ ردیف به پرونده می‌رود (${href})`);

  console.log('\n۳) دانلودِ CSV');
  const [dl1] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('.crm-card-head:has(b:has-text("پیگیریِ پس از عمل")) .crm-csv').click(),
  ]);
  ok(dl1.suggestedFilename() === 'crm-unfollowed.csv', `فایلِ پیگیری‌نشده‌ها دانلود شد (${dl1.suggestedFilename()})`);

  const formCard = page.locator('.crm-card', { has: page.locator(`b:has-text("نظرسنجیِ چشمی")`) });
  await formCard.scrollIntoViewIfNeeded();
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    formCard.locator('.crm-csv').click(),
  ]);
  ok(/^crm-.*\.csv$/.test(dl2.suggestedFilename()), `CSVِ فرم دانلود شد (${dl2.suggestedFilename()})`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `بدونِ سرریزِ افقی (${overflow}px)`);
  ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
} finally {
  await browser.close();
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM intake_submissions WHERE patient_id IN (SELECT id FROM patients WHERE phone='09120000781')`);
  sql(`DELETE FROM patients WHERE phone='09120000781'`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
