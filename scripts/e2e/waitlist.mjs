/**
 * **فهرستِ انتظارِ عمل + عملِ «هنوز تاریخ ندارد»** (بسته‌های ۹ب/ج، طرحِ مصوبِ ۱۴۰۵/۰۷/۰۶).
 *
 *  باید بیفتد:
 *   - تصمیمِ جراحیِ بی‌عمل ← «منتظرِ برنامه» با روزهای انتظار و مجوزهای سرور (W1)
 *   - عملِ بی‌تاریخ با تاریخِ تقریبی (بی‌بیمارستان و بی‌مبلغ در مطب) ← «بی‌تاریخ»؛ تصمیمش از فهرست می‌رود (W2)
 *   - تاریخِ قطعی ← «رزروشده» و تاریخِ تقریبی پاک؛ لغوِ عمل تصمیم را با دلیلِ لغو برمی‌گرداند (W3–W4)
 *   - بستن/بازکردنِ تصمیم با دلیل و ممیزی (W5)
 *   - آمار: شمار، میانهٔ انتظار، تصمیم تا عمل (W6)
 *   - باگِ B1: مراجعهٔ شرکتیِ بی‌تاریخ (رزرو بدون تاریخ) بی‌تاریخ ویرایش می‌شود (B1)
 *  نباید بیفتد:
 *   - عملِ بی‌تاریخ پیامکِ عمل بگیرد یا در اتاقِ عمل بنشیند (P1)
 *   - ویرایشِ عملِ بی‌تاریخ به‌خاطرِ ستارهٔ تاریخ/بیمارستان رد شود (P2)
 *   - بی‌تاریخ روی ویزیت، یا با تاریخ با هم (P3)
 *   - عملِ تاریخ‌دار که بی‌تاریخ می‌شود پیامک یا پست‌آپِ زنده نگه دارد (P5)
 *   - عملِ لغوشده بی‌تاریخ شود (P6)
 *   - تاریخِ عملِ شرکتی بی‌پرچمِ صریح پاک شود (B1)
 *   - کاربرِ سطح ۲ بیمارِ دیگری را ببیند (S1)
 *   - ماژول بیرون از مطب (G1)
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
const day = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const trash = { visits: [], accounts: [] };
/* ستاره‌هایی که آزمون روشن کرد — در `finally` برمی‌گردند، حتی اگر اجرا وسطِ راه بشکند. */
const starred = [];
const list = async (s = send) => (await s('/waitlist')).json;
const rowOf = (w, key) => w?.rows?.find((r) => r.key === key);
const ensureForms = async () => {
  /* DBِ تازهٔ CI فرمِ ویزیت/عمل ندارد — مثلِ بقیهٔ سوییت‌ها، اگر نیست ساخته می‌شود. */
  for (const [kind, title] of [['clinic', 'فرمِ ویزیت'], ['surgery', 'فرمِ عمل']]) {
    if (Number(sql(`SELECT count(*) FROM form_defs WHERE scope='visit' AND active=TRUE AND visit_kind='${kind}'`)) === 0) {
      await send('/forms', 'POST', { key: kind, title, scope: 'visit' });
    }
  }
};

try {
  ok('سوییچ به مطب', (await send('/config/vertical', 'PATCH', { vertical: 'clinic' })).status === 200);
  await ensureForms();
  ok('ماژولِ waitlist در مطب روشن است', sql(`SELECT enabled::text FROM features WHERE key='waitlist'`) === 'true');
  const surgeon = (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `انتظار${tag}` })).json;
  const hospital = (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;
  const proc = (await send('/procedure-types', 'POST', { name: `عملِ انتظار ${tag}` })).json;
  const dx = (await send('/diagnoses', 'POST', { title: `تنگیِ کانال ${tag}` })).json;
  /* ستاره روی بیمارستان و مبلغِ فرمِ عمل — تا «بی‌تاریخ در مطب» واقعاً برداشتنشان را بسنجد. */
  for (const key of ['hospitalId', 'amount', 'opDate']) {
    const was = sql(`SELECT coalesce((SELECT required::text FROM form_fields f JOIN form_defs d ON d.id=f.form_id WHERE d.scope='visit' AND d.visit_kind='surgery' AND f.key='${key}' LIMIT 1), '∅')`);
    if (was === 'false') { sql(`UPDATE form_fields SET required=TRUE WHERE key='${key}' AND form_id IN (SELECT id FROM form_defs WHERE scope='visit' AND visit_kind='surgery')`); starred.push(key); }
  }
  const decide = async (label, daysAgo) => {
    const v = (await send('/visits', 'POST', {
      kind: 'clinic', firstName: 'انتظارِ', lastName: `${label}${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
      opDate: day(-daysAgo), surgeonId: surgeon.id, chiefComplaint: 'درد', diagnosisId: dx.id, decisions: ['surgery'],
    })).json;
    if (!v?.id) throw new Error('ویزیت ساخته نشد: ' + JSON.stringify(v).slice(0, 200));
    trash.visits.push(v.id);
    return v;
  };

  console.log('۱) تصمیم ← منتظرِ برنامه');
  const D1 = await decide('یک', 20);
  let w = await list();
  let r = rowOf(w, `awaiting:${D1.id}`);
  ok('W1 ردیفِ «منتظرِ برنامه» با ۲۰ روز انتظار، تشخیص و شکایت', r?.state === 'awaiting' && r.waitingDays === 20 && r.decision?.diagnosis?.includes(dx.title)
    && r.stateFa === 'منتظرِ برنامه' && r.decision?.chiefComplaint === 'درد' && r.surgeonId === surgeon.id, JSON.stringify(r).slice(0, 260));
  ok('W1 مجوزها و «نمای همه» از سرور', w?.can?.plan === true && w?.can?.manage === true && w?.team === true, JSON.stringify([w?.can, w?.team]));
  ok('W1 برچسب‌های تب‌ها و دلایلِ بستن در /config', (await send('/config')).json?.statuses?.decisionClose?.every((x) => x.label && x.hint));

  console.log('\n۲) عملِ «هنوز تاریخ ندارد»');
  const P = await send('/visits', 'POST', {
    kind: 'surgery', patientId: D1.patientId, decidedInVisitId: D1.id, surgeonId: surgeon.id, procedureTypeId: proc.id,
    opDateOpen: true, plannedDate: day(30),
  });
  ok('W2 عملِ بی‌تاریخ بی‌تاریخ، بی‌بیمارستان و بی‌مبلغ ساخته شد (ستاره‌ها برداشته)', P.status < 300 && P.json?.undated === true && !P.json?.opDate, `${P.status} ${msgOf(P)}`);
  const PV = P.json;
  if (PV?.id) trash.visits.push(PV.id);
  ok('W2 تاریخِ تقریبی نشست', String(PV?.plannedDate).slice(0, 10) === day(30), String(PV?.plannedDate));
  w = await list();
  ok('W2 تصمیم از «منتظرِ برنامه» رفت و عمل «بی‌تاریخ» شد', !rowOf(w, `awaiting:${D1.id}`) && rowOf(w, `surgery:${PV.id}`)?.state === 'planned', JSON.stringify(w?.rows?.map((x) => x.key)));
  ok('W2 انتظار از روزِ تصمیم حساب می‌شود', rowOf(w, `surgery:${PV.id}`)?.waitingDays === 20);
  ok('P1 **نباید بیفتد:** پیامکِ عمل برای بی‌تاریخ', sql(`SELECT count(*) FROM reminders WHERE visit_id=${PV.id} AND status='pending'`) === '0');
  const td = (await send(`/theatre/day?date=${day(30)}`)).json;
  ok('P1 **نباید بیفتد:** تاریخِ تقریبی در اتاقِ عمل', !(td?.visits ?? []).some((x) => x.id === PV.id));
  const e1 = await send(`/visits/${PV.id}`, 'PATCH', { opDate: null, hospitalId: null, notes: `ویرایش ${tag}` });
  ok('P2 **نباید بیفتد:** ویرایشِ بی‌تاریخ به‌خاطرِ ستارهٔ تاریخ/بیمارستان رد شود', e1.status === 200, msgOf(e1));
  /* عملِ تاریخ‌دار با ویزیتِ بعدی که بی‌تاریخ می‌شود: پیامک و ویزیتِ پست‌آپِ خودکارش نباید بمانند. */
  const D2b = await decide('دو-ب', 10);
  const S2 = (await send('/visits', 'POST', {
    kind: 'surgery', patientId: D2b.patientId, decidedInVisitId: D2b.id, surgeonId: surgeon.id, procedureTypeId: proc.id,
    hospitalId: hospital.id, opDate: day(10), nextVisitDate: day(17), amount: 5000000,
  })).json;
  if (S2?.id) trash.visits.push(S2.id);
  const childOf = (id) => sql(`SELECT coalesce((SELECT op_status FROM visits WHERE follow_of_visit_id=${id} ORDER BY id DESC LIMIT 1), '∅')`);
  ok('P5 عملِ تاریخ‌دار با ویزیتِ بعدی: پیامک و ویزیتِ پست‌آپ کاشته شد',
    !!S2?.id && sql(`SELECT count(*) FROM reminders WHERE visit_id=${S2?.id} AND status='pending'`) !== '0' && childOf(S2?.id) === 'pending', `${childOf(S2?.id)}`);
  const un = await send(`/visits/${S2?.id}`, 'PATCH', { opDateOpen: true });
  ok('P5 بی‌تاریخ‌شدن (فقط با پرچم): تاریخ پاک، هیچ پیامکی نمی‌ماند و ویزیتِ پست‌آپ لغو می‌شود',
    un.status === 200 && !un.json?.opDate && un.json?.undated === true && sql(`SELECT count(*) FROM reminders WHERE visit_id=${S2?.id} AND status='pending'`) === '0'
      && childOf(S2?.id) === 'cancelled', `${un.status} ${msgOf(un)} child=${childOf(S2?.id)}`);
  const p3 = await send('/visits', 'POST', { kind: 'clinic', patientId: D1.patientId, opDateOpen: true, surgeonId: surgeon.id, chiefComplaint: 'x' });
  ok('P3 **نباید بیفتد:** بی‌تاریخ روی ویزیت', p3.status === 400, msgOf(p3));
  if (p3.json?.id) trash.visits.push(p3.json.id);
  const p3b = await send('/visits', 'POST', { kind: 'surgery', patientId: D1.patientId, opDateOpen: true, opDate: day(5), surgeonId: surgeon.id, procedureTypeId: proc.id, hospitalId: hospital.id });
  ok('P3 **نباید بیفتد:** بی‌تاریخ و تاریخ با هم', p3b.status === 400, msgOf(p3b));
  if (p3b.json?.id) trash.visits.push(p3b.json.id);

  console.log('\n۳) تاریخِ قطعی و لغو');
  r = await send(`/visits/${PV.id}`, 'PATCH', { opDate: day(12), hospitalId: hospital.id });
  w = await list();
  ok('W3 تاریخِ قطعی ← «رزروشده»؛ تاریخِ تقریبی پاک شد', r.status === 200 && rowOf(w, `surgery:${PV.id}`)?.state === 'booked'
    && rowOf(w, `surgery:${PV.id}`)?.surgery?.plannedDate === null && r.json?.undated === false, msgOf(r));
  r = await send(`/visits/${PV.id}/status`, 'PATCH', { opStatus: 'cancelled', cancelReason: 'patient' });
  w = await list();
  const back = rowOf(w, `awaiting:${D1.id}`);
  ok('W4 لغوِ عمل تصمیم را با دلیلِ لغو برگرداند', r.status < 300 && back?.state === 'awaiting' && !!back?.lastCancelReasonFa, JSON.stringify(back).slice(0, 200));
  const cu = await send(`/visits/${PV.id}`, 'PATCH', { opDateOpen: true });
  ok('P6 **نباید بیفتد:** عملِ لغوشده بی‌تاریخ شود', cu.status === 400, `${cu.status} ${msgOf(cu)}`);

  console.log('\n۴) بستنِ تصمیم');
  const bad = await send(`/waitlist/decisions/${D1.id}/close`, 'POST', { reason: 'bored' });
  ok('W5 **نباید بیفتد:** دلیلِ ناشناخته', bad.status === 400, msgOf(bad));
  r = await send(`/waitlist/decisions/${D1.id}/close`, 'POST', { reason: 'elsewhere' });
  w = await list();
  ok('W5 بسته شد و از «منتظرِ برنامه» رفت؛ ممیزی دارد', r.status < 300 && !rowOf(w, `awaiting:${D1.id}`)
    && sql(`SELECT count(*) FROM audit_events WHERE action='visit.decision_close' AND entity_id='${D1.id}'`) === '1', msgOf(r));
  const closedRow = rowOf(w, `closed:${D1.id}`);
  ok('W5 تصمیمِ بسته در تبِ «بسته‌شده» با دلیلش', closedRow?.state === 'closed' && closedRow?.stateFa === 'بسته‌شده' && closedRow?.closeReasonFa === 'جای دیگری عمل شد' && w?.stats?.closed >= 1,
    JSON.stringify(closedRow).slice(0, 200));
  r = await send(`/waitlist/decisions/${D1.id}/reopen`, 'POST');
  w = await list();
  ok('W5 بازکردن برش گرداند', r.status < 300 && rowOf(w, `awaiting:${D1.id}`)?.state === 'awaiting');

  console.log('\n۵) آمار');
  const D2 = await decide('دو', 40);
  const done = (await send('/visits', 'POST', {
    kind: 'surgery', patientId: D2.patientId, decidedInVisitId: D2.id, opDate: day(-10), surgeonId: surgeon.id, hospitalId: hospital.id, procedureTypeId: proc.id, amount: 5000000,
  })).json;
  if (done?.id) trash.visits.push(done.id);
  await send(`/visits/${done.id}/status`, 'PATCH', { opStatus: 'done' });
  w = await list();
  ok('W6 تصمیم تا عمل: ۳۰ روز در آمار (عملِ انجام‌شدهٔ گره‌خورده)', w?.stats?.decisionToSurgery?.n === 1 && w?.stats?.decisionToSurgery?.medianDays === 30, JSON.stringify(w?.stats));
  ok('W6 تصمیمی که عملش انجام شده منتظر نیست', !rowOf(w, `awaiting:${D2.id}`));
  ok('W6 شمارِ وضعیت‌ها با ردیف‌ها می‌خواند', w?.stats?.awaiting === w.rows.filter((x) => x.state === 'awaiting').length);

  console.log('\n۶) دامنه');
  const made = (await send('/accounts/temporary', 'POST', {
    firstName: 'دستیارِ', lastName: `انتظار ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)), level: 2, jobRole: 'assistant', username: `wl${tag}`,
  })).json;
  if (made?.account?.id) {
    trash.accounts.push(made.account.id);
    const tech = call((await loginAs(`wl${tag}`, made.temporaryPassword)).accessToken);
    let tw = await list(tech);
    ok('S1 **نباید بیفتد:** سطح ۲ بیمارِ دیگری را ببیند', Array.isArray(tw?.rows) && !rowOf(tw, `awaiting:${D1.id}`) && tw.team === false, JSON.stringify(tw).slice(0, 160));
    await send(`/visits/${D1.id}`, 'PATCH', { techId: made.account.id });
    tw = await list(tech);
    ok('S1 مراجعهٔ منتسب را می‌بیند', rowOf(tw, `awaiting:${D1.id}`)?.state === 'awaiting');
    ok('S1 سطح ۲ «برنامهٔ عمل» ندارد (مجوز از سرور)', tw?.can?.plan === false, JSON.stringify(tw?.can));
    const other = (await tech(`/waitlist/decisions/${D2b.id}/close`, 'POST', { reason: 'declined' }));
    ok('S1 **نباید بیفتد:** بستنِ تصمیمِ بیمارِ دیگر', other.status === 404, `${other.status} ${msgOf(other)}`);
  } else ok('حسابِ سطح ۲', false, JSON.stringify(made).slice(0, 160));

  console.log('\n۷) بیرون از مطب + باگِ B1');
  const other = vertical0 === 'clinic' ? 'ionm' : vertical0;
  await send('/config/vertical', 'PATCH', { vertical: other });
  const g1 = await send('/waitlist');
  ok(`G1 **نباید بیفتد:** فهرست در ${other}`, g1.status === 404 || g1.status === 403, String(g1.status));
  ok(`G1 ماژول در ${other} خاموش شد`, sql(`SELECT enabled::text FROM features WHERE key='waitlist'`) === 'false');
  await ensureForms();
  /* «رزرو بدون تاریخ»ِ شرکت: مراجعه بی‌تاریخ ساخته شده؛ ویرایشش نباید تاریخِ ساختگی بخواهد (B1). */
  const B = (await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'رزروِ', lastName: `بی‌تاریخ${tag}`, surgeonId: surgeon.id, hospitalId: hospital.id, procedureTypeId: proc.id,
    amount: 5000000, opDateOpen: true,
  }));
  if (B.json?.id) trash.visits.push(B.json.id);
  ok(`B1 مراجعهٔ بی‌تاریخ در ${other} ساخته شد (بیمارستان و مبلغ همچنان ستاره‌دار)`, B.status < 300 && B.json?.undated === true, `${B.status} ${msgOf(B)}`);
  const Bnh = await send('/visits', 'POST', { kind: 'surgery', firstName: 'رزروِ', lastName: `بی‌بیمارستان${tag}`, surgeonId: surgeon.id, procedureTypeId: proc.id, amount: 5000000, opDateOpen: true });
  ok(`B1 **نباید بیفتد:** در ${other} بی‌تاریخ ستارهٔ بیمارستان را بردارد`, Bnh.status === 400, `${Bnh.status} ${msgOf(Bnh)}`);
  if (Bnh.json?.id) trash.visits.push(Bnh.json.id);
  let be = await send(`/visits/${B.json?.id}`, 'PATCH', { notes: `یادداشت ${tag}`, opDate: null });
  ok('B1 ویرایشِ مراجعهٔ بی‌تاریخ بی‌تاریخ (همان باگ)', be.status === 200, `${be.status} ${msgOf(be)}`);
  be = await send(`/visits/${B.json?.id}`, 'PATCH', { opDate: day(3) });
  ok('B1 تاریخ‌دارشدن', be.status === 200 && String(be.json?.opDate).slice(0, 10) === day(3), `${be.status} ${msgOf(be)}`);
  be = await send(`/visits/${B.json?.id}`, 'PATCH', { opDate: null, notes: 'x' });
  ok('B1 **نباید بیفتد:** تاریخِ عملِ تاریخ‌دار بی‌پرچمِ صریح پاک شود', be.status === 400, `${be.status} ${msgOf(be)}`);
} catch (e) {
  ok(`اجرا متوقف شد: ${e?.message ?? e}`, false);
} finally {
  for (const key of starred) {
    try { sql(`UPDATE form_fields SET required=FALSE WHERE key='${key}' AND form_id IN (SELECT id FROM form_defs WHERE scope='visit' AND visit_kind='surgery')`); } catch { /* */ }
  }
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  ok('برگشت به حوزهٔ قبلی', back.status === 200, String(back.status));
  for (const id of trash.visits.reverse()) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    try {
      sql(`DELETE FROM account_sessions WHERE account_id=${id}`);
      sql(`DELETE FROM hospital_duties WHERE tech_id=${id}`);
      sql(`DELETE FROM accounts WHERE id=${id}`);
    } catch { /* پاک‌سازیِ بهترین‌تلاش */ }
  }
}
console.log(`\n${pass} سبز · ${fails.length} قرمز`);
if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
