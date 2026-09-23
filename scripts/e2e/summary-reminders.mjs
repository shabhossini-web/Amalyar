/**
 * خلاصهٔ ویزیت + یادآوری‌ها:
 * - لینکِ عمومیِ /v/<token>: بدونِ ورود باز می‌شود؛ فیلدِ نقش‌دار و یادداشتِ
 *   داخلی و هیچ عددِ مالی‌ای در آن نیست؛ بازکردنِ دوباره همان توکن را می‌دهد
 * - پیامکِ خلاصه به شمارهٔ خودِ پرونده
 * - دفترِ یادآوری: ثبتِ nextVisitDate → pending؛ تغییرش → قبلی cancelled؛
 *   پاک‌کردنش → همه cancelled؛ sweep سررسیده‌ها را می‌برد (با credential `sent`؛
 *   بدونِ آن — CI و توسعه — سرویس stub است و ردیف `simulated` می‌شود، نه `sent`)
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b, auth = true) => fetch(API + p, {
  method: m, headers: auth ? A : { 'Content-Type': 'application/json' },
  body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'sr' + randomBytes(3).toString('hex');
const trash = { forms: [], visits: [] };

try {
  /* فرمِ ویزیت با یک textareaی عمومی و یکی بخشِ پزشک */
  const form = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ خلاصه‌دار', scope: 'visit' })).json;
  trash.forms.push(form.id);
  /* ⚠️ از بستهٔ ۶الف `planNote` و `exam` کلیدهای هستهٔ ثابت‌اند: فیلدِ سفارشی
     با آن‌ها ساخته نمی‌شود و هر فرمِ مراجعه ردیفِ builtinِ خاموششان را دارد.
     پس همان کاری را می‌کنیم که کاربر در فرم‌ساز می‌کند — روشن‌کردن، و برای
     معاینه محدودکردن به نقشِ پزشک. */
  const view = (await send(`/forms/${encodeURIComponent('visit.' + tag)}`, 'GET')).json;
  const fieldOf = (k) => view?.fields?.find((f) => f.key === k);
  ok(fieldOf('planNote')?.builtin && fieldOf('exam')?.builtin, 'طرحِ درمان و معاینه ردیفِ builtinِ فرم‌اند');
  await send(`/forms/fields/${fieldOf('planNote')?.id}`, 'PATCH', { active: true });
  await send(`/forms/fields/${fieldOf('exam')?.id}`, 'PATCH', { active: true, roles: ['doctor'] });

  const nextIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'خلاصه', phone: '09120000711',
    opDate: new Date().toISOString(),
    nextVisitDate: nextIso,
    notes: 'یادداشتِ داخلیِ منشی — نباید بیرون برود',
    amount: 500000,
    planNote: 'فیزیوتراپی سه جلسه', exam: 'یافتهٔ خصوصیِ پزشک',
  })).json;
  if (!visit?.id) { console.error('مراجعه ساخته نشد: ' + JSON.stringify(visit).slice(0, 200)); process.exit(1); }
  trash.visits.push(visit.id);

  console.log('۱) لینکِ عمومیِ خلاصه');
  const l1 = (await send(`/visits/${visit.id}/summary-link`, 'POST')).json;
  const l2 = (await send(`/visits/${visit.id}/summary-link`, 'POST')).json;
  ok(!!l1?.token && l1.token === l2?.token, 'لینک تنبل ساخته می‌شود و دوباره همان است');
  ok(String(l1.url).includes(`/v/${l1.token}`), `و نشانیِ /v دارد (${String(l1.url).slice(0, 40)}…)`);

  const pub = await send(`/public/visit-summary/${l1.token}`, 'GET', null, false);
  ok(pub.status === 200, `بدونِ ورود باز می‌شود (${pub.status})`);
  const body = JSON.stringify(pub.json);
  ok(pub.json?.patient?.fullName === 'بیمارِ خلاصه', 'نامِ بیمار هست');
  /* برچسب از ردیفِ builtin می‌آید («طرحِ درمان و توصیه‌ها») — قابلِ تغییر در فرم‌ساز. */
  ok(pub.json?.answers?.some((a) => /^طرحِ درمان/.test(a.label) && a.body.includes('فیزیوتراپی')),
    'طرحِ درمان (فیلدِ عمومی) هست');
  ok(!body.includes('خصوصیِ پزشک'), '**فیلدِ بخشِ پزشک بیرون نمی‌رود**');
  ok(!body.includes('یادداشتِ داخلی'), 'یادداشتِ داخلی هم بیرون نمی‌رود');
  ok(!body.includes('500000') && !/amount|paid|total/.test(body), 'و هیچ عددِ مالی‌ای در سند نیست');
  ok(typeof pub.json?.nextVisitDateFa === 'string' && pub.json.nextVisitDateFa.includes('۱۴'),
    `ویزیتِ بعدی شمسی است (${pub.json?.nextVisitDateFa})`);
  const bad = await send('/public/visit-summary/xxxxxxxx', 'GET', null, false);
  ok(bad.status === 404, `توکنِ جعلی ۴۰۴ (${bad.status})`);

  console.log('\n۲) پیامکِ خلاصه به بیمار');
  const sms = (await send(`/visits/${visit.id}/summary-sms`, 'POST')).json;
  ok(sms?.to === '09120000711', `به شمارهٔ خودِ پرونده (${sms?.to})`);
  ok(sms?.sent === true || sms?.stub === true, `نتیجهٔ ارسال گزارش می‌شود (stub=${sms?.stub})`);

  console.log('\n۳) دفترِ یادآوری‌ها');
  const cnt = (st) => Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${visit.id} AND status='${st}'`));
  ok(cnt('pending') === 1, 'ثبتِ ویزیتِ بعدی یک pending کاشت');
  ok(sql(`SELECT phone FROM reminders WHERE visit_id=${visit.id} AND status='pending'`) === '09120000711',
    'با شمارهٔ بیمار');
  ok(sql(`SELECT text FROM reminders WHERE visit_id=${visit.id} AND status='pending'`).includes('یادآوری'),
    'و متنِ یادآوری');
  const list = (await send('/reminders', 'GET')).json;
  ok(Array.isArray(list) && list.some((r) => r.visitCode?.endsWith(`-V1`) && r.status === 'pending'),
    'در فهرستِ ادمین دیده می‌شود');

  await send(`/visits/${visit.id}`, 'PATCH', { nextVisitDate: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString() });
  ok(cnt('pending') === 1 && cnt('cancelled') === 1, 'تغییرِ تاریخ: قبلی cancelled، تازه pending');

  await send(`/visits/${visit.id}`, 'PATCH', { nextVisitDate: null });
  ok(cnt('pending') === 0, 'پاک‌کردنِ تاریخ: هیچ pendingی نمی‌ماند');

  console.log('\n۴) sweep — سررسیده‌ها می‌روند');
  await send(`/visits/${visit.id}`, 'PATCH', { nextVisitDate: nextIso });
  sql(`UPDATE reminders SET due_at = now() - interval '1 minute' WHERE visit_id=${visit.id} AND status='pending'`);
  const sw = (await send('/reminders/sweep', 'POST')).json;
  /* بدونِ credentialِ پیامک (CI، توسعه) سرویس stub است و sweep «stub را ارسال
     نمی‌شمارد» (`send-reminders.ts`): ردیف `simulated` می‌شود و در شمارنده‌ها
     `skipped`؛ با credentialِ واقعی `sent`. هر دو یعنی سررسیده برداشته شد و
     `failed` باید صفر بماند. */
  ok(sw?.due >= 1 && sw?.failed === 0 && (sw?.sent ?? 0) + (sw?.skipped ?? 0) >= 1,
    `sweep سررسیده را برداشت (${JSON.stringify(sw)})`);
  /* فقط خودِ یادآوری — پیامکِ خلاصهٔ گامِ ۲ هم به‌عنوانِ notice با وضعیتِ
     sent در دفتر ثبت می‌شود (پروندهٔ الکترونیک) و نباید این را کج کند. */
  ok(Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${visit.id} AND kind='next_visit' AND status IN ('sent','simulated')`)) === 1,
    'وضعیتِ یادآوری sent/simulated شد — دیگر pending نیست');
  const sw2 = (await send('/reminders/sweep', 'POST')).json;
  ok((sw2?.due ?? 0) === 0, 'sweepِ دوم چیزی برای فرستادن ندارد — دوباره‌فرستی نیست');
} finally {
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}'`);
  sql(`DELETE FROM patients WHERE last_name='خلاصه' AND id NOT IN (SELECT patient_id FROM visits)`);
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
