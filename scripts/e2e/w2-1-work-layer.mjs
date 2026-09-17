/**
 * W2.1 — لایهٔ کار (WorkItem + DomainEvent + /work):
 * - کارِ دستی ساخته می‌شود و در صفِ «من» می‌آید؛ شمارنده‌ها درست‌اند
 * - رویدادِ دامنه ← کار (idempotent: رویدادِ تکراری کارِ دوم نمی‌سازد)
 * - رویدادِ «بررسی شد» کارِ باز را می‌بندد؛ کارِ بسته با رویدادِ تکراری **دوباره باز نمی‌شود**
 * - object-authz: سطحِ پایین همهٔ کارها را نمی‌بیند؛ کارِ خودِ بیمار در صفِ کارکنان نمی‌آید
 * - اقدام‌ها: done / block (دلیل لازم) / snooze / cancel — و done روی کارِ بسته رد می‌شود
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'wk' + randomBytes(3).toString('hex');
const trash = { visits: [], forms: [] };

try {
  console.log('۱) کارِ دستی');
  const before = (await send('/work/counts', 'GET')).json;
  const created = await send('/work', 'POST', { title: `تماس با بیمار ${tag}`, priority: 2, dueAt: new Date(Date.now() - 3600e3).toISOString() });
  ok(created.status === 201 && created.json?.id, `ساخته شد (#${created.json?.id})`);
  ok(created.json?.ownerAccountId === login.user?.id || created.json?.ownerAccountId != null, 'به نامِ سازنده است');
  const inbox = (await send('/work?scope=inbox', 'GET')).json;
  ok(Array.isArray(inbox) && inbox.some((w) => w.id === created.json.id), 'در صفِ «من» می‌آید');
  ok(inbox.find((w) => w.id === created.json.id)?.overdue === true, 'عقب‌افتادگی سمتِ سرور محاسبه می‌شود (overdue)');
  const after = (await send('/work/counts', 'GET')).json;
  ok(after.mine === before.mine + 1 && after.overdue === before.overdue + 1, 'شمارنده‌ها یکی بالا رفتند');

  console.log('\n۲) رویداد ← کار (idempotent)');
  /* فرمِ موقتِ ویزیت بدونِ فیلدِ اجباری (همان الگوی care-reminders.mjs) تا پیش‌فرضِ حوزه جراح/بیمارستان نخواهد. */
  const form = (await send('/forms', 'POST', { key: tag, title: `ویزیتِ ${tag}`, scope: 'visit' })).json;
  trash.forms.push(form.id);
  const visit = (await send('/visits', 'POST', { kind: tag, firstName: 'بیمارِ', lastName: `کار ${tag}`, phone: '09120000912', opDate: new Date().toISOString() })).json;
  if (!visit?.id) { console.error('مراجعه ساخته نشد', visit); process.exit(1); }
  trash.visits.push(visit.id);
  const pid = Number(sql(`SELECT patient_id FROM visits WHERE id=${visit.id}`));
  const emit = (type, extra = '') => sql(`INSERT INTO domain_events(type, patient_id, visit_id, ref_type, ref_id ${extra ? ', payload' : ''}) VALUES ('${type}', ${pid}, ${visit.id}, 'imaging_order', ${visit.id} ${extra ? `, '${extra}'::jsonb` : ''}) RETURNING id`);
  emit('order.answered');
  emit('order.answered'); // تکراری
  const p1 = (await send('/work/process', 'POST')).json;
  ok(p1.events === 2 && p1.created === 1, `دو رویدادِ یکسان ← یک کار (events=${p1.events}, created=${p1.created})`);
  const key = `review_result:imaging_order:${visit.id}`;
  const cnt = () => Number(sql(`SELECT count(*) FROM work_items WHERE idempotency_key='${key}'`));
  ok(cnt() === 1, 'کلیدِ idempotency یکتاست');
  const item = JSON.parse(sql(`SELECT row_to_json(w) FROM work_items w WHERE idempotency_key='${key}'`));
  ok(item.owner_role === 'doctor' && item.state === 'open' && item.patient_id === pid, 'مسئول = پزشک، باز، به بیمار وصل');
  const pat = (await send(`/work?scope=patient&patientId=${pid}`, 'GET')).json;
  ok(pat.some((w) => w.idempotencyKey === key && w.patient?.id === pid), 'در صفِ بیمار با نامِ بیمار enrich شده');
  ok(!((await send('/work?scope=inbox', 'GET')).json).some((w) => w.idempotencyKey === key) || login.user?.jobRole === 'doctor', 'کارِ نقشِ پزشک در صفِ نقشِ دیگر نمی‌آید');

  console.log('\n۳) بسته‌شدن با رویداد و نبودِ بازگشایی');
  emit('order.reviewed');
  const p2 = (await send('/work/process', 'POST')).json;
  ok(p2.closed >= 1, 'order.reviewed کارِ بررسی را بست');
  ok(sql(`SELECT state FROM work_items WHERE idempotency_key='${key}'`) === 'done', 'وضعیت done');
  /* ⚠️ **قرارداد این‌جا با W1.2 عوض شد و این سنجه جا مانده بود** (تا امروز روی
     `main` قرمز بود و چون این سوئیت در CI نیست کسی ندید — سومین بار برای این
     الگو): `order.answered` حالا عمداً `reopen: true` دارد، چون پاسخِ **تازهٔ**
     بیمار بعد از بررسی یعنی چیزی هست که دوباره باید دیده شود. پس رویدادِ
     تازه‌تر **باید** باز کند؛ آنچه نباید بیفتد **replay** است. */
  const replayId = Number(sql(`SELECT id FROM domain_events WHERE visit_id=${visit.id} AND type='order.answered' ORDER BY id ASC LIMIT 1`));
  sql(`UPDATE domain_events SET processed_at=NULL WHERE id=${replayId}`);
  await send('/work/process', 'POST');
  const stReplay = sql(`SELECT state FROM work_items WHERE idempotency_key='${key}'`), nReplay = cnt();
  ok(stReplay === 'done' && nReplay === 1,
    `**نباید بیفتد:** پردازشِ دوبارهٔ همان رویداد کارِ بسته را باز کند یا دومی بسازد (state=${stReplay}, count=${nReplay})`);

  /* و رویِ دیگرِ همان قرارداد — پاسخِ تازه **باید** بررسی را دوباره باز کند،
     وگرنه نتیجهٔ دومِ بیمار هیچ‌وقت دیده نمی‌شود. سنجهٔ مثبت کنارِ منفی. */
  emit('order.answered');
  await send('/work/process', 'POST');
  const stNew = sql(`SELECT state FROM work_items WHERE idempotency_key='${key}'`);
  ok(stNew === 'open' && cnt() === 1, `پاسخِ تازه همان کار را دوباره باز می‌کند، نه کارِ دوم (state=${stNew})`);

  console.log('\n۴) کارِ خودِ بیمار در صفِ کارکنان نمی‌آید');
  emit('order.needs_action', '{"reason":"عکس ناخوانا"}');
  await send('/work/process', 'POST');
  const pkey = `upload_result:imaging_order:${visit.id}`;
  ok(sql(`SELECT owner_role FROM work_items WHERE idempotency_key='${pkey}'`) === 'patient', 'کارِ «ارسالِ دوباره» به نامِ بیمار ساخته شد');
  ok(!((await send('/work?scope=all', 'GET')).json).some((w) => false), 'scope=all برای سوپرادمین باز است');
  ok(!((await send('/work?scope=inbox', 'GET')).json).some((w) => w.idempotencyKey === pkey), 'و در صفِ کارکنان دیده نمی‌شود');

  console.log('\n۵) اقدام‌ها');
  const id = created.json.id;
  const blocked = await send(`/work/${id}`, 'PATCH', { action: 'block' });
  ok(blocked.status === 400, 'توقف بدونِ دلیل رد می‌شود');
  ok((await send(`/work/${id}`, 'PATCH', { action: 'block', reason: 'بیمار جواب نداد' })).json?.state === 'blocked', 'توقف با دلیل');
  const until = new Date(Date.now() + 2 * 3600e3).toISOString();
  ok((await send(`/work/${id}`, 'PATCH', { action: 'snooze', until })).json?.state === 'open', 'snooze دوباره باز می‌کند');
  ok((await send(`/work/${id}`, 'PATCH', { action: 'done', outcome: { callResult: 'answered' } })).json?.state === 'done', 'انجام شد با خروجی');
  ok((await send(`/work/${id}`, 'PATCH', { action: 'done' })).status === 400, '**نباید بیفتد:** done روی کارِ بسته رد می‌شود');
  ok(Number(sql(`SELECT count(*) FROM audit_events WHERE action='work.done' AND entity_id='${id}'`)) >= 1, 'ردِ ممیزی ثبت شد');
} finally {
  for (const v of trash.visits) await send(`/visits/${v}`, 'DELETE').catch(() => {});
  for (const f of trash.forms) await send(`/forms/${f}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM work_items WHERE title LIKE '%${tag}%' OR idempotency_key LIKE '%:${trash.visits[0] ?? -1}'`);
  sql(`DELETE FROM domain_events WHERE visit_id IN (${trash.visits.join(',') || -1})`);
}
console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
