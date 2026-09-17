/**
 * مراقبتِ قبل/بعدِ عمل (قالبِ هر نوعِ عمل) + یادآوریِ نوبت:
 * - قالب روی نوعِ عمل ذخیره می‌شود؛ جراحیِ آینده با آن نوع → سه یادآوری
 *   (عمل، مراقبتِ قبل، مراقبتِ بعد) با متنِ قالب
 * - قالبِ خالی → یادآوریِ مراقبت کاشته نمی‌شود
 * - نوبتِ حضوریِ فردا → یادآوریِ appointment؛ لغوِ نوبت → cancelled
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

const tag = 'cr' + randomBytes(3).toString('hex');
const trash = { forms: [], visits: [], procs: [], rules: [] };

try {
  console.log('۱) قالبِ مراقبت روی نوعِ عمل');
  const proc = (await send('/procedure-types', 'POST', {
    name: `عملِ ${tag}`,
    preOpCare: 'از ۸ ساعت قبل ناشتا باشید و داروهای رقیق‌کننده را قطع کنید.',
    postOpCare: 'پانسمان را خشک نگه دارید؛ در صورتِ تب تماس بگیرید.',
  })).json;
  trash.procs.push(proc.id);
  ok(!!proc?.id, `نوعِ عمل با قالب ساخته شد (#${proc?.id})`);
  const patched = await send(`/procedure-types/${proc.id}`, 'PATCH', { preOpCare: 'ناشتاییِ ۱۰ ساعته.' });
  ok(patched.status === 200, 'و قالب ویراستنی است');

  const form = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ مراقبت', scope: 'visit' })).json;
  trash.forms.push(form.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'مراقبت', phone: '09120000911',
    opDate: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(),
    procedureTypeId: proc.id,
  })).json;
  trash.visits.push(visit.id);
  sql(`UPDATE visits SET kind='surgery' WHERE id=${visit.id}`);
  await send(`/visits/${visit.id}`, 'PATCH', { opDate: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString() });

  console.log('\n۲) سه یادآوریِ جراحی');
  const cnt = (kind) => Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${visit.id} AND kind='${kind}' AND status='pending'`));
  ok(cnt('surgery') === 1, 'عملِ پیشِ‌رو');
  ok(cnt('pre_op_care') === 1, 'مراقبتِ قبل از عمل');
  ok(cnt('post_op_care') === 1, 'مراقبتِ بعد از عمل');
  ok(sql(`SELECT text FROM reminders WHERE visit_id=${visit.id} AND kind='pre_op_care' AND status='pending'`).includes('ناشتاییِ ۱۰'),
    '**متنِ مراقبت از قالبِ ویراستهٔ نوعِ عمل می‌آید**');
  const preDue = sql(`SELECT (due_at < (SELECT due_at FROM reminders WHERE visit_id=${visit.id} AND kind='surgery' AND status='pending')) FROM reminders WHERE visit_id=${visit.id} AND kind='pre_op_care' AND status='pending'`);
  ok(preDue === 't', 'مراقبتِ قبل زودتر از یادآوریِ عمل می‌رود');
  const postDue = sql(`SELECT (due_at > op_date) FROM reminders r JOIN visits v ON v.id=r.visit_id WHERE r.visit_id=${visit.id} AND r.kind='post_op_care' AND r.status='pending'`);
  ok(postDue === 't', 'مراقبتِ بعد، بعد از روزِ عمل می‌رود');

  /* قالبِ خالی → یادآوریِ مراقبت نه */
  await send(`/procedure-types/${proc.id}`, 'PATCH', { preOpCare: '', postOpCare: '' });
  await send(`/visits/${visit.id}`, 'PATCH', { opDate: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString() });
  ok(cnt('pre_op_care') === 0 && cnt('post_op_care') === 0 && cnt('surgery') === 1,
    'قالبِ خالی: مراقبت‌ها نمی‌آیند ولی یادآوریِ عمل می‌ماند');

  console.log('\n۳) یادآوریِ نوبت (حضوری)');
  /* نوبتِ حضوری از مسیرِ ظرفیت می‌گذرد — اول یک برنامهٔ کاریِ گذرا برای همهٔ
     روزها (حالتِ اسلاتی) باز می‌شود و در پایان جمع می‌شود. */
  for (let w = 0; w < 7; w++) {
    const rule = (await send('/availability/rules', 'POST', {
      weekday: w, startMin: 9 * 60, endMin: 12 * 60, mode: 'slot', slotMinutes: 30,
    })).json;
    if (rule?.id) trash.rules.push(rule.id);
  }
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const apptRes = await send('/appointments', 'POST', { patientId: visit.patientId, date: tomorrow, startMin: 9 * 60 });
  const appt = apptRes.json;
  ok(!!appt?.id, `نوبتِ فردا ثبت شد (${apptRes.status} — #${appt?.id ?? JSON.stringify(appt).slice(0, 80)})`);
  const acnt = (st) => Number(sql(`SELECT count(*) FROM reminders WHERE appointment_id=${appt.id} AND kind='appointment' AND status='${st}'`));
  ok(acnt('pending') === 1, 'یادآوریِ نوبت کاشته شد');
  ok(sql(`SELECT text FROM reminders WHERE appointment_id=${appt.id} AND status='pending'`).includes('یادآوری نوبت'),
    'با متنِ نوبت');
  await send(`/appointments/${appt.id}/status`, 'POST', { status: 'cancelled', cancelReason: 'other' });
  ok(acnt('pending') === 0 && acnt('cancelled') === 1, '**لغوِ نوبت یادآوری را باطل می‌کند**');
} finally {
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE last_name='مراقبت')`);
  sql(`DELETE FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE last_name='مراقبت')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}' OR (kind='surgery' AND patient_id IN (SELECT id FROM patients WHERE last_name='مراقبت'))`);
  sql(`DELETE FROM patients WHERE last_name='مراقبت' AND id NOT IN (SELECT patient_id FROM visits)`);
  for (const id of trash.rules) await fetch(API + `/availability/rules/${id}`, { method: 'DELETE', headers: A }).catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs) sql(`DELETE FROM procedure_types WHERE id=${id} AND id NOT IN (SELECT procedure_type_id FROM visits WHERE procedure_type_id IS NOT NULL)`);
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
