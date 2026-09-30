/**
 * W3.2 گامِ ۲ — کارتِ آماده‌سازیِ ویزیت:
 * - `GET /visits/:id/prep` هویت، هشدارهای بالینی، سابقه و ماندهٔ مالی را یک‌جا می‌دهد
 * - همه‌چیز سمتِ سرور مشتق می‌شود: سن، مانده، و کوتاه‌شدنِ متنِ شرح
 * - «نباید بیفتد»: شرحِ جایگزین‌شده نمی‌آید · شرحِ **همین** مراجعه در «سابقه» نیست ·
 *   سفارشِ بررسی‌شده در «منتظر» نمی‌آید · کارشناسِ دیگری به مراجعه دسترسی ندارد
 * - روی صفحه: هشدارِ حساسیت **باز** است و سابقه **بسته**
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { browserLogin } from './lib/browser-login.mjs';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'pr' + randomBytes(3).toString('hex');
const trash = { visits: [], forms: [], accounts: [] };
const LONG = 'شرحِ بلندِ آزمایشی. '.repeat(30);

try {
  const form = (await send('/forms', 'POST', { key: tag, title: `ویزیتِ ${tag}`, scope: 'visit' })).json;
  trash.forms.push(form.id);
  const v1 = (await send('/visits', 'POST', { kind: tag, firstName: 'سمیهِ', lastName: `آماده${tag}`, phone: '09120000918', opDate: new Date(Date.now() - 30 * 864e5).toISOString() })).json;
  trash.visits.push(v1.id);
  const pid = num(`SELECT patient_id FROM visits WHERE id=${v1.id}`);
  const v2 = (await send('/visits', 'POST', { kind: tag, patientId: pid, opDate: new Date().toISOString() })).json;
  if (!v2?.id) { console.error('مراجعهٔ دوم ساخته نشد', v2); process.exit(1); }
  trash.visits.push(v2.id);

  sql(`UPDATE patients SET allergies='پنی‌سیلین', chronic_conditions='دیابت نوع ۲', medications='متفورمین', blood_type='A+', birth_date='1990-03-21', insurer='تأمین اجتماعی' WHERE id=${pid}`);
  /* سه شرح: قبلی (باید بیاید) · جایگزین‌شده (نباید) · مالِ همین مراجعه (نباید در سابقه) */
  const nOld = num(`INSERT INTO clinical_notes(patient_id, visit_id, kind, body, author_name, created_at) VALUES (${pid}, ${v1.id}, 'visit', '${LONG}', 'دکتر الف', now()-interval '30 days') RETURNING id`);
  const nDead = num(`INSERT INTO clinical_notes(patient_id, visit_id, kind, body, author_name, created_at, replaced_at) VALUES (${pid}, ${v1.id}, 'visit', 'متنِ کهنه که اصلاح شد', 'دکتر الف', now()-interval '31 days', now()) RETURNING id`);
  const nSelf = num(`INSERT INTO clinical_notes(patient_id, visit_id, kind, body, author_name, created_at) VALUES (${pid}, ${v2.id}, 'visit', 'شرحِ همین ویزیت', 'دکتر ب', now()) RETURNING id`);

  const oAns = (await send('/orders/imaging', 'POST', { patientId: pid, visitId: v1.id, modalities: ['MRI'] })).json;
  const oRev = (await send('/orders/lab', 'POST', { patientId: pid, visitId: v1.id, tests: ['CBC'] })).json;
  sql(`UPDATE imaging_orders SET status='answered' WHERE id=${oAns.id}`);
  sql(`UPDATE lab_orders SET status='reviewed' WHERE id=${oRev.id}`);
  await send(`/visits/${v2.id}/charges`, 'POST', { title: 'ویزیت', unitPrice: 500000 }).catch(() => {});

  console.log('۱) پاسخِ سرور');
  const prep = (await send(`/visits/${v2.id}/prep`, 'GET')).json;
  ok(prep?.patient?.fullName?.includes(tag), 'هویتِ بیمار آمد');
  ok(prep.patient.allergies === 'پنی‌سیلین' && prep.patient.chronicConditions === 'دیابت نوع ۲' && prep.patient.medications === 'متفورمین',
    'سه هشدارِ بالینی (حساسیت، زمینه‌ای، دارو) جدا برمی‌گردند');
  ok(prep.patient.age === 36 || prep.patient.age === 35, `سن سمتِ سرور حساب شد (${prep.patient.age})`);
  ok(prep.patient.bloodType === 'A+' && prep.patient.insurer === 'تأمین اجتماعی', 'گروهِ خونی و بیمه آمدند');

  console.log('\n۲) سابقه — و آنچه نباید بیاید');
  const ids = prep.notes.map((n) => n.id);
  ok(ids.includes(nOld), 'شرحِ ویزیتِ قبلی در سابقه هست');
  ok(!ids.includes(nDead), '**نباید بیفتد:** شرحِ جایگزین‌شده نمی‌آید (متنِ کهنه به‌جای اصلاحیه‌اش)');
  ok(!ids.includes(nSelf), '**نباید بیفتد:** شرحِ همین مراجعه «سابقه» نیست');
  const note = prep.notes.find((n) => n.id === nOld);
  ok(note.excerpt.length <= 181 && note.truncated === true, `متن سمتِ سرور کوتاه شد (${note.excerpt.length} نویسه) و کوتاه‌شدنش اعلام شد`);
  ok(prep.prevVisits.some((v) => v.id === v1.id) && !prep.prevVisits.some((v) => v.id === v2.id), 'مراجعهٔ قبلی هست و خودِ این مراجعه نیست');

  console.log('\n۳) نتیجه‌های در انتظار');
  const kinds = prep.pendingResults.map((o) => `${o.kind}:${o.status}`);
  ok(kinds.includes('imaging:answered'), 'نتیجهٔ پاسخ‌آمده در فهرست است');
  ok(!kinds.some((k) => k.startsWith('lab:')), '**نباید بیفتد:** سفارشِ بررسی‌شده دیگر «در انتظار» نیست');
  ok(prep.pendingResults[0]?.status === 'answered', 'پاسخ‌آمده پیش از منتظرِ پاسخ می‌آید (کارِ همین حالا)');

  console.log('\n۴) مالی');
  ok(typeof prep.billing.due === 'number' && prep.billing.due === prep.billing.total - prep.billing.paid, 'ماندهٔ مالی سمتِ سرور مشتق شد');

  console.log('\n۵) روی صفحه');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) console.log(`    ↳ ${r.status()} ${r.url()}`); });
  try {
    await browserLogin(page, login.accessToken, { ui: UI });
    /* ⚠️ `?patient=` در داشبورد شناسهٔ **مراجعه** است نه بیمار (نامش گمراه‌کننده است)؛
       این‌جا اصلاً لازم نیست: کارت را با نامِ بیمار پیدا می‌کنیم. */
    await page.goto(`${UI}/app/dashboard`, { waitUntil: 'networkidle' });
    /* کارت (موبایل) یا ردیفِ جدول (دسکتاپ، بازبینیِ UX global-04) — همان دکمهٔ «ویرایش» در هر دو. */
    const row = page.locator(':is(.db-card, .db-row)', { hasText: `آماده${tag}` }).first();
    await row.waitFor({ timeout: 15000 });
    await row.locator('button[title="ویرایش"], button[aria-label="ویرایش"]').first().click().catch(async () => {
      await row.getByRole('button', { name: /ویرایش/ }).first().click();
    });
    /* اصلاحِ مالک ۱۴۰۵/۰۷/۰۲: کارتِ آماده‌سازی حالا «خلاصهٔ کوچکِ بیمار» است — دوستونه، و
       کادرهای مشخصات پشتِ «ویرایشِ مشخصات» (پیش‌فرض بسته) تا بالای هر فرم جا نگیرد. */
    await page.waitForSelector('[data-patient-summary]', { timeout: 10000 });
    const sum = page.locator('[data-patient-summary]');
    ok(await sum.count() === 1, 'خلاصهٔ بیمار بالای فرم رندر شد');
    const sumText = await sum.innerText();
    ok(sumText.includes(`آماده${tag}`) && /موبایل/.test(sumText) && /کد ملی/.test(sumText), 'نام، موبایل و کد ملی در خلاصه دیده می‌شوند');
    ok(await sum.locator('.db-psum-grid > div').count() >= 3, 'ردیف‌های خلاصه دوستونه‌اند (dl)');
    const idStep = page.locator('.db-sheet .db-step').first();
    ok(await idStep.isHidden(), '**نباید بیفتد:** کادرهای مشخصات در ویرایش پیش‌فرض بسته‌اند');
    const editId = sum.locator('[data-act="edit-identity"]');
    ok((await editId.getAttribute('aria-expanded')) === 'false', 'دکمهٔ «ویرایشِ مشخصات» بسته را اعلام می‌کند');
    await editId.click();
    ok(await idStep.isVisible() && (await editId.getAttribute('aria-expanded')) === 'true', 'با «ویرایشِ مشخصات» کادرها باز می‌شوند');
    await editId.click();
    ok(await idStep.isHidden(), 'و با «بستنِ مشخصات» دوباره بسته می‌شوند');
    const risk = page.locator('.db-prep-risk');
    ok(await risk.count() === 1 && /پنی‌سیلین/.test(await risk.innerText()), 'هشدارِ حساسیت **باز** و دیدنی است');
    const more = page.locator('.db-prep-more');
    ok(await more.count() === 1 && !(await more.evaluate((el) => el.open)), '**نباید بیفتد:** سابقه باز نیست (فرم زیرِ متن دفن نشود)');
    ok(errors.length === 0, `بدونِ خطای جاوااسکریپت (${errors.length})${errors.length ? ' — ' + errors[0].slice(0, 140) : ''}`);

    console.log('\n۶) دامنهٔ دید');
    const made = (await send('/accounts/temporary', 'POST', {
      firstName: 'کارشناسِ', lastName: `دیگر ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
      level: 2, jobRole: 'technician', username: `p${tag}`,
    })).json;
    if (made?.account?.id) {
      trash.accounts.push(made.account.id);
      const tl = await fetch(API + '/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: `p${tag}`, password: made.temporaryPassword }),
      }).then((r) => r.json());
      const res = await fetch(`${API}/visits/${v2.id}/prep`, { headers: { Authorization: 'Bearer ' + tl.accessToken } });
      ok(res.status >= 400, `**نباید بیفتد:** کارشناسی که این مراجعه مالِ او نیست کارتِ بالینی را نمی‌گیرد (${res.status})`);
    } else { ok(false, 'حسابِ آزمایشی ساخته نشد'); }
  } finally { await browser.close().catch(() => {}); }
} finally {
  const pid = trash.visits.length ? num(`SELECT patient_id FROM visits WHERE id=${trash.visits[0]}`) : -1;
  sql(`DELETE FROM clinical_notes WHERE patient_id=${pid}`);
  for (const k of ['imaging_orders', 'lab_orders']) sql(`DELETE FROM ${k} WHERE patient_id=${pid}`);
  for (const v of trash.visits.reverse()) await send(`/visits/${v}`, 'DELETE').catch(() => {});
  for (const f of trash.forms) await send(`/forms/${f}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    sql(`DELETE FROM account_sessions WHERE account_id=${id}`);
    sql(`DELETE FROM accounts WHERE id=${id}`);
  }
}
console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
