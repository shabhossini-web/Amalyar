/**
 * **پیوستگیِ ویزیتِ پست‌آپِ خودکار** (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳): «اطلاعاتی مثلِ اسمِ
 * پزشک یا شکایتِ اصلی که در پرونده بوده چرا در فرم‌های بعدی لود نمی‌شود؟»
 *
 * ریشه: `syncPostOpVisit` فرزند را فقط با بیمار/تاریخ/موضوع می‌ساخت، و شکایتِ ارثی فقط
 * از `decidedIn` خوانده می‌شد (نه از زنجیرهٔ `followOf`).
 *
 *  باید بیفتد:
 *   - پزشکِ فرزند = جراحِ عمل؛ مرکزِ فرزند = مرکزِ ویزیتِ تصمیم (مطب)
 *   - شکایتِ فرزند از ویزیتِ تصمیم مشتق است (نه کپی) و منبعش گفته می‌شود
 *   - عملِ بی‌ویزیتِ تصمیم: شکایتِ خودِ عمل به فرزند می‌رسد
 *   - مهاجرتِ تکمیلی ردیف‌های قدیمیِ بی‌پزشک را پر می‌کند
 *  نباید بیفتد:
 *   - ذخیرهٔ بی‌تغییرِ فرمِ فرزند شکایتِ ارثی را کپی کند
 *   - پزشکی که دستی عوض شده با همگام‌سازیِ بعدی یا مهاجرت بازنویسی شود
 *   - فرزندِ عملِ بی‌ویزیتِ تصمیم بیمارستانِ عمل را «مرکز» بگیرد
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, '../../server/prisma/migrations/20260928000000_postop_child_continuity/migration.sql');

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken }, body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = randomBytes(3).toString('hex');
const day = (d) => new Date(Date.now() + d * 864e5).toISOString();
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const trash = [];
const childOf = (id) => {
  const row = sql(`SELECT coalesce(id::text,'') || '|' || coalesce(surgeon_id::text,'') || '|' || coalesce(hospital_id::text,'') FROM visits WHERE follow_of_visit_id=${id} ORDER BY id LIMIT 1`);
  const [cid, sid, hid] = (row || '||').split('|');
  return { id: Number(cid) || null, surgeonId: Number(sid) || null, hospitalId: Number(hid) || null };
};

try {
  ok('سوییچ به مطب', (await send('/config/vertical', 'PATCH', { vertical: 'clinic' })).status === 200);
  if (!((await send('/forms/visit-kinds')).json ?? []).some((k) => (k.kind ?? k.key) === 'clinic')) {
    await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  }
  const s1 = (await send('/surgeons', 'POST', { firstName: 'دکترِ', lastName: `پیوسته${tag}` })).json;
  const s3 = (await send('/surgeons', 'POST', { firstName: 'دکترِ', lastName: `جانشین${tag}` })).json;
  const office = (await send('/hospitals', 'POST', { name: `مطبِ پیوسته ${tag}` })).json;
  const hosp = (await send('/hospitals', 'POST', { name: `بیمارستانِ پیوسته ${tag}` })).json;
  const proc = (await send('/procedure-types', 'POST', { name: `عملِ پیوسته ${tag}` })).json;
  ok('تعریف‌ها ساخته شدند', [s1, s3, office, hosp, proc].every((x) => x?.id));

  const COMPLAINT = `کمردردِ تیرکشنده ${tag}`;
  const D = (await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'پیوستهٔ', lastName: `آزمون${tag}`, opDate: day(-10), surgeonId: s1.id, hospitalId: office.id, chiefComplaint: COMPLAINT,
  })).json;
  if (!D?.id) throw new Error('ویزیتِ تصمیم ساخته نشد: ' + JSON.stringify(D).slice(0, 200));
  trash.push(D.id);
  const X = (await send('/visits', 'POST', {
    kind: 'surgery', patientId: D.patientId, decidedInVisitId: D.id, opDate: day(-1), nextVisitDate: day(7),
    surgeonId: s1.id, hospitalId: hosp.id, procedureTypeId: proc.id,
  })).json;
  if (!X?.id) throw new Error('عمل ساخته نشد: ' + JSON.stringify(X).slice(0, 200));
  trash.push(X.id);

  console.log('۱) فرزندِ پست‌آپ پزشک و مرکز دارد');
  const c = childOf(X.id);
  if (c.id) trash.unshift(c.id);
  ok('ویزیتِ پست‌آپ ساخته شد', !!c.id);
  ok('پزشکِ ویزیتِ پست‌آپ = جراحِ عمل', c.surgeonId === s1.id, JSON.stringify(c));
  ok('مرکزِ ویزیتِ پست‌آپ = مرکزِ ویزیتِ تصمیم (مطب)، نه بیمارستانِ عمل', c.hospitalId === office.id, JSON.stringify(c));

  console.log('\n۲) شکایتِ اولیه مشتق است، نه کپی');
  const cv = (await send(`/visits/${c.id}`)).json;
  ok('شکایتِ ویزیتِ پست‌آپ همان شکایتِ ویزیتِ تصمیم است', cv?.chiefComplaint === COMPLAINT, cv?.chiefComplaint);
  ok('منبعِ شکایت گفته می‌شود', cv?.chiefComplaintFrom?.visitId === D.id && cv?.chiefComplaintOwn == null, JSON.stringify(cv?.chiefComplaintFrom));
  const echo = await send(`/visits/${c.id}`, 'PATCH', { chiefComplaint: COMPLAINT });
  ok('ذخیرهٔ فرمِ ویزیتِ پست‌آپ پذیرفته شد', echo.status === 200, `${echo.status} ${JSON.stringify(echo.json).slice(0, 160)}`);
  ok('**نباید بیفتد:** ذخیرهٔ بی‌تغییر شکایتِ ارثی را کپی کند', sql(`SELECT coalesce(chief_complaint,'<null>') FROM visits WHERE id=${c.id}`) === '<null>');
  const OWN = `دردِ محلِ زخم ${tag}`;
  await send(`/visits/${c.id}`, 'PATCH', { chiefComplaint: OWN });
  const cv2 = (await send(`/visits/${c.id}`)).json;
  ok('شکایتِ تازهٔ خودِ ویزیتِ پست‌آپ جای ارث را می‌گیرد', cv2?.chiefComplaint === OWN && cv2?.chiefComplaintFrom == null, JSON.stringify([cv2?.chiefComplaint, cv2?.chiefComplaintFrom]));

  console.log('\n۳) انتخابِ دستی بازنویسی نمی‌شود');
  await send(`/visits/${c.id}`, 'PATCH', { surgeonId: s3.id });
  await send(`/visits/${X.id}`, 'PATCH', { nextVisitDate: day(9) });
  const c3 = childOf(X.id);
  ok('**نباید بیفتد:** همگام‌سازیِ بعدی پزشکِ دستی را برگرداند', c3.surgeonId === s3.id, JSON.stringify(c3));
  const moved = sql(`SELECT (op_date::date = (now() + interval '9 days')::date)::text FROM visits WHERE id=${c.id}`);
  ok('تاریخِ ویزیتِ پست‌آپ همچنان با عمل جابه‌جا می‌شود', moved === 'true', moved);

  console.log('\n۴) عملِ بی‌ویزیتِ تصمیم');
  const X2 = (await send('/visits', 'POST', {
    kind: 'surgery', patientId: D.patientId, opDate: day(-2), nextVisitDate: day(5), chiefComplaint: `شکایتِ خودِ عمل ${tag}`,
    surgeonId: s1.id, hospitalId: hosp.id, procedureTypeId: proc.id,
  })).json;
  if (X2?.id) trash.push(X2.id);
  const c4 = childOf(X2?.id ?? 0);
  if (c4.id) trash.unshift(c4.id);
  ok('پزشکِ ویزیتِ پست‌آپ = جراحِ عمل', c4.surgeonId === s1.id, JSON.stringify(c4));
  ok('**نباید بیفتد:** بیمارستانِ عمل «مرکزِ» ویزیتِ پست‌آپ شود', c4.hospitalId == null, JSON.stringify(c4));
  const c4v = (await send(`/visits/${c4.id}`)).json;
  ok('شکایتِ خودِ عمل به ویزیتِ پست‌آپ می‌رسد', c4v?.chiefComplaint === `شکایتِ خودِ عمل ${tag}` && c4v?.chiefComplaintFrom?.visitId === X2?.id, JSON.stringify([c4v?.chiefComplaint, c4v?.chiefComplaintFrom]));

  console.log('\n۵) مهاجرتِ تکمیلیِ ردیف‌های قدیمی');
  sql(`UPDATE visits SET surgeon_id=NULL, hospital_id=NULL WHERE id=${c4.id}`);
  execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: readFileSync(MIGRATION, 'utf8') });
  const c5 = childOf(X2.id);
  ok('ردیفِ قدیمیِ بی‌پزشک پزشکش را از عمل گرفت', c5.surgeonId === s1.id, JSON.stringify(c5));
  ok('**نباید بیفتد:** مهاجرت پزشکِ دستیِ فرزندِ دیگر را بازنویسی کند', childOf(X.id).surgeonId === s3.id);
  execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: readFileSync(MIGRATION, 'utf8') });
  ok('مهاجرت تکرارپذیر است', childOf(X2.id).surgeonId === s1.id);
} catch (e) {
  ok(`اجرا متوقف شد: ${e?.message ?? e}`, false);
} finally {
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  ok('برگشت به حوزهٔ قبلی', back.status === 200, String(back.status));
  for (const id of trash) await send(`/visits/${id}`, 'DELETE').catch(() => {});
}

console.log(`\n${pass} سبز · ${fails.length} قرمز`);
if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
