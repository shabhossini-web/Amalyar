/**
 * **کلیدِ پایدارِ موضوع + فرمِ تکمیلیِ موضوعِ ویزیت** (بستهٔ ۹الف).
 *
 *  باید بیفتد:
 *   - چهار موضوعِ seed کلیدِ سیستمی دارند؛ ویزیتِ پست‌آپِ خودکار بعد از **تغییرِ نام** هم موضوعش را می‌گیرد (K1–K2)
 *   - موضوع به فرمِ زیرپرونده وصل می‌شود؛ پاسخ با مراجعه ذخیره و در نما و پرونده خوانده می‌شود (S1–S3)
 *   - وصلهٔ جزئی ادغام می‌شود؛ عوضِ موضوع پاسخِ قبلی را نمی‌برد (S4)
 *  نباید بیفتد:
 *   - کلیدِ سیستمی از API نوشته شود یا موضوعِ سیستمی حذفِ سخت شود (K3)
 *   - فرمِ پیگیری/غیرِ زیرپرونده فرمِ تکمیلی شود؛ فرمِ درگیر حذفِ سخت شود (F1–F2)
 *   - پاسخِ فرمِ موضوعِ دیگر، کلیدِ ناشناخته، ستارهٔ خالی، یا فیلدِ نقشِ دیگر (V1–V4)
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const loginAs = (identifier, password) => fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) }).then((r) => r.json());
const call = (token) => (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { Authorization: 'Bearer ' + token, ...(b !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const login = await loginAs(process.env.E2E_USER ?? 'admin', process.env.E2E_PASS ?? 'test1234');
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = call(login.accessToken);
const msgOf = (r) => { const m = r.json?.message; return Array.isArray(m) ? m.join('، ') : String(m ?? ''); };
const tag = randomBytes(3).toString('hex');
const today = new Date().toISOString().slice(0, 10);
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const trash = { visits: [], forms: [], topics: [], accounts: [], roles: [] };
let postop = null;

try {
  ok('سوییچ به مطب', (await send('/config/vertical', 'PATCH', { vertical: 'clinic' })).status === 200);
  /* DBِ تازهٔ CI فرمِ ویزیتِ مطب ندارد — مثلِ بقیهٔ سوییت‌ها، اگر نیست ساخته می‌شود. */
  if (Number(sql(`SELECT count(*) FROM form_defs WHERE scope='visit' AND active=TRUE AND visit_kind='clinic'`)) === 0)
    await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  console.log('۱) کلیدِ پایدار');
  let topics = (await send('/visit-topics')).json ?? [];
  const bySys = Object.fromEntries(topics.filter((t) => t.system).map((t) => [t.system, t]));
  ok('K1 چهار موضوعِ seed کلید دارند', ['initial', 'preop', 'postop', 'treatment'].every((k) => bySys[k]?.id), JSON.stringify(Object.keys(bySys)));
  postop = bySys.postop;
  const r1 = await send(`/visit-topics/${postop.id}`, 'PATCH', { system: 'initial' });
  ok('K3 **نباید بیفتد:** کلیدِ سیستمی از API', r1.status === 400 && /سیستمی/.test(msgOf(r1)), `${r1.status} ${msgOf(r1)}`);
  const ren = await send(`/visit-topics/${postop.id}`, 'PATCH', { name: `پیگیریِ بعد از جراحی ${tag}` });
  ok('K2 نامِ موضوعِ پست‌آپ عوض شد', ren.status === 200);
  const surgeon = (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `موضوع${tag}` })).json;
  const hospital = (await send('/hospitals')).json?.[0] ?? (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;
  const proc = (await send('/procedure-types', 'POST', { name: `عملِ موضوع ${tag}` })).json;
  const next = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  const op = (await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'موضوعِ', lastName: `پایدار${tag}`, opDate: today, surgeonId: surgeon.id, hospitalId: hospital.id,
    procedureTypeId: proc.id, nextVisitDate: next,
  })).json;
  if (op?.id) trash.visits.push(op.id);
  const child = sql(`SELECT coalesce(topic_id::text,'∅') FROM visits WHERE follow_of_visit_id=${op?.id} LIMIT 1`);
  ok('K2 ویزیتِ پست‌آپِ خودکار بعد از تغییرِ نام هم موضوعِ پست‌آپ را گرفت', Number(child) === postop.id, `${child} vs ${postop.id}`);
  const del = await send(`/visit-topics/${bySys.treatment.id}`, 'DELETE');
  ok('K3 **نباید بیفتد:** حذفِ سختِ موضوعِ سیستمی (خاموش شد)', del.json?.deactivated === true && sql(`SELECT count(*) FROM visit_topics WHERE id=${bySys.treatment.id}`) === '1');
  await send(`/visit-topics/${bySys.treatment.id}`, 'PATCH', { active: true });

  console.log('\n۲) فرمِ تکمیلی');
  const mkForm = async (key, extra = {}) => {
    const f = (await send('/forms', 'POST', { key, title: `فرمِ ${key}`, scope: 'record' })).json;
    trash.forms.push(f.id);
    if (Object.keys(extra).length) await send(`/forms/${f.id}`, 'PATCH', extra);
    return f;
  };
  const F = await mkForm(`sup${tag}`);
  await send(`/forms/${F.id}/fields`, 'POST', { key: 'q1', label: `پرسشِ اول ${tag}`, type: 'text', required: true });
  await send(`/forms/${F.id}/fields`, 'POST', { key: 'q2', label: 'پرسشِ دوم', type: 'text' });
  await send(`/forms/${F.id}/fields`, 'POST', { key: 'pic', label: 'عکس', type: 'image' });
  const G = await mkForm(`oth${tag}`);
  await send(`/forms/${G.id}/fields`, 'POST', { key: 'g1', label: 'دیگری', type: 'text' });
  const FU = await mkForm(`fu${tag}`, { followUp: 'general' });
  const opts = (await send('/visit-topics/form-options')).json ?? [];
  ok('F1 گزینه‌ها: زیرپروندهٔ فعال بله، پیگیری نه', opts.some((o) => o.id === F.id) && !opts.some((o) => o.id === FU.id), JSON.stringify(opts.map((o) => o.id)));
  const T = (await send('/visit-topics', 'POST', { name: `زیبایی ${tag}`, formId: F.id })).json;
  trash.topics.push(T?.id);
  const bad = await send('/visit-topics', 'POST', { name: `بد ${tag}`, formId: FU.id });
  ok('F1 **نباید بیفتد:** فرمِ پیگیری فرمِ تکمیلی شود', bad.status === 400, msgOf(bad));
  topics = (await send('/visit-topics')).json ?? [];
  const Trow = topics.find((t) => t.id === T.id);
  ok('S1 فهرستِ موضوع فرم را می‌گوید', Trow?.formId === F.id && Trow?.formKey === F.key && Trow?.formTitle === F.title, JSON.stringify(Trow));

  const v = (await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'تکمیلیِ', lastName: `موضوع${tag}`, opDate: today, surgeonId: surgeon.id, chiefComplaint: 'درد',
    topicId: T.id, supplement: { formId: F.id, values: { q1: 'پاسخِ اول', q2: 'دوم' } },
  })).json;
  if (v?.id) trash.visits.push(v.id);
  ok('S1 ساخت با پاسخِ فرمِ تکمیلی (پاسخِ ساخت هم دارد)', v?.supplements?.[0]?.values?.q1 === 'پاسخِ اول', JSON.stringify(v?.supplements ?? v).slice(0, 200));
  let g = (await send(`/visits/${v.id}`)).json;
  const sup = g.supplements?.find((x) => x.formId === F.id);
  ok('S2 نمای کامل: عنوانِ فرم و پاسخ با برچسب', sup?.formTitle === F.title && sup?.answers?.some((a) => a.label === `پرسشِ اول ${tag}` && a.text === 'پاسخِ اول'), JSON.stringify(sup).slice(0, 240));
  const rec = (await send(`/patients/${v.patientId}/record`)).json;
  ok('S3 پرونده هم می‌خواندش', rec?.visits?.find((x) => x.id === v.id)?.supplements?.[0]?.answers?.length === 2);

  let r = await send(`/visits/${v.id}`, 'PATCH', { supplement: { formId: F.id, values: { q2: 'اصلاحِ دوم' } } });
  g = (await send(`/visits/${v.id}`)).json;
  ok('S4 وصلهٔ جزئی ادغام شد', r.status === 200 && g.supplements[0].values.q1 === 'پاسخِ اول' && g.supplements[0].values.q2 === 'اصلاحِ دوم', msgOf(r));
  ok('S4 ممیزیِ visit.supplement با کلیدهای عوض‌شده',
    sql(`SELECT after_json->>'changedKeys' FROM audit_events WHERE action='visit.supplement' AND entity_id='${v.id}' ORDER BY id DESC LIMIT 1`) === '["q2"]');

  const V1 = await send(`/visits/${v.id}`, 'PATCH', { supplement: { formId: G.id, values: { g1: 'x' } } });
  ok('V1 **نباید بیفتد:** فرمِ موضوعِ دیگر', V1.status === 400, msgOf(V1));
  const V2 = await send(`/visits/${v.id}`, 'PATCH', { supplement: { formId: F.id, values: { zz: 'x' } } });
  ok('V2 **نباید بیفتد:** کلیدِ ناشناخته', V2.status === 400, msgOf(V2));
  const V3 = await send(`/visits/${v.id}`, 'PATCH', { supplement: { formId: F.id, values: { q1: '' } } });
  ok('V3 **نباید بیفتد:** ستارهٔ خالی', V3.status === 400 && /پرسشِ اول/.test(msgOf(V3)), msgOf(V3));
  const V3b = await send(`/visits/${v.id}`, 'PATCH', { supplement: { formId: F.id, values: { pic: { id: 1 } } } });
  ok('V3 **نباید بیفتد:** فیلدِ عکس از این مسیر', V3b.status === 400, msgOf(V3b));

  r = await send(`/visits/${v.id}`, 'PATCH', { topicId: bySys.initial.id });
  g = (await send(`/visits/${v.id}`)).json;
  ok('S4 عوضِ موضوع پاسخِ قبلی را نبرد', r.status === 200 && g.supplements?.[0]?.values?.q1 === 'پاسخِ اول');
  r = await send(`/visits/${v.id}`, 'PATCH', { supplement: { formId: F.id, values: { q2: 'باز هم' } } });
  ok('S4 پاسخِ فرمِ موضوعِ قبلی همچنان اصلاح‌پذیر', r.status === 200, msgOf(r));

  const q2 = sql(`SELECT id FROM form_fields WHERE form_id=${F.id} AND key='q2'`);
  await send(`/forms/fields/${q2}`, 'PATCH', { roles: ['doctor'] });
  const made = (await send('/accounts/temporary', 'POST', {
    firstName: 'منشیِ', lastName: `تکمیلی ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)), level: 5, jobRole: 'secretary', username: `ts${tag}`,
  })).json;
  if (made?.account?.id) {
    trash.accounts.push(made.account.id);
    const sec = call((await loginAs(`ts${tag}`, made.temporaryPassword)).accessToken);
    const V4 = await sec(`/visits/${v.id}`, 'PATCH', { supplement: { formId: F.id, values: { q2: 'منشی' } } });
    ok('V4 **نباید بیفتد:** منشی فیلدِ بخشِ پزشک را بنویسد', V4.status === 400 && /پزشک/.test(msgOf(V4)), msgOf(V4));
    const V4b = await sec(`/visits/${v.id}`, 'PATCH', { supplement: { formId: F.id, values: { q1: 'منشی نوشت', q2: 'باز هم' } } });
    ok('V4 echoِ بی‌تغییرِ همان فیلد آزاد است', V4b.status === 200, msgOf(V4b));
  } else ok('حسابِ منشی', false, JSON.stringify(made).slice(0, 120));

  const rm = await send(`/forms/${F.id}`, 'DELETE');
  ok('F2 **نباید بیفتد:** فرمِ درگیر حذفِ سخت شود (غیرفعال)', rm.json?.deactivated === true && (rm.json?.topics ?? 0) >= 1, JSON.stringify(rm.json));
} catch (e) {
  ok(`اجرا متوقف شد: ${e?.message ?? e}`, false);
} finally {
  if (postop) await send(`/visit-topics/${postop.id}`, 'PATCH', { name: postop.name }).catch(() => {});
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  ok('برگشت به حوزهٔ قبلی', back.status === 200, String(back.status));
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  /* اول موضوع‌ها، بعد فرم‌ها — تا شمارِ استفادهٔ فرم صفر شود و حذفِ سخت بگیرد (بازبینی). */
  for (const id of trash.topics) if (id) await send(`/visit-topics/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) if (id) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) { try { sql(`DELETE FROM account_sessions WHERE account_id=${id}`); sql(`DELETE FROM accounts WHERE id=${id}`); } catch { /* */ } }
}
console.log(`\n${pass} سبز · ${fails.length} قرمز`);
if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
