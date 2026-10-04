/**
 * Real services on a disposable database: the two-sided handover (owner, 1405/07/11).
 *
 * Owner report: «الان راننده میزنه تحویل داده شد ولی تو پنل کارشناسی نوشته فرستاده نشد». The day board
 * creates every delivery as a *planned* transfer and no button ever shipped it, so the driver's «ثبتِ
 * تحویل» only stamped the stop while the warehouse ledger never moved. Now:
 *  - the driver's «تحویل دادم» ships the stop's planned cargo (ledger: warehouse → hospital) — before the
 *    stop is stamped, so short stock refuses the whole thing instead of recording a delivery that never left;
 *  - the tech sees «راننده … تحویل داد» and must answer «تحویل گرفتم» or «با مغایرت» (count sheet →
 *    SetShortage rows with stage = receipt);
 *  - a delivery left unconfirmed past the clinic day becomes an office work item («تأییدِ تحویل») that the
 *    tech's confirmation closes.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'pglite-server';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client');
const cls = (f, n) => require(`../../server/dist/${f}.js`)[n];
const { clinicTodayIso } = require('../../server/dist/common/clinic-day.js');
const { detectStaleWork } = require('../../server/dist/work/work-detectors.js');
const { processDomainEvents } = require('../../server/dist/work/work-processor.js');
const { deliveryState, handoverOf, receiptOf } = require('../../server/dist/patients/handover.js');
const db = new PGlite(); await db.waitReady;
const server = createServer(db, { logLevel: 0 });
let prisma, count = 0;
const pass = name => console.log(`PASS ${++count}: ${name}`);
const rejects = async (fn, re, what) => {
  try { await fn(); } catch (e) { assert.match(String(e?.message ?? e), re, what); return; }
  assert.fail(`${what}: did not throw`);
};
try {
  const migrations = new URL('../../server/prisma/migrations/', import.meta.url);
  for (const dir of (await readdir(migrations)).sort()) if (dir.startsWith('20')) await db.exec(await readFile(new URL(`${dir}/migration.sql`, migrations), 'utf8'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  prisma = new PrismaClient({ datasources: { db: { url: `postgresql://postgres@127.0.0.1:${server.address().port}/postgres?connection_limit=1` } } });

  const audit = new (cls('audit/audit.service', 'AuditService'))(prisma);
  const settings = new (cls('config/settings.service', 'SettingsService'))(prisma, audit, { require: () => ({ tenantId: 'fixture' }) }, {});
  const events = new (cls('work/events.service', 'EventsService'))(prisma);
  const places = { canonical: async v => (typeof v === 'string' && v.trim() ? v.trim() : null) };
  const noConflict = { conflicts: async () => [], consignedElsewhere: async () => [] };
  const routes = new (cls('patients/routes.service', 'RoutesService'))(prisma, audit, {}, {}, settings, places, { queueStaffNotice: async () => ({}), sweep: async () => ({ sent: 0 }) });
  const inventory = new (cls('patients/inventory.service', 'InventoryService'))(prisma, audit, noConflict, settings, places, events, routes);
  const board = new (cls('patients/transport-board.service', 'TransportBoardService'))(prisma, audit, inventory, routes);
  /* Nest passes the inventory service; the e2e constructor mirrors the module order. */
  const transport = new (cls('patients/transport.service', 'TransportService'))(prisma, audit, places, routes, inventory);
  const tech = new (cls('patients/tech.service', 'TechService'))(prisma, {}, {}, {}, events, routes);

  // ── pure helpers (handover.ts) ──
  assert.equal(deliveryState({ status: 'planned' }, null), 'not_sent');
  assert.equal(deliveryState({ status: 'sent' }, null), 'none', 'an office send without a driver stop needs no second hand');
  assert.equal(deliveryState({ status: 'sent' }, { kind: 'deliver', doneAt: new Date() }), 'awaiting');
  assert.equal(deliveryState({ status: 'sent', techReceivedAt: new Date(), techReceiptIssue: false }, { kind: 'deliver', doneAt: new Date() }), 'received');
  assert.equal(deliveryState({ status: 'received', techReceivedAt: new Date(), techReceiptIssue: true }, { kind: 'deliver', doneAt: new Date() }), 'received_issue');
  assert.equal(deliveryState({ status: 'closed' }, { kind: 'deliver', doneAt: new Date() }), 'none', 'a returned waybill is past confirmation');
  assert.equal(handoverOf({ kind: 'pickup', doneAt: new Date() }), null, 'a pickup stop is not a handover to the tech');
  assert.equal(receiptOf({ status: 'sent' }), null);
  pass('handover helpers: one state machine for the tech panel, the driver panel and the warehouse');

  // ── fixture: admin, driver (person + staff + account), tech account, hospital, patient + visit today ──
  const admin = await prisma.account.create({ data: { username: 'dh-admin', passwordHash: 'x', level: 6, status: 'active', person: { create: { firstName: 'مدیر', lastName: 'تست' } } } });
  const drvPerson = await prisma.person.create({ data: { firstName: 'رضا', lastName: 'احمدی', phone: '09120000031' } });
  const staff = await prisma.transportStaff.create({ data: { personId: drvPerson.id, role: 'driver' } });
  const driver = await prisma.account.create({ data: { username: 'dh-driver', passwordHash: 'x', level: 2, status: 'active', personId: drvPerson.id } });
  const techAcc = await prisma.account.create({ data: { username: 'dh-tech', passwordHash: 'x', level: 2, status: 'active', person: { create: { firstName: 'نیما', lastName: 'کارشناس' } } } });
  const otherTech = await prisma.account.create({ data: { username: 'dh-tech2', passwordHash: 'x', level: 2, status: 'active', person: { create: { firstName: 'سمیرا', lastName: 'دیگر' } } } });
  const h = await prisma.hospital.create({ data: { name: 'بیمارستان آرمان' } });
  const day = clinicTodayIso();
  const patient = await prisma.patient.create({ data: { code: 'AM-9001', firstName: 'بیمار', lastName: 'یکم' } });
  /* The board anchors a delivery to the first visit of that hospital and day, so each scenario gets its own hospital. */
  const mkVisit = (seq, hospital = h, techId = techAcc.id) => prisma.visit.create({
    data: { patientId: patient.id, seq, kind: 'surgery', opStatus: 'pending', opDate: new Date(`${day}T00:00:00.000Z`), hospitalId: hospital.id, hospitalName: hospital.name, techId },
  });
  const visit = await mkVisit(1);

  const home = await inventory.home();
  const set = await prisma.item.create({ data: { name: 'ست SDN', assetKind: 'set' } });
  await prisma.itemComponent.createMany({ data: [{ setId: set.id, label: 'الکترود SDN', quantity: 20 }, { setId: set.id, label: 'سوزن', quantity: 5 }] });
  const electrode = await prisma.item.create({ data: { name: 'الکترود SDN', assetKind: 'consumable', unit: 'عدد' } });
  const setLot = await prisma.stockLot.create({ data: { itemId: set.id, serialNo: 'SE-07', location: home } });
  const elLot = await prisma.stockLot.create({ data: { itemId: electrode.id, lotNo: 'E-100', location: home } });
  await prisma.stockMovement.create({ data: { lotId: setLot.id, kind: 'in', quantity: 1, location: home } });
  await prisma.stockMovement.create({ data: { lotId: elLot.id, kind: 'in', quantity: 100, location: home } });
  const at = async (lotId, location) => {
    const rows = await prisma.stockMovement.findMany({ where: { lotId }, select: { quantity: true, location: true } });
    return rows.filter(r => r.location === location).reduce((s, r) => s + r.quantity, 0);
  };

  const techUser = { id: techAcc.id, level: 2 };
  const otherUser = { id: otherTech.id, level: 2 };
  const driverUser = { id: driver.id, level: 2 };

  // ── 1) board plans a delivery → planned transfer, nothing moved ──
  await board.planDelivery({
    on: day, hospitalId: h.id, plannedAt: '08:00', handedTo: 'کارشناسِ حاضر', staffId: staff.id,
    lines: [{ lotId: setLot.id, quantity: 1 }, { lotId: elLot.id, quantity: 10 }],
  }, admin);
  const t1 = await prisma.stockTransfer.findFirstOrThrow({ where: { visitId: visit.id }, include: { stop: true } });
  assert.equal(t1.status, 'planned');
  assert.equal(await at(setLot.id, home), 1, 'planning reserves, it does not move');
  const agenda0 = await tech.agenda(techUser, 'today');
  const tr0 = agenda0.visits.find(v => v.id === visit.id).transfers[0];
  assert.equal(tr0.delivery, 'not_sent');
  assert.equal(tr0.handover, null);
  assert.equal(tr0.items.length, 2, 'planned lines are shown by name');
  const drv0 = await transport.agenda(driverUser, 'today');
  assert.equal(drv0.runs[0].stops[0].cargo[0].delivery, 'not_sent');
  pass('before the driver: planned transfer, tech sees «هنوز ارسال نشده», warehouse untouched');

  // ── 2) tech cannot confirm what was never sent ──
  await rejects(() => inventory.confirmReceipt(t1.id, {}, techUser), /هنوز ارسال نشده/, 'confirm on planned');
  await rejects(() => inventory.receiptSheet(t1.id, techUser), /هنوز ارسال نشده/, 'sheet on planned');
  pass('«تحویل گرفتم» before the driver\'s delivery is refused in Persian');

  // ── 3) driver's «ثبتِ تحویل» ships the cargo ──
  const stop1 = t1.stop;
  await transport.markDone(stop1.id, { handedActual: 'کارشناسِ حاضر' }, driverUser);
  const t1b = await prisma.stockTransfer.findUniqueOrThrow({ where: { id: t1.id } });
  assert.equal(t1b.status, 'sent', 'the stop done = the waybill shipped');
  assert.equal(await at(setLot.id, home), 0);
  assert.equal(await at(setLot.id, t1b.toLocation), 1, 'the set is now at the hospital in the ledger');
  assert.equal(await at(elLot.id, home), 90);
  assert.equal(await at(elLot.id, t1b.toLocation), 10);
  const doneAudit = await prisma.auditEvent.findFirst({ where: { action: 'transport.stop.done', entityId: String(stop1.id) } });
  assert.deepEqual(doneAudit.afterJson.shipped, [{ id: t1.id, code: t1.code }], 'the stop audit names the shipped waybill');
  const sendAudit = await prisma.auditEvent.findFirst({ where: { action: 'stock.transfer.send', entityId: String(t1.id) } });
  assert.equal(sendAudit.actorId, driver.id, 'the ship audit actor is the driver');
  pass('driver «ثبتِ تحویل» → waybill sent, ledger moved warehouse → hospital (the root bug)');

  const agenda1 = await tech.agenda(techUser, 'today');
  const tr1 = agenda1.visits.find(v => v.id === visit.id).transfers[0];
  assert.equal(tr1.delivery, 'awaiting');
  assert.equal(tr1.handover.by, 'رضا احمدی');
  assert.equal(tr1.handover.role, 'driver');
  assert.equal(tr1.handover.to, 'کارشناسِ حاضر');
  assert.ok(tr1.handover.at, 'handover time');
  assert.equal(tr1.receipt, null);
  assert.equal(tr1.items.length, 2, 'sent lines come from the ledger now');
  const drv1 = await transport.agenda(driverUser, 'today');
  const cargo1 = drv1.runs[0].stops[0].cargo[0];
  assert.equal(cargo1.status, 'sent');
  assert.equal(cargo1.delivery, 'awaiting');
  assert.equal(cargo1.receipt, null);
  assert.ok(!JSON.stringify(agenda1).match(/"(amount|paid|price|fee|discount|charges|payments|shares?)"/), 'tech view still carries no money');
  pass('tech sees «راننده (رضا احمدی) … تحویل داد» + awaiting; driver sees «منتظرِ تأییدِ کارشناس»');

  // ── 4) the count sheet: standard from the set template, consumable as itself ──
  await rejects(() => inventory.receiptSheet(t1.id, otherUser), /یافت نشد/, 'another tech cannot read this sheet');
  const sheet = await inventory.receiptSheet(t1.id, techUser);
  assert.equal(sheet.code, t1.code);
  assert.equal(sheet.receipt, null);
  const setLine = sheet.lots.find(l => l.lotId === setLot.id);
  assert.deepEqual(setLine.contents, [{ label: 'الکترود SDN', expected: 20 }, { label: 'سوزن', expected: 5 }]);
  assert.equal(setLine.serialNo, 'SE-07');
  const elLine = sheet.lots.find(l => l.lotId === elLot.id);
  assert.deepEqual(elLine.contents, [{ label: 'الکترود SDN', expected: 10 }], 'a consumable line is its own single row');
  pass('receipt sheet: set contents from the template (20 + 5), consumable as sent (10)');

  // ── 5) «با مغایرت»: shortages land as receipt-stage rows; another tech cannot confirm ──
  await rejects(() => inventory.confirmReceipt(t1.id, {}, otherUser), /یافت نشد/, 'another tech cannot confirm');
  await rejects(() => inventory.confirmReceipt(t1.id, { lines: [{ lotId: 999999, label: 'x', missing: 1 }] }, techUser), /در حواله نیست/, 'foreign lot');
  await inventory.confirmReceipt(t1.id, {
    note: 'دو الکترود کم بود، یک سوزن کج',
    lines: [
      { lotId: setLot.id, label: 'الکترود SDN', missing: 2, kind: 'missing' },
      { lotId: setLot.id, label: 'سوزن', missing: 1, kind: 'damaged' },
      { lotId: elLot.id, label: 'الکترود SDN', missing: 0 },
    ],
  }, techUser);
  const t1c = await prisma.stockTransfer.findUniqueOrThrow({ where: { id: t1.id } });
  assert.ok(t1c.techReceivedAt, 'receipt stamped');
  assert.equal(t1c.techReceivedById, techAcc.id);
  assert.equal(t1c.techReceiptIssue, true);
  assert.equal(t1c.techReceiptNote, 'دو الکترود کم بود، یک سوزن کج');
  assert.equal(t1c.status, 'sent', 'the receipt is a signature, not a status change');
  const rows = await prisma.setShortage.findMany({ where: { transferId: t1.id }, orderBy: { id: 'asc' } });
  assert.deepEqual(rows.map(r => [r.label, r.missing, r.kind, r.stage]), [['الکترود SDN', 2, 'missing', 'receipt'], ['سوزن', 1, 'damaged', 'receipt']], 'zero rows are dropped; missing and damaged stay distinct');
  assert.equal(await at(setLot.id, t1c.toLocation), 1, 'confirming moves no stock');
  await rejects(() => inventory.confirmReceipt(t1.id, {}, techUser), /قبلاً تأیید/, 'second confirm');
  const agenda2 = await tech.agenda(techUser, 'today');
  const tr2 = agenda2.visits.find(v => v.id === visit.id).transfers[0];
  assert.equal(tr2.delivery, 'received_issue');
  assert.equal(tr2.receipt.issue, true);
  const drv2 = await transport.agenda(driverUser, 'today');
  assert.equal(drv2.runs[0].stops[0].cargo[0].delivery, 'received_issue');
  const detail = await inventory.transfer(t1.id, { id: admin.id, level: 6 });
  assert.equal(detail.receipt.issue, true, 'warehouse detail shows the tech receipt too');
  const list = await inventory.listTransfers({}, { id: admin.id, level: 6 });
  assert.equal(list.find(x => x.id === t1.id).receipt.issue, true);
  const ev = await prisma.domainEvent.findFirst({ where: { type: 'delivery.confirmed', refType: 'stock_transfer', refId: t1.id } });
  assert.ok(ev, 'delivery.confirmed event with the waybill as ref');
  pass('«با مغایرت» → receipt-stage shortage rows (2 missing, 1 damaged), all three panels read received_issue');

  // ── 6) short stock refuses the delivery before the stop is stamped ──
  const emptyLot = await prisma.stockLot.create({ data: { itemId: electrode.id, lotNo: 'E-EMPTY', location: home } });
  const run = await prisma.transportRun.findFirstOrThrow({ where: { staffId: staff.id } });
  const stop2 = await prisma.transportStop.create({ data: { runId: run.id, seq: 50, kind: 'deliver', hospitalId: h.id, plannedAt: '09:00' } });
  const ghost = await prisma.stockTransfer.create({ data: { code: 'HV-GHOST', fromLocation: home, toLocation: h.name, hospitalId: h.id, status: 'planned', stopId: stop2.id, plannedLines: [{ lotId: emptyLot.id, quantity: 1 }] } });
  await rejects(() => transport.markDone(stop2.id, { handedActual: 'CSR' }, driverUser), /موجودی/, 'ship with no stock');
  assert.equal((await prisma.transportStop.findUniqueOrThrow({ where: { id: stop2.id } })).doneAt, null, 'the stop is not stamped when the cargo cannot leave');
  assert.equal((await prisma.stockTransfer.findUniqueOrThrow({ where: { id: ghost.id } })).status, 'planned');
  pass('no stock → the driver gets the Persian error and the stop stays open (no phantom delivery)');

  // ── 7) a pickup stop ships nothing ──
  const pick = await prisma.transportStop.create({ data: { runId: run.id, seq: 60, kind: 'pickup', hospitalId: h.id, plannedAt: '17:00' } });
  await prisma.stockTransfer.update({ where: { id: ghost.id }, data: { stopId: pick.id } });
  await transport.markDone(pick.id, { handedActual: 'انبار' }, driverUser);
  assert.equal((await prisma.stockTransfer.findUniqueOrThrow({ where: { id: ghost.id } })).status, 'planned', 'pickup done does not ship anything');
  assert.ok((await prisma.transportStop.findUniqueOrThrow({ where: { id: pick.id } })).doneAt);
  pass('pickup «ثبتِ تحویل» stamps the stop only');

  // ── 8) unconfirmed past the clinic day → office work item; the tech\'s confirmation closes it ──
  const h2 = await prisma.hospital.create({ data: { name: 'بیمارستان میلاد' } });
  const visit2 = await mkVisit(2, h2);
  await board.planDelivery({ on: day, hospitalId: h2.id, plannedAt: '10:00', handedTo: 'CSR', staffId: staff.id, lines: [{ lotId: elLot.id, quantity: 5 }] }, admin);
  const t2 = await prisma.stockTransfer.findFirstOrThrow({ where: { visitId: visit2.id }, include: { stop: true } });
  await transport.markDone(t2.stop.id, { handedActual: 'CSR' }, driverUser);
  const d0 = await detectStaleWork(prisma);
  assert.equal(d0.deliveryUnconfirmed, 0, 'same-day: no work item yet — the tech still has the day');
  const yesterday = new Date(Date.now() - 36 * 3600e3);
  await prisma.transportStop.update({ where: { id: t2.stop.id }, data: { doneAt: yesterday } });
  const d1 = await detectStaleWork(prisma);
  assert.equal(d1.deliveryUnconfirmed, 1, 'one event per unconfirmed waybill');
  assert.equal((await detectStaleWork(prisma)).deliveryUnconfirmed, 0, 'idempotent within the week');
  await processDomainEvents(prisma);
  const work = await prisma.workItem.findFirstOrThrow({ where: { type: 'confirm_delivery', refType: 'stock_transfer', refId: t2.id } });
  assert.equal(work.state, 'open');
  assert.equal(work.ownerRole, 'secretary', 'the office owns it, not the tech');
  assert.match(work.title, new RegExp(t2.code));
  assert.match(work.title, /نیما کارشناس/);
  assert.equal(work.visitId, visit2.id);
  const t1Work = await prisma.workItem.findFirst({ where: { type: 'confirm_delivery', refId: t1.id } });
  assert.equal(t1Work, null, 'the confirmed waybill never became a work item');
  await inventory.confirmReceipt(t2.id, {}, techUser);
  await processDomainEvents(prisma);
  const closed = await prisma.workItem.findUniqueOrThrow({ where: { id: work.id } });
  assert.equal(closed.state, 'done', '«تحویل گرفتم» closes the office work item');
  const t2b = await prisma.stockTransfer.findUniqueOrThrow({ where: { id: t2.id } });
  assert.equal(t2b.techReceiptIssue, false);
  assert.equal(await prisma.setShortage.count({ where: { transferId: t2.id } }), 0, 'a clean receipt writes no shortage rows');
  pass('unconfirmed past the day → «تأییدِ تحویل» for the office (secretary); the tech\'s clean receipt closes it');

  // ── 9) usage after receipt still works on the shipped transfer ──
  await inventory.recordUsage(t1.id, [{ lotId: elLot.id, used: 4 }], techUser);
  assert.equal(await at(elLot.id, t1c.toLocation), 6, 'usage deducts from the set at the hospital');
  pass('usage sheet keeps working after the handshake');

  console.log(`\nall ${count} passed`);
} finally {
  await prisma?.$disconnect().catch(() => {});
  server.close();
  await db.close();
}
