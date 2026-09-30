/**
 * **نمای اتاقِ عمل** — `GET/POST /theatre/*`.
 *
 * بازخوردِ مالک ۱۴۰۵/۰۶/۳۱ («برای میزِ اتاقِ عمل خیلی ناقص ساختی») این میز را
 * از نو تعریف کرد: شکایتِ اولیه، مدارکِ قبل/حین/بعد که **باز شوند**، نوشتنِ
 * شرحِ عمل، و ترخیص به‌عنوانِ مرحله‌ای جدا از پایانِ عمل. چک‌لیستِ WHO از
 * رابط برداشته شد ولی داده و APIش ماند (توضیح در `theatre.service.ts`).
 *
 *  باید بیفتد:
 *   - فهرستِ روز + کارت، با **شکایتِ اولیه** — مشتق از ویزیتِ تصمیم اگر خودِ
 *     عمل ننوشته باشدش
 *   - کارتِ حینِ عمل: هویت، گروه خونی، سه هشدارِ بالینی، ست
 *   - مدارک **مرحله‌بندی‌شده** و بازشدنی از خودِ میز (نه از پروندهٔ بیمار)
 *   - نوشتنِ شرحِ عمل سرِ میز → همان `ClinicalNote`ِ پرونده
 *   - «شروع شد» ساعتِ دیوار را می‌زند و بارِ دوم بازنویسی نمی‌کند — و `stamped` می‌گوید کدام لمس نوشت
 *   - «برگرداندن»/«اصلاحِ ساعت» با `expect`ِ کهنه ۴۰۹ می‌گیرد و ساعتِ دیگری را پاک نمی‌کند (بستهٔ FF، FF3)
 *   - شرحِ میز با `base`ِ کهنه ۴۰۹ می‌گیرد و شرحِ تازه‌ترِ پرونده را جایگزین نمی‌کند (بستهٔ FF، FF1)
 *   - ترخیص: بعد از پایان، با شرحِ اجباری، و زدنِ دوباره ساعت را عوض نمی‌کند
 *   - تیکِ چک‌لیست (API همچنان کار می‌کند) نامِ زننده را نگه می‌دارد
 *  نباید بیفتد:
 *   - **هیچ عددِ مالی** در کارت (همان قاعدهٔ `tech.service.ts`)
 *   - «پایان» پیش از «شروع» · ترخیص پیش از «پایان» · ترخیصِ بی‌شرح
 *   - مرحله/بندِ ساختگی پذیرفته شود
 *   - کارشناسی که این عمل به نامش نیست کارت، مدرک یا چک‌لیستش را ببیند
 *   - مدرکِ **عملِ دیگر** از مسیرِ این عمل باز شود
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { jToday } from '../../src/lib/jalali.js';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));
const loginAs = (i, p) => fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: i, password: p }) }).then((r) => r.json());
const call = (t) => (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { Authorization: 'Bearer ' + t, ...(b ? { 'Content-Type': 'application/json' } : {}) },
  body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const login = await loginAs(USER, PASS);
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = call(login.accessToken);
const tag = randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const today = new Date().toISOString().slice(0, 10);

try {
  console.log('۱) فهرستِ عمل‌های روز');
  const hospital = (await send('/hospitals')).json?.[0];
  const surgeons = (await send('/surgeons')).json ?? [];
  const surgeonId = surgeons[0]?.id ?? (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `آزمون${tag}` })).json?.id;
  const proc = (await send('/procedure-types')).json?.[0];
  const mk = async (first) => {
    const r = await send('/visits', 'POST', {
      kind: 'surgery', firstName: first, lastName: `تئاتر${tag}`, phone: phone(),
      opDate: new Date().toISOString(), surgeonId,
      ...(hospital ? { hospitalId: hospital.id } : {}), ...(proc ? { procedureTypeId: proc.id } : {}),
    });
    if (!r.json?.id) throw new Error('عمل ساخته نشد: ' + JSON.stringify(r.json).slice(0, 220));
    return r.json;
  };
  const v = await mk('بیمارِ');
  /* دادهٔ بالینی مستقیم روی پرونده — همان چیزی که سرِ میز خوانده می‌شود. */
  sql(`UPDATE patients SET blood_type='O+', allergies='پنی‌سیلین', medications='وارفارین' WHERE id=${v.patientId}`);
  /* شکایتِ اولیه روی **ویزیتِ تصمیم** می‌نشیند و عمل فقط به آن گره می‌خورد —
     همان مسیرِ واقعی (بستهٔ ۴الف). اگر ارث‌بری بشکند، همین‌جا قرمز می‌شود. */
  const decidedIn = (await send('/visits', 'POST', {
    kind: 'surgery', patientId: v.patientId, opDate: new Date().toISOString(), surgeonId,
    ...(hospital ? { hospitalId: hospital.id } : {}),
    chiefComplaint: 'ضعفِ پای چپ',
  })).json;
  sql(`UPDATE visits SET decided_in_visit_id=${decidedIn.id} WHERE id=${v.id}`);
  sql(`UPDATE visits SET op_date=CURRENT_DATE - 30 WHERE id=${decidedIn.id}`);

  const day = (await send(`/theatre/day?date=${today}`)).json;
  const row = (day?.visits ?? []).find((x) => x.id === v.id);
  ok('عملِ امروز در فهرستِ روز هست', !!row, JSON.stringify((day?.visits ?? []).map((x) => x.id)));
  /* 🔴 چک‌لیست از **رابط** برداشته شد، پس از payloadِ فهرستِ روز هم. اگر روزی
     برگشت، این سنجه باید عمداً عوض شود نه اینکه بی‌صدا دوباره سبز بماند. */
  ok('فهرستِ روز دیگر شمارشِ چک‌لیست نمی‌فرستد', !day?.stages && !row?.checklist,
    JSON.stringify([day?.stages, row?.checklist]));
  ok('**شکایتِ اولیه در فهرستِ روز هست** — «چرا آمده» جای عددِ چک‌لیست را گرفت',
    row?.chiefComplaint === 'ضعفِ پای چپ', JSON.stringify(row?.chiefComplaint));

  console.log('\n۲) کارتِ حینِ عمل');
  const card = (await send(`/theatre/visits/${v.id}`)).json;
  ok('هویت و گروه خونی می‌آید', card?.patient?.bloodType === 'O+' && !!card?.patient?.fullName, JSON.stringify(card?.patient));
  ok('**هر سه هشدار همیشه کلید دارند** — «نپرسیده‌ایم» با «نداشت» یکی نیست',
    card?.alerts && 'allergies' in card.alerts && 'chronicConditions' in card.alerts && 'medications' in card.alerts
    && card.alerts.allergies === 'پنی‌سیلین' && card.alerts.chronicConditions === null, JSON.stringify(card?.alerts));
  /* 🔴 ادعای مرکزیِ بستهٔ ۴: عمل شکایتِ خودش را **ننوشته**؛ از ویزیتِ تصمیم
     می‌خواندش. اگر روزی کپی شود، اصلاحِ ویزیت این‌جا اثر نمی‌کند و پایین
     قرمز می‌شویم. */
  ok('**شکایتِ اولیه سرِ میز دیده می‌شود** — مشتق از ویزیتِ تصمیم',
    card?.visit?.chiefComplaint === 'ضعفِ پای چپ'
    && sql(`SELECT coalesce(chief_complaint,'-') FROM visits WHERE id=${v.id}`) === '-',
    JSON.stringify(card?.visit?.chiefComplaint));
  await send(`/visits/${decidedIn.id}`, 'PATCH', { chiefComplaint: 'ضعفِ پیش‌روندهٔ پای چپ' });
  ok('… و اصلاحِ ویزیت همان لحظه سرِ میز دیده می‌شود',
    (await send(`/theatre/visits/${v.id}`)).json?.visit?.chiefComplaint === 'ضعفِ پیش‌روندهٔ پای چپ');
  ok('چک‌لیست هنوز در **کارت** می‌آید (رابط نشانش نمی‌دهد ولی API زنده است)',
    (card?.checklist ?? []).length === 3 && card.checklist[0].items.length > 0
    && card.checklist[0].items.every((i) => typeof i.label === 'string' && i.checked === false), JSON.stringify(card?.checklist?.[0]?.items?.[0]));
  /* 🔴 ثابتِ اصلیِ این ماژول. `tech.service.ts` هم همین را دارد: دستِ دستکش‌دار
     مبلغ نمی‌بیند. اگر روزی فیلدی اضافه شد که پول می‌آورد، این‌جا قرمز می‌شود. */
  const flat = JSON.stringify(card);
  const money = ['amount', 'paid', 'due', 'globalAmount', 'pricingModel', 'billing', 'charges', 'payments', 'price', 'tariff'];
  ok('🔴 **هیچ عددِ مالی در کارتِ اتاقِ عمل نیست**', money.every((k) => !flat.includes(`"${k}"`)),
    money.filter((k) => flat.includes(`"${k}"`)).join('، '));

  console.log('\n۳) چک‌لیست — امضا، نه یک بولین');
  const stage = card.checklist[0].key; const item = card.checklist[0].items[0].key;
  const after = await send(`/theatre/visits/${v.id}/check`, 'POST', { stage, key: item, checked: true });
  const hit = (after.json?.checklist ?? []).find((s) => s.key === stage)?.items.find((i) => i.key === item);
  ok('تیک می‌نشیند و **نامِ زننده** را نگه می‌دارد', after.status < 300 && hit?.checked === true && !!hit?.by, JSON.stringify(hit));
  ok('… و در دیتابیس یک سطر است', num(`SELECT count(*) FROM safety_checks WHERE visit_id=${v.id} AND stage='${stage}' AND key='${item}'`) === 1);
  /* دوبار زدنِ همان بند (دو نفر هم‌زمان) نباید دو سطر بسازد. */
  await send(`/theatre/visits/${v.id}/check`, 'POST', { stage, key: item, checked: true });
  ok('**نباید بیفتد:** تیکِ تکراری سطرِ دوم بسازد', num(`SELECT count(*) FROM safety_checks WHERE visit_id=${v.id}`) === 1);
  await send(`/theatre/visits/${v.id}/check`, 'POST', { stage, key: item, checked: false });
  ok('برداشتنِ تیک سطر را **حذف** می‌کند، نه اینکه false بنویسد',
    num(`SELECT count(*) FROM safety_checks WHERE visit_id=${v.id}`) === 0);
  const badStage = await send(`/theatre/visits/${v.id}/check`, 'POST', { stage: 'nope', key: item, checked: true });
  const badKey = await send(`/theatre/visits/${v.id}/check`, 'POST', { stage, key: 'nope', checked: true });
  ok('**نباید بیفتد:** مرحله یا بندِ ساختگی پذیرفته شود', badStage.status === 400 && badKey.status === 400,
    `${badStage.status}/${badKey.status}`);

  console.log('\n۴) ساعتِ شروع و پایان');
  const early = await send(`/theatre/visits/${v.id}/finish`, 'POST');
  ok('**نباید بیفتد:** «پایان» پیش از «شروع»', early.status === 400, String(early.status));
  const started = await send(`/theatre/visits/${v.id}/start`, 'POST');
  const t1 = started.json?.visit?.opStartTime;
  ok('«شروع شد» ساعتِ دیوار را می‌زند', started.status < 300 && /^\d{2}:\d{2}$/.test(t1 ?? ''), String(t1));
  ok('… و `stamped` می‌گوید همین لمس نوشت (میز فقط با آن نوارِ «برگرداندن» می‌دهد)', started.json?.stamped === true, String(started.json?.stamped));
  /* ⚠️ `00:00` نه یک ساعتِ دلخواه: پایین‌تر همین شروع باید «در جریان» خوانده
     شود، و شروعِ بعد از «الان» برنامه است نه جریان. با `01:02` این سوییت هر شب
     بین ۰۰:۰۰ و ۰۱:۰۲ قرمز می‌شد (رانِ محلیِ بستهٔ ۶ از نیمه‌شب گذشت و گرفتش).
     `00:00` هیچ‌وقت بعد از «الانِ» همان روز نیست. */
  sql(`UPDATE visits SET op_start_time='00:00' WHERE id=${v.id}`);
  const restamp = await send(`/theatre/visits/${v.id}/start`, 'POST');
  ok('**نباید بیفتد:** لمسِ دوباره ساعتِ ثبت‌شده را بازنویسی کند', sql(`SELECT op_start_time FROM visits WHERE id=${v.id}`) === '00:00');
  /* ⚠️ بستهٔ FF (FF3): پاسخِ این لمس هم کارت بود و میز «… ثبت شد — برگرداندن» نشان می‌داد؛ «برگرداندن»
     ساعتی را پاک می‌کرد که کسِ دیگری زده بود. */
  ok('**نباید بیفتد:** لمسی که چیزی ننوشت `stamped` بگیرد', restamp.status < 300 && restamp.json?.stamped === false, String(restamp.json?.stamped));
  const staleUndo = await send(`/theatre/visits/${v.id}/times`, 'POST', { opStartTime: null, expect: { opStartTime: t1 === '00:00' ? '00:01' : t1 } });
  ok('**نباید بیفتد:** «برگرداندن» با ساعتِ کهنه ساعتِ فعلی را پاک کند — ۴۰۹ فارسی',
    staleUndo.status === 409 && /کسِ دیگری/.test(String(staleUndo.json?.message)) && sql(`SELECT op_start_time FROM visits WHERE id=${v.id}`) === '00:00',
    `${staleUndo.status} ${staleUndo.json?.message}`);
  const rightUndo = await send(`/theatre/visits/${v.id}/times`, 'POST', { opStartTime: null, expect: { opStartTime: '00:00' } });
  ok('… و با همان ساعتی که دیده شد برمی‌گردد', rightUndo.status < 300 && sql(`SELECT coalesce(op_start_time, 'NULL') FROM visits WHERE id=${v.id}`) === 'NULL',
    String(rightUndo.status));
  sql(`UPDATE visits SET op_start_time='00:00' WHERE id=${v.id}`);
  const fin = await send(`/theatre/visits/${v.id}/finish`, 'POST');
  ok('«پایان» بعد از شروع می‌نشیند', fin.status < 300 && /^\d{2}:\d{2}$/.test(fin.json?.visit?.opEndTime ?? ''), String(fin.json?.visit?.opEndTime));

  /* 🔴 وضعیتِ اتاق از **ساعت** می‌آید نه از `opStatus`: عملی که ساعتِ شروع خورده
     «در جریان» است، هرچند `op_status` تا تسویهٔ اداری `pending` می‌ماند. در اولین
     اسکرین‌شات همین «در انتظار» نوشته بود و سرِ میز غلط خوانده می‌شد. */
  ok('وضعیتِ اتاق بعد از پایان «در ریکاوری» است — حتی با `op_status = pending`',
    fin.json?.visit?.state === 'finished' && fin.json?.visit?.stateFa === 'در ریکاوری'
    && sql(`SELECT op_status FROM visits WHERE id=${v.id}`) === 'pending',
    JSON.stringify([fin.json?.visit?.state, sql(`SELECT op_status FROM visits WHERE id=${v.id}`)]));
  sql(`UPDATE visits SET op_end_time=NULL WHERE id=${v.id}`);
  ok('… و با شروعِ بی‌پایان «در جریان»', (await send(`/theatre/visits/${v.id}`)).json?.visit?.state === 'running');
  sql(`UPDATE visits SET op_start_time=NULL WHERE id=${v.id}`);
  ok('… و بی‌ساعت «در انتظار»', (await send(`/theatre/visits/${v.id}`)).json?.visit?.state === 'waiting');
  /* ⚠️ بستهٔ FF (FF8): عملی که از فهرستِ انتظار «انجام شد» خورد ولی ساعتش سرِ میز زده نشد «در انتظار» می‌ماند. */
  sql(`UPDATE visits SET op_status='done' WHERE id=${v.id}`);
  const doneRow = (await send(`/theatre/visits/${v.id}`)).json?.visit;
  ok('**نباید بیفتد:** عملِ «انجام شد»ِ بی‌ساعت روی تخته «در انتظار» بماند',
    doneRow?.state === 'finished' && doneRow?.stateFa === 'انجام شد', JSON.stringify([doneRow?.state, doneRow?.stateFa]));
  sql(`UPDATE visits SET op_status='pending' WHERE id=${v.id}`);
  /* 🔴 **ساعتِ شروعِ آینده برنامه است، نه جریان.** مطب ساعتِ برنامه‌ریزی‌شده را در
     همین فیلد می‌نویسد؛ بدونِ این شرط، ساعتِ ۹ صبح عملِ ۲۳:۵۹ هم «در جریان» بود. */
  sql(`UPDATE visits SET op_start_time='23:59' WHERE id=${v.id}`);
  const future = (await send(`/theatre/visits/${v.id}`)).json?.visit;
  ok('**نباید بیفتد:** ساعتِ شروعِ آیندهٔ همین امروز «در جریان» خوانده شود',
    future?.state === 'waiting' || new Date().getHours() === 23, JSON.stringify([future?.state, new Date().getHours()]));
  sql(`UPDATE visits SET op_start_time='00:00' WHERE id=${v.id}`);
  ok('… ولی ساعتِ گذشتهٔ همین امروز «در جریان» است', (await send(`/theatre/visits/${v.id}`)).json?.visit?.state === 'running');
  sql(`UPDATE visits SET op_date=CURRENT_DATE - 2 WHERE id=${v.id}`);
  const past = (await send(`/theatre/day?date=${new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)}`)).json;
  ok('روزِ گذشته با شروعِ بی‌پایان «ناتمام» است، نه «در جریان»',
    (past?.visits ?? []).find((x) => x.id === v.id)?.stateFa === 'ناتمام',
    JSON.stringify((past?.visits ?? []).map((x) => [x.id, x.stateFa])));
  sql(`UPDATE visits SET op_date=CURRENT_DATE, op_start_time=NULL WHERE id=${v.id}`);
  ok('… و فهرستِ روز هم همین برچسب را می‌دهد',
    ((await send(`/theatre/day?date=${today}`)).json?.visits ?? []).find((x) => x.id === v.id)?.stateFa === 'در انتظار');

  console.log('\n۵) شرحِ عمل — نوشتنی سرِ میز، ذخیره در پروندهٔ بیمار');
  /* ساعت‌ها را برمی‌گردانیم: بخشِ قبل عمداً به NULL بردشان تا حالت‌ها را بسنجد. */
  sql(`UPDATE visits SET op_start_time='08:00', op_end_time='09:30' WHERE id=${v.id}`);
  const rep = await send(`/theatre/visits/${v.id}/report`, 'POST', { body: 'لامینکتومیِ L4-L5؛ مانیتورینگ بدونِ افتِ دامنه.' });
  ok('شرحِ عمل از میزِ اتاق نوشته می‌شود', rep.status < 300 && rep.json?.visit?.opReport?.startsWith('لامینکتومی'),
    JSON.stringify(rep.json?.visit?.opReport ?? rep.json).slice(0, 160));
  /* 🔴 همان سندِ پرونده، نه یک ستونِ دوم — وگرنه شرحی که جراح سرِ میز نوشته
     در پروندهٔ بیمار نبود. */
  ok('… و همان `ClinicalNote`ِ پرونده است، نه یک ستونِ دوم',
    num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${v.id} AND kind='op' AND replaced_at IS NULL`) === 1
    && !!sql(`SELECT author_name FROM clinical_notes WHERE visit_id=${v.id} AND kind='op' AND replaced_at IS NULL`));
  await send(`/theatre/visits/${v.id}/report`, 'POST', { body: 'لامینکتومیِ L4-L5؛ افتِ گذرای MEP در دقیقهٔ ۴۰.' });
  ok('ویرایش نسخهٔ تازه می‌سازد و قبلی را بایگانی می‌کند (نه بازنویسی)',
    num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${v.id} AND kind='op'`) === 2
    && num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${v.id} AND kind='op' AND replaced_at IS NULL`) === 1);
  /* ⚠️ بستهٔ FF (FF1): پیش‌نویسِ کهنهٔ یک تبلت (پایه‌اش شرحِ اول) نباید شرحِ تازه‌تر را بی‌صدا جایگزین کند. */
  const stale = await send(`/theatre/visits/${v.id}/report`, 'POST', { body: 'پیش‌نویسِ کهنه', base: 'لامینکتومیِ L4-L5؛ مانیتورینگ بدونِ افتِ دامنه.' });
  ok('**نباید بیفتد:** شرح با پایهٔ کهنه شرحِ تازه‌ترِ پرونده را جایگزین کند — ۴۰۹ فارسی',
    stale.status === 409 && /عوض شده/.test(String(stale.json?.message))
    && sql(`SELECT body FROM clinical_notes WHERE visit_id=${v.id} AND kind='op' AND replaced_at IS NULL`).includes('MEP'),
    `${stale.status} ${stale.json?.message}`);
  const fresh = await send(`/theatre/visits/${v.id}/report`, 'POST', { body: 'لامینکتومیِ L4-L5؛ افتِ گذرای MEP در دقیقهٔ ۴۰؛ برگشت.', base: 'لامینکتومیِ L4-L5؛ افتِ گذرای MEP در دقیقهٔ ۴۰.' });
  ok('… و با پایهٔ درست ذخیره می‌شود', fresh.status < 300 && fresh.json?.visit?.opReport?.endsWith('برگشت.'), String(fresh.status));

  console.log('\n۶) مدارک — مرحله‌بندی‌شده و بازشدنی از خودِ میز');
  const upload = async (name, body, phase) => {
    const fd = new FormData();
    fd.append('file', new Blob([body], { type: 'text/plain' }), name);
    fd.append('category', 'report');
    fd.append('title', name);
    fd.append('visitId', String(v.id));
    if (phase) fd.append('phase', phase);
    const r = await fetch(`${API}/patients/${v.patientId}/documents`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + login.accessToken }, body: fd,
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const dPre = await upload(`pre${tag}.txt`, 'MRI پیش از عمل', 'pre');
  const dPost = await upload(`post${tag}.txt`, 'گزارشِ پس از عمل', 'post');
  ok('دو مدرک با مرحله ثبت شدند', dPre.status === 201 && dPost.status === 201, `${dPre.status}/${dPost.status}`);
  const withDocs = (await send(`/theatre/visits/${v.id}`)).json;
  const groups = withDocs?.documents ?? [];
  ok('**مدارک مرحله‌بندی‌شده با برچسبِ فارسیِ سرور می‌آیند** (قانونِ ۱۵)',
    groups.some((g) => g.phase === 'pre' && g.label === 'قبل از عمل')
    && groups.some((g) => g.phase === 'post' && g.label === 'بعد از عمل'),
    JSON.stringify(groups.map((g) => [g.phase, g.label])));
  ok('… و ترتیبشان مسیرِ بیمار است: قبل پیش از بعد',
    groups.findIndex((g) => g.phase === 'pre') < groups.findIndex((g) => g.phase === 'post'));
  const docId = groups.find((g) => g.phase === 'pre')?.items?.[0]?.id;
  const file = await fetch(`${API}/theatre/visits/${v.id}/documents/${docId}/file`, { headers: { Authorization: 'Bearer ' + login.accessToken } });
  ok('🔴 **مدرک از خودِ میزِ اتاق باز می‌شود** — نه از پروندهٔ بیمار',
    file.status === 200 && (await file.text()) === 'MRI پیش از عمل', String(file.status));
  /* مدرکِ عملِ دیگر نباید از مسیرِ این عمل باز شود، وگرنه این endpoint یک
     دورزدنِ `documents.read` برای کلِ پرونده می‌شد. */
  const foreign = await fetch(`${API}/theatre/visits/${decidedIn.id}/documents/${docId}/file`, { headers: { Authorization: 'Bearer ' + login.accessToken } });
  ok('**نباید بیفتد:** مدرکِ عملِ دیگر از مسیرِ این عمل باز شود', foreign.status === 404, String(foreign.status));

  console.log('\n۷) ترخیص — مرحلهٔ سوم، نه مترادفِ «پایانِ عمل»');
  sql(`UPDATE visits SET op_end_time=NULL WHERE id=${v.id}`);
  const early2 = await send(`/theatre/visits/${v.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'home' });
  ok('**نباید بیفتد:** ترخیص پیش از «پایانِ عمل»', early2.status === 400, String(early2.status));
  sql(`UPDATE visits SET op_end_time='09:30' WHERE id=${v.id}`);
  const blank = await send(`/theatre/visits/${v.id}/discharge`, 'POST', { condition: '   ', disposition: 'home' });
  ok('**نباید بیفتد:** ترخیصِ بی‌شرح', blank.status === 400, String(blank.status));
  /* بستهٔ ۶ب: «به کجا رفت» جزوِ حداقلِ خلاصهٔ ترخیص است (منزل/انتقال/با
     رضایتِ شخصی/فوت) — بی‌آن، آمارِ خروج و پیگیریِ بعد از عمل ممکن نیست. */
  const noDispo = await send(`/theatre/visits/${v.id}/discharge`, 'POST', { condition: 'هوشیار' });
  ok('**نباید بیفتد:** ترخیص بدونِ وضعیتِ خروج', noDispo.status === 400
    && /خروج|ترخیص/.test(JSON.stringify(noDispo.json)), JSON.stringify([noDispo.status, noDispo.json?.message]).slice(0, 160));
  const badDispo = await send(`/theatre/visits/${v.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'mars' });
  ok('**نباید بیفتد:** وضعیتِ خروجِ ناشناخته', badDispo.status === 400, String(badDispo.status));
  const dis = await send(`/theatre/visits/${v.id}/discharge`, 'POST', {
    condition: 'هوشیار، بدونِ نقصِ حرکتی، دردِ کنترل‌شده.',
    disposition: 'home',
    summary: 'لامینکتومیِ L4-L5 بدونِ عارضه؛ درن روزِ دوم خارج شد.',
    remark: 'پانسمان روزِ پنجم در مطب.',
  });
  ok('ترخیص ثبت می‌شود و شرحش برمی‌گردد',
    dis.status < 300 && !!dis.json?.visit?.dischargeAt && dis.json?.visit?.dischargeNote?.startsWith('هوشیار'),
    JSON.stringify([dis.status, dis.json?.visit?.dischargeAt, dis.json?.visit?.dischargeNote]).slice(0, 180));
  ok('… و شرحش سندِ `discharge`ِ پرونده است',
    num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${v.id} AND kind='discharge' AND replaced_at IS NULL`) === 1);
  ok('وضعیتِ خروج با برچسبِ فارسی برمی‌گردد (منزل)',
    dis.json?.visit?.dischargeDisposition === 'home' && dis.json?.visit?.dischargeDispositionFa === 'منزل',
    JSON.stringify([dis.json?.visit?.dischargeDisposition, dis.json?.visit?.dischargeDispositionFa]));
  ok('شرحِ ترخیص و یادداشت هر کدام سندِ جدای پرونده‌اند',
    dis.json?.visit?.dischargeSummary?.includes('L4-L5') && dis.json?.visit?.dischargeRemark?.includes('پانسمان')
    && num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${v.id} AND kind='discharge_summary' AND replaced_at IS NULL`) === 1
    && num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${v.id} AND kind='discharge_note' AND replaced_at IS NULL`) === 1,
    JSON.stringify([dis.json?.visit?.dischargeSummary, dis.json?.visit?.dischargeRemark]).slice(0, 160));
  ok('ستونِ discharge_disposition پر شد', sql(`SELECT discharge_disposition FROM visits WHERE id=${v.id}`) === 'home');
  ok('وضعیتِ اتاق «ترخیص شد» می‌شود — جدا از «در ریکاوری»',
    dis.json?.visit?.state === 'discharged' && dis.json?.visit?.stateFa === 'ترخیص شد',
    JSON.stringify([dis.json?.visit?.state, dis.json?.visit?.stateFa]));
  const at1 = sql(`SELECT discharge_at FROM visits WHERE id=${v.id}`);
  const again = await send(`/theatre/visits/${v.id}/discharge`, 'POST', { condition: 'هوشیار، با توصیهٔ فیزیوتراپی.', disposition: 'transfer' });
  ok('زدنِ دوباره فقط شرح را نسخه‌بندی می‌کند و **ساعتِ ترخیص را عوض نمی‌کند**',
    again.status < 300 && sql(`SELECT discharge_at FROM visits WHERE id=${v.id}`) === at1
    && num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${v.id} AND kind='discharge'`) === 2, at1);
  /* ویرایشِ ترخیص بدونِ شرح/یادداشتِ تازه نباید آن دو را پاک کند — همان قاعدهٔ
     «بخشِ نفرستاده دست نمی‌خورد» که فرمِ ویزیت هم دارد. */
  ok('وضعیتِ خروج عوض شد ولی شرح و یادداشتِ قبلی ماند',
    again.json?.visit?.dischargeDisposition === 'transfer'
    && again.json?.visit?.dischargeSummary?.includes('L4-L5') && again.json?.visit?.dischargeRemark?.includes('پانسمان'),
    JSON.stringify([again.json?.visit?.dischargeDisposition, again.json?.visit?.dischargeSummary]).slice(0, 160));
  const rec7 = (await send(`/patients/${v.patientId}/record`)).json;
  ok('در پرونده هر سه با نامِ خودشان‌اند',
    ['وضعیتِ هنگامِ ترخیص', 'شرحِ ترخیص', 'یادداشتِ ترخیص'].every((l) => (rec7?.clinicalNotes ?? []).some((n) => n.visitId === v.id && n.kindFa === l)),
    JSON.stringify((rec7?.clinicalNotes ?? []).filter((n) => n.visitId === v.id).map((n) => n.kindFa)));
  /* 🔴 شرحِ عمل نباید قربانیِ شرحِ ترخیص شود: هر دو در یک آرایه برمی‌گردند و
     نسخهٔ اولِ enrich با `[0]` می‌خواندشان. */
  ok('🔴 شرحِ عمل بعد از ترخیص هنوز شرحِ عمل است، نه شرحِ ترخیص',
    (await send(`/visits/${v.id}`)).json?.opReport?.startsWith('لامینکتومی'),
    JSON.stringify((await send(`/visits/${v.id}`)).json?.opReport).slice(0, 120));

  console.log('\n۸) خلاصهٔ ماه — نشانهٔ تقویمِ انتخابِ تاریخ');
  /* 🔴 بازخوردِ مالک: «روی تاریخ‌ها یه علامتی مثل تقویمِ عمل باشه که کاربر
     موقعِ انتخاب ویوِ کلی رو ببینه». تا دیروز انتخابگرِ تاریخ هیچ‌چیز از
     شلوغیِ روز نمی‌دانست. */
  sql(`UPDATE visits SET op_date=CURRENT_DATE WHERE id=${v.id}`);
  const [jy, jm, jd] = jToday();
  const mon = (await send(`/theatre/month?year=${jy}&month=${jm}`)).json;
  const cell = (mon?.days ?? []).find((x) => x.day === jd);
  ok(`خلاصهٔ ماه روزِ امروز را می‌شمارد (${JSON.stringify(cell)})`, !!cell && cell.visits >= 1,
    JSON.stringify(mon).slice(0, 200));
  /* فقط عدد، نه ردیف: این پاپ‌آپ نباید نامِ بیمار را به میزی برساند که شاید
     اجازه‌اش را ندارد — و کشیدنِ صدها سطر برای چند عدد هم بیهوده است. */
  ok('🔴 **هیچ نامِ بیماری در خلاصهٔ ماه نیست** — فقط شمارش', !JSON.stringify(mon).includes('تئاتر'));
  const badMonth = await send(`/theatre/month?year=${jy}&month=13`);
  ok('**نباید بیفتد:** ماهِ ۱۳ پذیرفته شود', badMonth.status === 400, String(badMonth.status));

  console.log('\n۹) دامنهٔ دید — object-authz');
  const other = (await send('/accounts/temporary', 'POST', { firstName: 'کارشناسِ', lastName: `بیگانه${tag}`, phone: phone(), level: 2, jobRole: 'technician', username: `th${tag}` })).json;
  const ol = await loginAs(`th${tag}`, other.temporaryPassword);
  const oApi = call(ol.accessToken);
  const oDay = (await oApi(`/theatre/day?date=${today}`)).json;
  ok('کارشناسی که این عمل به نامش نیست، آن را در فهرست نمی‌بیند',
    !((oDay?.visits ?? []).some((x) => x.id === v.id)), JSON.stringify((oDay?.visits ?? []).map((x) => x.id)));
  ok('**نباید بیفتد:** کارتش را مستقیم بگیرد', (await oApi(`/theatre/visits/${v.id}`)).status === 404);
  ok('**نباید بیفتد:** چک‌لیستش را امضا کند',
    (await oApi(`/theatre/visits/${v.id}/check`, 'POST', { stage, key: item, checked: true })).status === 404);
  const oFile = await fetch(`${API}/theatre/visits/${v.id}/documents/${docId}/file`, { headers: { Authorization: 'Bearer ' + ol.accessToken } });
  ok('**نباید بیفتد:** مدرکِ این عمل را بگیرد', oFile.status === 404, String(oFile.status));
  /* شمارندهٔ تقویم هم باید همان دامنه را داشته باشد، وگرنه کارشناس از روی
     عددِ تقویم می‌فهمد اتاق آن روز چقدر شلوغ بوده. */
  const oMon = (await oApi(`/theatre/month?year=${jy}&month=${jm}`)).json;
  ok('**نباید بیفتد:** شمارندهٔ تقویم عمل‌های دیگران را بشمارد',
    ((oMon?.days ?? []).find((x) => x.day === jd)?.visits ?? 0) === 0,
    JSON.stringify(oMon).slice(0, 160));
  ok('**نباید بیفتد:** شرحِ عمل یا ترخیصش را بنویسد',
    (await oApi(`/theatre/visits/${v.id}/report`, 'POST', { body: 'نفوذ' })).status === 404
    && (await oApi(`/theatre/visits/${v.id}/discharge`, 'POST', { condition: 'نفوذ', disposition: 'home' })).status === 404
    && (await oApi(`/theatre/visits/${v.id}/findings`, 'POST', { body: 'نفوذ' })).status === 404);
  /* ولی همان حساب وقتی کارشناسِ عمل شد، می‌بیند — یعنی ۴۰۴ از دامنه بود نه از گارد. */
  sql(`UPDATE visits SET tech_id=${other.account.id} WHERE id=${v.id}`);
  ok('… و به‌محضِ اینکه کارشناسِ همین عمل شد، می‌بیند', (await oApi(`/theatre/visits/${v.id}`)).status === 200);
} finally {
  /* چیزی نمی‌ماند: پاک‌سازی را خودِ رانر با دیتابیسِ تازه انجام می‌دهد. */
}

console.log(`\n${pass} سنجه سبز${fails.length ? `، ${fails.length} قرمز` : ''}`);
if (fails.length) { for (const f of fails) console.log('  ✘ ' + f); process.exit(1); }
