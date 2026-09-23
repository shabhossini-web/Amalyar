/**
 * اتوماسیونِ پیگیریِ پس از عمل:
 * - نوعِ عمل با «روزهای پیگیری» (ارقامِ فارسی) → دو یادآوریِ follow_up با لینکِ /f/
 * - بخشِ عمومی + اختصاصیِ عمل + اختصاصیِ تشخیص = **یک** توکن؛ فیلدهای اختصاصی صفحه‌های بعدی
 * - **هر موج فرم و لینکِ خودش را دارد** (قراردادِ لِینِ الف، W1.1/D01: یک ردیف به‌ازای هر موعد
 *   با کلیدِ `followUpVisitId`/`followUpDay`؛ گزارشِ «پیگیری‌نشده» روی همین بنا شده). نسخهٔ قبلیِ
 *   این سوئیت «یک توکن برای همهٔ موج‌ها» را می‌سنجید که با کدِ `main` هرگز نمی‌خواند
 *   (۱۹/۲ روی دیتابیسِ تازه) — ۱۴۰۵/۰۶/۲۹ با قرارداد هم‌خوان شد.
 * - پیامکِ مراقبتِ بعد از عمل لینکِ **موجِ اول** را ضمیمه دارد
 * - پرکردنِ فرم پاسخِ هر دو بخش را در یک submission می‌نشاند و پرونده هر دو را با برچسبِ درست می‌خواند
 * - هم‌گام‌سازیِ دوباره ردیفِ تازه نمی‌سازد (نه انباشت)؛ لغوِ عمل پیگیری را باطل می‌کند
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
const pub = (p, m, b) => fetch(API + p, { method: m ?? 'GET', headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'fu' + randomBytes(3).toString('hex');
const trash = { forms: [], visits: [], procs: [], diags: [] };
let restoreGen = '';

try {
  console.log('۱) چیدمان: نوعِ عمل + تشخیص + سه فرمِ پیگیری');
  const proc = (await send('/procedure-types', 'POST', {
    name: `عملِ ${tag}`, followUpDays: '۷,۳۰', postOpCare: 'پانسمان را خشک نگه دارید.',
  })).json;
  trash.procs.push(proc.id);
  ok(!!proc?.id, `نوعِ عمل با روزهای پیگیریِ فارسی ساخته شد (#${proc?.id})`);
  const diag = (await send('/diagnoses', 'POST', { title: `تشخیصِ ${tag}` })).json;
  trash.diags.push(diag.id);

  const mk = async (key, title) => {
    const f = (await send('/forms', 'POST', { key, title, scope: 'record' })).json;
    trash.forms.push(f.id);
    return f;
  };
  const gen = await mk(`${tag}g`, 'پیگیریِ عمومی');
  await send(`/forms/${gen.id}/fields`, 'POST', { key: 'fuPain', label: 'شدتِ درد (۱ تا ۱۰)' });
  const spec = await mk(`${tag}p`, 'پیگیریِ اختصاصیِ عمل');
  await send(`/forms/${spec.id}/fields`, 'POST', { key: 'fuWound', label: 'وضعیتِ زخم' });
  const dspec = await mk(`${tag}d`, 'پیگیریِ اختصاصیِ تشخیص');
  await send(`/forms/${dspec.id}/fields`, 'POST', { key: 'fuDiag', label: 'علائمِ اختصاصیِ تشخیص' });

  ok((await send(`/forms/${gen.id}`, 'PATCH', { followUp: 'general' })).status === 200, 'نقشِ «عمومی» نشست');
  ok((await send(`/forms/${spec.id}`, 'PATCH', { followUp: 'procedure', procedureTypeId: proc.id })).status === 200,
    'نقشِ «اختصاصیِ عمل» نشست');
  ok((await send(`/forms/${dspec.id}`, 'PATCH', { followUp: 'diagnosis', diagnosisId: diag.id })).status === 200,
    'نقشِ «اختصاصیِ تشخیص» نشست');
  ok((await send(`/forms/${spec.id}`, 'PATCH', { followUp: 'procedure' })).status === 400,
    'اختصاصیِ بی‌مرجع رد می‌شود');

  console.log('\n۲) جراحی → یادآوری‌های پیگیری + لینکِ یکتا');
  const vform = (await send('/forms', 'POST', { key: tag, title: 'جراحیِ پیگیری', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const op = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'پیگیری', phone: '09120000918',
    opDate: op.toISOString(), procedureTypeId: proc.id, diagnosisId: diag.id,
  })).json;
  trash.visits.push(visit.id);
  sql(`UPDATE visits SET kind='surgery' WHERE id=${visit.id}`);
  await send(`/visits/${visit.id}`, 'PATCH', { opDate: op.toISOString() });

  const fu = sql(`SELECT count(*) FROM reminders WHERE visit_id=${visit.id} AND kind='follow_up' AND status='pending'`);
  ok(Number(fu) === 2, `دو یادآوریِ پیگیری کاشته شد (${fu})`);
  /* متنِ پیامک چندخطی است — داخلِ SQL تخت می‌شود تا psql خطی‌اش نکند. */
  const texts = execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: `SELECT replace(text, E'\\n', ' ') FROM reminders WHERE visit_id=${visit.id} AND kind='follow_up' AND status='pending' ORDER BY due_at` }).toString().trim().split('\n');
  const token = texts[0]?.match(/\/f\/([A-Za-z0-9_-]+)/)?.[1];
  ok(!!token, '**متنِ یادآوری لینکِ فرم دارد**');
  const token2 = texts[1]?.match(/\/f\/([A-Za-z0-9_-]+)/)?.[1];
  ok(texts.length === 2 && !!token2 && token2 !== token, '**هر موج لینکِ خودش را دارد** (قراردادِ per-wave)');
  const day7 = sql(`SELECT to_char(min(due_at), 'YYYY-MM-DD') FROM reminders WHERE visit_id=${visit.id} AND kind='follow_up' AND status='pending'`);
  ok(day7 === new Date(op.getTime() + 7 * 864e5).toISOString().slice(0, 10), `موجِ اول = عمل + ۷ روز (${day7})`);
  const postText = sql(`SELECT replace(text, E'\\n', ' ') FROM reminders WHERE visit_id=${visit.id} AND kind='post_op_care' AND status='pending'`);
  ok(postText.includes('پانسمان') && postText.includes(`/f/${token}`), '**مراقبتِ بعد از عمل هم لینکِ پیگیری را ضمیمه دارد**');

  /* یک ردیف به‌ازای هر موعد — و هم‌گام‌سازیِ دوباره پیش از پرشدن همان دو را نگه می‌دارد، نه نسخهٔ سوم. */
  ok(Number(sql(`SELECT count(*) FROM intake_submissions WHERE patient_id=${visit.patientId} AND form_id=${gen.id}`)) === 2,
    '**دو موعد، دو ردیفِ فرم** (کلیدِ `followUpDay`)');
  await send(`/visits/${visit.id}`, 'PATCH', { opDate: op.toISOString() });
  ok(Number(sql(`SELECT count(*) FROM intake_submissions WHERE patient_id=${visit.patientId} AND form_id=${gen.id}`)) === 2,
    '**هم‌گام‌سازیِ دوباره همان ردیف‌های باز را نگه می‌دارد (نه انباشت)**');

  console.log('\n۳) یک توکن، دو بخش (عمومی + اختصاصی)');
  const view = (await pub(`/public/intake/form/${token}`)).json;
  const keys = view.form.fields.map((f) => f.key);
  ok(keys.includes('fuPain') && keys.includes('fuWound') && keys.includes('fuDiag'),
    '**فیلدهای هر سه بخش پشتِ یک توکن‌اند**');
  const genPage = view.form.fields.find((f) => f.key === 'fuPain').page;
  const specPage = view.form.fields.find((f) => f.key === 'fuWound').page;
  const dPage = view.form.fields.find((f) => f.key === 'fuDiag').page;
  ok(specPage > genPage && dPage > specPage, `بخش‌های اختصاصی صفحه‌های بعدی‌اند (${genPage}→${specPage}→${dPage})`);
  ok(view.form.pages >= 3, `صفحه‌شمار سرور هر سه بخش را می‌بیند (${view.form.pages})`);

  console.log('\n۴) پاسخ‌ها در یک submission و پرونده');
  const fill = await pub(`/public/intake/form/${token}/fill`, 'POST', {
    values: { fuPain: '۳', fuWound: 'خوب و خشک', fuDiag: 'علامتی نیست' },
  });
  ok(fill.status === 200 || fill.status === 201, `فرم پر شد (${fill.status})`);
  ok(fill.json?.status === 'approved', 'فرمِ رایگانِ زیرپرونده بدونِ صف approved شد');
  const rec = (await send(`/patients/${visit.patientId}/record`, 'GET')).json;
  const attached = (rec?.attachedForms ?? []).find((x) => x.formTitle === 'پیگیریِ عمومی');
  ok(!!attached, 'در پروندهٔ بیمار نشسته');
  const labels = (attached?.answers ?? []).map((a) => a.label);
  ok(labels.includes('وضعیتِ زخم') && labels.includes('علائمِ اختصاصیِ تشخیص'),
    '**پاسخ‌های بخش‌های اختصاصی با برچسبِ خودشان در پرونده خوانده می‌شوند**');

  console.log('\n۵) هم‌گام‌سازی بعد از پرشدن و لغو');
  /* فرمِ پرشده سندِ پرونده است و پایدار می‌ماند؛ موجِ دوم فرمِ خودش را از قبل دارد — ردیفِ تازه‌ای ساخته نمی‌شود. */
  await send(`/visits/${visit.id}`, 'PATCH', { opDate: op.toISOString() });
  const cnt2 = sql(`SELECT count(*) FROM reminders WHERE visit_id=${visit.id} AND kind='follow_up' AND status='pending'`);
  ok(Number(cnt2) === 2, 'هم‌گام‌سازیِ دوباره باز هم دو موج (نه انباشت)');
  const subs = sql(`SELECT count(*) FROM intake_submissions WHERE patient_id=${visit.patientId} AND form_id=${gen.id}`);
  ok(Number(subs) === 2, '**فرمِ پرشده می‌ماند و موجِ دوم همان فرمِ خودش را دارد (ردیفِ تازه نه)**');
  const filledStill = sql(`SELECT status FROM intake_submissions WHERE token='${token}'`);
  ok(filledStill === 'approved', '**پاسخِ ثبت‌شده با هم‌گام‌سازی پاک/بازنشانی نمی‌شود**');
  await send(`/visits/${visit.id}/status`, 'PATCH', { opStatus: 'cancelled', cancelReason: 'other' });
  const afterCancel = sql(`SELECT count(*) FROM reminders WHERE visit_id=${visit.id} AND kind='follow_up' AND status='pending'`);
  ok(Number(afterCancel) === 0, 'لغوِ عمل، پیگیری‌ها را باطل می‌کند');

  console.log('\n۶) بی فرمِ عمومی: افزودنِ عملِ همزمان لینک و پیامک را عوض نمی‌کند');
  /* بازبینیِ بستهٔ ۷: پایه «کم‌شناسه‌ترین» فرمِ مجموعه بود، پس عملِ همزمانی که فرمِ
     کم‌شناسه‌تری داشت پایه را برمی‌گرداند → توکنِ تازه، پیامکِ دوباره، ردیفِ قبلی یتیم.
     فرم‌های «عمومی» موقتاً کنار می‌روند (و در finally برمی‌گردند) تا همین مسیر برود. */
  restoreGen = sql(`SELECT coalesce(string_agg(id::text, ','), '') FROM form_defs WHERE follow_up='general'`);
  if (restoreGen) sql(`UPDATE form_defs SET follow_up=NULL WHERE id IN (${restoreGen})`);
  const p2 = (await send('/procedure-types', 'POST', { name: `همزمانِ ${tag}` })).json;
  trash.procs.push(p2.id);
  const secF = await mk(`${tag}s`, 'پیگیریِ عملِ همزمان');
  await send(`/forms/${secF.id}/fields`, 'POST', { key: 'fuSec', label: 'وضعیتِ عملِ همزمان' });
  const p1 = (await send('/procedure-types', 'POST', { name: `اصلیِ ${tag}`, followUpDays: '7', postOpCare: 'استراحت کنید.' })).json;
  trash.procs.push(p1.id);
  const priF = await mk(`${tag}r`, 'پیگیریِ عملِ اصلی');
  await send(`/forms/${priF.id}/fields`, 'POST', { key: 'fuPri', label: 'وضعیتِ عملِ اصلی' });
  await send(`/forms/${secF.id}`, 'PATCH', { followUp: 'procedure', procedureTypeId: p2.id });
  await send(`/forms/${priF.id}`, 'PATCH', { followUp: 'procedure', procedureTypeId: p1.id });
  ok(secF.id < priF.id, `فرمِ همزمان شناسهٔ کمتری دارد (${secF.id} < ${priF.id}) — همان حالتِ باگ`);
  const v6 = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'پیگیری', phone: '09120000919', opDate: op.toISOString(), procedureTypeId: p1.id,
  })).json;
  trash.visits.push(v6.id);
  sql(`UPDATE visits SET kind='surgery' WHERE id=${v6.id}`);
  await send(`/visits/${v6.id}`, 'PATCH', { opDate: op.toISOString() });
  const snap = () => sql(`SELECT string_agg(kind || ':' || replace(text, E'\\n', ' '), ' | ' ORDER BY kind, due_at) FROM reminders WHERE visit_id=${v6.id} AND status='pending'`);
  const subsOf = () => Number(sql(`SELECT count(*) FROM intake_submissions WHERE data->>'followUpVisitId' = '${v6.id}'`));
  const before6 = snap();
  const tok6 = before6.match(/\/f\/([A-Za-z0-9_-]+)/)?.[1];
  ok(!!tok6 && subsOf() === 1, `یک لینک، یک ردیف (${subsOf()})`);
  const add6 = await send(`/visits/${v6.id}`, 'PATCH', { otherProcedureTypeIds: [p2.id] });
  ok(add6.status === 200, `عملِ همزمان افزوده شد (${add6.status})`);
  ok(snap() === before6, '**نباید بیفتد:** متنِ پیامک‌ها (و لینک) عوض نشد — پیامکِ دوباره نمی‌رود');
  ok(subsOf() === 1, `**نباید بیفتد:** ردیفِ دوم ساخته نشد (${subsOf()})`);
  const view6 = (await pub(`/public/intake/form/${tok6}`)).json;
  const k6 = (view6?.form?.fields ?? []).map((f) => f.key);
  ok(k6.includes('fuPri') && k6.includes('fuSec'), '… و بخشِ عملِ همزمان پشتِ همان لینک اضافه شد');
} finally {
  if (restoreGen) sql(`UPDATE form_defs SET follow_up='general' WHERE id IN (${restoreGen})`);
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE last_name='پیگیری')`);
  sql(`DELETE FROM intake_submissions WHERE patient_id IN (SELECT id FROM patients WHERE last_name='پیگیری')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}' OR (kind='surgery' AND patient_id IN (SELECT id FROM patients WHERE last_name='پیگیری'))`);
  sql(`DELETE FROM patients WHERE last_name='پیگیری' AND id NOT IN (SELECT patient_id FROM visits)`);
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs) sql(`DELETE FROM procedure_types WHERE id=${id} AND id NOT IN (SELECT procedure_type_id FROM visits WHERE procedure_type_id IS NOT NULL)`);
  for (const id of trash.diags) sql(`DELETE FROM diagnoses WHERE id=${id} AND id NOT IN (SELECT diagnosis_id FROM visits WHERE diagnosis_id IS NOT NULL)`);
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
