/**
 * W4.2 گامِ ۱ — «اطلاع‌رسانی و عدمِ پاسخ» + آزمونِ الگو با بیمارِ ساختگی.
 *
 * مرحلهٔ ۴ و ۵ ویزاردِ سند. نیمهٔ **پرریسکِ** بسته این‌جاست: متنی که مدیر در
 * الگو می‌نویسد واقعاً به دستِ بیمار می‌رسد، پس پیش از ساختنِ ویزارد سنجیده
 * می‌شود.
 *
 * «نباید بیفتد» — هرکدام یک پیامکِ اشتباه به بیمارِ واقعی است:
 *   دوره‌ای که با تاریخِ عقب‌افتاده شروع شود رگباری پیامِ کهنه بفرستد ·
 *   گامِ انجام‌شده یادآوریِ نفرستاده‌اش را نگه دارد ·
 *   دورهٔ بسته‌شده (تمام یا لغو) فردا به بیمار پیام بدهد ·
 *   یادآوریِ **فرستاده‌شده** باطل شود (دفترِ پیام‌ها باید راست بگوید) ·
 *   بیمارِ بی‌شماره شروعِ دوره را بشکند ·
 *   آزمونِ الگو چیزی بنویسد یا پیامی بفرستد
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
/* ⚠️ `ON_ERROR_STOP=1` حیاتی است: بدونش `psql` روی کوئریِ خراب هم کدِ ۰
   می‌دهد و `num()` عددِ ۰ برمی‌گرداند — یعنی سنجهٔ «باید صفر باشد» با یک
   کوئریِ **شکسته** سبز می‌شود. همین در نسخهٔ اولِ همین فایل دو سبزِ دروغین داد. */
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
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

const tag = 'nt' + randomBytes(3).toString('hex');
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const trash = { visits: [], forms: [], templates: [], patients: [] };
let pid = 0, tpl = 0;

/** یادآوری‌های ساخته‌شده برای گام‌های یک دوره. */
const notices = (epId, status = null) => num(
  `SELECT count(*) FROM reminders r JOIN episode_steps s ON s.reminder_id = r.id
   WHERE s.episode_id=${epId}${status ? ` AND r.status='${status}'` : ''}`);

try {
  console.log('۱) الگویی با پیامک و «عدمِ پاسخ»');
  tpl = num(`INSERT INTO pathway_templates(key, title, builtin, active, created_at, updated_at)
    VALUES ('t-${tag}', 'الگوی ${tag}', false, true, now(), now()) RETURNING id`);
  trash.templates.push(tpl);
  const steps = [
    { key: 'soon', title: 'گامِ آینده', offsetDays: 2, ownerRole: 'nurse', notify: `یادآوریِ آیندهٔ ${tag}` },
    { key: 'later', title: 'گامِ دورتر', offsetDays: 9, ownerRole: 'doctor', notify: `یادآوریِ دورترِ ${tag}`, escalateDays: 5 },
    { key: 'silent', title: 'گامِ بی‌پیام', offsetDays: 4, ownerRole: 'doctor' },
  ];
  const pub = await send(`/pathway/templates/${tpl}/publish`, 'POST', { steps });
  ok(okStatus(pub.status), `نسخه منتشر شد (${pub.status})`);
  ok(pub.json.steps.filter((s) => s.notify).length === 2, 'دو گام متنِ پیامک دارند');
  ok(pub.json.steps.find((s) => s.key === 'later').escalateDays === 5, '«عدمِ پاسخ» ذخیره شد');

  console.log('۲) آزمونِ الگو — هیچ‌چیز نمی‌نویسد');
  const remBefore = num('SELECT count(*) FROM reminders');
  const epBefore = num('SELECT count(*) FROM episodes');
  const prev = await send('/pathway/preview', 'POST', { steps, anchor: `${day(0)}T00:00:00.000Z` });
  ok(okStatus(prev.status), `پیش‌نمایش آمد (${prev.status})`);
  ok(prev.json.steps.length === 3, 'هر سه گام با تاریخِ محاسبه‌شده');
  ok(prev.json.steps[0].dueAt.slice(0, 10) === day(2), `تاریخ درست حساب شد (${prev.json.steps[0].dueAt.slice(0, 10)})`);
  ok(prev.json.steps[0].ownerRoleFa === 'پرستار', 'مسئول فارسی‌شده است');
  /* 🔴 نباید بیفتد: «آزمون» چیزی بسازد. */
  ok(num('SELECT count(*) FROM reminders') === remBefore, 'هیچ یادآوری‌ای ساخته نشد');
  ok(num('SELECT count(*) FROM episodes') === epBefore, 'هیچ دوره‌ای ساخته نشد');
  const past = await send('/pathway/preview', 'POST', { steps, anchor: `${day(-30)}T00:00:00.000Z` });
  ok(past.json.steps.every((s) => !s.notifySends), 'با مبدأِ گذشته، صریح می‌گوید هیچ پیامی نمی‌رود');

  console.log('۳) شروعِ دوره — یادآوریِ واقعی ساخته می‌شود');
  const form = (await send('/forms', 'POST', { key: tag, title: `عملِ ${tag}`, scope: 'visit' })).json;
  if (form?.id) trash.forms.push(form.id);
  const vRes = await send('/visits', 'POST', {
    kind: tag, firstName: 'سحرِ', lastName: `اطلاع${tag}`, phone: '09120000961',
    opDate: new Date().toISOString(),
  });
  if (!vRes.json?.id) { console.error('مراجعه ساخته نشد:', vRes.status, vRes.json); process.exit(1); }
  const v = vRes.json;
  trash.visits.push(v.id);
  pid = num(`SELECT patient_id FROM visits WHERE id=${v.id}`);

  const startRes = await send('/pathway/episodes', 'POST', { patientId: pid, templateId: tpl });
  if (!startRes.json?.id) { console.error('دوره ساخته نشد:', startRes.status, startRes.json); process.exit(1); }
  const ep = startRes.json;
  ok(notices(ep.id) === 2, `برای دو گامِ پیام‌دار یادآوری ساخته شد (${notices(ep.id)})`);
  ok(notices(ep.id, 'pending') === 2, 'هر دو در انتظارِ ارسال‌اند');
  ok(sql(`SELECT text FROM reminders r JOIN episode_steps s ON s.reminder_id=r.id
          WHERE s.episode_id=${ep.id} AND s.key='soon'`) === `یادآوریِ آیندهٔ ${tag}`,
    'متنِ پیامک همان است که مدیر نوشت');
  ok(sql(`SELECT r.due_at::date::text FROM reminders r JOIN episode_steps s ON s.reminder_id=r.id
          WHERE s.episode_id=${ep.id} AND s.key='soon'`) === day(2), 'موعدِ پیام = موعدِ گام');
  ok(num(`SELECT count(*) FROM episode_steps WHERE episode_id=${ep.id} AND key='silent' AND reminder_id IS NOT NULL`) === 0,
    'گامِ بی‌پیام یادآوری نگرفت');

  console.log('۴) 🔴 مبدأِ گذشته رگبارِ پیامِ کهنه نمی‌سازد');
  const oldEp = (await send('/pathway/episodes', 'POST', {
    patientId: pid, templateId: tpl, anchor: `${day(-30)}T00:00:00.000Z`,
  })).json;
  ok(notices(oldEp.id) === 0, 'هیچ یادآوری‌ای برای موعدهای گذشته ساخته نشد');
  ok(oldEp.steps.length === 3, 'ولی خودِ گام‌ها سرِ جایشان‌اند — دوره‌ی گذشته هم سابقه است');

  console.log('۵) گامِ بسته‌شده یادآوریِ نفرستاده‌اش را باطل می‌کند');
  const soon = ep.steps.find((s) => s.key === 'soon');
  await send(`/pathway/steps/${soon.id}`, 'PATCH', { status: 'done' });
  ok(sql(`SELECT r.status FROM reminders r JOIN episode_steps s ON s.reminder_id=r.id
          WHERE s.id=${soon.id}`) === 'cancelled', 'یادآوریِ همان گام باطل شد');
  ok(notices(ep.id, 'pending') === 1, 'یادآوریِ گامِ دیگر دست‌نخورده ماند');

  console.log('۶) 🔴 یادآوریِ فرستاده‌شده باطل نمی‌شود');
  const later = ep.steps.find((s) => s.key === 'later');
  sql(`UPDATE reminders SET status='sent', sent_at=now()
       WHERE id=(SELECT reminder_id FROM episode_steps WHERE id=${later.id})`);
  await send(`/pathway/steps/${later.id}`, 'PATCH', { status: 'skipped' });
  ok(sql(`SELECT r.status FROM reminders r JOIN episode_steps s ON s.reminder_id=r.id
          WHERE s.id=${later.id}`) === 'sent',
    'پیامی که واقعاً رفته «باطل» نشد — دفترِ پیام‌ها راست می‌گوید');

  console.log('۷) 🔴 دورهٔ بسته‌شده فردا پیام نمی‌دهد');
  const ep2 = (await send('/pathway/episodes', 'POST', { patientId: pid, templateId: tpl })).json;
  ok(notices(ep2.id, 'pending') === 2, 'دورهٔ تازه دو یادآوریِ در انتظار دارد');
  await send(`/pathway/episodes/${ep2.id}/close`, 'POST', { status: 'cancelled' });
  ok(notices(ep2.id, 'pending') === 0, 'با لغوِ دوره همه باطل شدند');
  ok(notices(ep2.id, 'cancelled') === 2, 'و به‌شکلِ «لغوشده» در دفتر ماندند');

  console.log('۸) بیمارِ بی‌شماره شروعِ دوره را نمی‌شکند');
  const v2 = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بی', lastName: `شماره${tag}`, opDate: new Date().toISOString(),
  })).json;
  trash.visits.push(v2.id);
  const pid2 = num(`SELECT patient_id FROM visits WHERE id=${v2.id}`);
  trash.patients.push(pid2);
  const noPhone = await send('/pathway/episodes', 'POST', { patientId: pid2, templateId: tpl });
  ok(okStatus(noPhone.status), `دوره ساخته شد (${noPhone.status})`);
  ok(notices(noPhone.json.id) === 0, 'و بی‌سروصدا یادآوری نساخت');

  console.log('۹) اعتبارسنجیِ متنِ پیامک و «عدمِ پاسخ»');
  const tooLong = await send(`/pathway/templates/${tpl}/publish`, 'POST', {
    steps: [{ key: 'a', title: 'x', offsetDays: 0, notify: 'ب'.repeat(401) }],
  });
  ok(tooLong.status === 400, `متنِ بیش از ۴۰۰ نویسه رد شد (${tooLong.status})`);
  const badEsc = await send(`/pathway/templates/${tpl}/publish`, 'POST', {
    steps: [{ key: 'a', title: 'x', offsetDays: 0, escalateDays: -3 }],
  });
  ok(badEsc.status === 400, `«عدمِ پاسخ»ِ منفی رد شد (${badEsc.status})`);
  const blank = await send(`/pathway/templates/${tpl}/publish`, 'POST', {
    steps: [{ key: 'a', title: 'x', offsetDays: 0, notify: '   ' }],
  });
  ok(okStatus(blank.status), 'متنِ فقط‌فاصله پذیرفته شد');
  /* 🔴 نباید بیفتد: رشتهٔ تهی به‌عنوانِ «پیام دارد» ذخیره شود و بعداً پیامکِ خالی بفرستد. */
  ok(blank.json.steps[0].notify === undefined, 'و به‌شکلِ «بدونِ پیام» ذخیره شد، نه رشتهٔ تهی');
} finally {
  if (pid) sql(`DELETE FROM reminders WHERE patient_id=${pid}`);
  for (const p of trash.patients) sql(`DELETE FROM reminders WHERE patient_id=${p}`);
  if (pid) sql(`DELETE FROM episodes WHERE patient_id=${pid}`);
  for (const p of trash.patients) sql(`DELETE FROM episodes WHERE patient_id=${p}`);
  for (const id of trash.templates) sql(`DELETE FROM pathway_templates WHERE id=${id}`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
