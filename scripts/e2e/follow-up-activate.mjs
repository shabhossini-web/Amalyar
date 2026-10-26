/**
 * فرمِ پیگیری «رهاشده» نماند — گزارشِ مالک (۱۴۰۵/۰۸/۰۴): «یه کلیدی تو فرمساز هست به اسم فرم
 * پیگیری ولی کاری نمی‌کنه». سه علت داشت و هر سه این‌جا سنجیده می‌شوند:
 * ۱) فرمِ نصب‌شده خاموش بود و هیچ راهی برای روشن‌کردنش در فرم‌ساز نبود → `PATCH {active}`
 *    + کارتِ آمادگی (`/forms/:id/follow-up-status`) که می‌گوید چرا نمی‌رود.
 * ۲) روشن‌کردنِ فرم یا تعیینِ روزهای پیگیری روی نوعِ عمل فقط روی مراجعه‌ای اثر داشت که
 *    **بعدش** ویرایش می‌شد → حالا عمل‌های پیشِ‌رو همان لحظه زمان‌بندی می‌شوند.
 * ۳) فهرستِ «پیگیری‌نشده» با فرمِ خاموش هم همه را پیگیری‌نشده نشان می‌داد.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'fa' + randomBytes(3).toString('hex');
const trash = { forms: [], visits: [], procs: [] };
let restoreActive = '';
const pendingFu = (vid) => Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${vid} AND kind='follow_up' AND status='pending'`));

try {
  /* فرم‌های پیگیریِ روشنِ دیگر (سوییت‌های قبلی، نصبِ واقعی) موقتاً خاموش می‌شوند تا فقط فرمِ همین سوییت حساب شود. */
  restoreActive = sql(`SELECT coalesce(string_agg(id::text, ','), '') FROM form_defs WHERE scope='record' AND follow_up IS NOT NULL AND active`);
  if (restoreActive) sql(`UPDATE form_defs SET active=false WHERE id IN (${restoreActive})`);

  console.log('۱) چیدمان: نوعِ عملِ بی‌روز + فرمِ پیگیریِ اختصاصیِ خاموش + عملِ پیشِ‌رو');
  const proc = (await send('/procedure-types', 'POST', { name: `عملِ ${tag}`, postOpCare: 'زخم را خشک نگه دارید.' })).json;
  trash.procs.push(proc.id);
  const form = (await send('/forms', 'POST', { key: `${tag}f`, title: 'پیگیریِ آزمایشی', scope: 'record' })).json;
  trash.forms.push(form.id);
  await send(`/forms/${form.id}/fields`, 'POST', { key: 'fuPain', label: 'شدتِ درد' });
  ok((await send(`/forms/${form.id}`, 'PATCH', { followUp: 'procedure', procedureTypeId: proc.id, active: false })).status === 200,
    'فرم نقشِ پیگیری گرفت و خاموش ماند');

  const vform = (await send('/forms', 'POST', { key: tag, title: 'جراحیِ آزمایشی', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const op = new Date(Date.now() + 3 * 864e5);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'روشن‌سازی', phone: '09120000927',
    opDate: op.toISOString(), procedureTypeId: proc.id,
  })).json;
  trash.visits.push(visit.id);
  sql(`UPDATE visits SET kind='surgery' WHERE id=${visit.id}`);
  await send(`/visits/${visit.id}`, 'PATCH', { opDate: op.toISOString() });
  ok(pendingFu(visit.id) === 0, 'بی‌روز و خاموش: هیچ پیگیری‌ای زمان‌بندی نشده');

  let st = (await send(`/forms/${form.id}/follow-up-status`, 'GET')).json;
  ok(st?.active === false && st?.procedures?.length === 0, '**کارتِ آمادگی: «خاموش» و «هیچ نوعِ عملی روز ندارد»**');
  ok(st?.upcoming >= 1, `عملِ پیشِ‌رو شمرده شد (${st?.upcoming})`);

  const unf0 = (await send('/intake/unfollowed', 'GET')).json;
  ok(unf0?.enabled === false, '**فهرستِ «پیگیری‌نشده» با فرمِ خاموش «روشن نیست» می‌گوید، نه همه پیگیری‌نشده**');

  console.log('\n۲) روزِ پیگیری روی نوعِ عمل — هنوز خاموش');
  ok((await send(`/procedure-types/${proc.id}`, 'PATCH', { followUpDays: '۷' })).status === 200, 'روزِ «۷» روی نوعِ عمل نشست');
  ok(pendingFu(visit.id) === 0, 'فرم خاموش است، پس هنوز پیگیری نمی‌رود');
  st = (await send(`/forms/${form.id}/follow-up-status`, 'GET')).json;
  ok(st?.procedures?.some((p) => p.id === proc.id && p.days.join() === '7'), 'کارتِ آمادگی روزهای همین عمل را نشان می‌دهد');

  console.log('\n۳) روشن‌کردن از فرم‌ساز ← عملِ ازپیش‌ثبت‌شده همان لحظه زمان‌بندی می‌شود');
  const on = await send(`/forms/${form.id}`, 'PATCH', { active: true });
  ok(on.status === 200 && on.json?.active === true, 'فرم روشن شد');
  ok(pendingFu(visit.id) === 1, `**بی هیچ ویرایشی روی مراجعه، یادآوریِ پیگیری کاشته شد** (${pendingFu(visit.id)})`);
  const txt = sql(`SELECT replace(text, E'\\n', ' ') FROM reminders WHERE visit_id=${visit.id} AND kind='follow_up' AND status='pending'`);
  ok(/\/f\/[A-Za-z0-9_-]+/.test(txt), 'متنِ پیامک لینکِ فرم دارد');
  const due = sql(`SELECT to_char(due_at, 'YYYY-MM-DD') FROM reminders WHERE visit_id=${visit.id} AND kind='follow_up' AND status='pending'`);
  ok(due === new Date(op.getTime() + 7 * 864e5).toISOString().slice(0, 10), `موعد = عمل + ۷ روز (${due})`);
  st = (await send(`/forms/${form.id}/follow-up-status`, 'GET')).json;
  ok(st?.active === true && st?.scheduled >= 1, `کارتِ آمادگی: روشن و ${st?.scheduled} پیامکِ زمان‌بندی‌شده`);
  const unf1 = (await send('/intake/unfollowed', 'GET')).json;
  ok(unf1?.enabled === true, 'با فرمِ روشن، فهرستِ «پیگیری‌نشده» فعال است');

  console.log('\n۴) تغییرِ روزها روی نوعِ عمل ← برنامهٔ همان عمل عوض می‌شود');
  await send(`/procedure-types/${proc.id}`, 'PATCH', { followUpDays: '۷,۳۰' });
  ok(pendingFu(visit.id) === 2, `روزِ «۳۰» اضافه شد ← دو موج (${pendingFu(visit.id)})`);

  console.log('\n۵) خاموش‌کردن ← پیگیری‌های نرفته لغو می‌شوند');
  await send(`/forms/${form.id}`, 'PATCH', { active: false });
  ok(pendingFu(visit.id) === 0, '**خاموش‌کردنِ فرم پیگیری‌های در صف را برمی‌دارد**');

  console.log('\n۶) عملی که پیامِ بعد از عملش رفته دوباره هم‌گام نمی‌شود');
  sql(`UPDATE reminders SET status='sent', sent_at=now() WHERE visit_id=${visit.id} AND kind='post_op_care'`);
  const sentBefore = Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${visit.id} AND kind='post_op_care'`));
  await send(`/forms/${form.id}`, 'PATCH', { active: true });
  const sentAfter = Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${visit.id} AND kind='post_op_care'`));
  ok(sentBefore >= 1 && sentAfter === sentBefore, '**مراقبتِ رفته با روشن‌شدنِ فرم (لینکِ تازه در متن) دوباره کاشته نمی‌شود**');
} finally {
  if (restoreActive) sql(`UPDATE form_defs SET active=true WHERE id IN (${restoreActive})`);
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE last_name='روشن‌سازی')`);
  sql(`DELETE FROM intake_submissions WHERE patient_id IN (SELECT id FROM patients WHERE last_name='روشن‌سازی')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}' OR (kind='surgery' AND patient_id IN (SELECT id FROM patients WHERE last_name='روشن‌سازی'))`);
  sql(`DELETE FROM patients WHERE last_name='روشن‌سازی' AND id NOT IN (SELECT patient_id FROM visits)`);
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs) sql(`DELETE FROM procedure_types WHERE id=${id} AND id NOT IN (SELECT procedure_type_id FROM visits WHERE procedure_type_id IS NOT NULL)`);
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
