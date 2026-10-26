/**
 * ارسالِ فوریِ مراقبتِ قبل از عمل + برنامهٔ پیام‌ها در فرمِ ویزیت (#63):
 *
 * - `preOpImmediate` **مکمّلِ** موعدِ مقرر است نه جایگزینش (برعکسِ مراقبتِ
 *   بعد از عمل): ثبتِ چندروزقبل → یک پیامِ همین‌حالا + یک پیامِ نزدیکِ عمل.
 * - وقتی موعدِ مقرر خودش به «حالا» فروکش کرده، پیامِ دومِ تکراری کاشته نمی‌شود.
 * - مرورگر: چیپِ زمانِ ارسالِ قبل از عمل هست؛ پیش‌فرضِ عملِ آینده «به‌محضِ
 *   ثبت + زمان‌بندی» است و عملِ همین‌امروز راهنمای خودش را می‌گیرد؛ و پایینِ
 *   فرمِ ویزیت «برنامهٔ پیام‌ها» دیده می‌شود.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const PHONE = '09120000965';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'pi' + randomBytes(3).toString('hex');
/* ⚠️ ۱۴۰۵/۰۸/۰۴: مراقبتِ پیش از عمل و زبانه‌های مرحله‌ای فقط مالِ **مطب** است — شرکتی فرمِ خدمت دارد. */
sql(`INSERT INTO settings (key, value, updated_at) VALUES ('vertical','clinic', now()) ON CONFLICT (key) DO UPDATE SET value='clinic', updated_at=now();`);
sql(`INSERT INTO settings (key, value, updated_at) VALUES ('services','[]', now()) ON CONFLICT (key) DO UPDATE SET value='[]', updated_at=now();`);
const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const trash = { visits: [], procs: [], forms: [] };
const plusD = (d) => new Date(Date.now() + d * 864e5);
const preRows = (id) => sql(`SELECT count(*) FROM reminders WHERE visit_id=${id} AND kind='pre_op_care' AND status='pending'`);
const preSoon = (id) => sql(`SELECT count(*) FROM reminders WHERE visit_id=${id} AND kind='pre_op_care' AND status='pending' AND due_at <= now() + interval '2 minutes'`);

try {
  console.log('۱) چیدمان');
  const proc = (await send('/procedure-types', 'POST', {
    name: `عملِ ${tag}`, preOpCare: `ناشتاییِ ${tag}`,
  })).json;
  trash.procs.push(proc.id);
  const surgeon = (await send('/surgeons', 'GET')).json?.[0]
    ?? (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: 'آزمون' })).json;
  const hospital = (await send('/hospitals', 'GET')).json?.[0]
    ?? (await send('/hospitals', 'POST', { name: '[pi] بیمارستان' })).json;

  console.log('\n۲) عملِ چندروزِ دیگر — فوری + مقرر (نه جایگزین)');
  const vFuture = (await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'بیمارِ', lastName: 'قبلی', phone: PHONE,
    opDate: plusD(10).toISOString(), procedureTypeId: proc.id,
    surgeonId: surgeon.id, hospitalId: hospital.id, preOpImmediate: true,
  })).json;
  trash.visits.push(vFuture.id);
  ok(vFuture?.preOpImmediate === true, 'preOpImmediate در نما برگشت');
  ok(Number(preRows(vFuture.id)) === 2, `**دو پیام: یکی حالا، یکی نزدیکِ عمل** (${preRows(vFuture.id)})`);
  ok(Number(preSoon(vFuture.id)) === 1, 'دقیقاً یکی‌شان «همین حالا» است');

  const off = await send(`/visits/${vFuture.id}`, 'PATCH', { preOpImmediate: false });
  ok(off.status === 200 && Number(preRows(vFuture.id)) === 1 && Number(preSoon(vFuture.id)) === 0,
    '**خاموش‌کردن فقط موعدِ مقرر را می‌گذارد**');

  console.log('\n۳) عملِ همین امروز — موعدِ مقرر خودش «حالا» است، پیامِ دوم تکرار نمی‌شود');
  const vToday = (await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'بیمارِ', lastName: 'امروزی', phone: '09120000966',
    opDate: new Date().toISOString(), procedureTypeId: proc.id,
    surgeonId: surgeon.id, hospitalId: hospital.id, preOpImmediate: true,
  })).json;
  trash.visits.push(vToday.id);
  ok(Number(preRows(vToday.id)) === 1,
    `**پیامِ تکراری کاشته نشد (موعدِ مقرر همان «حالا» بود)** (${preRows(vToday.id)})`);

  console.log('\n۴) مرورگر — چیپِ زمانِ قبل از عمل و برنامهٔ پیام‌ها');
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ پیام', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const vVisit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'ویزیتی', phone: PHONE,
    opDate: new Date().toISOString(), nextVisitDate: plusD(14).toISOString(),
  })).json;
  trash.visits.push(vVisit.id);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1150, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + '/login');
    await page.waitForTimeout(900);
    await page.fill('input[name="identifier"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app**', { timeout: 15000 });

    /* الف) فرمِ عمل — چیپِ زمانِ ارسالِ قبل از عمل. */
    await page.goto(BASE + `/app/dashboard?patient=${vFuture.id}`);
    await page.waitForTimeout(2600);
    /* مراقبتِ قبل از عمل در زبانهٔ «قبل از عمل» است (عملِ آینده روی همان باز می‌شود؛ surgery-10). */
    const preBlock = page.locator('.db-phase[data-phase="pre"] .db-careblock').first();
    const preChips = preBlock.locator('.db-daychip');
    ok(await preChips.count() === 2, `چیپِ زمانِ مراقبتِ قبل از عمل هست (${await preChips.count()})`);
    await preChips.filter({ hasText: 'به‌محضِ ثبت' }).click();
    await page.waitForTimeout(400);
    ok((await preBlock.locator('.db-carehead i').innerText()).includes('به‌محضِ ثبت'),
      '**نشانِ زمان با انتخابِ «به‌محضِ ثبت» جمعِ هر دو را می‌گوید**');
    ok((await preBlock.locator('.db-carehead i').innerText()).includes('قبل از عمل'),
      'و موعدِ مقرر هم هنوز در همان نشان هست (مکمّل، نه جایگزین)');
    await page.locator('.db-sheet .db-x').click();
    await page.waitForTimeout(700);

    /* ب) فرمِ ویزیت — برنامهٔ پیام‌ها. */
    await page.goto(BASE + `/app/dashboard?patient=${vVisit.id}`);
    await page.waitForTimeout(2600);
    const plan = page.locator('.db-msgplan');
    ok(await plan.count() === 1, '**پنلِ «برنامهٔ پیام‌ها» پایینِ فرمِ ویزیت هست**');
    const planText = await plan.innerText();
    ok(planText.includes('یادآوریِ ویزیتِ بعدی'), `متنِ برنامه پیام را نام می‌برد (${planText.slice(0, 60)}…)`);
    ok(/روز قبل|ساعتِ/.test(planText), '**زمانِ ارسال صریح گفته شده**');
    ok(await page.locator('.db-postop:not(.db-msgplan)').count() === 0 && await page.locator('.db-sheet .db-phasetabs').count() === 0,
      'برنامهٔ مراقبت و زبانه‌های مخصوصِ عمل در فرمِ ویزیت نیست');
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE phone IN ('${PHONE}','09120000966'))`);
  sql(`DELETE FROM visits WHERE follow_of_visit_id IN (${trash.visits.join(',') || 0})`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs) await send(`/procedure-types/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM patients WHERE phone IN ('${PHONE}','09120000966') AND id NOT IN (SELECT patient_id FROM visits)`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
