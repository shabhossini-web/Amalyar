/**
 * **جزئیاتِ ساخت‌یافتهٔ عمل، سمت/سطحِ هر عمل، تکمیلِ ترخیص** (بستهٔ ۸ — بندِ «د» HIS).
 *
 * سه چیز، همه فقط در حوزهٔ مطب:
 *  ۱. `visit_op_details` — پیش از عمل (ASA، رضایت، ناشتایی، ضدانعقاد)، تیم و حینِ عمل،
 *     بعد از عمل (عارضه + Clavien، تأییدِ تشخیصِ پس از عمل). تنها نویسنده `writeOpDetails`.
 *  ۲. `visit_procedure_details` — سمت و سطحِ **هر** عمل؛ تنها نویسنده `writeProcedureDetails`.
 *  ۳. ترخیص: داروهای ترخیص (سندِ `discharge_rx`) و ویزیتِ بعدی از پاپ‌آپ.
 *
 *  باید بیفتد:
 *   - ساخت با هر سه بخش + سمتِ دو عمل؛ ارقامِ فارسی پذیرفته (A1)
 *   - وصلهٔ جزئی چیزی را پاک نمی‌کند (A3)
 *   - عارضهٔ «نداشت» درجه و تاریخ را پاک می‌کند؛ پاک‌کردنِ ASA «اورژانس» را (A4)
 *   - میزِ اتاق: سطرِ پیش از عمل، تیم، سمت در فهرستِ روز، ذخیرهٔ حینِ عمل با ممیزی (T1–T3)
 *   - ترخیص با دارو و ویزیتِ بعدی؛ «فوت» ویزیتِ بعدی و پیام‌ها را برمی‌دارد (D1–D4)
 *   - پرونده همه را روی کارتِ عمل نشان می‌دهد (R1)
 *  نباید بیفتد:
 *   - کلید/گزینه/بازهٔ نامعتبر، درجهٔ عارضه بی‌عارضه، E بی‌ASA (A2)
 *   - سمت برای عملی که روی مراجعه نیست؛ سمتِ کهنه بعد از جابه‌جاییِ عمل‌ها بماند (S1–S3)
 *   - میز پیش از عمل یا عارضه بنویسد (T4)
 *   - کارشناس بخشِ نقشِ دیگر را بنویسد؛ ویزیتِ بعدی بی‌مجوز (O1–O3)
 *   - هیچ‌کدام بیرون از مطب یا روی ویزیت (G1–G3)
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const psql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
const sql = (q) => psql(q).split('\n')[0];
const num = (q) => Number(sql(q));
const sqlFails = (q) => { try { psql(q); return false; } catch { return true; } };

const loginAs = async (identifier, password) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier, password }),
}).then((r) => r.json());
const call = (token) => (p, m = 'GET', b) => fetch(API + p, {
  method: m,
  headers: { Authorization: 'Bearer ' + token, ...(b !== undefined ? { 'Content-Type': 'application/json' } : {}) },
  body: b !== undefined ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const login = await loginAs(USER, PASS);
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = call(login.accessToken);

const tag = randomBytes(3).toString('hex');
const msgOf = (r) => { const m = r.json?.message; return Array.isArray(m) ? m.join('، ') : String(m ?? JSON.stringify(r.json ?? '')); };
const today = new Date().toISOString().slice(0, 10);
const plusDays = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const detailRows = (id) => psql(`SELECT procedure_type_id || ':' || coalesce(side,'-') || ':' || coalesce(level,'-') FROM visit_procedure_details WHERE visit_id=${id} ORDER BY procedure_type_id`).split('\n').filter(Boolean);
const od = (id, col) => sql(`SELECT coalesce(${col}::text, '∅') FROM visit_op_details WHERE visit_id=${id}`);

const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const trash = { visits: [], procs: [], accounts: [], dx: [] };
const restoreRoles = [];

try {
  const sw = await send('/config/vertical', 'PATCH', { vertical: 'clinic' });
  ok('سوییچ به حوزهٔ مطب', sw.status === 200, String(sw.status));

  const surgeon = (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `جزئیات${tag}` })).json;
  const hospital = (await send('/hospitals')).json?.[0]
    ?? (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;
  const mkProc = async (name, extra = {}) => { const r = (await send('/procedure-types', 'POST', { name, ...extra })).json; trash.procs.push(r.id); return r; };
  /* P1 مراقبتِ پس از عمل و پیگیری دارد تا لغو/کاشتِ دوبارهٔ یادآوری‌ها در ترخیص سنجیدنی باشد. */
  const P1 = await mkProc(`میکرودیسککتومی ${tag}`, { postOpCare: 'پانسمان را خشک نگه دارید', followUpDays: '1,7' });
  const P2 = await mkProc(`فیوژن ${tag}`);
  const P3 = await mkProc(`لامینکتومی ${tag}`);
  const dx = (await send('/diagnoses', 'POST', { title: `فتقِ دیسک ${tag}` })).json;
  if (dx?.id) trash.dx.push(dx.id);
  ok('چیدمان: جراح، بیمارستان، سه نوعِ عمل، یک تشخیص', !!surgeon?.id && !!hospital?.id && !!P3?.id && !!dx?.id);

  console.log('۱) ساخت با هر سه بخش و سمتِ هر عمل');
  const a1 = await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'جزئیاتِ', lastName: `عمل${tag}`, opDate: today, surgeonId: surgeon.id, hospitalId: hospital.id,
    procedureTypeId: P1.id, otherProcedureTypeIds: [P2.id], diagnosisId: dx.id, anesthesia: 'general',
    opDetails: {
      asaClass: 'II', consentSigned: true, npoConfirmed: false, anticoagulant: 'stopped', anticoagNote: 'آسپرین — ۵ روز پیش',
      assistantSurgeonName: 'دکتر کمکی', bloodLossMl: '۲۵۰', specimenSent: true, specimenNote: 'قطعهٔ دیسک',
      complication: false,
    },
    procedureDetails: [{ procedureTypeId: P1.id, side: 'right', level: 'L4–L5' }, { procedureTypeId: P2.id, side: 'left' }],
  });
  ok('A1 ساخته شد', a1.status === 201 || a1.status === 200, `${a1.status} ${msgOf(a1).slice(0, 200)}`);
  const V = a1.json;
  if (!V?.id) throw new Error('مراجعه ساخته نشد');
  trash.visits.push(V.id);
  ok('A1 پاسخِ ساخت خودش جزئیات و سمت‌ها را دارد (نه `undefined`)',
    V.opDetails?.asaClass === 'II' && V.procedures?.find((p) => p.id === P1.id)?.side === 'right', JSON.stringify({ o: V.opDetails?.asaClass, p: V.procedures }).slice(0, 200));
  let g = (await send(`/visits/${V.id}`)).json;
  ok('A1 خون‌ریزی با ارقامِ فارسی ← ۲۵۰', g.opDetails?.bloodLossMl === 250, String(g.opDetails?.bloodLossMl));
  ok('A1 برچسب‌ها از سرور', g.opDetails?.asaFa?.startsWith('ASA II') && g.opDetails?.anticoagulantFa === 'طبقِ دستور قطع شد', `${g.opDetails?.asaFa} · ${g.opDetails?.anticoagulantFa}`);
  ok('A1 «خیر» ثبت شد نه «ثبت نشده»', g.opDetails?.npoConfirmed === false && g.opDetails?.complication === false && g.opDetails?.drainPlaced === null);
  const p1 = g.procedures?.find((p) => p.id === P1.id);
  const p2 = g.procedures?.find((p) => p.id === P2.id);
  ok('A1 سمت و سطحِ هر عمل جدا', p1?.sideFa === 'راست' && p1?.level === 'L4–L5' && p2?.sideFa === 'چپ' && p2?.level === null, JSON.stringify(g.procedures));
  ok('A1 **نباید بیفتد:** سمت داخلِ نامِ عمل یا برچسبِ ترکیبی نرفت', g.procedureLabel === `${P1.name} + ${P2.name}` && p1?.name === P1.name, g.procedureLabel);
  ok('A1 دو ردیفِ سمت در DB', JSON.stringify(detailRows(V.id)) === JSON.stringify([`${P1.id}:right:L4–L5`, `${P2.id}:left:-`]), JSON.stringify(detailRows(V.id)));

  const a1b = await send('/visits', 'POST', {
    kind: 'surgery', patientId: V.patientId, opDate: today, surgeonId: surgeon.id, hospitalId: hospital.id,
    procedureTypeId: P1.id, procedureDetails: [{ procedureTypeId: P3.id, side: 'left' }],
  });
  ok('A1 **نباید بیفتد:** سمت برای عملی که روی مراجعه نیست (۴۰۰)', a1b.status === 400, `${a1b.status} ${msgOf(a1b)}`);
  if (a1b.json?.id) trash.visits.push(a1b.json.id);

  console.log('\n۲) اعتبارسنجی — ۴۰۰ با پیامِ فارسی، نه دور ریختنِ بی‌صدا');
  const bad = async (name, body) => {
    const r = await send(`/visits/${V.id}`, 'PATCH', body);
    ok(`A2 ${name} (${r.status})`, r.status === 400 && /[؀-ۿ]/.test(msgOf(r)), msgOf(r));
  };
  await bad('کلیدِ ناشناخته', { opDetails: { foo: 1 } });
  await bad('آرایه به‌جای شیء', { opDetails: [] });
  await bad('ASA VI', { opDetails: { asaClass: 'VI' } });
  await bad('ضدانعقادِ ناشناخته', { opDetails: { anticoagulant: 'maybe' } });
  await bad('خون‌ریزیِ ۳۰۰۰۰', { opDetails: { bloodLossMl: 30000 } });
  await bad('خون‌ریزیِ منفی', { opDetails: { bloodLossMl: -5 } });
  await bad('خون‌ریزیِ غیرعددی', { opDetails: { bloodLossMl: 'زیاد' } });
  await bad('یادداشتِ ضدانعقادِ ۲۰۱ نویسه', { opDetails: { anticoagNote: 'x'.repeat(201) } });
  await bad('بله/خیر با رشته', { opDetails: { consentSigned: 'yes' } });
  await bad('درجهٔ عارضه وقتی عارضه «نداشت»', { opDetails: { clavienGrade: 'II' } });
  await bad('تاریخِ عارضه وقتی عارضه «نداشت»', { opDetails: { complicationDate: today } });
  await bad('«اورژانس» همراهِ پاک‌کردنِ ASA', { opDetails: { asaClass: null, asaEmergency: true } });
  await bad('سمتِ ناشناخته', { procedureDetails: [{ procedureTypeId: P1.id, side: 'up' }] });
  await bad('یک عمل دو بار', { procedureDetails: [{ procedureTypeId: P1.id, side: 'right' }, { procedureTypeId: P1.id, side: 'left' }] });
  await bad('سطحِ ۶۱ نویسه', { procedureDetails: [{ procedureTypeId: P1.id, level: 'L'.repeat(61) }] });
  ok('A2 هیچ‌کدام چیزی ننوشت', od(V.id, 'asa_class') === 'II' && od(V.id, 'blood_loss_ml') === '250' && detailRows(V.id).length === 2);
  ok('A2 پشتیبانِ آخر: CHECKِ DB درجهٔ بی‌عارضه را رد می‌کند',
    sqlFails(`UPDATE visit_op_details SET clavien_grade='II' WHERE visit_id=${V.id}`));
  ok('A2 CHECKِ DB: E بی‌کلاس', sqlFails(`UPDATE visit_op_details SET asa_class=NULL, asa_emergency=true WHERE visit_id=${V.id}`));

  console.log('\n۳) وصلهٔ جزئی');
  let r = await send(`/visits/${V.id}`, 'PATCH', { opDetails: { bloodLossMl: 300 } });
  g = (await send(`/visits/${V.id}`)).json;
  ok('A3 فقط خون‌ریزی عوض شد', r.status === 200 && g.opDetails?.bloodLossMl === 300 && g.opDetails?.asaClass === 'II'
    && g.opDetails?.assistantSurgeonName === 'دکتر کمکی' && g.opDetails?.specimenNote === 'قطعهٔ دیسک', `${r.status} ${JSON.stringify(g.opDetails).slice(0, 200)}`);
  r = await send(`/visits/${V.id}`, 'PATCH', { notes: `بی‌ربط ${tag}` });
  ok('A3 PATCHِ بی‌`opDetails` دست نمی‌زند', r.status === 200 && od(V.id, 'blood_loss_ml') === '300' && detailRows(V.id).length === 2);
  r = await send(`/visits/${V.id}`, 'PATCH', { opDetails: { specimenNote: '' } });
  ok('A3 رشتهٔ خالی = پاک', r.status === 200 && od(V.id, 'specimen_note') === '∅' && od(V.id, 'specimen_sent') === 'true');

  console.log('\n۴) قاعده‌های میانِ کلیدها');
  r = await send(`/visits/${V.id}`, 'PATCH', { opDetails: { asaEmergency: true } });
  ok('A4 «اورژانس» با کلاس', r.status === 200 && od(V.id, 'asa_emergency') === 'true');
  r = await send(`/visits/${V.id}`, 'PATCH', { opDetails: { asaClass: null } });
  ok('A4 پاک‌کردنِ کلاس «اورژانس» را هم برد', r.status === 200 && od(V.id, 'asa_emergency') === '∅' && od(V.id, 'asa_class') === '∅');
  await send(`/visits/${V.id}`, 'PATCH', { opDetails: { asaClass: 'II' } });
  r = await send(`/visits/${V.id}`, 'PATCH', { opDetails: { complication: true, clavienGrade: 'IIIa', complicationDate: plusDays(2), complicationNote: 'نشتِ مایعِ نخاع' } });
  g = (await send(`/visits/${V.id}`)).json;
  ok('A4 عارضه با درجه و تاریخ', r.status === 200 && g.opDetails?.clavienGradeFa?.includes('IIIa') && g.opDetails?.complicationDate?.slice(0, 10) === plusDays(2),
    `${r.status} ${msgOf(r)} ${g.opDetails?.complicationDate}`);
  r = await send(`/visits/${V.id}`, 'PATCH', { opDetails: { complication: null } });
  ok('A4 عارضهٔ «ثبت نشده» درجه و تاریخ را برد، شرح ماند',
    r.status === 200 && od(V.id, 'clavien_grade') === '∅' && od(V.id, 'complication_date') === '∅' && od(V.id, 'complication_note') !== '∅');
  const before = sql(`SELECT updated_at FROM visit_op_details WHERE visit_id=${V.id}`);
  await send(`/visits/${V.id}`, 'PATCH', { opDetails: { asaClass: 'II', consentSigned: true } });
  ok('A4 **نباید بیفتد:** echoِ بی‌تغییر ردیف را لمس کند', sql(`SELECT updated_at FROM visit_op_details WHERE visit_id=${V.id}`) === before);

  console.log('\n۵) سمت‌ها — هرسِ عملِ رفته');
  r = await send(`/visits/${V.id}`, 'PATCH', { procedureDetails: [{ procedureTypeId: P2.id, side: null, level: null }] });
  ok('S1 ردیفِ «هر دو خالی» حذف شد', r.status === 200 && JSON.stringify(detailRows(V.id)) === JSON.stringify([`${P1.id}:right:L4–L5`]), JSON.stringify(detailRows(V.id)));
  await send(`/visits/${V.id}`, 'PATCH', { procedureDetails: [{ procedureTypeId: P2.id, side: 'bilateral' }] });
  r = await send(`/visits/${V.id}`, 'PATCH', { procedureTypeId: P3.id });
  g = (await send(`/visits/${V.id}`)).json;
  ok('S2 تعویضِ **فقط اصلی** (P1←P3): سمتِ P1 هرس شد، P2 ماند',
    r.status === 200 && JSON.stringify(detailRows(V.id)) === JSON.stringify([`${P2.id}:bilateral:-`]) && g.procedureTypeId === P3.id,
    JSON.stringify(detailRows(V.id)));
  r = await send(`/visits/${V.id}`, 'PATCH', { procedureTypeId: P1.id, otherProcedureTypeIds: [P2.id] });
  ok('S2 **نباید بیفتد:** برگشتنِ P1 سمتِ کهنه‌اش را زنده کند', r.status === 200 && !detailRows(V.id).some((x) => x.startsWith(`${P1.id}:`)), JSON.stringify(detailRows(V.id)));
  r = await send(`/visits/${V.id}`, 'PATCH', { otherProcedureTypeIds: [], procedureDetails: [{ procedureTypeId: P1.id, side: 'right', level: 'L4–L5' }] });
  ok('S3 حذفِ همزمان‌ها + سمتِ اصلی در یک درخواست', r.status === 200 && JSON.stringify(detailRows(V.id)) === JSON.stringify([`${P1.id}:right:L4–L5`]), `${r.status} ${JSON.stringify(detailRows(V.id))}`);
  r = await send(`/visits/${V.id}`, 'PATCH', { otherProcedureTypeIds: [P2.id], procedureDetails: [{ procedureTypeId: P2.id, side: 'left' }] });
  ok('S3 برگرداندنِ P2 با سمت', r.status === 200, msgOf(r));
  r = await send(`/visits/${V.id}`, 'PATCH', { procedureTypeId: P2.id, otherProcedureTypeIds: [P1.id], procedureDetails: [{ procedureTypeId: P2.id, side: 'left' }] });
  ok('S4 جابه‌جاییِ اصلی + سمتِ اصلیِ تازه در یک درخواست — هر دو ردیف می‌مانند',
    r.status === 200 && JSON.stringify(detailRows(V.id)) === JSON.stringify([`${P1.id}:right:L4–L5`, `${P2.id}:left:-`]), `${r.status} ${JSON.stringify(detailRows(V.id))}`);
  r = await send(`/visits/${V.id}`, 'PATCH', { procedureTypeId: P1.id, otherProcedureTypeIds: [P2.id] });
  ok('S4 برگشتِ ترتیب بدونِ details سمت‌ها را نگه می‌دارد', r.status === 200 && detailRows(V.id).length === 2, JSON.stringify(detailRows(V.id)));
  ok('S3 ناوردای جدول: هیچ سمتی برای عملِ ناموجود', num(`
    SELECT count(*) FROM visit_procedure_details d JOIN visits v ON v.id = d.visit_id
    WHERE d.procedure_type_id IS DISTINCT FROM v.procedure_type_id
      AND NOT EXISTS (SELECT 1 FROM visit_other_procedures o WHERE o.visit_id = d.visit_id AND o.procedure_type_id = d.procedure_type_id)`) === 0);

  console.log('\n۶) میزِ اتاقِ عمل');
  let card = (await send(`/theatre/visits/${V.id}`)).json;
  ok('T1 کارت: `clinical` و مجوزها از سرور', card?.clinical === true && card?.can?.report === true && card?.can?.followup === true, JSON.stringify(card?.can));
  ok('T1 سطرِ پیش از عمل: بیهوشی · ASA · رضایت', /عمومی/.test(card?.visit?.preOp ?? '') && /ASA II/.test(card?.visit?.preOp ?? '') && /رضایت‌نامه امضا شد/.test(card?.visit?.preOp ?? ''), card?.visit?.preOp);
  ok('T1 تیم: کمک‌جراح', card?.visit?.opDetails?.assistantSurgeonName === 'دکتر کمکی');
  ok('T1 **نباید بیفتد:** پولی روی کارت', !/"(amount|paid|due|price|tariff)"/.test(JSON.stringify(card)));
  const day = (await send(`/theatre/day?date=${today}`)).json;
  const row = day?.visits?.find((x) => x.id === V.id);
  ok('T2 فهرستِ روز سمت را جدا دارد', /راست/.test(row?.sides ?? '') && /L4–L5/.test(row?.sides ?? '') && !/راست/.test(row?.procedure ?? ''), JSON.stringify(row && { s: row.sides, p: row.procedure }));
  r = await send(`/theatre/visits/${V.id}/op-details`, 'POST', { opDetails: { bloodLossMl: '۴۰۰', drainPlaced: true, anesthesiologistName: 'دکتر بیهوشی' } });
  ok('T3 ذخیرهٔ حینِ عمل از میز', r.status < 300 && r.json?.visit?.opDetails?.bloodLossMl === 400 && r.json?.visit?.opDetails?.drainPlaced === true, `${r.status} ${msgOf(r)}`);
  ok('T3 ممیزیِ `visit.op_details` با قبل/بعد',
    num(`SELECT count(*) FROM audit_events WHERE action='visit.op_details' AND entity_id='${V.id}' AND before_json->>'bloodLossMl'='300' AND after_json->>'bloodLossMl'='400'`) === 1);
  const n0 = num(`SELECT count(*) FROM audit_events WHERE action='visit.op_details' AND entity_id='${V.id}'`);
  await send(`/theatre/visits/${V.id}/op-details`, 'POST', { opDetails: { bloodLossMl: 400 } });
  ok('T3 **نباید بیفتد:** ذخیرهٔ بی‌تغییر ممیزیِ تازه بسازد', num(`SELECT count(*) FROM audit_events WHERE action='visit.op_details' AND entity_id='${V.id}'`) === n0);
  for (const [n, body] of [['ASA', { asaClass: 'I' }], ['عارضه', { complication: true }], ['تأییدِ تشخیص', { postopDxConfirmed: true }], ['خالی', {}]]) {
    const x = await send(`/theatre/visits/${V.id}/op-details`, 'POST', { opDetails: body });
    ok(`T4 **نباید بیفتد:** میز «${n}» بنویسد (${x.status})`, x.status === 400, msgOf(x));
  }

  console.log('\n۷) ترخیص');
  await send(`/theatre/visits/${V.id}/start`, 'POST');
  await send(`/theatre/visits/${V.id}/finish`, 'POST');
  const early = await send(`/theatre/visits/${V.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'home', nextVisitDate: plusDays(-3) });
  ok('D1 **نباید بیفتد:** ویزیتِ بعدی پیش از روزِ عمل', early.status === 400, msgOf(early));
  const nul = await send(`/theatre/visits/${V.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'home', nextVisitDate: null });
  ok('D1 **نباید بیفتد:** برداشتنِ ویزیتِ بعدی از پاپ‌آپ', nul.status === 400, msgOf(nul));
  r = await send(`/theatre/visits/${V.id}/discharge`, 'POST', {
    condition: 'هوشیار، دردِ کم', disposition: 'home', summary: 'سیرِ بستریِ بی‌حادثه', rx: 'سفالکسین ۵۰۰ — هر ۶ ساعت', nextVisitDate: plusDays(7),
  });
  ok('D2 ترخیص با دارو و ویزیتِ بعدی', r.status < 300 && r.json?.visit?.dischargeRx?.startsWith('سفالکسین') && r.json?.visit?.nextVisitDate?.slice(0, 10) === plusDays(7), `${r.status} ${msgOf(r)}`);
  ok('D2 دارو سندِ نسخه‌دارِ `discharge_rx`', num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${V.id} AND kind='discharge_rx' AND replaced_at IS NULL`) === 1);
  ok('D2 ممیزی: طولِ دارو و قبل/بعدِ ویزیتِ بعدی',
    num(`SELECT count(*) FROM audit_events WHERE action='visit.discharge' AND entity_id='${V.id}' AND (after_json->>'rxLength')::int > 0 AND after_json->'nextVisitDate' ? 'after'`) === 1);
  ok('D2 یادآوریِ ویزیتِ بعدی کاشته شد', num(`SELECT count(*) FROM reminders WHERE visit_id=${V.id} AND kind='next_visit' AND status='pending'`) >= 1);
  const deathRx = await send(`/theatre/visits/${V.id}/discharge`, 'POST', { condition: 'ایست قلبی', disposition: 'death', rx: 'x' });
  ok('D3 **نباید بیفتد:** «فوت» با دارو', deathRx.status === 400, msgOf(deathRx));
  const deathNext = await send(`/theatre/visits/${V.id}/discharge`, 'POST', { condition: 'ایست قلبی', disposition: 'death', nextVisitDate: plusDays(9) });
  ok('D3 **نباید بیفتد:** «فوت» با ویزیتِ بعدی', deathNext.status === 400, msgOf(deathNext));
  r = await send(`/theatre/visits/${V.id}/discharge`, 'POST', { condition: 'ایست قلبی حینِ ریکاوری', disposition: 'death', rx: '' });
  ok('D4 «فوت» ثبت شد', r.status < 300, `${r.status} ${msgOf(r)}`);
  ok('D4 ویزیتِ بعدی پاک شد', sql(`SELECT coalesce(next_visit_date::text,'∅') FROM visits WHERE id=${V.id}`) === '∅');
  ok('D4 دارو بسته شد', num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${V.id} AND kind='discharge_rx' AND replaced_at IS NULL AND trim(body) <> ''`) === 0);
  ok('D4 هیچ پیامِ پس از عمل/ویزیتِ بعدی در صف نماند',
    num(`SELECT count(*) FROM reminders WHERE visit_id=${V.id} AND kind IN ('next_visit','post_op_care','follow_up') AND status='pending'`) === 0);
  /* اصلاحِ «فوت» بدونِ تاریخ (حالتِ عادیِ نقشی که ویزیتِ بعدی نمی‌دهد): مراقبتِ پس از عمل و پیگیری باید برگردند. */
  r = await send(`/theatre/visits/${V.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'home' });
  ok('D4 اصلاحِ «فوت» ← منزل **بدونِ تاریخ** هم مراقبت/پیگیری را دوباره می‌کارد',
    r.status < 300 && num(`SELECT count(*) FROM reminders WHERE visit_id=${V.id} AND kind IN ('post_op_care','follow_up') AND status='pending'`) >= 1, `${r.status} ${msgOf(r)}`);
  r = await send(`/theatre/visits/${V.id}/discharge`, 'POST', { condition: 'ایست قلبی', disposition: 'death' });
  ok('D4 «فوت»ِ دوباره همان‌ها را دوباره لغو می‌کند', r.status < 300 && num(`SELECT count(*) FROM reminders WHERE visit_id=${V.id} AND kind IN ('post_op_care','follow_up','next_visit') AND status='pending'`) === 0);
  r = await send(`/theatre/visits/${V.id}/discharge`, 'POST', { condition: 'هوشیار، دردِ کم', disposition: 'home', rx: 'سفالکسین', nextVisitDate: plusDays(8) });
  ok('D4 اصلاحِ اشتباهِ «فوت» ← منزل دوباره می‌کارد', r.status < 300 && num(`SELECT count(*) FROM reminders WHERE visit_id=${V.id} AND kind='next_visit' AND status='pending'`) >= 1, `${r.status} ${msgOf(r)}`);

  console.log('\n۸) پرونده');
  const rec = (await send(`/patients/${V.patientId}/record`)).json;
  const rv = rec?.visits?.find((x) => x.id === V.id);
  ok('R1 کارتِ عمل: سمت، جزئیات، ترخیص با دارو، ویزیتِ بعدی',
    rv?.procedures?.find((p) => p.id === P1.id)?.sideFa === 'راست' && rv?.opDetails?.bloodLossMl === 400
      && rv?.discharge?.rx === 'سفالکسین' && rv?.discharge?.dispositionFa === 'منزل' && rv?.nextVisitDate?.slice(0, 10) === plusDays(8),
    JSON.stringify(rv && { d: rv.discharge, n: rv.nextVisitDate }).slice(0, 200));

  console.log('\n۹) نقش و مجوز');
  const forms = (await send('/forms')).json ?? [];
  const sForm = forms.find((f) => f.scope === 'visit' && f.visitKind === 'surgery');
  const fld = (k) => sForm?.fields?.find((x) => x.key === k);
  const setRoles = async (k, roles) => {
    const f = fld(k);
    if (!f) return 0;
    if (!restoreRoles.some((x) => x.id === f.id)) restoreRoles.push({ id: f.id, roles: f.roles ?? (f.role ? [f.role] : []) });
    return (await send(`/forms/fields/${f.id}`, 'PATCH', { roles })).status;
  };
  const mkAcc = async (level, jobRole, u) => {
    const made = (await send('/accounts/temporary', 'POST', {
      firstName: 'آزمونِ', lastName: `${u} ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)), level, jobRole, username: `${u}${tag}`,
    })).json;
    if (!made?.account?.id) return null;
    trash.accounts.push(made.account.id);
    const l = await loginAs(`${u}${tag}`, made.temporaryPassword);
    return l.accessToken ? { id: made.account.id, send: call(l.accessToken) } : null;
  };
  const tech = await mkAcc(2, 'technician', 'odt');
  const sec = await mkAcc(5, 'secretary', 'ods');
  ok('حساب‌های آزمایشی', !!tech && !!sec);
  if (tech && sec) {
    await send(`/visits/${V.id}`, 'PATCH', { techId: tech.id });
    ok('O1 نقش‌ها: بیهوشی ← پزشک، شرحِ عمل ← کارشناس', (await setRoles('anesthesia', ['doctor'])) === 200 && (await setRoles('opReport', ['technician'])) === 200);
    r = await tech.send(`/theatre/visits/${V.id}/op-details`, 'POST', { opDetails: { bloodLossMl: 450 } });
    ok('O1 کارشناس (مالکِ شرحِ عمل) از میز می‌نویسد', r.status < 300 && od(V.id, 'blood_loss_ml') === '450', `${r.status} ${msgOf(r)}`);
    r = await sec.send(`/visits/${V.id}`, 'PATCH', { opDetails: { asaClass: 'III' } });
    ok('O2 **نباید بیفتد:** منشی ASA (بخشِ پزشک) را بنویسد', r.status === 400 && /ارزیابیِ پیش از عمل/.test(msgOf(r)) && od(V.id, 'asa_class') === 'II', msgOf(r));
    r = await sec.send(`/visits/${V.id}`, 'PATCH', { opDetails: { asaClass: 'II' }, notes: `منشی ${tag}` });
    ok('O2 echoِ بی‌تغییرِ ASA رد نمی‌شود (مقایسهٔ کلید‌به‌کلید)', r.status === 200, `${r.status} ${msgOf(r)}`);
    r = await sec.send(`/visits/${V.id}`, 'PATCH', { procedureDetails: [{ procedureTypeId: P1.id, side: 'left' }] });
    const ptRoles = await setRoles('procedureTypeId', ['doctor']);
    const r2 = await sec.send(`/visits/${V.id}`, 'PATCH', { procedureDetails: [{ procedureTypeId: P1.id, side: 'bilateral' }] });
    ok('O2 سمت‌ها مالکِ «نوعِ عمل» را دارند', ptRoles === 200 && r2.status === 400 && /سمت و سطحِ عمل‌ها/.test(msgOf(r2)), `${r2.status} ${msgOf(r2)}`);
    await setRoles('opReport', ['doctor']);
    r = await tech.send(`/theatre/visits/${V.id}/op-details`, 'POST', { opDetails: { bloodLossMl: 500 } });
    ok('O2 **نباید بیفتد:** میز دورِ قفلِ نقش بزند', r.status === 400 && od(V.id, 'blood_loss_ml') === '450', `${r.status} ${msgOf(r)}`);
    await setRoles('opReport', []);
    await setRoles('procedureTypeId', []);
    r = await tech.send(`/theatre/visits/${V.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'home', nextVisitDate: plusDays(10) });
    ok('O3 **نباید بیفتد:** کارشناس (بی `theatre.followup`) ویزیتِ بعدی را عوض کند', r.status === 403, `${r.status} ${msgOf(r)}`);
    r = await tech.send(`/theatre/visits/${V.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'home', nextVisitDate: plusDays(8) });
    ok('O3 همان تاریخِ قبلی (بی‌تغییر) مجوز نمی‌خواهد', r.status < 300, `${r.status} ${msgOf(r)}`);
    const tc = (await tech.send(`/theatre/visits/${V.id}`)).json;
    ok('O3 کارت به کارشناس می‌گوید ویزیتِ بعدی مالِ او نیست', tc?.can?.followup === false && tc?.can?.report === true, JSON.stringify(tc?.can));
    await send(`/visits/${V.id}`, 'PATCH', { techId: null });
  }

  console.log('\n۱۰) دروازه‌ها');
  /* فرمِ ویزیتِ مطب باید باشد، وگرنه ۴۰۰ از «نوعی که فرم ندارد» می‌آید و دروازهٔ «فقط عمل» سنجیده نمی‌شود (بازبینی). */
  if (!((await send('/forms/visit-kinds')).json ?? []).some((k) => (k.kind ?? k.key) === 'clinic')) {
    await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  }
  const cv = await send('/visits', 'POST', {
    kind: 'clinic', patientId: V.patientId, opDate: today, surgeonId: surgeon.id, opDetails: { asaClass: 'I' },
  });
  ok('G1 **نباید بیفتد:** جزئیاتِ عمل روی ویزیت', cv.status === 400 && /فقط برای مراجعهٔ نوعِ عمل/.test(msgOf(cv)), msgOf(cv));
  if (cv.json?.id) trash.visits.push(cv.json.id);
  const other = vertical0 === 'clinic' ? 'ionm' : vertical0;
  await send('/config/vertical', 'PATCH', { vertical: other });
  r = await send(`/visits/${V.id}`, 'PATCH', { opDetails: { bloodLossMl: 10 } });
  ok(`G2 **نباید بیفتد:** بیرون از مطب (${other})`, r.status === 400 && /مطب/.test(msgOf(r)), msgOf(r));
  r = await send(`/theatre/visits/${V.id}/op-details`, 'POST', { opDetails: { bloodLossMl: 10 } });
  ok('G2 … از میز هم', r.status === 400, msgOf(r));
  r = await send(`/theatre/visits/${V.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'home', rx: 'x' });
  ok('G2 … داروی ترخیص هم', r.status === 400, msgOf(r));
  card = (await send(`/theatre/visits/${V.id}`)).json;
  ok('G3 کارتِ بیرون از مطب: بی‌بلوکِ بالینی', card?.clinical === false && card?.visit?.opDetails === null && card?.visit?.preOp === null && card?.can?.followup === false,
    JSON.stringify({ c: card?.clinical, o: card?.visit?.opDetails, f: card?.can?.followup }));
} finally {
  for (const x of restoreRoles) await send(`/forms/fields/${x.id}`, 'PATCH', { roles: x.roles }).catch(() => {});
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  ok('برگشت به حوزهٔ قبلی', back.status === 200, String(back.status));
  for (const v of trash.visits) await send(`/visits/${v}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    try { sql(`DELETE FROM account_sessions WHERE account_id=${id}`); sql(`DELETE FROM accounts WHERE id=${id}`); } catch { /* حسابِ مرجع‌دار می‌ماند */ }
  }
}

console.log(`\n${pass} سبز · ${fails.length} قرمز`);
if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
