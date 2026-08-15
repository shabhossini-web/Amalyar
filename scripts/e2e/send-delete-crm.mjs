/**
 * سه قابلیتِ تازهٔ ثبت‌نام — ارسالِ مستقیم، حذف، و تحلیل (CRM):
 *
 * ۱. **ارسالِ مستقیمِ فرمِ زیرپرونده از کارتِ مراجعه** (`POST /intake/send`):
 *    بدونِ صفحهٔ مشخصات — هویت از پرونده می‌آید و فرم با `/f/<token>` مستقیم
 *    باز می‌شود. فقط فرمِ record؛ ثبت‌نامِ بازِ قبلی دوباره استفاده می‌شود نه
 *    اینکه هر «ارسال» یک ردیفِ نیمه‌کارهٔ تازه بکارد.
 * ۲. **حذف**: حذفِ ثبت‌نام نوبتِ نگه‌داشته را آزاد می‌کند؛ تأییدشده‌ای که
 *    مراجعه ساخته حذف نمی‌شود؛ حذفِ لینک ثبت‌نام‌های موجود را نمی‌بلعد
 *    (SetNull).
 * ۳. **تحلیل** (`GET /intake/analytics`): توزیعِ select/rating و متن‌ها از
 *    پاسخ‌های واقعی درمی‌آید و کانالِ آشناییِ بیماران شمرده می‌شود.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtAc ${JSON.stringify(q)}`).toString().trim().split('\n')[0];

/* برچسبِ تصادفی — کلیدِ فرم سراسری‌یکتاست و اجرای دوم نباید به جنازهٔ اجرای
   قبل بخورد (همان درسِ record-direct). */
const tag = 'sd' + randomBytes(3).toString('hex');
const nid = (n) => {
  const base = String(n).padStart(9, '0').slice(-9);
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(base[i]) * (10 - i);
  const r = s % 11;
  return base + String(r < 2 ? r : 11 - r);
};
const seed = parseInt(randomBytes(3).toString('hex'), 16) % 900000 + 100000;
const NID = nid(seed);

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — ' + JSON.stringify(login)); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b, auth = true) => fetch(API + p, {
  method: m, headers: auth ? A : { 'Content-Type': 'application/json' },
  body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());
const CAP = { captchaA: 3, captchaB: 4, captchaAnswer: 7 };

const trash = { forms: [], visits: [], links: [] };

try {
  /* ── چیدمان: فرمِ نظرسنجی (record) + فرمِ ویزیت + بیمار از لینکِ عمومی ── */
  const survey = (await send('/forms', 'POST', { key: `${tag}s`, title: 'نظرسنجیِ آزمون', scope: 'record' })).json;
  const visitForm = (await send('/forms', 'POST', { key: `${tag}v`, title: 'ویزیتِ آزمون', scope: 'visit' })).json;
  if (!survey?.id || !visitForm?.id) { console.error('فرم ساخته نشد'); process.exit(1); }
  trash.forms.push(survey.id, visitForm.id);
  await send(`/forms/${survey.id}/fields`, 'POST', {
    key: 'howFound', label: 'از کجا آشنا شدید؟', type: 'select',
    options: [{ v: 'insta', l: 'اینستاگرام' }, { v: 'friend', l: 'معرفیِ دوست' }],
  });
  await send(`/forms/${survey.id}/fields`, 'POST', { key: 'score', label: 'رضایتِ کلی', type: 'rating' });
  await send(`/forms/${survey.id}/fields`, 'POST', { key: 'note', label: 'نظرِ شما', type: 'textarea' });

  const link = (await send('/intake/links', 'POST', { title: `لینکِ ${tag}`, amount: 0 })).json;
  trash.links.push(link.id);
  const reg = await send(`/public/intake/link/${link.token}/register`, 'POST',
    { firstName: 'بیمارِ', lastName: 'سنجش', nationalId: NID, phone: '09120000611', ...CAP }, false);
  if (reg.status >= 300) { console.error('ثبت‌نامِ پایه نشد: ' + JSON.stringify(reg.json)); process.exit(1); }
  const patientId = Number(sql(`SELECT id FROM patients WHERE national_id='${NID}'`));
  ok(Number.isInteger(patientId) && patientId > 0, `بیمارِ آزمون ساخته شد (#${patientId})`);

  console.log('\n۱) ارسالِ مستقیم فقط برای فرمِ زیرپرونده');
  const wrong = await send('/intake/send', 'POST', { patientId, formId: visitForm.id });
  ok(wrong.status === 400, `فرمِ مراجعه‌ساز رد شد (${wrong.status})`);
  /* بدونِ شمارهٔ معتبر «ارسال» معنایی ندارد — پیش از هر ساختی ۴۰۰. */
  sql(`UPDATE patients SET phone='123' WHERE id=${patientId}`);
  const noPhone = await send('/intake/send', 'POST', { patientId, formId: survey.id });
  ok(noPhone.status === 400 && /شماره/.test(noPhone.json?.message ?? ''),
    `شمارهٔ نامعتبرِ پرونده رد شد (${noPhone.status} — «${noPhone.json?.message}»)`);
  sql(`UPDATE patients SET phone='09120000611' WHERE id=${patientId}`);
  const sent = await send('/intake/send', 'POST', { patientId, formId: survey.id });
  ok(sent.status < 300 && !!sent.json?.token, `فرمِ record فرستاده شد (${sent.status})`);
  ok(sent.json?.reused === false, 'بارِ اول reused=false');
  /* «ارسال» یعنی پیامک به شمارهٔ پرونده — در dev سرویسِ پیامک stub است ولی
     مقصد و نشانی باید درست باشند. */
  ok(sent.json?.to === '09120000611', `پیامک به شمارهٔ خودِ پرونده (${sent.json?.to})`);
  ok(typeof sent.json?.url === 'string' && sent.json.url.includes(`/f/${sent.json.token}`),
    'و متنِ پیامک نشانیِ مستقیمِ فرم را دارد (/f/…)');
  ok(sent.json?.sent === true || sent.json?.stub === true,
    `نتیجهٔ پیامک گزارش می‌شود (sent=${sent.json?.sent}, stub=${sent.json?.stub})`);

  console.log('\n۲) فرمِ مستقیم بدونِ صفحهٔ مشخصات باز می‌شود و پیش‌پُر است');
  const view = await send(`/public/intake/form/${sent.json.token}`, 'GET', null, false);
  ok(view.status === 200, `نمای عمومی با توکن باز شد (${view.status})`);
  ok(view.json?.data?.firstName === 'بیمارِ', `نام از پرونده پیش‌پُر است («${view.json?.data?.firstName}»)`);
  ok((view.json?.payable ?? view.json?.amount ?? 0) === 0, 'و مبلغی در کار نیست');

  const again = await send('/intake/send', 'POST', { patientId, formId: survey.id });
  ok(again.json?.reused === true && again.json?.token === sent.json.token,
    'ارسالِ دوباره همان ثبت‌نامِ باز را برمی‌گرداند، نه نسخهٔ دوم');

  console.log('\n۳) پر کردن — و ورودِ پاسخ‌ها به تحلیل');
  const fill = await send(`/public/intake/form/${sent.json.token}/fill`, 'POST',
    { values: { howFound: 'insta', score: 5, note: 'برخوردِ تیم عالی بود' } }, false);
  ok(fill.status < 300, `پر شد (${fill.status} — ${fill.json?.status})`);
  const an = await get('/intake/analytics');
  const af = (an.forms ?? []).find((f) => f.id === survey.id);
  ok(!!af, 'فرمِ نظرسنجی در تحلیل هست');
  ok(af?.filled >= 1, `دستِ‌کم یک پاسخِ کامل شمرده شد (${af?.filled})`);
  ok(af?.direct >= 1, `و به‌عنوانِ ارسالِ مستقیم (${af?.direct})`);
  const howFound = af?.fields?.find((x) => x.key === 'howFound');
  const insta = howFound?.dist?.find((d) => d.value === 'insta');
  ok(insta?.count >= 1 && insta?.label === 'اینستاگرام',
    `توزیعِ select با برچسبِ گزینه («${insta?.label}»: ${insta?.count})`);
  const score = af?.fields?.find((x) => x.key === 'score');
  ok(score?.avg >= 1, `میانگینِ امتیاز حساب شد (${score?.avg})`);
  const note = af?.fields?.find((x) => x.key === 'note');
  ok((note?.answers ?? []).some((a) => a.text.includes('عالی')), 'متنِ نظر در تحلیل خواندنی است');
  ok((an.referrals ?? []).length >= 1 && an.patientsTotal >= 1,
    `کانالِ آشنایی شمرده شد (${an.patientsTotal} پرونده)`);

  console.log('\n۴) حذفِ ثبت‌نام — نوبتِ نگه‌داشته آزاد می‌شود');
  /* بعد از تأییدِ خودکارِ نظرسنجی، ارسالِ تازه باید ثبت‌نامِ تازه بسازد. */
  const sent2 = await send('/intake/send', 'POST', { patientId, formId: survey.id });
  ok(sent2.json?.reused === false && sent2.json?.token !== sent.json.token,
    'بعدِ بسته‌شدنِ قبلی، ارسالِ تازه توکنِ تازه می‌سازد');
  const sub2 = Number(sql(`SELECT id FROM intake_submissions WHERE token='${sent2.json.token}'`));
  const apptId = Number(sql(`INSERT INTO appointments (patient_id, date, status, submission_id, created_at, updated_at) VALUES (${patientId}, CURRENT_DATE, 'held', ${sub2}, now(), now()) RETURNING id`));
  const del = await send(`/intake/submissions/${sub2}`, 'DELETE');
  ok(del.status < 300, `حذف شد (${del.status})`);
  ok(sql(`SELECT status FROM appointments WHERE id=${apptId}`) === 'cancelled', '**نوبتِ نگه‌داشته آزاد شد**');
  ok(sql(`SELECT count(*) FROM intake_submissions WHERE id=${sub2}`) === '0', 'ردیف واقعاً رفت');
  sql(`DELETE FROM appointments WHERE id=${apptId}`);

  console.log('\n۵) تأییدشده‌ای که مراجعه ساخته حذف نمی‌شود');
  const visit = (await send('/visits', 'POST', {
    kind: tag + 'v', firstName: 'بیمارِ', lastName: 'سنجش', opDate: new Date().toISOString(),
  })).json;
  if (visit?.id) trash.visits.push(visit.id);
  const approvedId = Number(sql(
    `SELECT id FROM intake_submissions WHERE token='${sent.json.token}'`));
  sql(`UPDATE intake_submissions SET status='approved', visit_id=${visit.id} WHERE id=${approvedId}`);
  const blocked = await send(`/intake/submissions/${approvedId}`, 'DELETE');
  ok(blocked.status === 400, `حذف رد شد (${blocked.status})`);
  ok(/مراجعه/.test(blocked.json?.message ?? ''), `و پیام راه را می‌گوید («${blocked.json?.message}»)`);
  sql(`UPDATE intake_submissions SET visit_id=NULL WHERE id=${approvedId}`);

  console.log('\n۶) حذفِ لینک ثبت‌نام‌ها را نمی‌بلعد');
  const regSubId = Number(sql(
    `SELECT id FROM intake_submissions WHERE link_id=${link.id} ORDER BY id DESC LIMIT 1`));
  ok(regSubId > 0, 'ثبت‌نامِ روی لینک سرِ جایش است');
  const delLink = await send(`/intake/links/${link.id}`, 'DELETE');
  ok(delLink.status < 300, `لینک حذف شد (${delLink.status})`);
  ok(sql(`SELECT count(*) FROM intake_links WHERE id=${link.id}`) === '0', 'لینک واقعاً رفت');
  ok(sql(`SELECT count(*) FROM intake_submissions WHERE id=${regSubId}`) === '1',
    '**ثبت‌نامش ماند** (SetNull)');
  ok(sql(`SELECT link_id IS NULL FROM intake_submissions WHERE id=${regSubId}`) === 't',
    'و دیگر به لینکی وصل نیست');
  trash.links.length = 0;
} finally {
  /* ── پاک‌سازی — تا اجرای دوم هم تمیز شروع شود ── */
  sql(`DELETE FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE national_id='${NID}')`);
  sql(`DELETE FROM intake_submissions WHERE patient_id IN (SELECT id FROM patients WHERE national_id='${NID}')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM visits WHERE patient_id IN (SELECT id FROM patients WHERE national_id='${NID}')`);
  sql(`DELETE FROM patients WHERE national_id='${NID}'`);
  for (const id of trash.links) await send(`/intake/links/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
