/**
 * رفعِ باگ‌های میدانی + ویزیتِ پست‌آپِ خودکار (#62):
 *
 * - گاردِ ضدتکرارِ متن‌محور: متنِ یکسانِ رفته دوباره نمی‌رود، متنِ
 *   **اصلاح‌شده** می‌رود (گزارشِ میدانی: نسخهٔ قبلی پیامِ تازه را بلاک می‌کرد)؛
 *   یادآوریِ عمل هم با ویرایش‌های پیاپی دیگر تکرار نمی‌شود ولی تاریخِ
 *   عوض‌شده پیامِ تازه دارد.
 * - followUpFormReady: بدونِ فرمِ پیگیری، فرم صریح می‌گوید روزها بی‌اثرند.
 * - ویزیتِ پست‌آپِ خودکار: از nextVisitDateِ عمل یک مراجعهٔ مستقل (kind=clinic،
 *   موضوعِ پست‌آپ) ساخته می‌شود؛ تغییرِ تاریخ جابه‌جایش می‌کند، پاک‌شدن/لغوِ
 *   عمل لغوش می‌کند، و برگشتِ تاریخ همان ردیف را برمی‌گرداند (نه ردیفِ دوم).
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const PHONE = '09120000963';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'pv' + randomBytes(3).toString('hex');
const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const trash = { visits: [], forms: [] };
const plusD = (d) => new Date(Date.now() + d * 864e5);

try {
  console.log('۱) followUpFormReady — فرم صادقانه بگوید پیگیری می‌رود یا نه');
  const ready0 = (await send('/care-plan/timing', 'GET')).json;
  const hadFu = Number(sql(`SELECT count(*) FROM form_defs WHERE follow_up IS NOT NULL AND active = TRUE`)) > 0;
  ok(ready0?.followUpFormReady === hadFu, `پرچم با واقعیتِ دیتابیس می‌خواند (${ready0?.followUpFormReady}/${hadFu})`);
  const fuForm = (await send('/forms', 'POST', { key: `${tag}g`, title: 'پیگیریِ عمومی', scope: 'record' })).json;
  trash.forms.push(fuForm.id);
  await send(`/forms/${fuForm.id}/fields`, 'POST', { key: 'fuPain', label: 'درد' });
  await send(`/forms/${fuForm.id}`, 'PATCH', { followUp: 'general' });
  ok((await send('/care-plan/timing', 'GET')).json?.followUpFormReady === true,
    '**با ساختِ فرمِ پیگیری، پرچم true می‌شود**');

  console.log('\n۲) چیدمان: جراح/بیمارستان/فرمِ ویزیت');
  const surgeon = (await send('/surgeons', 'GET')).json?.[0]
    ?? (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: 'آزمون' })).json;
  const hospital = (await send('/hospitals', 'GET')).json?.[0]
    ?? (await send('/hospitals', 'POST', { name: '[pv] بیمارستان' })).json;
  /* فرزندِ پست‌آپ به یک نوعِ ویزیتِ غیرجراحی نیاز دارد — clinic اگر نیست بسازیم. */
  const hasClinic = Number(sql(`SELECT count(*) FROM form_defs WHERE scope='visit' AND active=TRUE AND visit_kind='clinic'`)) > 0;
  if (!hasClinic) {
    const cf = (await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' })).json;
    if (cf?.id) trash.forms.push(cf.id);
  }

  console.log('\n۳) گاردِ متن‌محور — متنِ اصلاح‌شده می‌رود، تکراری نه');
  const v1 = (await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'بیمارِ', lastName: 'متن‌گارد', phone: PHONE,
    opDate: new Date().toISOString(), surgeonId: surgeon.id, hospitalId: hospital.id,
    postOpCare: `مراقبتِ الفِ ${tag}`, postOpImmediate: true,
  })).json;
  trash.visits.push(v1.id);
  const postPend = () => Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${v1.id} AND kind='post_op_care' AND status='pending'`));
  ok(postPend() === 1, 'مراقبتِ فوری در صف نشست');
  sql(`UPDATE reminders SET status='sent', sent_at=now() WHERE visit_id=${v1.id} AND status='pending'`);
  await send(`/visits/${v1.id}`, 'PATCH', { postOpCare: `مراقبتِ الفِ ${tag}` });
  ok(postPend() === 0, '**متنِ یکسانِ رفته دوباره در صف نمی‌نشیند**');
  await send(`/visits/${v1.id}`, 'PATCH', { postOpCare: `مراقبتِ اصلاح‌شدهٔ ${tag}` });
  /* متنِ ثبت‌شده چندخطی است: پوششِ D07 («اگر عملِ شما انجام شده…») **پیش از**
     خودِ مراقبت می‌آید و `sql()` فقط خطِ اول را برمی‌گرداند — پس شرطِ متن در
     خودِ SQL سنجیده می‌شود، نه روی خطِ اول. */
  ok(postPend() === 1
    && Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${v1.id} AND kind='post_op_care' AND status='pending' AND text LIKE '%اصلاح‌شده%'`)) === 1,
    '**متنِ اصلاح‌شده پیامِ تازه می‌گیرد (باگِ میدانی)**');

  const sgPend = () => Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${v1.id} AND kind='surgery' AND status='pending'`));
  sql(`UPDATE reminders SET status='sent', sent_at=now() WHERE visit_id=${v1.id} AND status='pending'`);
  await send(`/visits/${v1.id}`, 'PATCH', { notes: 'ویرایشِ بی‌ربط' });
  ok(sgPend() === 0, '**ویرایشِ فرم دیگر یادآوریِ عملِ تکراری نمی‌فرستد**');
  await send(`/visits/${v1.id}`, 'PATCH', { opDate: plusD(1).toISOString() });
  ok(sgPend() === 1, 'تاریخِ عوض‌شده یادآوریِ تازه دارد (متنِ نو)');

  console.log('\n۴) ویزیتِ پست‌آپِ خودکار');
  const nv = plusD(7);
  const v2 = (await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'بیمارِ', lastName: 'پست‌آپی', phone: '09120000964',
    opDate: new Date().toISOString(), surgeonId: surgeon.id, hospitalId: hospital.id,
    nextVisitDate: nv.toISOString(),
  })).json;
  trash.visits.push(v2.id);
  const childRow = () => sql(`SELECT id || '|' || kind || '|' || coalesce(to_char(op_date,'YYYY-MM-DD'),'-') || '|' || op_status FROM visits WHERE follow_of_visit_id=${v2.id} ORDER BY id LIMIT 1`);
  const c1 = childRow();
  ok(!!c1 && c1.includes('|clinic|') && c1.includes(nv.toISOString().slice(0, 10)),
    `**مراجعهٔ مستقلِ پست‌آپ ساخته شد** (${c1})`);
  const childId = Number(c1.split('|')[0]);
  const childTopic = sql(`SELECT t.name FROM visits v JOIN visit_topics t ON t.id=v.topic_id WHERE v.id=${childId}`);
  ok((childTopic ?? '').includes('پست‌آپ'), `موضوعِ فرزند پست‌آپ است (${childTopic || '—'})`);
  ok((await send(`/visits/${v2.id}`, 'GET')).json?.followOfVisitId === null
    && (await send(`/visits/${childId}`, 'GET')).json?.followOfVisitId === v2.id,
    'نما زنجیره را برمی‌گرداند (فرزند → عمل)');

  /* تغییرِ تاریخِ ویزیتِ بعدی → همان فرزند جابه‌جا می‌شود، فرزندِ دوم ساخته نمی‌شود. */
  const nv2 = plusD(9);
  await send(`/visits/${v2.id}`, 'PATCH', { nextVisitDate: nv2.toISOString() });
  const cnt = Number(sql(`SELECT count(*) FROM visits WHERE follow_of_visit_id=${v2.id}`));
  ok(cnt === 1 && childRow().includes(nv2.toISOString().slice(0, 10)),
    '**تغییرِ تاریخ همان فرزند را جابه‌جا کرد (نه ردیفِ دوم)**');
  /* پاک‌کردنِ تاریخ → فرزندِ pending لغو؛ برگرداندن → همان ردیف برمی‌گردد. */
  await send(`/visits/${v2.id}`, 'PATCH', { nextVisitDate: null });
  ok(childRow().endsWith('|cancelled'), 'پاک‌شدنِ تاریخ فرزند را لغو کرد');
  await send(`/visits/${v2.id}`, 'PATCH', { nextVisitDate: nv2.toISOString() });
  ok(Number(sql(`SELECT count(*) FROM visits WHERE follow_of_visit_id=${v2.id}`)) === 1 && childRow().endsWith('|pending'),
    'برگشتِ تاریخ همان ردیف را زنده کرد');
  /* لغوِ خودِ عمل → فرزند هم لغو. */
  await send(`/visits/${v2.id}/status`, 'PATCH', { opStatus: 'cancelled', cancelReason: 'other' });
  ok(childRow().endsWith('|cancelled'), '**لغوِ عمل، ویزیتِ پست‌آپ را هم لغو می‌کند**');

  console.log('\n۵) مرورگر — بدونِ فلاشِ فهرستِ اشتباه + هشدارِ فرمِ پیگیری');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1150, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + '/login');
    await page.waitForTimeout(900);
    await page.fill('input[name="identifier"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app**', { timeout: 15000 });

    await page.goto(BASE + `/app/dashboard?patient=${v1.id}`);
    /* در لحظه‌های اول یا اسکلت است یا فهرستِ واقعی — هرگز دکمهٔ «پیگیری». */
    let sawGhost = false;
    for (let i = 0; i < 10; i++) {
      if (await page.locator('.db-kindrow button', { hasText: 'پیگیری' }).count() > 0) sawGhost = true;
      await page.waitForTimeout(150);
    }
    ok(!sawGhost, '**در هیچ لحظه‌ای فهرستِ هاردکدِ قدیمی (با «پیگیری») دیده نشد**');
    await page.waitForTimeout(1500);
    const kindBtns = await page.locator('.db-kindrow button').allInnerTexts();
    ok(kindBtns.length > 0 && !kindBtns.some((x) => x.trim() === 'پیگیری'),
      `فهرستِ نهایی همان فرم‌های واقعی است (${kindBtns.join('، ')})`);
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE phone IN ('${PHONE}','09120000964'))`);
  sql(`DELETE FROM visits WHERE follow_of_visit_id IN (${trash.visits.join(',') || 0})`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'PATCH', { followUp: null }).catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM patients WHERE phone IN ('${PHONE}','09120000964') AND id NOT IN (SELECT patient_id FROM visits)`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
