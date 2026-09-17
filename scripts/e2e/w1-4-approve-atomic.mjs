import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { IntakeService } = require('./dist/patients/intake.service');
const { BillingService } = require('./dist/patients/billing.service');
const { EventsService } = require('./dist/work/events.service');
const { PatientsService } = require('./dist/patients/patients.service');
const { SettingsService } = require('./dist/config/settings.service');
const { SmsService } = require('./dist/sms/sms.service');
const { processDomainEvents } = require('./dist/work/work-processor');
const { sendReminders } = require('./dist/reminders/send-reminders');

/** The app and all DB operations are real. Only explicit failure probes replace a dependency method. */
export async function runApprovalTests(app) {
  const API = process.env.E2E_API, DB = process.env.E2E_DB;
  if (![API, DB].every(u => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw Error('فقط محیط محلی جداگانه');
  const db = new PrismaClient({ datasources: { db: { url: DB } } });
  const tag = 'approve' + randomBytes(4).toString('hex');
  let auth, count = 0, patient, other, form, record, surgeon, bank;
  const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
  async function api(path, body, method = 'POST') {
    const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  }
  const submissions = [];
  async function sub(opts = {}) {
    const row = await db.intakeSubmission.create({ data: { token: tag + submissions.length, patientId: patient.id, formId: form.id,
      status: 'pending_approval', amount: 1000, discountAmount: 100, discountCode: 'TEST', data: { note: 'پاسخ بیمار' },
      expiresAt: new Date(Date.now() + 86400000), ...opts } });
    submissions.push(row.id); return row;
  }
  const approve = (id, extra = {}) => api(`/intake/submissions/${id}/approve`, { surgeonId: surgeon.id, bankAccountId: bank.id, ...extra });
  const intake = app.get(IntakeService);
  const expire = intake.expireIfDue.bind(intake);
  let releaseEdit;
  const settings = app.get(SettingsService), smsSettings = settings.sms.bind(settings);
  const billing = app.get(BillingService), events = app.get(EventsService), sms = app.get(SmsService), patients = app.get(PatientsService);
  const addPayment = billing.addPayment.bind(billing), emit = events.emit.bind(events), send = sms.send.bind(sms), after = patients.afterVisitCreation.bind(patients);
  let sentDuringApproval = 0;
  sms.send = async () => { sentDuringApproval++; throw Error('unexpected inline SMS'); };
  try {
    auth = (await api('/auth/login', { identifier: 'admin', password: 'test1234' })).data.accessToken;
    patient = await db.patient.create({ data: { code: tag, firstName: 'تست', lastName: 'تأیید', phone: '09120000001' } });
    other = await db.patient.create({ data: { code: tag + 'other', firstName: 'بیمار', lastName: 'دیگر' } });
    surgeon = await db.surgeon.create({ data: { person: { create: { firstName: 'جراح', lastName: 'تست' } } } });
    bank = await db.bankAccount.create({ data: { ownerName: 'آزمون', classification: 'formal' } });
    form = await db.formDef.create({ data: { key: 'visit.' + tag, scope: 'visit', visitKind: tag, title: 'تأیید آزمایشی', fields: { create: [
      { key: 'note', label: 'شرح', type: 'text' }, { key: 'scan', label: 'تصویر', type: 'image' },
      { key: 'resultLinks', label: 'لینک', type: 'links', docCategory: 'lab' },
    ] } } });
    record = await db.formDef.create({ data: { key: tag + 'record', scope: 'record', title: 'زیرپرونده', fields: { create: { key: 'links', label: 'نتیجه', type: 'links', docCategory: 'lab' } } } });
    const s = await sub();
    const receipt = await db.document.create({ data: { patientId: patient.id, category: 'receipt', fileName: 'receipt.pdf', mimeType: 'application/pdf', size: 1, sha256: 'receipt-fixture' } });
    const foreign = await db.document.create({ data: { patientId: other.id, category: 'lab', fileName: 'other.pdf', mimeType: 'application/pdf', size: 1, sha256: 'other-fixture' } });
    await db.intakeSubmission.update({ where: { id: s.id }, data: { data: { note: 'پاسخ بیمار', receiptDocumentId: receipt.id, scan: [{ id: foreign.id }], resultLinks: [{ url: 'https://example.test/result' }] } } });
    const appointment = await db.appointment.create({ data: { submissionId: s.id, patientId: patient.id, status: 'held', date: new Date('2026-10-01'), startMin: 600 } });
    billing.addPayment = async (...args) => { await addPayment(...args); throw Error('injected payment failure after write'); };
    const failed = await approve(s.id);
    ok(failed.status === 500, 'payment failure reaches API');
    ok(await db.visit.count({ where: { patientId: patient.id } }) === 0, 'payment failure leaves no visit');
    ok(await db.payment.count() === 0 && await db.charge.count() === 0, 'payment and both charges roll back');
    ok((await db.intakeSubmission.findUnique({ where: { id: s.id } })).status === 'pending_approval', 'submission remains pending');
    ok((await db.appointment.findUnique({ where: { id: appointment.id } })).status === 'held', 'appointment stays held');
    ok((await db.document.findUnique({ where: { id: receipt.id } })).visitId === null && await db.document.count({ where: { externalUrl: 'https://example.test/result' } }) === 0, 'document attachment and new link roll back');
    ok(await db.domainEvent.count({ where: { refType: 'intake_submission', refId: s.id } }) === 0 && await db.reminder.count({ where: { dedupeKey: `intake_approved:${s.id}` } }) === 0, 'no success event or SMS after rollback');
    billing.addPayment = addPayment;
    const succeeded = await approve(s.id, { idempotencyKey: 'approval-' + tag });
    assert.equal(succeeded.status, 201, JSON.stringify(succeeded.data));
    const visitId = succeeded.data.visitId;
    ok(!!visitId && await db.visit.count({ where: { patientId: patient.id } }) === 1, 'retry creates exactly one visit');
    ok(await db.payment.count({ where: { visitId, amount: 900 } }) === 1 && await db.charge.count({ where: { visitId } }) === 2, 'gross, discount and payment recorded once');
    const notice = await db.reminder.findUnique({ where: { dedupeKey: `intake_approved:${s.id}` } });
    ok(notice?.status === 'pending' && sentDuringApproval === 0, 'SMS is queued transactionally, never sent inline');
    ok((await db.document.findUnique({ where: { id: receipt.id } })).visitId === visitId && (await db.document.findUnique({ where: { id: foreign.id } })).visitId === null, 'only own unattached document moves');
    ok((await db.appointment.findUnique({ where: { id: appointment.id } })).visitId === visitId, 'appointment links to approved visit');
    ok((await db.visit.findUnique({ where: { id: visitId } })).extra.note === 'پاسخ بیمار', 'custom answer reaches visit');
    const retry = await approve(s.id, { idempotencyKey: 'approval-' + tag });
    ok(JSON.stringify(retry.data) === JSON.stringify(succeeded.data), 'idempotent replay returns the same result');
    ok((await approve(s.id, { idempotencyKey: 'different' })).status === 409, 'different explicit key cannot approve again');
    ok(await db.payment.count({ where: { visitId } }) === 1 && await db.reminder.count({ where: { dedupeKey: `intake_approved:${s.id}` } }) === 1, 'replay never repeats payment or message');
    const sendResult = await sendReminders(db, { send: async () => {
      assert.equal((await db.intakeSubmission.findUnique({ where: { id: s.id } })).status, 'approved');
      return { sent: true, providerId: 'fixture' };
    } }, [notice.id]);
    ok(sendResult.sent === 1, 'sender observes committed approval');
    await processDomainEvents(db);
    ok((await db.workItem.findUnique({ where: { idempotencyKey: `repair_intake:intake_submission:${s.id}` } }))?.state === 'done', 'successful post-commit synchronization closes recovery task');

    const concurrent = await sub({ amount: 0, discountAmount: 0 });
    const parallel = await Promise.all([approve(concurrent.id), approve(concurrent.id)]);
    ok(parallel.every(r => r.status === 201) && parallel[0].data.visitId === parallel[1].data.visitId, 'concurrent requests return one visit: ' + JSON.stringify(parallel));
    ok(await db.domainEvent.count({ where: { type: 'intake.approved', refId: concurrent.id, refType: 'intake_submission' } }) === 1, 'concurrent approval has one success event');

    const stale = await sub({ amount: 0, discountAmount: 0, data: { receiptDocumentId: receipt.id } });
    let signalRead;
    const didRead = new Promise(resolve => { signalRead = resolve; });
    const resume = new Promise(resolve => { releaseEdit = resolve; });
    intake.expireIfDue = async token => {
      const row = await expire(token);
      if (token === stale.token) { signalRead(); await resume; }
      return row;
    };
    const lateEdit = api(`/public/intake/form/${stale.token}/receipt/${receipt.id}`, undefined, 'DELETE');
    await didRead;
    assert.equal((await approve(stale.id)).status, 201);
    releaseEdit();
    ok((await lateEdit).status === 409, 'receipt edit read before approval cannot reopen it afterward');
    intake.expireIfDue = expire;
    ok((await db.intakeSubmission.findUnique({ where: { id: stale.id } })).status === 'approved', 'stale public edit preserves approved state');

    const target = await db.visit.create({ data: { patientId: patient.id, seq: 100, kind: 'clinic', opStatus: 'done', extra: { clinical: 'حفظ شود' }, notes: 'یادداشت قبلی' } });
    const linked = await sub({ amount: 0, discountAmount: 0, data: { note: 'پاسخ جدید' } });
    const booked = await db.appointment.create({ data: { submissionId: linked.id, patientId: patient.id, date: new Date('2026-10-02'), status: 'held', forVisitId: target.id } });
    const before = await db.visit.count({ where: { patientId: patient.id } });
    const linkedResult = await approve(linked.id);
    ok(linkedResult.data.visitId === target.id && await db.visit.count({ where: { patientId: patient.id } }) === before, 'forVisitId reuses existing visit');
    const kept = await db.visit.findUnique({ where: { id: target.id } });
    ok(kept.opStatus === 'done' && kept.kind === 'clinic' && kept.extra.clinical === 'حفظ شود' && kept.extra.note === 'پاسخ جدید' && kept.notes === 'یادداشت قبلی', 'reuse preserves clinical state, kind and earlier answers');
    ok((await db.appointment.findUnique({ where: { id: booked.id } })).visitId === target.id, 'reused visit links back to appointment');

    const targetOther = await db.visit.create({ data: { patientId: other.id, seq: 1, kind: 'clinic' } });
    const badTarget = await sub({ amount: 0, discountAmount: 0 });
    await db.appointment.create({ data: { submissionId: badTarget.id, patientId: patient.id, forVisitId: targetOther.id, date: new Date(), status: 'held' } });
    ok((await approve(badTarget.id)).status === 400, 'cross-patient target denied');
    const cancelled = await sub({ amount: 0, discountAmount: 0 });
    await db.appointment.create({ data: { submissionId: cancelled.id, patientId: patient.id, date: new Date(), status: 'cancelled' } });
    ok((await approve(cancelled.id)).status === 409, 'cancelled appointment cannot be revived by approval');
    const r = await sub({ formId: record.id, amount: 0, discountAmount: 0, data: { links: [{ url: 'https://example.test/record' }] } });
    const rec = await approve(r.id);
    ok(rec.data.madeVisit === false && rec.data.patientId === patient.id, 'record form intentionally makes no visit');
    ok((await db.document.findFirst({ where: { externalUrl: 'https://example.test/record' } }))?.visitId === null, 'record link remains on patient');
    ok(JSON.stringify((await approve(r.id)).data) === JSON.stringify(rec.data), 'record approval also replays safely');

    const broken = await sub({ amount: 0, discountAmount: 0 });
    const total = await db.visit.count({ where: { patientId: patient.id } });
    events.emit = async (event, tx) => { const result = await emit(event, tx); if (event.type === 'intake.approved') throw Error('injected outbox failure'); return result; };
    ok((await approve(broken.id)).status === 500, 'outbox failure rejected');
    ok(await db.visit.count({ where: { patientId: patient.id } }) === total && (await db.intakeSubmission.findUnique({ where: { id: broken.id } })).status === 'pending_approval', 'outbox failure rolls back entire approval');
    events.emit = emit;
    const reusedKey = await sub({ amount: 0, discountAmount: 0 });
    ok((await approve(reusedKey.id, { idempotencyKey: 'approval-' + tag })).status === 409, 'key cannot be reused across submissions');
    ok(await db.visit.count({ where: { patientId: patient.id } }) === total, 'key collision creates no visit');
    const sync = await sub({ amount: 0, discountAmount: 0 });
    let settingsReads = 0;
    settings.sms = async () => { if (++settingsReads > 1) throw Error('sync settings offline'); return smsSettings(); };
    ok((await approve(sync.id)).status === 201, 'post-commit outage does not report failed payment');
    settings.sms = smsSettings;
    await processDomainEvents(db);
    const repair = await db.workItem.findUnique({ where: { idempotencyKey: `repair_intake:intake_submission:${sync.id}` } });
    ok(repair?.state === 'open' && repair.title.includes('همگام'), 'post-commit outage remains visible as synchronization work');
    const apptSync = await sub({ amount: 0, discountAmount: 0 });
    await db.appointment.create({ data: { submissionId: apptSync.id, patientId: patient.id, date: new Date(Date.now() + 7 * 86400000), status: 'held' } });
    settingsReads = 0;
    settings.sms = async () => { if (++settingsReads > 2) throw Error('appointment sync settings offline'); return smsSettings(); };
    ok((await approve(apptSync.id)).status === 201, 'appointment sync outage preserves committed approval');
    settings.sms = smsSettings;
    await processDomainEvents(db);
    ok((await db.workItem.findUnique({ where: { idempotencyKey: `repair_intake:intake_submission:${apptSync.id}` } }))?.state === 'open', 'error inside appointment sync keeps recovery work open');
    ok((await api(`/intake/submissions/${s.id}/reject`, { note: 'رد دیرهنگام' })).status >= 400, 'completed approval cannot be rejected');
    console.log(`W1.4: ${count} checks passed`);
  } finally {
    releaseEdit?.(); intake.expireIfDue = expire; settings.sms = smsSettings;
    billing.addPayment = addPayment; events.emit = emit; sms.send = send; patients.afterVisitCreation = after;
    await db.$disconnect();
  }
}
