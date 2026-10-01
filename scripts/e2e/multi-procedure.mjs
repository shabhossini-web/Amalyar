/**
 * **چند عمل در یک مراجعه** (بستهٔ ۷ج) — سندِ بسته §۷.۱، سناریوهای B1…B15.
 *
 * مدل همان ۷ب: عملِ **اصلی** ستونِ `visits.procedure_type_id` (و عکسِ نامش
 * `op_type`)، «عمل‌های همزمان» در `visit_other_procedures`؛ روی سیم
 * `procedureTypeId` (اصلی) و همزادش `otherProcedureTypeIds`.
 *
 * چیدمان — دو نوعِ عمل با قالب‌های متفاوت تا هر قاعده جدا دیده شود:
 *   P1: پیگیری «۷»، مراقبتِ قبل و بعد، نیاز: X (مصرفی) ×۲ و D (دستگاه) ×۱
 *   P2: پیگیری «۱۰,۹۰»، مراقبتِ بعد، نیاز: X ×۳، D ×۱ و Y (ست) ×۱ + فرمِ پیگیریِ اختصاصی
 *
 *  باید بیفتد:
 *   - برچسبِ ترکیبی «P1 + P2»؛ `procedureTypeName`/`opType` همان اصلی (B1)
 *   - پیامکِ مراقبت و روزهای پیگیری **فقط از اصلی** — یکی از هر نوع (B2/B5)
 *   - فرمِ پیگیریِ عملِ همزمان صفحهٔ بیشتر در همان لینک است، نه پیامکِ دوم (B3)
 *   - کیت: مصرفی جمع، ست/دستگاه بیشینه — در سه میز یک عدد (B4)
 *   - فاکتورِ چندعملی نام‌ها را دارد؛ جستجوی کدِ AI عملِ دوم را هم می‌گردد (B6/B8)
 *   - تأییدِ پذیرش روی مراجعهٔ هدف اصلی را عوض و همزمان‌ها را نگه می‌دارد (B12)
 *   - فیلتر، تقویم، پرتال و CRM برچسبِ همه را نشان می‌دهند (B13)
 *   - فرم صریح می‌گوید قالبِ عملِ دوم نمی‌رود و با یک ضربه اضافه‌اش می‌کند (B14)
 *  نباید بیفتد:
 *   - فاکتورِ تک‌عملی شمارهٔ تازه بسوزاند یا کلیدِ تازه بگیرد (B6)
 *   - درآمد بینِ عمل‌ها پخش شود یا گروهِ «P1 + P2» بسازد (B7)
 *   - پاک‌کردنِ نوعِ عمل متنِ آزادِ همان درخواست را دور بریزد (B9 — رفعِ باگ)
 *   - نام یا تشخیص به ابلاغِ راننده برسد (B10)
 *   - عکسِ ذخیره‌شدهٔ اقلام با افزودنِ عمل عوض شود، یا تعریفِ «فقط همزمان» سخت حذف شود (B4/B11)
 *   - ناوردای جدول بشکند (B15)
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';
import { toJalaali } from '../../src/lib/jalali.js';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';
const SHOTS = process.env.E2E_SHOTS ?? null;

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const psql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
const sql = (q) => psql(q).split('\n')[0];
const num = (q) => Number(sql(q));
const sqlFails = (q) => { try { psql(q); return false; } catch { return true; } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = (p, m = 'GET', b, auth = true) => fetch(API + p, {
  method: m,
  headers: { ...(auth ? { Authorization: 'Bearer ' + login.accessToken } : {}), ...(b !== undefined ? { 'Content-Type': 'application/json' } : {}) },
  body: b !== undefined ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const sendText = (p) => fetch(API + p, { headers: { Authorization: 'Bearer ' + login.accessToken } })
  .then(async (r) => ({ status: r.status, text: await r.text() }));

const tag = randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => same([...(a ?? [])].sort((x, y) => x - y), [...(b ?? [])].sort((x, y) => x - y));
const msgOf = (r) => { const m = r.json?.message; return Array.isArray(m) ? m.join('، ') : String(m ?? JSON.stringify(r.json ?? '')); };
/** ساعتِ ۰۸:۰۰ِ UTC در روزِ «امروز + n» — تا روزِ شمسیِ چینش و تقویم (که با UTC حساب می‌شوند) مبهم نشود. */
const at8 = (days) => {
  const t = new Date(Date.now() + days * 864e5);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 8)).toISOString();
};
const plusDays = (iso, d) => new Date(new Date(iso).getTime() + d * 864e5).toISOString().slice(0, 10);
const jOf = (iso) => { const t = new Date(iso); return toJalaali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };

const dbRows = (id) => psql(`SELECT procedure_type_id || ':' || rank FROM visit_other_procedures WHERE visit_id=${id} ORDER BY rank`).split('\n').filter(Boolean);
const pending = (id, kind) => num(`SELECT count(*) FROM reminders WHERE visit_id=${id} AND kind='${kind}' AND status='pending'`);
const pendingText = (id, kind) => sql(`SELECT coalesce(string_agg(replace(text, E'\\n', ' '), ' ¦ '), '') FROM reminders WHERE visit_id=${id} AND kind='${kind}' AND status='pending'`);
const qtyBy = (list, key) => Object.fromEntries((list ?? []).map((x) => [x[key], x.quantity]));

const trash = { visits: [], procs: [], items: [], forms: [], codes: [], internal: [] };
const restore = { settings: {} };
let mock = null;

try {
  console.log('چیدمان: جراح، بیمارستان، سه کالا، دو نوعِ عمل (با متنِ مراقبت)، فرم‌های پیگیری');
  await send('/forms');
  const surgeons = (await send('/surgeons')).json;
  const surgeon = (surgeons?.rows ?? surgeons ?? []).find((s) => s.active !== false)
    ?? (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `چندعمل${tag}` })).json;
  const hospitals = (await send('/hospitals')).json;
  const hospital = (hospitals?.rows ?? hospitals ?? []).find((h) => h.active !== false)
    ?? (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;
  ok('جراح و بیمارستان برای فرمِ عمل', !!surgeon?.id && !!hospital?.id);

  const mkItem = async (name, assetKind) => {
    const r = await send('/items', 'POST', { name, assetKind });
    if (!r.json?.id) throw new Error('کالا ساخته نشد: ' + JSON.stringify(r.json).slice(0, 200));
    trash.items.push(r.json.id);
    return r.json;
  };
  const X = await mkItem(`گازِ استریل ${tag}`, 'consumable');
  const D = await mkItem(`دستگاهِ پایش ${tag}`, 'device');
  const Y = await mkItem(`ستِ پیچ ${tag}`, 'set');

  const PRE1 = `[پیش-یک ${tag}] ناشتا باشید.`;
  const POST1 = `[پس-یک ${tag}] پانسمان خشک بماند.`;
  const POST2 = `[پس-دو ${tag}] کمپرسِ سرد.`;
  const mkProc = async (body) => {
    const r = await send('/procedure-types', 'POST', body);
    if (!r.json?.id) throw new Error('نوعِ عمل ساخته نشد: ' + JSON.stringify(r.json).slice(0, 200));
    trash.procs.push(r.json.id);
    return r.json;
  };
  const P1 = await mkProc({ name: `لامینکتومی ${tag}`, followUpDays: '7', preOpCare: PRE1, postOpCare: POST1 });
  const P2 = await mkProc({ name: `فیوژن ${tag}`, followUpDays: '10,90', postOpCare: POST2 });
  const P3 = await mkProc({ name: `دیسککتومی ${tag}` });
  const Pz = await mkProc({ name: `تزریقِ همزمان ${tag}` });
  const LABEL = `${P1.name} + ${P2.name}`;

  const mkRecordForm = async (key, title, fieldKey, role) => {
    const f = (await send('/forms', 'POST', { key, title, scope: 'record' })).json;
    trash.forms.push(f.id);
    await send(`/forms/${f.id}/fields`, 'POST', { key: fieldKey, label: `پرسشِ ${title}` });
    return { ...f, patched: (await send(`/forms/${f.id}`, 'PATCH', role)).status };
  };
  /* فرمِ عمومی لازم است تا فرمِ اختصاصیِ P2 «بخشِ اضافه» شود نه پایه (B3). */
  const fGen = await mkRecordForm(`g${tag}`, 'پیگیریِ عمومی', 'fuGeneral', { followUp: 'general' });
  const fP2 = await mkRecordForm(`f${tag}`, 'پیگیریِ فیوژن', 'fuFusion', { followUp: 'procedure', procedureTypeId: P2.id });
  const fP3 = await mkRecordForm(`d${tag}`, 'پیگیریِ دیسک', 'fuDisc', { followUp: 'procedure', procedureTypeId: P3.id });
  ok('نقش‌های پیگیری نشستند', [fGen, fP2, fP3].every((f) => f.patched === 200));

  /* فرمِ اختصاصیِ غیرِ جراحی برای B9/B11 — فقط تاریخ اجباری است. */
  const KP = `mp${tag}`;
  const fK = (await send('/forms', 'POST', { key: KP, title: `ویزیتِ چندعملی ${tag}`, scope: 'visit' })).json;
  if (fK?.id) trash.forms.push(fK.id);

  const surgery = (last, extra = {}) => ({
    kind: 'surgery', firstName: 'بیمارِ', lastName: last, phone: phone(),
    opDate: at8(6), surgeonId: surgeon.id, hospitalId: hospital.id, ...extra,
  });
  const mkVisit = async (body) => {
    const r = await send('/visits', 'POST', body);
    if (r.json?.id) trash.visits.push(r.json.id);
    return r;
  };

  console.log('\nB1) جراحیِ دوعملی');
  const LASTM = `چندعمل${tag}`;
  const rM = await mkVisit(surgery(LASTM, { procedureTypeId: P1.id, otherProcedureTypeIds: [P2.id], amount: 1_000_000 }));
  const VM = rM.json;
  ok('۲۰۱', rM.status === 201, `${rM.status} ${msgOf(rM)}`);
  ok('`procedureTypeName` و `opType` = اصلی (P1)', VM?.procedureTypeName === P1.name && VM?.opType === P1.name && VM?.procedureTypeId === P1.id,
    JSON.stringify([VM?.procedureTypeName, VM?.opType]));
  ok('`procedureLabel` = «P1 + P2»', VM?.procedureLabel === LABEL, VM?.procedureLabel);
  ok('`otherProcedureTypeIds` = [P2] و در جدول (P2, ۲)', same(VM?.otherProcedureTypeIds, [P2.id]) && same(dbRows(VM.id), [`${P2.id}:2`]),
    JSON.stringify([VM?.otherProcedureTypeIds, dbRows(VM?.id)]));
  ok('**یک** قلمِ خدمت با عنوانِ عملِ اصلی (مبلغ مالِ مراجعه است)',
    num(`SELECT count(*) FROM charges WHERE visit_id=${VM.id} AND kind='service'`) === 1
    /* در شرکت نامِ خدمت جلوی نامِ عمل می‌آید («نورومانیتورینگ — P1»، بازبینیِ UX company-14)؛ P2 هرگز. */
    && ((t) => t === P1.name || (t.endsWith(` — ${P1.name}`) && !t.includes(P2.name)))(sql(`SELECT title FROM charges WHERE visit_id=${VM.id} AND kind='service'`)),
    sql(`SELECT string_agg(title, ' | ') FROM charges WHERE visit_id=${VM.id}`));

  console.log('\nB2) پیامکِ مراقبت و موج‌های پیگیری فقط از اصلی');
  ok('یک `pre_op_care` با متنِ P1', pending(VM.id, 'pre_op_care') === 1 && pendingText(VM.id, 'pre_op_care').includes(`پیش-یک ${tag}`),
    pendingText(VM.id, 'pre_op_care').slice(0, 120));
  const post2 = pendingText(VM.id, 'post_op_care');
  ok('یک `post_op_care` با متنِ P1 — **نه** P2', pending(VM.id, 'post_op_care') === 1 && post2.includes(`پس-یک ${tag}`) && !post2.includes(`پس-دو ${tag}`),
    post2.slice(0, 160));
  ok('فقط موجِ روزِ ۷ (روزهای P2 نه)', pending(VM.id, 'follow_up') === 1
    && sql(`SELECT to_char(min(due_at), 'YYYY-MM-DD') FROM reminders WHERE visit_id=${VM.id} AND kind='follow_up' AND status='pending'`) === plusDays(VM.opDate, 7),
    sql(`SELECT string_agg(to_char(due_at, 'YYYY-MM-DD'), ',') FROM reminders WHERE visit_id=${VM.id} AND kind='follow_up' AND status='pending'`));

  console.log('\nB3) فرمِ پیگیریِ عملِ همزمان — صفحهٔ بیشتر، نه پیامکِ بیشتر');
  const extras = sql(`SELECT array_to_string(extra_form_ids, ',') FROM intake_submissions WHERE data->>'followUpVisitId' = '${VM.id}' ORDER BY id LIMIT 1`)
    .split(',').filter(Boolean).map(Number);
  ok('`extraFormIds` فرمِ پیگیریِ P2 را دارد', extras.includes(fP2.id), JSON.stringify(extras));
  ok('**نباید بیفتد:** فرمِ عملی که در این جلسه نیست (P3)', !extras.includes(fP3.id), JSON.stringify(extras));

  console.log('\nB4) عکسِ اقلام — صریح و مستقل از افزودنِ عمل (الگوی نوعِ عمل حذف شده)');
  const sp = (await send(`/surgeon/visits?q=${encodeURIComponent(LASTM)}`)).json;
  const spRow = (sp?.rows ?? []).find((r) => r.id === VM.id);
  ok('پرتالِ جراح: بدونِ الگو، اقلام خالی است (چیزی خودکار پر نمی‌شود)', (spRow?.requiredItems ?? []).length === 0, JSON.stringify(spRow?.requiredItems));
  ok('پرتالِ جراح: `procedure` برچسبِ ترکیبی', spRow?.procedure === LABEL, spRow?.procedure);
  const { jy: dy, jm: dm, jd: dd } = jOf(VM.opDate);
  const day = (await send(`/dispatch/day?year=${dy}&month=${dm}&day=${dd}`)).json;
  const dRow = (day?.visits ?? []).find((v) => v.id === VM.id);
  const rK = await mkVisit(surgery(`اسنپ${tag}`, { procedureTypeId: P1.id }));
  const VK = rK.json;
  const ins = await send(`/surgeon/visits/${VK.id}/instructions`, 'PATCH', { instructions: `دستورِ جراح ${tag}`, requiredItems: [{ itemId: X.id, quantity: 7 }] });
  ok('عکسِ اقلامِ اختصاصی ثبت شد', ins.status === 200, `${ins.status} ${msgOf(ins)}`);
  const snap0 = sql(`SELECT required_items::text FROM visits WHERE id=${VK.id}`);
  const addP2 = await send(`/visits/${VK.id}`, 'PATCH', { otherProcedureTypeIds: [P2.id] });
  ok('P2 به همان مراجعه اضافه شد', addP2.status === 200 && same(addP2.json?.otherProcedureTypeIds, [P2.id]), `${addP2.status} ${msgOf(addP2)}`);
  ok('**نباید بیفتد:** عکسِ ذخیره‌شده با افزودنِ عمل عوض شود', sql(`SELECT required_items::text FROM visits WHERE id=${VK.id}`) === snap0);
  const cardK = (await send(`/theatre/visits/${VK.id}`)).json;
  ok('… و میزِ اتاقِ عمل همان عکس را نشان می‌دهد (X=۷ فقط)', (cardK?.items ?? []).length === 1 && cardK.items[0].quantity === 7,
    JSON.stringify(cardK?.items));
  const spK = ((await send(`/surgeon/visits?q=${encodeURIComponent(`اسنپ${tag}`)}`)).json?.rows ?? []).find((r) => r.id === VK.id);
  ok('… و پرتالِ جراح هم', same(qtyBy(spK?.requiredItems, 'itemId'), { [X.id]: 7 }), JSON.stringify(spK?.requiredItems));

  console.log('\nB5) جابه‌جاییِ اصلی — متن و روزها دنبالِ اصلیِ تازه می‌روند');
  const rW = await mkVisit(surgery(`جابه‌جا${tag}`, { procedureTypeId: P1.id, otherProcedureTypeIds: [P2.id] }));
  const VW = rW.json;
  ok('پیش از جابه‌جایی: مراقبتِ P1', pendingText(VW.id, 'post_op_care').includes(`پس-یک ${tag}`));
  const sw = await send(`/visits/${VW.id}`, 'PATCH', { procedureTypeId: P2.id, otherProcedureTypeIds: [P1.id] });
  ok('اصلی P2؛ `opType` = P2؛ برچسب «P2 + P1»', sw.status === 200 && sw.json?.opType === P2.name && sw.json?.procedureTypeName === P2.name
    && sw.json?.procedureLabel === `${P2.name} + ${P1.name}`, `${sw.status} ${JSON.stringify([sw.json?.opType, sw.json?.procedureLabel])}`);
  const post5 = pendingText(VW.id, 'post_op_care');
  ok('یک `post_op_care`، حالا با متنِ P2', pending(VW.id, 'post_op_care') === 1 && post5.includes(`پس-دو ${tag}`) && !post5.includes(`پس-یک ${tag}`), post5.slice(0, 160));
  ok('مراقبتِ قبل از عملِ P1 دیگر نمی‌رود (P2 قالبِ قبل ندارد)', pending(VW.id, 'pre_op_care') === 0);
  ok('موج‌ها روزهای P2 (۱۰ و ۹۰)؛ یادآوریِ عمل هنوز یکی', pending(VW.id, 'follow_up') === 2 && pending(VW.id, 'surgery') === 1,
    JSON.stringify([pending(VW.id, 'follow_up'), pending(VW.id, 'surgery')]));
  ok('ردیفِ «سایر» حالا P1 است', same(dbRows(VW.id), [`${P1.id}:2`]), JSON.stringify(dbRows(VW.id)));

  console.log('\nB9) پاک‌کردنِ نوعِ عمل همراهِ متنِ آزاد — متن می‌ماند (رفعِ باگ)');
  const rO = await mkVisit({ kind: KP, firstName: 'بیمارِ', lastName: `متن${tag}`, phone: phone(), opDate: at8(1), procedureTypeId: P1.id, otherProcedureTypeIds: [P2.id] });
  const VO = rO.json;
  ok('مراجعهٔ غیرِ جراحیِ دوعملی ساخته شد', rO.status === 201, `${rO.status} ${msgOf(rO)}`);
  const FREE = `متنِ آزادِ عمل ${tag}`;
  const b9 = await send(`/visits/${VO.id}`, 'PATCH', { procedureTypeId: null, otherProcedureTypeIds: [], opType: FREE });
  ok('`opType` همان متن ماند (نه null)', b9.status === 200 && b9.json?.opType === FREE && sql(`SELECT op_type FROM visits WHERE id=${VO.id}`) === FREE,
    `${b9.status} ${JSON.stringify(b9.json?.opType)}`);
  ok('بی‌نوعِ عمل و بی‌همزمان؛ برچسب و نامِ اصلی = همان متن', b9.json?.procedureTypeId === null && same(b9.json?.otherProcedureTypeIds, [])
    && b9.json?.procedureTypeName === FREE && b9.json?.procedureLabel === FREE, JSON.stringify([b9.json?.procedureTypeName, b9.json?.procedureLabel]));
  const b9b = await send(`/visits/${VO.id}`, 'PATCH', { procedureTypeId: P1.id });
  ok('انتخابِ دوبارهٔ P1 → `opType` عکسِ نامِ P1', b9b.status === 200 && b9b.json?.opType === P1.name, JSON.stringify(b9b.json?.opType));

  console.log('\nB11) تعریفی که فقط «همزمان» است');
  await send(`/visits/${VO.id}`, 'PATCH', { otherProcedureTypeIds: [Pz.id] });
  const list11 = (await send('/procedure-types')).json ?? [];
  ok('`visitCount` = ۱', list11.find((p) => p.id === Pz.id)?.visitCount === 1, JSON.stringify(list11.find((p) => p.id === Pz.id)));
  const del11 = await send(`/procedure-types/${Pz.id}`, 'DELETE');
  ok('حذف → فقط غیرفعال', del11.status < 300 && del11.json?.deactivated === true, `${del11.status} ${JSON.stringify(del11.json)}`);
  ok('**نباید بیفتد:** حذفِ خامِ SQL — RESTRICT', sqlFails(`DELETE FROM procedure_types WHERE id=${Pz.id}`)
    && num(`SELECT count(*) FROM procedure_types WHERE id=${Pz.id}`) === 1);
  ok('… و پیوند روی مراجعه ماند', same(dbRows(VO.id), [`${Pz.id}:2`]), JSON.stringify(dbRows(VO.id)));

  console.log('\nB12) تأییدِ پذیرش روی مراجعهٔ هدف');
  const rT = await mkVisit(surgery(`هدف${tag}`, { procedureTypeId: P3.id, otherProcedureTypeIds: [P2.id] }));
  const VT = rT.json;
  const subId = num(`INSERT INTO intake_submissions (token, patient_id, visit_id, amount, status, data, expires_at, updated_at)
    VALUES ('mp${tag}${Date.now()}', ${VT.patientId}, ${VT.id}, 0, 'pending_approval', '{}', now() + interval '7 days', now()) RETURNING id`);
  /* تاریخ همان تاریخِ هدف: در حوزه‌ای که مسیرِ `intakeIonm` ندارد ستارهٔ تاریخِ فرمِ عمل هم راضی باشد. */
  const ap = await send(`/intake/submissions/${subId}/approve`, 'POST', {
    procedureTypeId: P1.id, surgeonId: surgeon.id, hospitalId: hospital.id, opDate: String(VT.opDate).slice(0, 10),
  });
  ok('تأیید ۲۰۰/۲۰۱', ap.status < 300, `${ap.status} ${msgOf(ap)}`);
  const gT = (await send(`/visits/${VT.id}`)).json;
  ok('اصلی = P1 (P3 کنار رفت)', gT?.procedureTypeId === P1.id && gT?.opType === P1.name, JSON.stringify([gT?.procedureTypeId, gT?.opType]));
  ok('**همزمانِ ثبت‌شده (P2) ماند**', same(gT?.otherProcedureTypeIds, [P2.id]) && same(dbRows(VT.id), [`${P2.id}:2`]), JSON.stringify(gT?.otherProcedureTypeIds));
  ok('مراجعهٔ تازه‌ای ساخته نشد', num(`SELECT count(*) FROM visits WHERE patient_id=${VT.patientId}`) === 1
    && sql(`SELECT status FROM intake_submissions WHERE id=${subId}`) === 'approved');

  console.log('\nB13) فیلتر، تقویم، پرتال و CRM');
  const ids = (rows) => (rows ?? []).map((r) => r.id);
  const L13 = (await send(`/visits?procedureTypeId=${P2.id}&pageSize=200`)).json;
  const E13 = (await send(`/visits/export?procedureTypeId=${P2.id}`)).json;
  ok('`/visits?procedureTypeId=P2` مراجعه‌ای را که P2 عملِ دومش است پیدا می‌کند', ids(L13?.rows).includes(VM.id), JSON.stringify(ids(L13?.rows)));
  ok('**نباید بیفتد:** تک‌عملیِ P1', !ids(L13?.rows).includes(VS.id));
  ok('خروجی و آمار همان', sameSet(ids(L13?.rows), ids(E13?.rows)) && L13?.stats?.total === L13?.total && L13?.total === E13?.rows?.length,
    JSON.stringify([L13?.total, E13?.rows?.length, L13?.stats?.total]));
  ok('جستجوی آزاد با نامِ P2 هم', ids((await send(`/visits?q=${encodeURIComponent(P2.name)}&pageSize=200`)).json?.rows).includes(VM.id));
  const cal = (await send(`/calendar?year=${dy}&month=${dm}`)).json;
  const calRow = (cal?.days ?? []).flatMap((d) => d.visits ?? []).find((v) => v.id === VM.id);
  ok('تقویم: `procedureName` = «P1 + P2»', calRow?.procedureName === LABEL, JSON.stringify(calRow?.procedureName));
  const link = (await send(`/patients/${VM.patientId}/portal-link`, 'POST')).json;
  const portal = (await send(`/public/portal/${link?.token}`, 'GET', undefined, false)).json;
  /* VM آینده است: در «مراجعات» (تاریخچه) نیست ولی «عمل‌ها» همهٔ جراحی‌ها را دارد (بازبینیِ UX، بندِ ۱۰۰). */
  const pRow = [...(portal?.visits ?? []), ...(portal?.surgeries ?? [])].find((v) => v.code === VM.code);
  ok('پرتالِ بیمار: `procedure` = «P1 + P2» (سندِ بیمار عملِ دوم را جا نمی‌اندازد)', pRow?.procedure === LABEL, JSON.stringify(pRow?.procedure));
  const rP = await mkVisit({ ...surgery(`گذشته${tag}`, { procedureTypeId: P1.id, otherProcedureTypeIds: [P2.id] }), opDate: at8(-20) });
  const VP = rP.json;
  await send(`/visits/${VP.id}/status`, 'PATCH', { opStatus: 'done' });
  const crm = (await send('/intake/unfollowed')).json;
  const cRow = (crm?.rows ?? []).find((r) => r.visitId === VP.id);
  ok('CRMِ «پیگیری‌نشده»: `procedure` = «P1 + P2»', cRow?.procedure === LABEL, JSON.stringify([crm?.enabled, cRow?.procedure]));
  const csv = await sendText('/intake/unfollowed/csv');
  ok('… و CSVِ همان فهرست', csv.status === 200 && csv.text.includes(LABEL), `${csv.status} ${csv.text.slice(0, 120)}`);

  console.log('\nB10) ابلاغ — کارشناس برچسب را می‌بیند، راننده هیچ');
  const brief = await send(`/dispatch/visits/${VM.id}/briefing?role=tech`);
  ok('ابلاغِ کارشناس: «نوعِ عمل: P1 + P2»', brief.status === 200 && String(brief.json?.text ?? '').includes(`نوعِ عمل: ${LABEL}`),
    `${brief.status} ${String(brief.json?.text ?? '').split('\n').slice(0, 4).join(' ⏎ ')}`);
  const drv = await send(`/dispatch/visits/${VM.id}/briefing?role=driver`);
  ok('**نباید بیفتد:** مسیرِ دیسپچ برای راننده متن بسازد', drv.status === 400, String(drv.status));
  /* متنِ راننده از **همان تابعِ خالصِ سرور** (dist) روی همان شکلِ ردیفِ تختهٔ
     روز — نسخهٔ دومِ این قاعده در آزمون یعنی دو حرفِ متفاوت دربارهٔ حریمِ خصوصی. */
  let briefingText = null;
  try { ({ briefingText } = createRequire(import.meta.url)('../../server/dist/patients/dispatch.service.js')); } catch (e) { ok('بیلدِ سرور (dist) خوانده شد', false, String(e?.message ?? e).slice(0, 160)); }
  if (briefingText && dRow) {
    for (const role of ['driver', 'courier']) {
      const t = briefingText(dRow, new Date(VM.opDate), role);
      ok(`متنِ ${role}: نه نامِ عمل‌ها، نه نامِ بیمار`, !t.includes(P1.name) && !t.includes(P2.name) && !t.includes(LASTM), t.split('\n').slice(0, 3).join(' ⏎ '));
    }
    ok('… در حالی که همان شکل برای کارشناس برچسب را دارد', briefingText(dRow, new Date(VM.opDate), 'tech').includes(LABEL));
  }

  console.log('\nB14) مرورگر — هشدارِ «فقط از عملِ اصلی» و افزودنِ قالبِ دوم');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fa-IR' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await browserLogin(page, login.accessToken);
    /* زبانه‌های فرمِ عمل زیرِ سربرگ‌اند و «برنامهٔ مراقبت و پیگیری» (با هشدارِ عملِ همزمان) درونِ
       زبانهٔ «بعد از عمل» است (بازبینیِ UX، surgery-10). */
    const openVisit = async (id) => {
      await page.goto(`${UI}/app/dashboard?patient=${id}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1800);
      return page.locator('.db-sheet');
    };
    const tab = (sect, name) => sect.locator('.db-phasetabs button', { hasText: name }).click().then(() => page.waitForTimeout(350));
    const defaults = async (sect) => {
      await tab(sect, 'قبل از عمل');
      const pre = await sect.locator('.db-phase[data-phase="pre"] .db-default').allInnerTexts();
      await tab(sect, 'بعد از عمل');
      const post = await sect.locator('.db-phase[data-phase="post"] .db-default').allInnerTexts();
      return { pre, post };
    };
    /* شاهد: تک‌عملی — شمارِ `.db-default` که `postop-flow.mjs` سنجاقش کرده. */
    let sect = await openVisit(VS.id);
    const single = await defaults(sect);
    ok('تک‌عمل: بدونِ هشدارِ عملِ همزمان', await sect.locator('.db-careother').count() === 0);
    sect = await openVisit(VM.id);
    await tab(sect, 'بعد از عمل');
    const hint = sect.locator('.db-careother');
    ok('دوعملی: هشدارِ `.db-careother` آمد', await hint.count() === 1);
    const hintText = await hint.innerText().catch(() => '');
    ok('… و نامِ اصلی و عملِ دوم را صریح می‌گوید', hintText.includes(P1.name) && hintText.includes(P2.name), hintText.slice(0, 160));
    const insert = hint.locator('button', { hasText: P2.name });
    ok('دکمهٔ «افزودنِ متنِ P2 به متنِ اختصاصی» هست', await insert.count() === 1);
    const multi = await defaults(sect);
    ok('شمارِ `.db-default` همان تک‌عمل است (قبل/بعد)', multi.pre.length === single.pre.length && multi.post.length === single.post.length,
      JSON.stringify([single.pre.length, single.post.length, multi.pre.length, multi.post.length]));
    ok('پیش‌فرض‌ها از P1 می‌آیند، نه P2', multi.pre.join(' ').includes(`پیش-یک ${tag}`) && multi.post.join(' ').includes(`پس-یک ${tag}`)
      && !multi.post.join(' ').includes(`پس-دو ${tag}`), JSON.stringify(multi));
    const chips = await page.locator('.db-sheet [data-coding-chips="procedure"] [data-coding-chip]').evaluateAll((els) => els.map((e) => Number(e.dataset.id)));
    ok('چیپِ عملِ همزمان (P2) زیرِ انتخابگرِ اصلی', same(chips, [P2.id]), JSON.stringify(chips));
    await insert.click();
    await page.waitForTimeout(400);
    await tab(sect, 'بعد از عمل');
    const areas = await sect.locator('.db-phase[data-phase="post"] textarea').evaluateAll((els) => els.map((e) => e.value));
    ok('ضربه: متنِ P2 زیرِ قالبِ P1 در متنِ اختصاصی نشست (اصلی حذف نشد)',
      areas.some((v) => v.includes(`پس-یک ${tag}`) && v.includes(`پس-دو ${tag}`)), JSON.stringify(areas.map((v) => v.slice(0, 60))));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/multi-procedure-careother.png` }).catch(() => {});
    ok('بدونِ خطای JS', errors.length === 0, errors[0]);
    await ctx.close();
  } finally {
    await browser.close();
  }

  console.log('\nB6) فاکتور');
  const prevInv = sql(`SELECT coalesce((SELECT value FROM settings WHERE key='invoice_informal_name'), '')`);
  restore.settings.invoice_informal_name = prevInv;
  await send('/settings', 'PATCH', { values: { invoice_informal_name: `صادرکنندهٔ آزمون ${tag}` } });
  const bankId = num(`INSERT INTO bank_accounts (owner_name, classification) VALUES ('حسابِ آزمون ${tag}', 'informal') RETURNING id`);
  for (const v of [VS, VM]) {
    const r = await send(`/visits/${v.id}/billing/invoice-account`, 'POST', { invoiceType: 'informal', bankAccountId: bankId });
    ok(`حسابِ فاکتورِ ${v.code} ست شد`, r.status < 300, `${r.status} ${msgOf(r)}`);
  }
  const i1 = await send(`/visits/${VS.id}/invoices`, 'POST', { variant: 'informal' });
  const i2 = await send(`/visits/${VS.id}/invoices`, 'POST', { variant: 'informal' });
  ok('تک‌عمل: صدورِ دوباره همان سند و همان شماره', i1.status < 300 && i2.status < 300 && i1.json?.id === i2.json?.id && i1.json?.number === i2.json?.number,
    `${i1.status}/${i2.status} ${i1.json?.number} ${i2.json?.number}`);
  ok('تک‌عمل: snapshot کلیدِ `procedureNames` ندارد (اثرانگشتِ دیروز)', !!i1.json?.snapshot?.visit && !('procedureNames' in i1.json.snapshot.visit)
    && i1.json.snapshot.visit.procedureTypeName === P1.name
    && sql(`SELECT (snapshot->'visit') ? 'procedureNames' FROM invoice_documents WHERE id=${i1.json?.id}`) === 'f',
    JSON.stringify(Object.keys(i1.json?.snapshot?.visit ?? {})));
  const im = await send(`/visits/${VM.id}/invoices`, 'POST', { variant: 'informal' });
  ok('دوعملی: `procedureNames` = [P1, P2] و `procedureTypeName` همان اصلی', im.status < 300
    && same(im.json?.snapshot?.visit?.procedureNames, [P1.name, P2.name]) && im.json?.snapshot?.visit?.procedureTypeName === P1.name,
    `${im.status} ${JSON.stringify(im.json?.snapshot?.visit?.procedureNames)}`);

  console.log('\nB7) گزارشِ مالی — درآمد فقط زیرِ عملِ اصلی');
  await send(`/visits/${VM.id}/status`, 'PATCH', { opStatus: 'done' });
  const rep = (await send('/reports/financial')).json;
  const sum = (rep?.byProcedure ?? []).reduce((s, g) => s + (g.revenue ?? 0), 0);
  ok('Σ byProcedure.revenue == totals.revenue', sum === rep?.totals?.revenue, JSON.stringify([sum, rep?.totals?.revenue]));
  const g1 = (rep?.byProcedure ?? []).find((g) => g.label === P1.name);
  ok('گروهِ P1 درآمدِ همان مراجعهٔ دوعملی را دارد', g1?.revenue === 1_000_000, JSON.stringify(g1));
  ok('**نباید بیفتد:** گروهِ «P1 + P2» یا گروهِ P2 از این مراجعه', !(rep?.byProcedure ?? []).some((g) => g.label === LABEL)
    && ((rep?.byProcedure ?? []).find((g) => g.label === P2.name)?.revenue ?? 0) === 0,
    JSON.stringify((rep?.byProcedure ?? []).filter((g) => String(g.label).includes(tag))));

  console.log('\nB8) پیشنهادِ کدِ AI — کتاب برای عملِ دوم هم گشته می‌شود');
  await send('/service-codes/status'); // seedِ تنبلِ کتاب، پیش از ردیفِ ما
  const BOOK = `PX7${tag.toUpperCase()}`;
  sql(`INSERT INTO service_codes (code, title, version) VALUES ('${BOOK}', '${P2.name}', 'e2e-${tag}') ON CONFLICT (code) DO NOTHING`);
  trash.codes.push(BOOK);
  const byP2 = (await send(`/service-codes?q=${encodeURIComponent(P2.name)}`)).json ?? [];
  const byP1 = (await send(`/service-codes?q=${encodeURIComponent(P1.name)}`)).json ?? [];
  ok('شاهد: کدِ کتاب فقط با نامِ P2 پیدا می‌شود', byP2.some((c) => c.code === BOOK) && !byP1.some((c) => c.code === BOOK));
  /* یک کدِ داخلی تا تک‌عملی هم نامزد داشته باشد و فراخوانیِ مدل واقعاً انجام شود
     (بی‌نامزد، سرور پیش از مدل ۴۰۰ می‌دهد و شاهدِ منفی چیزی نمی‌سنجید). */
  const ic = (await send('/internal-codes', 'POST', { code: `IC7${tag.toUpperCase()}`, name: `ویزیتِ داخلی ${tag}`, price: 100000 })).json;
  if (ic?.id) trash.internal.push(ic.id);
  const captured = [];
  let mockReply = BOOK;
  mock = http.createServer((req, res) => {
    let data = '';
    req.on('data', (ch) => { data += ch; });
    req.on('end', () => {
      try { captured.push(JSON.parse(data || '{}')); } catch { captured.push({}); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: mockReply } }] }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  await send('/settings', 'PATCH', { values: { ai_base_url: `http://127.0.0.1:${mock.address().port}/v1`, ai_api_key: `key-${tag}`, ai_model: 'mock-1' } });
  await send(`/patients/${VM.patientId}/notes`, 'POST', { kind: 'op', visitId: VM.id, body: `شرحِ عمل: دو اقدام در یک جلسه ${tag}` });
  const sg = await send('/ai/suggest-codes', 'POST', { visitId: VM.id });
  const msgs = captured[captured.length - 1]?.messages ?? [];
  ok('نامزدها کدِ کتابِ عملِ **دوم** را دارند', (msgs[0]?.content ?? '').includes(BOOK), (msgs[0]?.content ?? '').slice(0, 160));
  ok('… و پیشنهادِ مدل از اعتبارسنجیِ سخت رد شد', sg.status < 300 && (sg.json?.suggestions ?? []).some((s) => s.code === BOOK && s.codeSystem === 'book'),
    `${sg.status} ${JSON.stringify(sg.json?.suggestions ?? sg.json)}`);
  ok('پیامِ کاربر: «نوعِ عمل: P1 (اصلی)، P2»', (msgs[1]?.content ?? '').split('\n')[0] === `نوعِ عمل: ${P1.name} (اصلی)، ${P2.name}`, (msgs[1]?.content ?? '').split('\n')[0]);
  await send(`/patients/${VS.patientId}/notes`, 'POST', { kind: 'op', visitId: VS.id, body: `شرحِ تک‌عمل ${tag}` });
  mockReply = 'هیچ';
  const before8 = captured.length;
  const sgS = await send('/ai/suggest-codes', 'POST', { visitId: VS.id });
  const msgsS = captured.length > before8 ? captured[captured.length - 1]?.messages ?? [] : [];
  ok('تک‌عمل: مدل صدا زده شد', sgS.status < 300 && captured.length > before8, `${sgS.status} ${msgOf(sgS)}`);
  ok('تک‌عمل: همان فراخوانیِ دیروز — نامزدِ P2 نیست و خطِ نوعِ عمل خالص', msgsS.length > 0 && !(msgsS[0]?.content ?? '').includes(BOOK)
    && (msgsS[1]?.content ?? '').split('\n')[0] === `نوعِ عمل: ${P1.name}`, (msgsS[1]?.content ?? '').split('\n')[0]);
  ok('**نباید بیفتد:** نامِ بیمار به سرویسِ AI برود', !JSON.stringify(captured).includes(LASTM));

  console.log('\nB15) ناوردای جدول');
  const inv = num(`SELECT
      (SELECT count(*) FROM visit_other_procedures o JOIN visits v ON v.id = o.visit_id WHERE v.procedure_type_id IS NULL OR v.procedure_type_id = o.procedure_type_id)
    + (SELECT count(*) FROM (SELECT visit_id FROM visit_other_procedures GROUP BY visit_id HAVING min(rank) <> 2 OR max(rank) <> count(*) + 1) a)`);
  ok('سایرِ برابرِ اصلی، سایرِ بی‌اصلی، رتبهٔ گسسته — هیچ', inv === 0, String(inv));
} finally {
  if (mock) {
    mock.close();
    await send('/settings', 'PATCH', { values: { ai_base_url: '', ai_api_key: '', ai_model: '' } }).catch(() => {});
  }
  if ('invoice_informal_name' in restore.settings) {
    await send('/settings', 'PATCH', { values: { invoice_informal_name: restore.settings.invoice_informal_name } }).catch(() => {});
  }
  /* اول مراجعه‌ها (پیوندهای «همزمان» cascade می‌شوند)؛ فاکتورخورده‌ها عمداً حذف
     نمی‌شوند — سرور هم نمی‌گذارد — و رانر دیتابیسِ هر سوییت را تازه می‌کند. */
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'PATCH', { followUp: null }).catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const code of trash.codes) { try { psql(`DELETE FROM service_codes WHERE code='${code}'`); } catch { /* ارجاع دارد — می‌ماند */ } }
  for (const id of trash.internal) await send(`/internal-codes/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs) await send(`/procedure-types/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.items) await send(`/items/${id}`, 'DELETE').catch(() => {});
}

console.log(`\n${pass} سنجه سبز${fails.length ? `، ${fails.length} قرمز` : ''}`);
if (fails.length) { for (const f of fails) console.log('  ✘ ' + f); process.exit(1); }
