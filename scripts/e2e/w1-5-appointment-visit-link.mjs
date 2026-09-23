/** W1.5: real HTTP/Prisma regression tests against an isolated local database.
 * E2E_API=http://localhost:3101/api E2E_DB=postgresql://... node scripts/e2e/w1-5-appointment-visit-link.mjs
 * Concurrency, explicit follow-up links, kind choice, rollback and outbox refs.
 * Run alone: temporarily changes active visit-form definitions, restored below.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { processDomainEvents } = require('./dist/work/work-processor');
import { clinicToday } from './lib/clinic-day.mjs';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB;
if (!DB || ![DB, API].every(u => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) {
  throw new Error('این آزمون فقط روی API و دیتابیسِ محلیِ جداگانه اجرا می‌شود');
}
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'w15' + randomBytes(4).toString('hex');
const ids = { patients: [], appointments: [], forms: [], rules: [], submissions: [] };
let savedForms = [], token = '', passed = 0;
/* «امروز» به وقتِ **مطب** — همان چیزی که سرور می‌نویسد (`lib/clinic-day.mjs`). */
const today = clinicToday();
const day = new Date(+today + 7 * 86400000), nextDay = new Date(+day + 86400000);
const iso = d => d.toISOString().slice(0, 10);
const check = (condition, title) => { assert.ok(condition, title); console.log('PASS ' + title); passed++; };
async function api(path, method = 'GET', body, auth = true) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json',
    ...(auth && token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function patient() {
  const p = await db.patient.create({ data: { code: tag + ids.patients.length, firstName: 'بیمار', lastName: 'آزمون نوبت' } });
  ids.patients.push(p.id); return p;
}
async function appointment(patientId, data = {}) {
  const a = await db.appointment.create({ data: { patientId, date: day, status: 'confirmed', ...data } });
  ids.appointments.push(a.id); return a;
}
async function chain(patientId) {
  const seq = (await db.visit.aggregate({ where: { patientId }, _max: { seq: true } }))._max.seq ?? 0;
  const parent = await db.visit.create({ data: { patientId, seq: seq + 1, kind: 'surgery', nextVisitDate: day, opStatus: 'done' } });
  const child = await db.visit.create({ data: { patientId, seq: seq + 2, kind: 'clinic', followOfVisitId: parent.id,
    opDate: day, extra: { history: 'پاسخ قبلی' }, notes: 'اطلاعات پیگیری' } });
  return { parent, child };
}
async function form(kind) {
  const existing = await db.formDef.findFirst({ where: { scope: 'visit', visitKind: kind } });
  if (existing) return db.formDef.update({ where: { id: existing.id }, data: { active: true } });
  const f = await db.formDef.create({ data: { key: 'visit.' + kind, title: 'فرم آزمون ' + kind, scope: 'visit', visitKind: kind } });
  ids.forms.push(f.id); return f;
}
try {
  const login = await api('/auth/login', 'POST', { identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' });
  token = login.data?.accessToken; assert.ok(token, 'ورود ناموفق');
  savedForms = await db.formDef.findMany({ where: { scope: 'visit' }, select: { id: true, active: true } });
  await db.formDef.updateMany({ where: { scope: 'visit' }, data: { active: false } });
  const surgery = await form('surgery'), fallback = await form(tag), clinic = await form('clinic');
  // Capacity windows scoped to the two fixture dates; no existing rules are deleted.
  for (const date of [day, nextDay]) {
    const r = await db.availabilityRule.create({ data: { weekday: (date.getUTCDay() + 1) % 7,
      startMin: 0, endMin: 1439, mode: 'capacity', capacity: 1000, activeFrom: date, activeTo: date } });
    ids.rules.push(r.id);
  }

  const p = await patient(), { child } = await chain(p.id);
  const walk = await api('/appointments', 'POST', { patientId: p.id, date: iso(day) });
  assert.equal(walk.status, 201, JSON.stringify(walk.data)); ids.appointments.push(walk.data.id);
  check(walk.data.forVisitId === child.id && walk.data.visitId === null, 'نوبت حضوری به فرزندِ صریح وصل می‌شود و هنوز شروع نشده است');
  const reused = await api(`/appointments/${walk.data.id}/visit`, 'POST');
  check(reused.data.visitId === child.id && reused.data.made === false, 'شروع نوبت همان مراجعهٔ پیگیری را برمی‌گرداند');
  const retained = await db.visit.findUnique({ where: { id: child.id } });
  check(iso(retained.opDate) === iso(today) && retained.opStatus === 'pending'
    && retained.extra.history === 'پاسخ قبلی' && retained.notes === 'اطلاعات پیگیری', 'تاریخِ حضور امروز می‌شود؛ وضعیت و اطلاعات بالینی حفظ می‌شوند');
  check(await db.visit.count({ where: { patientId: p.id } }) === 2, 'شروع پیگیری مراجعهٔ سوم نمی‌سازد');
  const repeat = await api(`/appointments/${walk.data.id}/visit`, 'POST');
  check(repeat.data.visitId === child.id && !repeat.data.made, 'تکرار شروع همان شناسه را می‌دهد');
  check(await db.domainEvent.count({ where: { type: 'appointment.started', appointmentId: walk.data.id } }) === 1, 'تکرار شروع رویداد دوم نمی‌سازد');

  const p2 = await patient(), fresh = await appointment(p2.id, { startMin: 600 });
  const starts = await Promise.all(Array.from({ length: 2 }, () => api(`/appointments/${fresh.id}/visit`, 'POST')));
  if (starts.some(r => r.status !== 201)) console.error('Concurrent responses:', JSON.stringify(starts));
  check(starts.every(r => r.status === 201) && new Set(starts.map(r => r.data.visitId)).size === 1, 'دو درخواست هم‌زمان یک مراجعه برمی‌گردانند');
  check(starts.filter(r => r.data.made).length === 1 && await db.visit.count({ where: { patientId: p2.id } }) === 1, 'فقط یک درخواست مراجعه را می‌سازد؛ هیچ مراجعهٔ یتیمی نیست');
  const made = await db.visit.findUnique({ where: { id: starts[0].data.visitId } });
  check(made.kind === 'clinic' && made.opStartTime === '10:00', 'clinic با وجود surgery و نوع سفارشی انتخاب می‌شود؛ ساعت حفظ می‌شود');
  check(await db.domainEvent.count({ where: { type: 'appointment.started', appointmentId: fresh.id } }) === 1, 'شروع هم‌زمان تنها یک رویداد outbox دارد');

  await db.formDef.update({ where: { id: clinic.id }, data: { active: false } });
  const p3 = await patient(), custom = await appointment(p3.id);
  const customStart = await api(`/appointments/${custom.id}/visit`, 'POST');
  check(customStart.status === 201 && (await db.visit.findUnique({ where: { id: customStart.data.visitId } })).kind === tag,
    'وقتی clinic فعال نیست اولین نوعِ غیرجراحی انتخاب می‌شود');
  await db.formDef.update({ where: { id: fallback.id }, data: { active: false } });
  const onlySurgery = await appointment((await patient()).id);
  const refused = await api(`/appointments/${onlySurgery.id}/visit`, 'POST');
  check(refused.status === 400 && (await db.appointment.findUnique({ where: { id: onlySurgery.id } })).visitId === null,
    'وجودِ فقط فرم جراحی باعث ساختِ جراحیِ ناخواسته نمی‌شود');
  await db.formDef.update({ where: { id: clinic.id }, data: { active: true } });

  const cancelled = await appointment(p.id, { status: 'cancelled', forVisitId: child.id });
  check((await api(`/appointments/${cancelled.id}/visit`, 'POST')).status === 400, 'نوبت لغوشده شروع نمی‌شود');
  const noPatient = await appointment(null);
  check((await api(`/appointments/${noPatient.id}/visit`, 'POST')).status === 400, 'نوبتِ بی‌پرونده شروع نمی‌شود');
  const foreign = await appointment(p2.id, { forVisitId: child.id });
  check((await api(`/appointments/${foreign.id}/visit`, 'POST')).status === 400, 'اتصال به مراجعهٔ بیمار دیگر رد می‌شود');
  check((await api(`/appointments/${foreign.id}/visit`, 'POST', undefined, false)).status === 401, 'شروع بدون احراز رد می‌شود');
  const alreadyLinked = await appointment(p.id, { forVisitId: child.id });
  check((await api(`/appointments/${alreadyLinked.id}/visit`, 'POST')).status === 400, 'مراجعهٔ شروع‌شده به نوبت دوم وصل نمی‌شود');

  const rollbackPatient = await patient(), fail = await appointment(rollbackPatient.id);
  // Inject only the outbox failure; all reads, writes, locks and rollback use real Prisma.
  // This also works on PGlite, whose wire adapter cannot recover a SQL RAISE error.
  const cls = (file, name) => require('./dist/' + file)[name];
  const audit = new (cls('audit/audit.service', 'AuditService'))(db);
  const forms = new (cls('patients/forms.service', 'FormsService'))(db, { vertical: async () => 'clinic', profile: async () => cls('config/tenant-profile', 'profileOf')('clinic', null) });
  const noSideEffects = { syncNextVisit: async () => { throw new Error('side effect before commit'); } };
  const failureEvents = { emit: async () => { throw new Error('fixture outbox failure'); } };
  const patients = new (cls('patients/patients.service', 'PatientsService'))(db, audit, forms, noSideEffects, failureEvents);
  const failing = new (cls('patients/appointments.service', 'AppointmentsService'))(db, audit, patients, forms, {}, noSideEffects, failureEvents);
  const actor = await db.account.findUnique({ where: { username: process.env.E2E_USER ?? 'admin' } });
  await assert.rejects(() => failing.startVisit(fail.id, actor), /fixture outbox failure/);
  check(await db.visit.count({ where: { patientId: rollbackPatient.id } }) === 0,
    'شکستِ outbox ساختِ مراجعه را هم rollback می‌کند');
  check((await db.appointment.findUnique({ where: { id: fail.id } })).visitId === null
    && await db.auditEvent.count({ where: { action: 'appointment.start_visit', entityId: String(fail.id) } }) === 0,
    'نوبت و audit نیز پس از شکست بدون تغییرند');
  check((await api(`/appointments/${fail.id}/visit`, 'POST')).status === 201, 'درخواست پس از رفع خطا قابل تکرار است');

  const pp = await patient(), follow = await chain(pp.id);
  const sub = await db.intakeSubmission.create({ data: { patientId: pp.id, formId: clinic.id,
    token: tag + 'public', status: 'pending_fill', data: {}, expiresAt: new Date(+day + 86400000) } });
  ids.submissions.push(sub.id);
  const book = await api(`/public/intake/form/${sub.token}/book`, 'POST', { date: iso(day) }, false);
  assert.equal(book.status, 201, JSON.stringify(book.data));
  let held = await db.appointment.findUnique({ where: { submissionId: sub.id } }); ids.appointments.push(held.id);
  check(held.forVisitId === follow.child.id && held.status === 'held', 'رزرو بیمار هم به مراجعهٔ پیگیری وصل می‌شود');
  const event = await db.domainEvent.findFirst({ where: { type: 'appointment.held', appointmentId: held.id } });
  check(event?.patientId === pp.id && event?.visitId === follow.child.id && event?.refId === null, 'رویداد held همان appointmentIdِ قرارداد را نگه می‌دارد');
  await processDomainEvents(db);
  const key = `confirm_appointment:appointment:${held.id}`;
  check((await db.workItem.findUnique({ where: { idempotencyKey: key } }))?.state === 'open', 'رویداد رزرو، کارِ تأیید را با ref صحیح باز می‌کند');
  const shifted = await api(`/public/intake/form/${sub.token}/book`, 'POST', { date: iso(nextDay) }, false);
  held = await db.appointment.findUnique({ where: { submissionId: sub.id } });
  check(shifted.status === 201 && held.forVisitId === null && await db.appointment.count({ where: { submissionId: sub.id } }) === 1,
    'جابه‌جاییِ روز ارجاع قدیمی را پاک می‌کند و نوبت دوم نمی‌سازد');
  await api(`/public/intake/form/${sub.token}/book`, 'POST', { date: iso(day) }, false);
  await api(`/appointments/${held.id}/visit`, 'POST');
  await processDomainEvents(db);
  check((await db.workItem.findUnique({ where: { idempotencyKey: key } }))?.state === 'done', 'started کارِ بازِ held را با همان ref می‌بندد');

  const ambiguous = await patient(); await chain(ambiguous.id); await chain(ambiguous.id);
  const amb = await api('/appointments', 'POST', { patientId: ambiguous.id, date: iso(day) });
  check(amb.status === 400 && await db.appointment.count({ where: { patientId: ambiguous.id } }) === 0,
    'چند پیگیریِ هم‌موعد به‌صورت حدسی به هم وصل نمی‌شوند');
  console.log(`W1.5: ${passed} passed`);
} catch (error) {
  console.error('W1.5 failure:', error);
  throw error;
} finally {
  // All operational rows are scoped to fixture patients/appointments.
  await db.workItem.deleteMany({ where: { patientId: { in: ids.patients } } });
  await db.domainEvent.deleteMany({ where: { OR: [{ patientId: { in: ids.patients } }, { appointmentId: { in: ids.appointments } }] } });
  await db.reminder.deleteMany({ where: { patientId: { in: ids.patients } } });
  await db.appointment.deleteMany({ where: { OR: [{ id: { in: ids.appointments } }, { patientId: { in: ids.patients } }] } });
  await db.intakeSubmission.deleteMany({ where: { id: { in: ids.submissions } } });
  const visits = await db.visit.findMany({ where: { patientId: { in: ids.patients } }, select: { id: true } });
  await db.auditEvent.deleteMany({ where: { OR: [
    { entityType: 'visit', entityId: { in: visits.map(v => String(v.id)) } },
    { entityType: 'appointment', entityId: { in: ids.appointments.map(String) } },
  ] } });
  await db.visit.deleteMany({ where: { patientId: { in: ids.patients } } });
  await db.patient.deleteMany({ where: { id: { in: ids.patients } } });
  await db.availabilityRule.deleteMany({ where: { id: { in: ids.rules } } });
  await db.formDef.deleteMany({ where: { id: { in: ids.forms } } });
  for (const { id, ...data } of savedForms) await db.formDef.update({ where: { id }, data });
  await db.$disconnect();
}
