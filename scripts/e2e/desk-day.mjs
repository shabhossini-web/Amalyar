/**
 * **میزِ پزشک و میزِ پذیرش — بستهٔ ۳الف** (بازبینی با دیدِ کاربر، ۱۴۰۵/۰۶/۳۰).
 *
 * سه چیزی که با **نشستن پای میز و نگاه‌کردن به اسکرین‌شات** پیدا شدند و هیچ
 * سنجه‌ای نمی‌گرفتشان:
 *
 *  ۱. **بنیان‌گذارِ مطب `jobRole` می‌گرفت ولی `Surgeon` نه.** بستهٔ ۱ فقط نقش را
 *     می‌داد؛ `setJobRole` و خودِ migration هر دو upsertِ جراح را داشتند و همین
 *     یک مسیر جا افتاده بود. نتیجه: کشویِ **اجباریِ** «پزشک» در فرمِ ویزیت خالی
 *     می‌مانْد و صاحبِ مطب اولین ویزیتش را هم نمی‌توانست ثبت کند.
 *  ۲. **میزِ پذیرش بدهیِ بیمار را فقط وقتی نشان می‌داد که نوبت به مراجعه وصل
 *     باشد.** بیمارِ ایستاده جلوی منشی با ۱٬۲۰۰٬۰۰۰ بدهی هیچ نشانی نداشت.
 *  ۳. **نوبت و مراجعهٔ یک بیمار دو ردیفِ جدا بودند** — هفت بیمار، چهارده ردیف.
 *
 *  باید بیفتد:
 *   - عوض‌کردنِ حوزه به مطب، بنیان‌گذار را هم پزشک می‌کند **و** تعریفِ جراحش را می‌سازد
 *   - `frontdesk/day` ماندهٔ مراجعه‌های دیگرِ بیمار را می‌دهد
 *   - `surgeon/today.day` نوبت و مراجعهٔ یک بیمار را یکی می‌کند
 *  نباید بیفتد:
 *   - ماندهٔ مراجعهٔ **وصل‌شده** دوباره در «بدهیِ قبلی» شمرده شود
 *   - بیمارِ تسویه‌شده بدهی نشان بدهد
 *   - دو نوبتِ یک بیمار در یک روز با یک مراجعه ادغام شوند (حدسِ مبهم)
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
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: A, body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const today = new Date().toISOString().slice(0, 10);
const before = sql("SELECT coalesce((SELECT value FROM settings WHERE key='vertical'),'ionm')");
const appts = [];

try {
  console.log('۱) مطبِ تک‌پزشکه — بنیان‌گذار هم نقش می‌گیرد هم تعریفِ جراح');
  const personId = num(`SELECT person_id FROM accounts WHERE username='${USER}'`);
  sql(`UPDATE accounts SET job_role=NULL WHERE username='${USER}'`);
  sql(`DELETE FROM surgeons WHERE person_id=${personId}`);
  ok('نقطهٔ شروع: نه نقشی، نه تعریفِ جراحی', sql(`SELECT coalesce(job_role,'-') FROM accounts WHERE username='${USER}'`) === '-'
    && num(`SELECT count(*) FROM surgeons WHERE person_id=${personId}`) === 0);
  await send('/config/vertical', 'PATCH', { vertical: 'clinic' });
  ok('عوض‌کردنِ حوزه به مطب، بنیان‌گذار را «پزشک» می‌کند', sql(`SELECT coalesce(job_role,'-') FROM accounts WHERE username='${USER}'`) === 'doctor');
  ok('🔴 **و تعریفِ جراحش را هم می‌سازد** — وگرنه کشویِ اجباریِ «پزشک» خالی می‌ماند',
    num(`SELECT count(*) FROM surgeons WHERE person_id=${personId}`) === 1);
  const surgeonId = num(`SELECT id FROM surgeons WHERE person_id=${personId}`);
  const list = (await send('/surgeons')).json ?? [];
  ok('… و در `GET /surgeons` دیده می‌شود (همان چیزی که فرمِ ویزیت می‌خواند)', list.some((s) => s.id === surgeonId), JSON.stringify(list.map((s) => s.id)));
  const kinds = (await send('/forms/visit-kinds')).json ?? [];
  if (!kinds.some((k) => (k.kind ?? k.key) === 'clinic')) await send('/forms', 'POST', { key: 'clinic', title: `ویزیت${tag}`, scope: 'visit' });

  console.log('\n۲) میزِ پذیرش — بدهیِ بیمار، نه بدهیِ نوبت');
  const mk = async (first) => {
    const r = await send('/visits', 'POST', { kind: 'clinic', firstName: first, lastName: `آزمون${tag}`, phone: phone(), opDate: new Date().toISOString(), surgeonId, extra: { chiefComplaint: 'آزمون' } });
    if (!r.json?.id) throw new Error('مراجعه ساخته نشد: ' + JSON.stringify(r.json).slice(0, 200));
    return r.json;
  };
  const bill = async (v, total, paid) => {
    await send(`/visits/${v.id}/billing/pricing`, 'POST', { pricingModel: 'global', globalAmount: total });
    if (paid > 0) await send(`/visits/${v.id}/payments`, 'POST', { amount: paid, method: 'card' });
  };
  const appt = (patientId, seq, visitId = null) => {
    const id = num(`INSERT INTO appointments (patient_id, date, seq, status, ${visitId ? 'visit_id, ' : ''}created_at, updated_at)
      VALUES (${patientId}, DATE '${today}', ${seq}, 'confirmed', ${visitId ? `${visitId}, ` : ''}now(), now()) RETURNING id`);
    appts.push(id); return id;
  };

  /* بدهکار: مراجعهٔ امروز دارد ولی نوبتش به آن **وصل نیست** — همان حالتی که
     چیپِ «مانده» را نامرئی می‌کرد. */
  const vDebt = await mk('بدهکار');
  await bill(vDebt, 1200000, 0);
  const aDebt = appt(vDebt.patientId, 81);
  /* تسویه‌شده: هیچ بدهی‌ای نباید نشان بدهد. */
  const vClean = await mk('تسویه');
  await bill(vClean, 500000, 500000);
  const aClean = appt(vClean.patientId, 82);
  /* وصل‌شده: ماندهٔ همین مراجعه در `billing` است و **نباید** در `debt` دوباره بیاید. */
  const vLinked = await mk('وصل');
  await bill(vLinked, 900000, 300000);
  const aLinked = appt(vLinked.patientId, 83, vLinked.id);

  const board = (await send(`/frontdesk/day?date=${today}`)).json;
  const row = (id) => (board?.rows ?? []).find((r) => r.id === id);
  ok('**بدهیِ بیمارِ بی‌نوبتِ وصل‌شده روی تخته دیده می‌شود**', row(aDebt)?.debt?.due === 1200000, JSON.stringify([row(aDebt)?.billing, row(aDebt)?.debt]));
  ok('**نباید بیفتد:** بیمارِ تسویه‌شده بدهی نشان بدهد', row(aClean)?.debt === null, JSON.stringify(row(aClean)?.debt));
  ok('**نباید بیفتد:** ماندهٔ مراجعهٔ وصل‌شده دوبار شمرده شود', row(aLinked)?.billing?.due === 600000 && row(aLinked)?.debt === null,
    JSON.stringify([row(aLinked)?.billing?.due, row(aLinked)?.debt]));

  /* دو مراجعهٔ بدهکار برای یک بیمار → جمع می‌شوند و شمارِ مراجعه برمی‌گردد. */
  const vSecond = (await send('/visits', 'POST', { kind: 'clinic', patientId: vDebt.patientId, opDate: new Date(Date.now() - 864e5 * 3).toISOString(), surgeonId, extra: { chiefComplaint: 'قبلی' } })).json;
  await bill(vSecond, 300000, 0);
  const board2 = (await send(`/frontdesk/day?date=${today}`)).json;
  const d2 = (board2?.rows ?? []).find((r) => r.id === aDebt)?.debt;
  ok('بدهیِ چند مراجعه با هم جمع می‌شود و تعدادش برمی‌گردد', d2?.due === 1500000 && d2?.visits === 2, JSON.stringify(d2));

  console.log('\n۳) میزِ پزشک — یک بیمار، یک ردیف');
  const day = (await send('/surgeon/today')).json;
  const rows = day?.day ?? [];
  const merged = rows.find((r) => r.visitId === vLinked.id);
  ok('نوبتِ وصل‌شده و مراجعه‌اش یک ردیف‌اند', merged?.apptId === aLinked, JSON.stringify(rows.map((r) => [r.key, r.visitId, r.apptId])));
  const byPatient = rows.find((r) => r.visitId === vDebt.id);
  ok('**نوبتِ بی‌`visit_id` هم با مراجعهٔ همان بیمارِ همان روز ادغام می‌شود**', byPatient?.apptId === aDebt, JSON.stringify(byPatient));
  ok('هیچ مراجعه‌ای دو ردیف نمی‌شود', rows.filter((r) => r.visitId === vDebt.id).length === 1);
  ok('ماندهٔ هر ردیف روی خودش هست (قانونِ ۱۵ — عدد از سرور)', byPatient?.billing?.due === 1200000, JSON.stringify(byPatient?.billing));
  ok('`summary` جمعِ صورت‌حسابِ امروز را می‌دهد', day?.summary?.money?.due >= 1200000 + 600000, JSON.stringify(day?.summary?.money));

  /* 🔴 حدسِ مبهم ممنوع: بیماری که **دو** نوبتِ بی‌مراجعه در یک روز دارد نباید
     یکی‌شان را خودسرانه به مراجعه بچسباند — صبح ویزیت و عصر نوبتِ دوم دو
     رویدادِ واقعی‌اند. */
  const aSecond = appt(vDebt.patientId, 84);
  const day2 = (await send('/surgeon/today')).json;
  const rows2 = day2?.day ?? [];
  ok('**نباید بیفتد:** با دو نوبتِ بی‌مراجعه، ادغامِ حدسی انجام شود',
    rows2.filter((r) => r.visitId === vDebt.id)[0]?.apptId === null
    && rows2.filter((r) => r.apptId === aDebt || r.apptId === aSecond).length === 2,
    JSON.stringify(rows2.map((r) => [r.key, r.visitId, r.apptId])));
  ok('… و هر سهٔ آن‌ها ردیفِ خودشان را دارند', rows2.filter((r) => r.patientId === vDebt.patientId).length === 3,
    JSON.stringify(rows2.filter((r) => r.patientId === vDebt.patientId).map((r) => r.key)));
  console.log('\n۴) بیمارِ بدونِ نوبت — ظرفیت خبر می‌دهد، منع نمی‌کند');
  /* تصمیمِ مالک ۱۴۰۵/۰۶/۳۰: «بیمار ممکن است بدون نوبتِ قبلی حضوری بیاد که اگه
     وقت بشه پذیرش میشه». تا امروز این مسیر روی نصبی که **هیچ قاعدهٔ کاری
     تعریف نکرده** همیشه ۴۰۰ می‌گرفت («این روز باز نیست یا جای آزاد ندارد») —
     یعنی دکمه‌اش هم اگر بود کار نمی‌کرد. */
  const vWalk = await mk('حضوری');
  const walk = await send('/frontdesk/walk-in', 'POST', { patientId: vWalk.patientId, date: today, note: 'ارجاع از اورژانس' });
  if (walk.json?.id) appts.push(walk.json.id);
  ok('**روی نصبِ بی‌قاعدهٔ کاری هم پذیرش می‌شود**', walk.status < 300 && walk.json?.status === 'confirmed',
    `${walk.status} ${walk.json?.message ?? ''}`);
  ok('… شمارهٔ صف می‌گیرد، نه اسلاتِ کسِ دیگر', walk.json?.seq != null && walk.json?.startMin == null, JSON.stringify([walk.json?.seq, walk.json?.startMin]));
  ok('… و همان لحظه روی تختهٔ امروز می‌نشیند',
    ((await send(`/frontdesk/day?date=${today}`)).json?.rows ?? []).some((r) => r.id === walk.json?.id && r.lane === 'booked'));
  /* 🔴 ولی مسیرِ **تقویم** نباید شل شده باشد: ظرفیت آن‌جا یک اعلامِ واقعیِ مطب
     است و اگر حضوری راهِ دورزدنش شود، تقویم دروغ می‌گوید. */
  const viaCalendar = await send('/appointments', 'POST', { patientId: vWalk.patientId, date: today });
  ok('**نباید بیفتد:** همین شلی به رزروِ تقویم هم برسد', viaCalendar.status === 400,
    `${viaCalendar.status} ${viaCalendar.json?.message ?? ''}`);
  const past = await send('/frontdesk/walk-in', 'POST', { patientId: vWalk.patientId, date: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10) });
  ok('**نباید بیفتد:** حضوریِ روزِ گذشته', past.status === 400, `${past.status} ${past.json?.message ?? ''}`);
} finally {
  if (appts.length) sql(`DELETE FROM appointments WHERE id IN (${appts.join(',')})`);
  await send('/config/vertical', 'PATCH', { vertical: before });
}

console.log(`\n${pass} سنجه سبز${fails.length ? `، ${fails.length} قرمز` : ''}`);
if (fails.length) { for (const f of fails) console.log('  ✘ ' + f); process.exit(1); }
