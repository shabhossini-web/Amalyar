/** Real HTTP + Prisma + outbox test. Only run against an isolated local database. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { processDomainEvents } = require('./dist/work/work-processor');
const { OrdersService } = require('./dist/patients/orders.service');
const { AuditService } = require('./dist/audit/audit.service');
const API = process.env.E2E_API ?? 'http://localhost:3101/api', DB = process.env.E2E_DB;
if (!DB || ![API, DB].every(u => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'review' + randomBytes(4).toString('hex');
const patients = [], accounts = [], people = [];
const savedAccess = [];
let token, count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
async function api(path, body, method = 'POST', auth = token) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const work = (type, kind, id) => db.workItem.findUnique({ where: { idempotencyKey: `${type}:${kind}_order:${id}` } });
const docs = (kind, id) => db.document.findMany({ where: { refType: `${kind}_order`, refId: id } });
try {
  token = (await api('/auth/login', { identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }, 'POST', '')).data?.accessToken;
  assert.ok(token, 'login');
  for (const [table, key] of [['feature', 'dashboard'], ['permission', 'patients.update']]) {
    savedAccess.push([table, key, await db[table].findUnique({ where: { key } })]);
    await db[table].upsert({ where: { key }, create: { key, minLevel: 3, enabled: true }, update: { minLevel: 3, enabled: true, roles: [] } });
  }
  const admin = await db.account.findFirst({ where: { username: process.env.E2E_USER ?? 'admin' } });
  for (let i = 0; i < 2; i++) patients.push((await db.patient.create({ data: { code: tag + i, firstName: 'بیمار', lastName: 'بررسی' } })).id);
  const patientId = patients[0];
  const doctor = await db.account.create({ data: { username: tag, passwordHash: await require('bcryptjs').hash('test1234', 4),
    level: 3, jobRole: 'doctor', status: 'active', person: { create: { firstName: 'پزشک', lastName: 'نتیجه' } } } });
  accounts.push(doctor.id); people.push(doctor.personId);
  const surgeon = await db.surgeon.create({ data: { personId: doctor.personId } });
  const visit = await db.visit.create({ data: { patientId, seq: 1, kind: 'clinic', surgeonId: surgeon.id, techId: doctor.id } });
  const doctorToken = (await api('/auth/login', { identifier: tag, password: 'test1234' }, 'POST', '')).data?.accessToken;
  let lab;
  for (const kind of ['lab', 'imaging', 'consult', 'referral']) {
    const created = await api('/orders/' + kind, { patientId, visitId: visit.id });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const row = created.data, table = db[kind + 'Order'];
    if (kind === 'lab') lab = row;
    ok((await api(`/orders/${kind}/${row.id}/review`, { status: 'reviewed', reviewNote: 'بدون پاسخ' })).status === 409, kind + ' draft cannot be reviewed');
    const answer = kind === 'lab' || kind === 'imaging' ? { resultText: 'نتیجه اول', resultLink: 'https://example.test/' + kind } : { answerText: 'نتیجه اول', answerLink: 'https://example.test/' + kind };
    const answered = await api(`/orders/${kind}/${row.id}`, answer, 'PATCH');
    assert.equal(answered.status, 200, JSON.stringify(answered.data));
    ok(answered.data.status === 'answered' && answered.data.documents.length === 2, kind + ' staff answer creates linked text and URL documents');
    await processDomainEvents(db);
    ok((await work('review_result', kind, row.id))?.ownerAccountId === doctor.id, kind + ' review assigned to actual surgeon account');
    const opening = await api(`/orders/${kind}/${row.id}/review`, { status: 'in_review' });
    ok(opening.data.status === 'in_review', kind + ' enters in_review');
    const liveOpen = await api(`/patients/${patientId}/live`, undefined, 'GET');
    ok(liveOpen.data.openOrders?.some(o => o.id === row.id && o.kind === kind), kind + ' in_review remains open in W3.1');
    ok((await api(`/orders/${kind}/${row.id}/review`, { status: 'reviewed' })).status === 400, kind + ' decision required');
    const reviewed = await api(`/orders/${kind}/${row.id}/review`, { status: 'reviewed', reviewNote: 'بررسی کامل' });
    ok(reviewed.data.reviewedById === admin.id && reviewed.data.reviewedAt, kind + ' records reviewer and time');
    await processDomainEvents(db);
    ok((await work('review_result', kind, row.id))?.state === 'done', kind + ' closes matching review task');
    await api(`/orders/${kind}/${row.id}`, { ...answer, note: 'توضیح درخواست' }, 'PATCH');
    ok((await table.findUnique({ where: { id: row.id } })).status === 'reviewed' && (await docs(kind, row.id)).length === 2, kind + ' unchanged answer does not reopen or duplicate');
    const n = await db.domainEvent.count({ where: { refType: kind + '_order', refId: row.id } });
    await api(`/orders/${kind}/${row.id}/review`, { status: 'reviewed', reviewNote: 'بررسی کامل' });
    ok(await db.domainEvent.count({ where: { refType: kind + '_order', refId: row.id } }) === n, kind + ' retry review is idempotent');
    ok((await api(`/orders/${kind}/${row.id}`, undefined, 'DELETE')).status === 409, kind + ' answered order cannot be deleted');
  }
  const textDoc = (await docs('lab', lab.id)).find(d => d.contentText);
  const documentList = await api(`/patients/${patientId}/documents`, undefined, 'GET');
  ok(documentList.data.some(d => d.id === textDoc.id && d.refId === lab.id), 'same document visible in record');
  const dl = await fetch(API + `/patients/documents/${textDoc.id}/file`, { headers: { Authorization: 'Bearer ' + token } });
  // Resolve the existing controller download route, without a new document copy.
  assert.equal(dl.status, 200);
  ok((await dl.text()) === 'نتیجه اول', 'text document downloads exact content');
  const next = await api('/orders/lab', { patientId, visitId: visit.id });
  const id = next.data.id, publicToken = next.data.token;
  await db.labOrder.update({ where: { id }, data: { status: 'sent' } });
  const first = await api(`/public/order/${publicToken}/answer`, { text: 'پاسخ بیمار' }, 'POST', '');
  ok(first.status === 201 && (await docs('lab', id)).length === 1, 'public answer persists a document');
  ok((await api(`/public/order/${publicToken}/answer`, { text: 'بازنویسی' }, 'POST', '')).status === 409, 'second public POST cannot overwrite');
  await processDomainEvents(db);
  for (let cycle = 0; cycle < 2; cycle++) {
    await api(`/orders/lab/${id}/review`, { status: 'needs_action', reviewNote: 'نتیجه ناقص' });
    const livePending = await api(`/patients/${patientId}/live`, undefined, 'GET');
    ok(livePending.data.openOrders?.some(o => o.id === id && o.kind === 'lab'), 'needs_action remains open in W3.1');
    await processDomainEvents(db);
    ok((await work('review_result', 'lab', id))?.state === 'done' && (await work('upload_result', 'lab', id))?.state === 'open', 'needs_action closes review and opens patient task ' + cycle);
    const result = await api(`/public/order/${publicToken}/answer`, { text: 'پاسخ تکمیلی ' + cycle }, 'POST', '');
    assert.equal(result.status, 201, JSON.stringify(result.data));
    await processDomainEvents(db);
    ok((await work('review_result', 'lab', id))?.state === 'open' && (await work('upload_result', 'lab', id))?.state === 'done', 'resubmission reopens same review and closes upload ' + cycle);
  }
  ok(await db.workItem.count({ where: { refType: 'lab_order', refId: id, type: 'review_result' } }) === 1, 'review task remains unique');
  ok((await docs('lab', id)).length === 3, 'all earlier answers preserved');
  const bad = await api('/orders/imaging', { patientId });
  await db.imagingOrder.update({ where: { id: bad.data.id }, data: { status: 'sent' } });
  ok((await api(`/public/order/${bad.data.token}/answer`, { link: 'javascript:alert(1)' }, 'POST', '')).status === 400, 'unsafe URL rejected');
  ok((await db.imagingOrder.findUnique({ where: { id: bad.data.id } })).status === 'sent', 'invalid answer rolls back status');
  const concurrent = await Promise.all([1, 2].map(i => api(`/public/order/${bad.data.token}/answer`, { text: 'همزمان ' + i }, 'POST', '')));
  ok(concurrent.map(r => r.status).sort().join() === '201,409', 'concurrent answers: only one commits');
  const foreign = await db.labOrder.create({ data: { patientId: patients[1], token: tag + 'foreign', status: 'answered' } });
  ok((await api(`/orders?patientId=${patientId}`, undefined, 'GET', doctorToken)).status === 200, 'configured doctor can access assigned patient');
  ok((await api(`/orders/lab/${foreign.id}/review`, { status: 'reviewed', reviewNote: 'نباید' }, 'POST', doctorToken)).status === 404, 'unassigned patient review denied');
  ok((await api(`/orders?patientId=${patients[1]}`, undefined, 'GET', doctorToken)).status === 404, 'unassigned patient list denied');
  const file = await db.document.create({ data: { patientId, visitId: visit.id, category: 'lab', fileName: 'result.pdf', mimeType: 'application/pdf', size: 10, sha256: 'fixture-existing-file' } });
  const attached = await api('/orders/lab', { patientId, visitId: visit.id, documentIds: [file.id] });
  ok(attached.data.status === 'answered' && attached.data.documents[0].id === file.id, 'existing file attaches by reference, no copy');
  ok(await db.document.count({ where: { sha256: 'fixture-existing-file' } }) === 1, 'file remains stored once');
  const denied = await api('/orders/lab', { patientId: patients[1], documentIds: [file.id] });
  ok(denied.status === 400, 'cross-patient document attachment rejected');
  const broken = new OrdersService(db, {}, {}, {}, new AuditService(db), { emit: async () => { throw new Error('outbox-test'); } });
  const before = await db.document.count({ where: { patientId } });
  await assert.rejects(() => broken.update('lab', id, { resultText: 'باید rollback شود' }, admin), /outbox-test/);
  ok(await db.document.count({ where: { patientId } }) === before && (await db.labOrder.findUnique({ where: { id } })).resultText === 'پاسخ تکمیلی 1', 'outbox failure rolls back answer and documents');
  const live = await api(`/patients/${patientId}/live`, undefined, 'GET');
  ok(live.status === 200, 'W3.1 live record remains readable');
  console.log(`W1.2: ${count} checks passed`);
} finally {
  for (const [table, key, previous] of savedAccess) {
    if (previous) { const { id, ...data } = previous; await db[table].update({ where: { key }, data }); }
    else await db[table].deleteMany({ where: { key } });
  }
  await db.domainEvent.deleteMany({ where: { patientId: { in: patients } } });
  await db.workItem.deleteMany({ where: { patientId: { in: patients } } });
  await db.patient.deleteMany({ where: { id: { in: patients } } });
  await db.surgeon.deleteMany({ where: { personId: { in: people } } });
  await db.account.deleteMany({ where: { id: { in: accounts } } });
  await db.person.deleteMany({ where: { id: { in: people } } });
  await db.$disconnect();
}
