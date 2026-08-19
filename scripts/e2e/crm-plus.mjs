/**
 * ادامهٔ CRM — سه قابلیت (#45):
 *
 * ۱. **روندِ ماهانهٔ شمسی** (`analytics.trend`): ۱۲ سطلِ ماهِ شمسی؛ حجمِ
 *    ثبت‌نام (کل + پرشده) و میانگینِ رضایت از فیلدهای rating فرم‌های
 *    زیرپرونده — فقط پرشده‌ها.
 * ۲. **پیگیری‌نشده‌ها** (`GET /intake/unfollowed`): عملِ انجام‌شده بدونِ
 *    فرمِ پیگیریِ پرشده بعد از تاریخِ عمل؛ fail-soft وقتی فرمِ پیگیری
 *    تعریف نشده؛ پرشدنِ فرم ردیف را می‌بندد.
 * ۳. **CSV**: پاسخ‌های یک فرم (`/intake/analytics/csv?formId=`) و فهرستِ
 *    پیگیری‌نشده‌ها (`/intake/unfollowed/csv`) — BOM + برچسبِ گزینه نه مقدارِ خام.
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

const tag = 'cp' + randomBytes(3).toString('hex');

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
/* BOM را از بایت‌ها می‌سنجیم: `text()`ِ استاندارد BOM را بی‌صدا برمی‌دارد و
   ادعای «BOM دارد» روی رشته همیشه دروغِ قرمز می‌شد. */
const getText = (p) => fetch(API + p, { headers: A }).then(async (r) => {
  const buf = new Uint8Array(await r.arrayBuffer());
  return {
    status: r.status,
    type: r.headers.get('content-type') ?? '',
    bom: buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf,
    text: new TextDecoder('utf-8').decode(buf),
  };
});
const pub = (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const trash = { forms: [], visits: [] };

try {
  /* ── چیدمان: نظرسنجی با rating + بیمار + پاسخِ پرشده ── */
  const survey = (await send('/forms', 'POST', { key: `${tag}s`, title: 'نظرسنجیِ روند', scope: 'record' })).json;
  trash.forms.push(survey.id);
  await send(`/forms/${survey.id}/fields`, 'POST', { key: 'cpScore', label: 'رضایتِ کلی', type: 'rating' });
  await send(`/forms/${survey.id}/fields`, 'POST', {
    key: 'cpVia', label: 'از کجا؟', type: 'select',
    options: [{ v: 'insta', l: 'اینستاگرام' }, { v: 'friend', l: 'معرفیِ دوست' }],
  });

  /* بیمار از راهِ مراجعهٔ دستی — فرمِ surgery جراح/بیمارستانِ اجباری دارد؛
     مثلِ suiteِ پیگیری با kindِ سبکِ آزمون می‌سازیم و بعد SQL جراحی‌اش می‌کنیم. */
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ روند', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const op = new Date(Date.now() - 20 * 864e5);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'روندسنج', phone: '09120000771',
    opDate: op.toISOString(),
  })).json;
  if (!visit?.id) { console.error('مراجعه ساخته نشد: ' + JSON.stringify(visit)); process.exit(1); }
  trash.visits.push(visit.id);
  sql(`UPDATE visits SET kind='surgery' WHERE id=${visit.id}`);
  const patientId = visit.patientId;

  /* ارسالِ مستقیمِ نظرسنجی → پر کردن (direct → approved). */
  const sent = (await send('/intake/send', 'POST', { patientId, formId: survey.id })).json;
  const stoken = sent?.token ?? sql(`SELECT token FROM intake_submissions WHERE patient_id=${patientId} AND form_id=${survey.id} ORDER BY id DESC LIMIT 1`);
  const fill = await pub(`/public/intake/form/${stoken}/fill`, 'POST', { values: { cpScore: '4', cpVia: 'friend' } });
  ok(fill.status === 200 || fill.status === 201, `نظرسنجی پر شد (${fill.status})`);

  console.log('\n۱) روندِ ماهانهٔ شمسی');
  const an = await get('/intake/analytics');
  ok(Array.isArray(an.trend) && an.trend.length === 12, `۱۲ سطلِ ماهانه (${an.trend?.length})`);
  const cur = an.trend?.[11];
  ok(cur && cur.total >= 1, `ماهِ جاری ثبت‌نام دارد (${cur?.total})`);
  ok(cur && cur.filled >= 1, `پرشدهٔ ماهِ جاری شمرده شد (${cur?.filled})`);
  ok(cur && cur.ratingCount >= 1 && cur.ratingAvg !== null && cur.ratingAvg >= 1 && cur.ratingAvg <= 5,
    `رضایتِ ماهِ جاری از rating آمد (${cur?.ratingAvg} از ${cur?.ratingCount} پاسخ)`);
  const mono = (an.trend ?? []).every((m, i, a) => i === 0
    || m.jy > a[i - 1].jy || (m.jy === a[i - 1].jy && m.jm === a[i - 1].jm + 1));
  ok(mono, 'ماه‌ها متوالی‌اند (بدونِ جاافتادگی)');

  console.log('\n۲) پیگیری‌نشده‌ها');
  /* هنوز فرمِ پیگیری‌ای با این برچسبِ آزمون تعریف نشده؛ اگر نصب هم فرمِ
     پیگیری ندارد باید fail-soft باشد. حالتِ سراسری را ثابت نمی‌گیریم چون
     suiteهای دیگر ممکن است فرمِ پیگیری کاشته باشند — enabled را می‌سازیم. */
  const fu = (await send('/forms', 'POST', { key: `${tag}f`, title: 'پیگیریِ روند', scope: 'record' })).json;
  trash.forms.push(fu.id);
  await send(`/forms/${fu.id}/fields`, 'POST', { key: 'cpPain', label: 'شدتِ درد' });
  ok((await send(`/forms/${fu.id}`, 'PATCH', { followUp: 'general' })).status === 200, 'فرمِ پیگیریِ عمومی تعریف شد');

  /* عملِ انجام‌شده در گذشته، بدونِ فرمِ پیگیریِ پرشده → باید در فهرست باشد. */
  await send(`/visits/${visit.id}/status`, 'PATCH', { opStatus: 'done' });
  let u = await get('/intake/unfollowed');
  ok(u.enabled === true, 'قابلیت روشن است');
  let row = (u.rows ?? []).find((r) => r.visitId === visit.id);
  ok(!!row, '**عملِ انجام‌شدهٔ بی‌پیگیری در فهرست است**');
  ok(row && row.patientId === patientId && typeof row.daysSince === 'number' && row.daysSince >= 19,
    `ردیف پرونده و روزشمار دارد (${row?.daysSince} روز)`);
  ok(row && ['none', 'pending', 'sent'].includes(row.sms), `وضعیتِ پیامک گزارش می‌شود (${row?.sms})`);
  /* نظرسنجیِ پرشده فرمِ پیگیری نیست — نباید ردیف را بسته باشد. */
  const surveySt = sql(`SELECT status FROM intake_submissions WHERE patient_id=${patientId} AND form_id=${survey.id} ORDER BY id DESC LIMIT 1`);
  ok(surveySt === 'approved' && !!row, `فرمِ غیرپیگیریِ پرشده (${surveySt}) پیگیری حساب نمی‌شود`);

  /* پر شدنِ فرمِ پیگیری → ردیف بسته می‌شود. */
  await send('/intake/send', 'POST', { patientId, formId: fu.id });
  const ftoken = sql(`SELECT token FROM intake_submissions WHERE patient_id=${patientId} AND form_id=${fu.id} ORDER BY id DESC LIMIT 1`);
  const ffill = await pub(`/public/intake/form/${ftoken}/fill`, 'POST', { values: { cpPain: 'کم' } });
  ok(ffill.status === 200 || ffill.status === 201, `فرمِ پیگیری پر شد (${ffill.status})`);
  u = await get('/intake/unfollowed');
  row = (u.rows ?? []).find((r) => r.visitId === visit.id);
  ok(!row, '**بعد از پر شدنِ فرمِ پیگیری، ردیف بسته شد**');
  ok(u.followed >= 1, `شمارندهٔ پیگیری‌شده‌ها بالا رفت (${u.followed})`);

  /* عملِ pending (انجام‌نشده) در فهرست نمی‌آید. */
  const v2 = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'انجام‌نشده', phone: '09120000772',
    opDate: new Date(Date.now() - 5 * 864e5).toISOString(),
  })).json;
  trash.visits.push(v2.id);
  sql(`UPDATE visits SET kind='surgery' WHERE id=${v2.id}`);
  u = await get('/intake/unfollowed');
  ok(!(u.rows ?? []).some((r) => r.visitId === v2.id), 'عملِ هنوز انجام‌نشده در فهرست نیست');

  console.log('\n۳) خروجیِ CSV');
  const csv = await getText(`/intake/analytics/csv?formId=${survey.id}`);
  ok(csv.status === 200 && csv.type.includes('text/csv'), `CSVِ فرم با نوعِ درست (${csv.type})`);
  ok(csv.bom, 'BOM دارد (اکسلِ فارسی)');
  ok(csv.text.includes('رضایتِ کلی') && csv.text.includes('از کجا؟'), 'سطرِ عنوان برچسبِ فیلدها را دارد');
  ok(csv.text.includes('بیمارِ روندسنج'), 'ردیفِ بیمارِ پرکرده هست');
  ok(csv.text.includes('معرفیِ دوست') && !csv.text.split('\n').slice(1).join('\n').includes(',friend,'),
    '**برچسبِ گزینه می‌آید نه مقدارِ خام**');
  const notFound = await getText('/intake/analytics/csv?formId=999999');
  ok(notFound.status === 404, `فرمِ ناموجود ۴۰۴ (${notFound.status})`);

  const ucsv = await getText('/intake/unfollowed/csv');
  ok(ucsv.status === 200 && ucsv.bom && ucsv.text.includes('تاریخِ عمل'),
    'CSVِ پیگیری‌نشده‌ها سالم است');
  ok(!ucsv.text.includes('بیمارِ روندسنج'), 'بیمارِ پیگیری‌شده در CSV نیست');
} finally {
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM intake_submissions WHERE patient_id IN (SELECT id FROM patients WHERE phone IN ('09120000771','09120000772'))`);
  sql(`DELETE FROM patients WHERE phone IN ('09120000771','09120000772')`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
