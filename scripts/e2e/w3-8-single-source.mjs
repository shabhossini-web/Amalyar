/**
 * W3.8 / U7 — «یک فیلد، یک نویسنده»: ساعتِ حضورِ کارشناس.
 *
 * تصمیمِ مالک ۱۴۰۵/۰۶/۲۶: ساعتِ حضور مالِ «آن کارشناس، در آن بیمارستان، در آن
 * روز» است نه مالِ یک بیمار — پس **فقط** از برنامهٔ چینش (`hospital_duties`)
 * می‌آید، و انتسابِ کارشناس در فرمِ مراجعه خودکار در همان برنامه می‌نشیند.
 *
 * تا امروز سه رابط مستقل می‌نوشتندش (فرمِ مراجعه، شیتِ ساعتِ کارشناس، برنامهٔ
 * چینش) و واگرا می‌شدند؛ نشانه‌اش گزینهٔ «— هنوز در برنامه حضور نیست» در تابلو بود.
 *
 * «نباید بیفتد»:
 *   فرم یا شیتِ ساعت بتوانند `techArriveTime` را مستقیم بنویسند ·
 *   ثبتِ بیمارِ تازه ساعتِ حضورِ ثبت‌شدهٔ برنامه را عقب/جلو ببرد ·
 *   مراجعهٔ بدونِ ساعتِ عمل هنگامِ انتسابِ کارشناس **رد** شود ·
 *   برداشتنِ کارشناس ساعتِ حضورِ یتیم را جا بگذارد ·
 *   عوض‌شدنِ بیمارستان در همان ویرایش، ردیفِ حضورِ بیمارستانِ قبلی را بخواند
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));
const okStatus = (s) => s >= 200 && s < 300;

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'ss' + randomBytes(3).toString('hex');
const ISO = new Date().toISOString().slice(0, 10);
const trash = { visits: [], forms: [], hospitals: [], accounts: [] };
let techId = 0, hosp = 0, hosp2 = 0;

/** ساعتِ حضورِ ثبت‌شده روی ردیفِ برنامه (یا `-` اگر ردیفی نیست). */
const duty = (h) => sql(`SELECT coalesce(max(arrive_time),'-') FROM hospital_duties
  WHERE date='${ISO}' AND hospital_id=${h} AND tech_id=${techId}`);
const arriveOf = (v) => sql(`SELECT coalesce(tech_arrive_time,'-') FROM visits WHERE id=${v}`);

try {
  /* ⚠️ کارشناس را **خودمان** می‌سازیم، نه از حالتِ محیط: نصبِ محلی فقط
     سوپرادمین دارد، و تستی که به تعریف‌های موجود تکیه کند روی ماشینِ دیگری
     چیزِ دیگری می‌سنجد. سطحِ ۲..۴ و `active` همان شرطی است که `save()` می‌سنجد. */
  const tech = (await send('/accounts/temporary', 'POST', {
    firstName: 'کارشناسِ', lastName: `چینش ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
    level: 2, jobRole: 'technician', username: `t${tag}`,
  })).json;
  techId = tech?.account?.id ?? 0;
  if (!techId) { console.error('کارشناس ساخته نشد', tech); process.exit(1); }
  trash.accounts.push(techId);

  const mkHospital = async (name) => {
    const r = await send('/hospitals', 'POST', { name });
    if (!r.json?.id) { console.error('بیمارستان ساخته نشد', r); process.exit(1); }
    trash.hospitals.push(r.json.id);
    return r.json.id;
  };
  hosp = await mkHospital(`بیمارستانِ ${tag}`);
  hosp2 = await mkHospital(`بیمارستانِ دومِ ${tag}`);

  const form = (await send('/forms', 'POST', { key: tag, title: `عملِ ${tag}`, scope: 'visit' })).json;
  if (form?.id) trash.forms.push(form.id);
  const mkVisit = async (body) => {
    const r = await send('/visits', 'POST', { kind: tag, ...body });
    if (!r.json?.id) { console.error('مراجعه ساخته نشد', r.json); process.exit(1); }
    trash.visits.push(r.json.id);
    return r.json;
  };

  console.log('۱) ثبتِ مراجعه با کارشناس → ردیفِ حضور خودکار ساخته می‌شود');
  const v1 = await mkVisit({
    firstName: 'سمیهٔ', lastName: `چینش${tag}`, phone: '09120000931',
    hospitalId: hosp, techId, opDate: `${ISO}T00:00:00.000Z`, opStartTime: '09:30',
  });
  ok(duty(hosp) === '09:30', `ردیفِ حضور با ساعتِ عمل ساخته شد (${duty(hosp)})`);
  ok(arriveOf(v1.id) === '09:30', 'ساعتِ حضورِ مراجعه از همان ردیف آمد');

  console.log('۲) تابلوی چینش دیگر «هنوز در برنامه حضور نیست» نمی‌گوید');
  const board = (await send(`/dispatch/roster?date=${ISO}`, 'GET')).json;
  const group = (board?.hospitals ?? []).find((h) => h.hospitalId === hosp);
  ok(!!group, 'بیمارستان در تابلو هست');
  ok((group?.duties ?? []).some((d) => d.techId === techId), 'کارشناس در فهرستِ حضورِ همان بیمارستان است');
  ok((group?.visits ?? []).some((v) => v.id === v1.id && v.techId === techId), 'مراجعه هم به همان کارشناس وصل است');

  console.log('۳) برنامه حرفِ آخر را می‌زند — بیمارِ بعدی عقبش نمی‌برد');
  const v2 = await mkVisit({
    patientId: num(`SELECT patient_id FROM visits WHERE id=${v1.id}`),
    hospitalId: hosp, techId, opDate: `${ISO}T00:00:00.000Z`, opStartTime: '14:00',
  });
  /* 🔴 نباید بیفتد: ردیفِ ۰۹:۳۰ با بیمارِ ۱۴:۰۰ بازنویسی شود. */
  ok(duty(hosp) === '09:30', 'ساعتِ ثبت‌شدهٔ برنامه دست‌نخورده ماند');
  ok(arriveOf(v2.id) === '09:30', 'بیمارِ دوم همان ساعتِ برنامه را گرفت، نه ساعتِ عملِ خودش');

  console.log('۴) فرم و شیتِ ساعت دیگر نمی‌توانند ساعتِ حضور را بنویسند');
  const forced = await send(`/visits/${v1.id}`, 'PATCH', { techArriveTime: '05:00' });
  ok(okStatus(forced.status), `درخواست رد نشد، فقط نادیده گرفته شد (${forced.status})`);
  ok(arriveOf(v1.id) === '09:30', '🔴 فرم ساعتِ حضور را عوض نکرد');
  const forcedTimes = await send(`/visits/${v1.id}/times`, 'PATCH', { techArriveTime: '06:00', opStartTime: '10:15' });
  ok(okStatus(forcedTimes.status), `شیتِ ساعت پذیرفته شد (${forcedTimes.status})`);
  ok(arriveOf(v1.id) === '09:30', '🔴 شیتِ ساعت هم ساعتِ حضور را عوض نکرد');
  ok(sql(`SELECT op_start_time FROM visits WHERE id=${v1.id}`) === '10:15', 'ولی ساعتِ عمل را درست نوشت');

  console.log('۵) مراجعهٔ بدونِ ساعتِ عمل — انتساب رد نمی‌شود');
  const v3 = await mkVisit({
    patientId: num(`SELECT patient_id FROM visits WHERE id=${v1.id}`),
    hospitalId: hosp2, techId, opDate: `${ISO}T00:00:00.000Z`,
  });
  /* 🔴 نباید بیفتد: فرم به‌خاطرِ این قاعده شکست بخورد. */
  ok(num(`SELECT tech_id FROM visits WHERE id=${v3.id}`) === techId, 'کارشناس نشست');
  ok(duty(hosp2) === '-', 'ردیفِ حضور ساخته نشد (ساعتی برای ساختنش نبود)');
  ok(arriveOf(v3.id) === '-', 'و ساعتِ حضورِ ساختگی هم ننشست');

  console.log('۶) همان مراجعه با ساعتِ عمل → ردیف ساخته می‌شود');
  ok(okStatus((await send(`/visits/${v3.id}`, 'PATCH', { opStartTime: '07:45' })).status), 'ویرایش پذیرفته شد');
  ok(duty(hosp2) === '07:45', `ردیفِ حضورِ بیمارستانِ دوم ساخته شد (${duty(hosp2)})`);
  ok(arriveOf(v3.id) === '07:45', 'ساعتِ حضور نشست');

  console.log('۷) برداشتنِ کارشناس، ساعتِ حضور را هم می‌برد');
  ok(okStatus((await send(`/visits/${v3.id}`, 'PATCH', { techId: null })).status), 'ویرایش پذیرفته شد');
  /* 🔴 نباید بیفتد: ساعتِ حضورِ یتیم روی کارت بماند. */
  ok(arriveOf(v3.id) === '-', 'ساعتِ حضور پاک شد');
  ok(duty(hosp2) === '07:45', 'ولی ردیفِ برنامه سرِ جایش ماند (کارشناس آن روز آن‌جاست)');

  console.log('۸) عوض‌شدنِ بیمارستان با مقادیرِ **نهایی** سنجیده می‌شود');
  const v4 = await mkVisit({
    patientId: num(`SELECT patient_id FROM visits WHERE id=${v1.id}`),
    hospitalId: hosp, techId, opDate: `${ISO}T00:00:00.000Z`, opStartTime: '11:00',
  });
  ok(arriveOf(v4.id) === '09:30', 'اول ساعتِ بیمارستانِ اول را دارد');
  ok(okStatus((await send(`/visits/${v4.id}`, 'PATCH', { hospitalId: hosp2 })).status), 'بیمارستان عوض شد');
  /* 🔴 نباید بیفتد: ردیفِ حضورِ بیمارستانِ **قبلی** خوانده شود. */
  ok(arriveOf(v4.id) === '07:45', `ساعتِ حضور به برنامهٔ بیمارستانِ تازه رفت (${arriveOf(v4.id)})`);

  console.log('۹) رکوردِ واگرای قدیمی با اولین ذخیره درست می‌شود');
  sql(`UPDATE visits SET tech_arrive_time='23:59' WHERE id=${v4.id}`);
  ok(arriveOf(v4.id) === '23:59', 'واگرایی کاشته شد');
  ok(okStatus((await send(`/visits/${v4.id}`, 'PATCH', { notes: `خودترمیمیِ ${tag}` })).status), 'یک ذخیرهٔ ساده');
  ok(arriveOf(v4.id) === '07:45', 'ساعت به مقدارِ برنامه برگشت');
} finally {
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const h of trash.hospitals) sql(`DELETE FROM hospital_duties WHERE hospital_id=${h}`);
  for (const h of trash.hospitals) await send(`/hospitals/${h}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    sql(`DELETE FROM account_sessions WHERE account_id=${id}`);
    sql(`DELETE FROM accounts WHERE id=${id}`);
  }
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
