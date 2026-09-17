/** Intake producers: real API/Prisma/outbox/processor, isolated local DB only.
 * E2E_API=http://localhost:3101/api E2E_DB=postgresql://... node scripts/e2e/w2-2b-intake-events.mjs
 * Only deliberate payment/outbox failures use injected dependencies.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const cls = (file, name) => require('./dist/' + file)[name];
const { processDomainEvents } = require('./dist/work/work-processor');
const API = process.env.E2E_API ?? 'http://localhost:3101/api', DB = process.env.E2E_DB;
if (!DB || ![API, DB].every(u => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلیِ جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'intakeEvents' + randomBytes(4).toString('hex');
const formIds = [], subIds = [], apptIds = [];
let token = '', passed = 0, patientId, surgeonId, surgeonPersonId;
const ok = (condition, label) => { assert.ok(condition, label); passed++; console.log('PASS ' + label); };
async function api(path, body, auth = true) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json',
    ...(auth && token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body ?? {}) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function sub(formId, status = 'pending_fill', amount = 0) {
  const s = await db.intakeSubmission.create({ data: { token: tag + subIds.length, patientId, formId, status, amount,
    expiresAt: new Date(Date.now() + 86400000), data: { note: 'پاسخ بیمار' } } });
  subIds.push(s.id); return s;
}
const intakeEvents = id => db.domainEvent.findMany({ where: { refType: 'intake_submission', refId: id }, orderBy: { id: 'asc' } });
const work = (type, ref, id) => db.workItem.findUnique({ where: { idempotencyKey: `${type}:${ref}:${id}` } });
try {
  const login = await api('/auth/login', { identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' });
  token = login.data?.accessToken; assert.ok(token, 'ورود ناموفق');
  patientId = (await db.patient.create({ data: { code: tag, firstName: 'بیمار', lastName: 'رویداد' } })).id;
  const surgeon = await db.surgeon.create({ data: { active: true, person: { create: { firstName: 'پزشک', lastName: 'آزمون' } } } });
  surgeonId = surgeon.id; surgeonPersonId = surgeon.personId;
  const record = await db.formDef.create({ data: { key: tag + 'record', title: 'پاسخ پرونده', scope: 'record',
    fields: { create: { key: 'note', label: 'شرح', type: 'text' } } } }); formIds.push(record.id);
  const clinic = await db.formDef.create({ data: { key: 'visit.' + tag, visitKind: tag, title: 'ویزیت آزمون', scope: 'visit',
    fields: { create: { key: 'note', label: 'شرح', type: 'text' } } } }); formIds.push(clinic.id);
  const events = new (cls('work/events.service', 'EventsService'))(db);
  const pending = await sub(clinic.id);
  const filled = await api(`/public/intake/form/${pending.token}/fill`, { values: { note: 'ثبت نهایی' } }, false);
  assert.equal(filled.status, 201, JSON.stringify(filled.data));
  ok((await intakeEvents(pending.id)).some(e => e.type === 'intake.submitted' && e.patientId === patientId), 'fill رویداد submitted با ref ثابت می‌نویسد');
  const held = await db.appointment.create({ data: { patientId, submissionId: pending.id, status: 'held', date: new Date() } }); apptIds.push(held.id);
  await events.emit({ type: 'appointment.held', appointmentId: held.id, patientId });
  await processDomainEvents(db);
  ok((await work('approve_intake', 'intake_submission', pending.id))?.state === 'open', 'submitted کار بررسی ثبت‌نام را باز می‌کند');
  ok((await work('confirm_appointment', 'appointment', held.id))?.state === 'open', 'کار تأیید نوبت از قبل باز است');
  const approved = await api(`/intake/submissions/${pending.id}/approve`, { surgeonId });
  assert.equal(approved.status, 201, JSON.stringify(approved.data));
  const approvedEvent = (await intakeEvents(pending.id)).find(e => e.type === 'intake.approved');
  ok(approvedEvent?.visitId === approved.data.visitId, 'approve ارجاع ثبت‌نام را حفظ و مراجعه را همراهش ثبت می‌کند');
  ok(await db.domainEvent.count({ where: { type: 'appointment.confirmed', appointmentId: held.id, visitId: approved.data.visitId } }) === 1,
    'تأیید ثبت‌نام، confirmed را با همان appointmentId می‌نویسد');
  await processDomainEvents(db);
  ok((await work('approve_intake', 'intake_submission', pending.id))?.state === 'done', 'approved کارِ همان ثبت‌نام را می‌بندد');
  ok((await work('confirm_appointment', 'appointment', held.id))?.state === 'done', 'confirmed کارِ held را پیش از شروع ویزیت می‌بندد');
  await api(`/intake/submissions/${pending.id}/approve`, { surgeonId });
  ok((await intakeEvents(pending.id)).filter(e => e.type === 'intake.approved').length === 1, 'تکرار نامعتبر تأیید رویداد دوم ندارد');

  const auto = await sub(record.id);
  await api(`/public/intake/form/${auto.token}/fill`, { values: { note: 'رایگان' } }, false);
  const automatic = await intakeEvents(auto.id);
  ok(automatic.map(e => e.type).join(',') === 'intake.submitted,intake.approved' && automatic.every(e => e.actorId === null),
    'تأیید خودکار نیز submitted/approved دارد و امضای انسانی جعل نمی‌کند');
  await processDomainEvents(db);
  ok((await work('approve_intake', 'intake_submission', auto.id))?.state === 'done', 'فرم رایگان کارِ بررسیِ باز باقی نمی‌گذارد');

  const rejected = await sub(clinic.id, 'pending_approval');
  const cancel = await db.appointment.create({ data: { patientId, submissionId: rejected.id, status: 'held', date: new Date() } }); apptIds.push(cancel.id);
  await events.emit({ type: 'intake.submitted', refType: 'intake_submission', refId: rejected.id, patientId });
  await events.emit({ type: 'appointment.held', appointmentId: cancel.id, patientId });
  await processDomainEvents(db);
  ok((await api(`/intake/submissions/${rejected.id}/reject`, { note: 'نیاز به ثبت تازه' })).status === 201, 'رد ثبت‌نام موفق است');
  ok((await intakeEvents(rejected.id)).some(e => e.type === 'intake.rejected'), 'rejected همان ref ثبت‌نام را نگه می‌دارد');
  await processDomainEvents(db);
  ok((await work('approve_intake', 'intake_submission', rejected.id))?.state === 'done'
    && (await work('confirm_appointment', 'appointment', cancel.id))?.state === 'done', 'رد ثبت‌نام، کار بررسی و کار نوبت لغوشده را می‌بندد');

  const audit = new (cls('audit/audit.service', 'AuditService'))(db);
  const forms = new (cls('patients/forms.service', 'FormsService'))(db, { vertical: async () => 'clinic' });
  const reminders = { syncNextVisit: async () => {}, syncAppointment: async () => {} };
  const patients = new (cls('patients/patients.service', 'PatientsService'))(db, audit, forms, reminders, events);
  const failingBilling = { assertIntakePayment: async () => {}, addPayment: async () => { throw new Error('fixture payment failure'); } };
  const makeIntake = emitter => new (cls('patients/intake.service', 'IntakeService'))(db, audit, patients, {}, failingBilling, {}, forms, {},
    { require: () => ({ hostname: 'localhost' }) }, {}, { sendSms: async () => {} }, reminders, {}, emitter);
  const actor = await db.account.findUnique({ where: { username: process.env.E2E_USER ?? 'admin' } });
  const partial = await sub(clinic.id, 'pending_approval', 100);
  await assert.rejects(() => makeIntake(events).approve(partial.id, {}, actor), /fixture payment failure/);
  const saved = await db.intakeSubmission.findUnique({ where: { id: partial.id } });
  const failure = (await intakeEvents(partial.id)).find(e => e.type === 'intake.approve_failed');
  ok(saved.visitId && failure?.visitId === saved.visitId, 'شکست پرداخت پس از نوشتن، رویداد نیمه‌کاره با همان مراجعه دارد');
  await processDomainEvents(db);
  ok((await work('repair_intake', 'intake_submission', partial.id))?.state === 'open', 'شکست نیمه‌کاره کارِ رسیدگی مدیر را باز می‌کند');
  const invalid = await sub(clinic.id);
  await assert.rejects(() => makeIntake(events).approve(invalid.id, {}, actor));
  ok((await intakeEvents(invalid.id)).length === 0, 'رد اعتبارسنجی پیش از نوشتن رویداد نیمه‌کاره نمی‌سازد');
  ok((await api(`/intake/submissions/${invalid.id}/approve`, {}, false)).status === 401, 'تأیید بدون احراز رد می‌شود');

  const rollback = await sub(record.id);
  const badOutbox = { emit: async () => { throw new Error('fixture outbox failure'); } };
  await assert.rejects(() => makeIntake(badOutbox).fill(rollback.token, { values: { note: 'نباید ذخیره شود' } }), /fixture outbox failure/);
  const untouched = await db.intakeSubmission.findUnique({ where: { id: rollback.id } });
  ok(untouched.status === 'pending_fill' && untouched.data.note === 'پاسخ بیمار', 'خطای outbox در fill وضعیت و پاسخ را rollback می‌کند');
  console.log(`W2.2-b: ${passed} passed`);
} catch (error) { console.error('Intake event test failed:', error); throw error; }
finally {
  if (patientId) {
    const visits = await db.visit.findMany({ where: { patientId }, select: { id: true } });
    await db.workItem.deleteMany({ where: { patientId } });
    await db.domainEvent.deleteMany({ where: { patientId } });
    await db.reminder.deleteMany({ where: { patientId } });
    await db.appointment.deleteMany({ where: { patientId } });
    await db.intakeSubmission.deleteMany({ where: { id: { in: subIds } } });
    await db.charge.deleteMany({ where: { visitId: { in: visits.map(v => v.id) } } });
    await db.auditEvent.deleteMany({ where: { OR: [
      { entityType: 'intake_submission', entityId: { in: subIds.map(String) } },
      { entityType: 'appointment', entityId: { in: apptIds.map(String) } },
      { entityType: 'visit', entityId: { in: visits.map(v => String(v.id)) } },
    ] } });
    await db.visit.deleteMany({ where: { patientId } });
    await db.patient.delete({ where: { id: patientId } });
  }
  await db.formDef.deleteMany({ where: { id: { in: formIds } } });
  if (surgeonId) await db.surgeon.delete({ where: { id: surgeonId } });
  if (surgeonPersonId) await db.person.delete({ where: { id: surgeonPersonId } });
  await db.$disconnect();
}
