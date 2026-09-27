/**
 * **«گزارشِ عمل بارگذاری نشده» در مطب** — گزارشِ مالک ۱۴۰۵/۰۷/۰۱: عملی با شرحِ عملِ
 * کامل در صفِ کارشناس «گزارشِ عمل هنوز بارگذاری نشده» گرفته بود (۱۷ کارِ دروغین).
 *
 * ریشه: آشکارساز فقط **فایلِ** دستهٔ `report` را می‌دید؛ در مطب گزارش همان شرحِ عملِ
 * نوشته‌شده (سندِ `op`) است.
 *
 *  باید بیفتد:
 *   - مطب، عملِ done بی‌شرح ← کار «شرحِ عمل هنوز نوشته نشده» برای پزشک (R1)
 *   - نوشتنِ شرح ← sweepِ بعدی کار را می‌بندد؛ کارهای دروغینِ قدیمی هم (R2)
 *  نباید بیفتد:
 *   - مطب، عملِ done با شرح ← کار (R3)
 *   - حوزهٔ شرکت: شرح جای فایلِ گزارشِ مانیتورینگ را بگیرد (R4) — و نامش «گزارشِ خدمت» است،
 *     نه «گزارشِ عمل» (مالک، ۱۴۰۵/۰۷/۰۵: شرکت عمل انجام نمی‌دهد، خدمتی حینِ عمل می‌دهد)
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';

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
const process_ = async () => (await send('/work/process', 'POST')).json;
const work = (visitId) => JSON.parse(sql(`SELECT coalesce((SELECT row_to_json(w) FROM work_items w WHERE idempotency_key='complete_report:visit:${visitId}')::text, 'null')`));

const tag = randomBytes(3).toString('hex');
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const trash = [];
let surgeon = null;
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

/** عملِ done دیروز — مستقیم در DB، تا به فرم و ستاره‌های هر حوزه وابسته نباشد. */
const mkDone = async (label) => {
  surgeon ??= (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `گزارش${tag}` })).json;
  const v = (await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'گزارشِ', lastName: `${label}${tag}`, opDate: yesterday, surgeonId: surgeon?.id, chiefComplaint: 'درد',
  })).json;
  if (!v?.id) throw new Error('مراجعه ساخته نشد: ' + JSON.stringify(v).slice(0, 160));
  trash.push(v.id);
  sql(`UPDATE visits SET kind='surgery', op_status='done', op_date='${yesterday}' WHERE id=${v.id}`);
  return v;
};

try {
  ok('سوییچ به مطب', (await send('/config/vertical', 'PATCH', { vertical: 'clinic' })).status === 200);
  /* DBِ تازهٔ CI فرمِ ویزیتِ مطب ندارد — مثلِ بقیهٔ سوییت‌ها، اگر نیست ساخته می‌شود. */
  if (!((await send('/forms/visit-kinds')).json ?? []).some((k) => (k.kind ?? k.key) === 'clinic')) {
    await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  }
  const bare = await mkDone('بی‌شرح');
  const written = await mkDone('باشرح');
  sql(`INSERT INTO clinical_notes (patient_id, visit_id, kind, body, created_at) VALUES (${written.patientId}, ${written.id}, 'op', 'شرحِ کاملِ عمل ${tag}', now())`);
  /* کارِ دروغینِ نسخهٔ قبل — همان که روی نصبِ مالک مانده بود. */
  sql(`INSERT INTO work_items (type, title, owner_role, patient_id, visit_id, ref_type, ref_id, idempotency_key, state, priority, updated_at)
       VALUES ('complete_report', 'گزارشِ عمل هنوز بارگذاری نشده', 'technician', ${written.patientId}, ${written.id}, 'visit', ${written.id}, 'complete_report:visit:${written.id}', 'open', 0, now())`);

  const p1 = await process_();
  const wb = work(bare.id);
  ok('R1 عملِ بی‌شرح ← کارِ پزشک با عنوانِ «شرحِ عمل»', wb?.state === 'open' && wb.owner_role === 'doctor' && wb.title === 'شرحِ عمل هنوز نوشته نشده',
    JSON.stringify(wb && { s: wb.state, r: wb.owner_role, t: wb.title }));
  ok('R2 کارِ دروغینِ قدیمی (شرح دارد) با همین sweep بسته شد', work(written.id)?.state === 'done' && (p1?.detected?.reportUploaded ?? 0) >= 1,
    JSON.stringify({ s: work(written.id)?.state, d: p1?.detected }));

  const rep = await send(`/theatre/visits/${bare.id}/report`, 'POST', { body: `شرحِ عمل از میز ${tag}` });
  ok('شرحِ عمل از میزِ اتاق ذخیره شد', rep.status < 300, String(rep.status));
  await process_();
  ok('R2 نوشتنِ شرح کار را بست', work(bare.id)?.state === 'done', work(bare.id)?.state);

  const fresh = await mkDone('تازه');
  sql(`INSERT INTO clinical_notes (patient_id, visit_id, kind, body, created_at) VALUES (${fresh.patientId}, ${fresh.id}, 'op', 'شرح ${tag}', now())`);
  await process_();
  ok('R3 **نباید بیفتد:** عملِ باشرح در مطب کار بگیرد', work(fresh.id) === null, JSON.stringify(work(fresh.id)));

  const other = vertical0 === 'clinic' ? 'ionm' : vertical0;
  await send('/config/vertical', 'PATCH', { vertical: other });
  const co = await mkDone('شرکت');
  sql(`INSERT INTO clinical_notes (patient_id, visit_id, kind, body, created_at) VALUES (${co.patientId}, ${co.id}, 'op', 'شرح ${tag}', now())`);
  await process_();
  const wc = work(co.id);
  ok(`R4 **نباید بیفتد:** در ${other} شرح جای فایلِ گزارش را بگیرد`, wc?.state === 'open' && wc.owner_role === 'technician' && wc.title === 'گزارشِ خدمت هنوز بارگذاری نشده',
    JSON.stringify(wc && { s: wc.state, r: wc.owner_role, t: wc.title }));
} catch (e) {
  ok(`اجرا متوقف شد: ${e?.message ?? e}`, false);
} finally {
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  ok('برگشت به حوزهٔ قبلی', back.status === 200, String(back.status));
  for (const id of trash) {
    try { sql(`DELETE FROM work_items WHERE visit_id=${id}`); } catch { /* */ }
    await send(`/visits/${id}`, 'DELETE').catch(() => {});
  }
}

console.log(`\n${pass} سبز · ${fails.length} قرمز`);
if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
