/**
 * W2.2 — تولیدکننده‌های کار (emit در سرویس‌ها + آشکارسازِ حالت‌های بیات):
 * - پاسخِ سفارشِ بالینی ← رویدادِ order.answered با refِ سفارش ← کارِ «بررسیِ نتیجه» برای پزشک
 *   («نباید بیفتد»: نامهٔ ارجاع پاسخ نمی‌گیرد و رویدادی نمی‌سازد)
 * - نوبت: noshow ← «تماس با غایب»؛ شروعِ ویزیت آن را می‌بندد
 * - عملِ جراحیِ گذشتهٔ بی‌وضعیت ← آشکارساز ← «وضعیتِ عمل ثبت نشده» به نامِ کارشناس؛ done می‌بندد
 *   («نباید بیفتد»: sweepِ دوباره رویدادِ دوم نمی‌سازد)
 * - عملِ done بدونِ گزارش ← «گزارش بارگذاری نشده»؛ سندِ گزارش از هر مسیری می‌بندد
 * - حوالهٔ بازِ عملِ گذشته ← «تأییدِ مصرف»؛ لغوِ عمل می‌بندد
 * - پیامکِ نرفته ← sms.failed ← «ارسالِ دوباره»؛ ارسالِ موفق می‌بندد («نباید بیفتد»: stub رویداد نمی‌سازد)
 * - دعوتِ فرمِ پیگیریِ ۳ روز بی‌پاسخ ← «تماس با بیمار»؛ پاسخِ بیمار می‌بندد و «بررسیِ پاسخ» می‌سازد
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد', login); process.exit(1); }
const me = login.user?.id;
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b, auth = true) => fetch(API + p, { method: m, headers: auth ? A : { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'wp' + randomBytes(3).toString('hex');
const trash = { visits: [], forms: [], appts: [], transfers: [], reminders: [], pid: null };
const process_ = async () => (await send('/work/process', 'POST')).json;
const work = (type, ref) => JSON.parse(sql(`SELECT coalesce((SELECT row_to_json(w) FROM work_items w WHERE idempotency_key='${type}:${ref}')::text, 'null')`));
const events = (type, where) => num(`SELECT count(*) FROM domain_events WHERE type='${type}' AND ${where}`);
const today = new Date().toISOString().slice(0, 10);

try {
  /* فرمِ موقتِ ویزیت بدونِ فیلدِ اجباری (الگوی w2-1) */
  const form = (await send('/forms', 'POST', { key: tag, title: `ویزیتِ ${tag}`, scope: 'visit' })).json;
  trash.forms.push(form.id);
  const visit = (await send('/visits', 'POST', { kind: tag, firstName: 'بیمارِ', lastName: `تولید ${tag}`, phone: '09120000913', opDate: new Date().toISOString() })).json;
  if (!visit?.id) { console.error('مراجعه ساخته نشد', visit); process.exit(1); }
  trash.visits.push(visit.id);
  const pid = trash.pid = num(`SELECT patient_id FROM visits WHERE id=${visit.id}`);

  console.log('۱) سفارشِ بالینی: پاسخِ بیمار ← بررسیِ نتیجه');
  const ord = (await send('/orders/imaging', 'POST', { patientId: pid, visitId: visit.id, modalities: ['MRI'], region: 'کمر' })).json;
  const sent = (await send(`/orders/imaging/${ord.id}/send`, 'POST')).json;
  const token = String(sent?.url ?? '').split('/o/')[1];
  ok(ord?.id && token, `سفارش ساخته و فرستاده شد (#${ord?.id})`);
  const ans = await send(`/public/order/${token}/answer`, 'POST', { text: 'گزارشِ MRI ضمیمه شد' }, false);
  ok(ans.status < 300, 'بیمار پاسخ داد');
  ok(events('order.answered', `ref_type='imaging_order' AND ref_id=${ord.id} AND patient_id=${pid}`) === 1, 'رویدادِ order.answered با refِ سفارش و بیمار ثبت شد');
  await process_();
  const w1 = work('review_result', `imaging_order:${ord.id}`);
  ok(w1?.state === 'open' && w1.owner_role === 'doctor' && w1.patient_id === pid, 'کارِ «بررسیِ نتیجه» برای پزشک باز شد');
  ok(String(w1?.title).includes('تصویربرداری'), 'عنوان نوعِ سفارش را می‌گوید');
  const rf = (await send('/orders/referral', 'POST', { patientId: pid, specialty: 'ارتوپدی' })).json;
  const rfSent = (await send(`/orders/referral/${rf.id}/send`, 'POST')).json;
  const rfTok = String(rfSent?.url ?? '').split('/o/')[1];
  const rfAns = await send(`/public/order/${rfTok}/answer`, 'POST', { text: 'x' }, false);
  ok(rfAns.status === 400 && events('order.answered', `ref_type='referral_order' AND ref_id=${rf.id}`) === 0, '**نباید بیفتد:** نامهٔ ارجاع پاسخ نمی‌گیرد و رویدادی نمی‌سازد');

  console.log('\n۲) نوبت: نیامد ← تماس؛ شروعِ ویزیت ← بسته');
  /* نوبتِ قطعی مستقیم در جدول — walkIn به تقویمِ کاریِ باز نیاز دارد که به این بسته ربطی ندارد. */
  const ap = { id: num(`INSERT INTO appointments(patient_id, date, status) VALUES (${pid}, '${today}', 'confirmed') RETURNING id`) };
  trash.appts.push(ap.id);
  ok(ap.id > 0, `نوبتِ قطعی ساخته شد (#${ap.id})`);
  const ns = await send(`/appointments/${ap.id}/status`, 'POST', { status: 'noshow' });
  ok(ns.status < 300 && events('appointment.noshow', `appointment_id=${ap.id} AND patient_id=${pid}`) === 1, 'رویدادِ appointment.noshow ثبت شد');
  await process_();
  const w2 = work('call_patient', `appointment:${ap.id}`);
  ok(w2?.state === 'open' && w2.owner_role === 'secretary' && w2.priority === 2, 'کارِ «تماس با بیمارِ غایب» برای منشی باز شد');
  await send(`/appointments/${ap.id}/status`, 'POST', { status: 'confirmed' });
  const sv = (await send(`/appointments/${ap.id}/visit`, 'POST')).json;
  if (sv?.visitId) trash.visits.push(sv.visitId);
  ok(sv?.visitId && events('appointment.started', `appointment_id=${ap.id} AND visit_id=${sv.visitId}`) === 1, 'شروعِ ویزیت رویدادِ appointment.started با مراجعهٔ تازه داد');
  await process_();
  ok(work('call_patient', `appointment:${ap.id}`)?.state === 'done', 'شروعِ ویزیت کارِ تماس را بست');

  console.log('\n۳) عملِ بی‌وضعیت ← تأییدِ کارشناس؛ done ← بسته');
  sql(`UPDATE visits SET kind='surgery', op_date=now()-interval '3 days', op_status='pending', tech_id=${me} WHERE id=${visit.id}`);
  const p3 = await process_();
  ok((p3?.detected?.unconfirmed ?? 0) >= 1, `آشکارساز عملِ بی‌وضعیت را دید (${p3?.detected?.unconfirmed})`);
  const w3 = work('confirm_surgery_done', `visit:${visit.id}`);
  ok(w3?.state === 'open' && w3.owner_role === 'technician' && w3.owner_account_id === me, 'کارِ «وضعیتِ عمل ثبت نشده» به نامِ کارشناسِ عمل باز شد');
  await process_();
  ok(events('visit.unconfirmed', `visit_id=${visit.id}`) === 1, '**نباید بیفتد:** sweepِ دوباره رویدادِ دوم نمی‌سازد (هفته‌ای یک‌بار)');
  const dn = await send(`/visits/${visit.id}/status`, 'PATCH', { opStatus: 'done' });
  ok(dn.status < 300 && events('visit.done', `visit_id=${visit.id}`) === 1, 'رویدادِ visit.done ثبت شد');
  await send(`/visits/${visit.id}/status`, 'PATCH', { opStatus: 'done' });
  ok(events('visit.done', `visit_id=${visit.id}`) === 1, '**نباید بیفتد:** ثبتِ همان وضعیت رویدادِ تکراری نمی‌سازد');
  await process_();
  ok(work('confirm_surgery_done', `visit:${visit.id}`)?.state === 'done', 'done کارِ تأیید را بست');

  console.log('\n۴) گزارشِ عمل');
  const w4 = work('complete_report', `visit:${visit.id}`);
  ok(w4?.state === 'open' && w4.owner_role === 'technician' && w4.owner_account_id === me, 'عملِ done بدونِ گزارش ← کارِ «گزارش بارگذاری نشده» به نامِ کارشناس');
  sql(`INSERT INTO documents(patient_id, visit_id, category, title, file_name, mime_type, size, sha256) VALUES (${pid}, ${visit.id}, 'report', 'گزارش', 'r.pdf', 'application/pdf', 1, '${tag}')`);
  const p4 = await process_();
  ok((p4?.detected?.reportUploaded ?? 0) >= 1 && work('complete_report', `visit:${visit.id}`)?.state === 'done', 'سندِ گزارش از هر مسیری (آشکارسازِ بستن) کار را بست');
  await process_();
  ok(work('complete_report', `visit:${visit.id}`)?.state === 'done', '**نباید بیفتد:** sweepِ بعدی کارِ بسته را دوباره باز نمی‌کند');

  console.log('\n۵) پیامک: شکست ← ارسالِ دوباره؛ موفق ← بسته');
  const req = createRequire(import.meta.url);
  const { PrismaClient } = req(path.join(ROOT, 'server/node_modules/@prisma/client'));
  const { sendReminders } = req(path.join(ROOT, 'server/dist/reminders/send-reminders.js'));
  const prisma = new PrismaClient({ datasources: { db: { url: DB } } });
  const remId = num(`INSERT INTO reminders(channel, kind, due_at, phone, text, status, patient_id, visit_id) VALUES ('sms', 'notice', now()-interval '1 minute', '09120000913', 'تست ${tag}', 'pending', ${pid}, ${visit.id}) RETURNING id`);
  trash.reminders.push(remId);
  try {
    await sendReminders(prisma, { send: async () => { throw new Error('boom ' + tag); } }, [remId]);
    ok(sql(`SELECT status FROM reminders WHERE id=${remId}`) === 'failed' && events('sms.failed', `ref_type='reminder' AND ref_id=${remId} AND patient_id=${pid}`) === 1, 'شکستِ ارسال ← رویدادِ sms.failed با refِ یادآوری');
    await process_();
    const w5 = work('resend_sms', `reminder:${remId}`);
    ok(w5?.state === 'open' && w5.owner_role === 'secretary' && String(w5.note).includes('boom'), 'کارِ «ارسالِ دوباره» برای منشی با متنِ خطا باز شد');
    sql(`UPDATE reminders SET status='pending' WHERE id=${remId}`);
    await sendReminders(prisma, { send: async () => ({ sent: false, stub: true }) }, [remId]);
    ok(events('sms.sent', `ref_id=${remId}`) === 0 && events('sms.failed', `ref_id=${remId}`) === 1, '**نباید بیفتد:** ارسالِ آزمایشی (stub) رویدادی نمی‌سازد');
    sql(`UPDATE reminders SET status='pending' WHERE id=${remId}`);
    await sendReminders(prisma, { send: async () => ({ sent: true, stub: false, providerId: 'p1' }) }, [remId]);
    ok(events('sms.sent', `ref_type='reminder' AND ref_id=${remId}`) === 1, 'ارسالِ موفق ← رویدادِ sms.sent');
    await process_();
    ok(work('resend_sms', `reminder:${remId}`)?.state === 'done', 'ارسالِ موفق کارِ «ارسالِ دوباره» را بست');
  } finally { await prisma.$disconnect().catch(() => undefined); }

  console.log('\n۶) فرمِ پیگیری: بی‌پاسخ ← تماس؛ پاسخ ← بررسی');
  const inv = (await send(`/visits/${visit.id}/survey`, 'POST')).json;
  const invId = num(`SELECT id FROM survey_invites WHERE patient_id=${pid} ORDER BY id DESC LIMIT 1`);
  const invTok = sql(`SELECT token FROM survey_invites WHERE id=${invId}`);
  ok(invId > 0 && invTok, `دعوتِ فرم فرستاده شد (#${invId})`);
  sql(`UPDATE survey_invites SET sent_at=now()-interval '4 days' WHERE id=${invId}`);
  const p6 = await process_();
  const w6 = work('follow_up_unanswered', `survey_invite:${invId}`);
  ok((p6?.detected?.formUnanswered ?? 0) >= 1 && w6?.state === 'open' && w6.owner_role === 'secretary', 'دعوتِ ۳ روز بی‌پاسخ ← کارِ «تماس با بیمار» برای منشی');
  const sub = await send(`/public/survey/${invTok}`, 'POST', { answers: { overall: 5 } }, false);
  ok(sub.status < 300 && events('form.answered', `ref_type='survey_invite' AND ref_id=${invId}`) === 1, 'پاسخِ بیمار ← رویدادِ form.answered');
  await process_();
  ok(work('follow_up_unanswered', `survey_invite:${invId}`)?.state === 'done', 'پاسخ کارِ تماس را بست');
  ok(work('review_form', `survey_invite:${invId}`)?.state === 'open' && work('review_form', `survey_invite:${invId}`)?.owner_role === 'doctor', '… و کارِ «بررسیِ پاسخ» برای پزشک باز شد');

  console.log('\n۷) مصرفِ سرِ عمل: حوالهٔ باز ← تأیید؛ لغوِ عمل ← بسته');
  const trId = num(`INSERT INTO stock_transfers(code, from_location, to_location, status, visit_id, sent_at) VALUES ('HV-${tag}', 'انبار', 'بیمارستان', 'sent', ${visit.id}, now()-interval '3 days') RETURNING id`);
  trash.transfers.push(trId);
  const p7 = await process_();
  const w7 = work('confirm_usage', `visit:${visit.id}`);
  ok((p7?.detected?.usageUnconfirmed ?? 0) >= 1 && w7?.state === 'open' && w7.owner_role === 'technician' && w7.owner_account_id === me, 'حوالهٔ بازِ عملِ گذشته ← کارِ «تأییدِ مصرف» به نامِ کارشناس');
  await send(`/visits/${visit.id}/status`, 'PATCH', { opStatus: 'cancelled', cancelReason: 'other' });
  await process_();
  ok(events('visit.cancelled', `visit_id=${visit.id}`) === 1 && work('confirm_usage', `visit:${visit.id}`)?.state === 'done', 'لغوِ عمل کارِ «تأییدِ مصرف» را بست');
} finally {
  const pid = trash.pid ?? -1;
  sql(`DELETE FROM stock_transfers WHERE id IN (${trash.transfers.join(',') || -1})`);
  sql(`DELETE FROM documents WHERE visit_id IN (${trash.visits.join(',') || -1})`);
  sql(`DELETE FROM survey_invites WHERE patient_id=${pid}`);
  sql(`DELETE FROM reminders WHERE patient_id=${pid}`);
  sql(`DELETE FROM appointments WHERE id IN (${trash.appts.join(',') || -1})`);
  for (const k of ['imaging_orders', 'referral_orders']) sql(`DELETE FROM ${k} WHERE patient_id=${pid}`);
  for (const v of trash.visits) await send(`/visits/${v}`, 'DELETE').catch(() => {});
  for (const f of trash.forms) await send(`/forms/${f}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM work_items WHERE patient_id=${pid}`);
  sql(`DELETE FROM domain_events WHERE patient_id=${pid}`);
}
console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
