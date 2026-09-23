/**
 * «همهٔ شرح‌های فرم‌ها در تبِ شرح‌های پرونده» — بدهیِ گزارش‌شده:
 * - textarea های فرمِ مراجعه (مثلِ قبل) + فیلدِ متنیِ تک‌خطی که برچسبش
 *   شرح/توضیح/گزارش دارد
 * - فیلدِ متنیِ بی‌ربط (کدِ بیمه) نمی‌آید
 * - پاسخ‌های متنیِ فرم‌های **زیرپرونده** (شرحِ حال/پیگیری) هم می‌آیند، با
 *   عنوانِ فرم به‌جای کدِ مراجعه
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
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const pub = (p, m, b) => fetch(API + p, { method: m ?? 'GET', headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'rt' + randomBytes(3).toString('hex');
const trash = { forms: [], visits: [] };

try {
  console.log('۱) شرح‌های فرمِ مراجعه');
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ شرح', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  /* کلید `examNote` نه `exam`: از بستهٔ ۶الف `exam` کلیدِ رزروِ هستهٔ ثابت است
     (شرحِ بخشی → ClinicalNote). این سوییت دربارهٔ textareaی سفارشی است. */
  await send(`/forms/${vform.id}/fields`, 'POST', { key: 'examNote', label: 'شرحِ معاینه', type: 'textarea' });
  await send(`/forms/${vform.id}/fields`, 'POST', { key: 'brief', label: 'شرحِ کوتاه', type: 'text' });
  await send(`/forms/${vform.id}/fields`, 'POST', { key: 'insNo', label: 'کدِ بیمه', type: 'text' });
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'شرح‌ها', phone: '09120000920',
    opDate: new Date().toISOString(), notes: 'یادداشتِ خودِ مراجعه',
    extra: { examNote: 'متنِ کاملِ معاینه', brief: 'یک خطِ خلاصه', insNo: '12345' },
  })).json;
  trash.visits.push(visit.id);

  let rec = (await send(`/patients/${visit.patientId}/record`, 'GET')).json;
  const labels = (rec.visitTexts ?? []).map((t) => t.label);
  ok(labels.includes('شرحِ معاینه'), 'textarea می‌آید');
  ok(labels.includes('شرحِ کوتاه'), '**فیلدِ متنیِ تک‌خطیِ «شرح…» هم می‌آید**');
  ok(labels.includes('یادداشتِ مراجعه'), 'یادداشتِ builtin می‌آید');
  ok(!labels.includes('کدِ بیمه'), '**فیلدِ متنیِ بی‌ربط (کدِ بیمه) نمی‌آید**');

  console.log('\n۲) شرح‌های فرمِ زیرپرونده');
  const rform = (await send('/forms', 'POST', { key: `${tag}r`, title: 'شرحِ حالِ آزمون', scope: 'record' })).json;
  trash.forms.push(rform.id);
  /* ⚠️ `history` در فرمِ زیرپرونده **مجاز** است — رزروِ هستهٔ ثابت فقط برای
     فرمی است که مراجعه می‌سازد. */
  const hist = await send(`/forms/${rform.id}/fields`, 'POST', { key: 'history', label: 'شرحِ حالِ بیمار', type: 'textarea' });
  ok(hist.status < 300, `کلیدِ history در فرمِ زیرپرونده ساخته می‌شود (${hist.status})`);
  const sent = (await send('/intake/send', 'POST', { patientId: visit.patientId, formId: rform.id })).json;
  const fill = await pub(`/public/intake/form/${sent.token}/fill`, 'POST', {
    values: { history: 'سابقهٔ کاملِ بیماری این‌جاست' },
  });
  ok(fill.json?.status === 'approved', `فرمِ زیرپرونده پر و تأیید شد (${fill.status})`);

  rec = (await send(`/patients/${visit.patientId}/record`, 'GET')).json;
  const row = (rec.visitTexts ?? []).find((t) => t.label === 'شرحِ حالِ بیمار');
  ok(!!row, '**شرحِ فرمِ زیرپرونده هم در تبِ شرح‌ها نشسته**');
  ok(row?.code === 'شرحِ حالِ آزمون', 'با عنوانِ فرم به‌جای کدِ مراجعه');
  ok(row?.body === 'سابقهٔ کاملِ بیماری این‌جاست', 'با متنِ کامل');
  ok((rec.counts?.visitTexts ?? 0) >= 4, `شمارندهٔ چیپ هر چهار شرح را می‌شمارد (${rec.counts?.visitTexts})`);
} finally {
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE last_name='شرح‌ها')`);
  sql(`DELETE FROM intake_submissions WHERE patient_id IN (SELECT id FROM patients WHERE last_name='شرح‌ها')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}'`);
  sql(`DELETE FROM patients WHERE last_name='شرح‌ها' AND id NOT IN (SELECT patient_id FROM visits)`);
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
