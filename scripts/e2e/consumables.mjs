/**
 * Real services on a disposable database: the tech's consumables sheet and the driver's pickup count
 * (owner, 1405/07/11 — package ج, items 6 and 7 of the approved plan).
 *
 *  - «ثبتِ مصرفی»: one sheet per surgery — from the set (ledger `out` at the set location, tied to the
 *    visit and the waybill), loose waybill lines (the old usage sheet's ledger), and flagged warehouse
 *    items («نمایش در پنلِ کارشناسی», taken from the home location). Multi-use items are only counted.
 *    Numbers are totals; the server applies the delta and corrections return to the same lots.
 *  - Locked while a set still awaits the tech's «تحویل گرفتم»; read-only once the waybills are closed.
 *  - The driver counts packages when taking them back from the tech (expected = sent − used); a short
 *    count becomes a pickup-stage shortage; a delivery stop never counts (sterile sets stay sealed).
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
const { setLocationOf } = require('../../server/dist/patients/stock-math.js');
const { pickupOf } = require('../../server/dist/patients/handover.js');
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
  const sets = new (cls('patients/set-stock.service', 'SetStockService'))(prisma, audit, settings, inventory);
  const usage = new (cls('patients/usage.service', 'VisitUsageService'))(prisma, audit, events, inventory, sets);
  const board = new (cls('patients/transport-board.service', 'TransportBoardService'))(prisma, audit, inventory, routes);
  const transport = new (cls('patients/transport.service', 'TransportService'))(prisma, audit, places, routes, inventory);
  const tech = new (cls('patients/tech.service', 'TechService'))(prisma, {}, {}, {}, events, routes);

  // ── fixture ──
  const admin = await prisma.account.create({ data: { username: 'cs-admin', passwordHash: 'x', level: 6, status: 'active', person: { create: { firstName: 'مدیر', lastName: 'تست' } } } });
  const drvPerson = await prisma.person.create({ data: { firstName: 'رضا', lastName: 'احمدی', phone: '09120000041' } });
  const staff = await prisma.transportStaff.create({ data: { personId: drvPerson.id, role: 'driver' } });
  const driver = await prisma.account.create({ data: { username: 'cs-driver', passwordHash: 'x', level: 2, status: 'active', personId: drvPerson.id } });
  const techAcc = await prisma.account.create({ data: { username: 'cs-tech', passwordHash: 'x', level: 2, status: 'active', person: { create: { firstName: 'نیما', lastName: 'کارشناس' } } } });
  const otherTech = await prisma.account.create({ data: { username: 'cs-tech2', passwordHash: 'x', level: 2, status: 'active', person: { create: { firstName: 'سمیرا', lastName: 'دیگر' } } } });
  const h = await prisma.hospital.create({ data: { name: 'بیمارستان آرمان' } });
  const h2 = await prisma.hospital.create({ data: { name: 'بیمارستان میلاد' } });
  const day = clinicTodayIso();
  const patient = await prisma.patient.create({ data: { code: 'AM-9101', firstName: 'بیمار', lastName: 'یکم' } });
  const mkVisit = (seq, hospital = h, techId = techAcc.id) => prisma.visit.create({
    data: { patientId: patient.id, seq, kind: 'surgery', opStatus: 'pending', opDate: new Date(`${day}T00:00:00.000Z`), hospitalId: hospital.id, hospitalName: hospital.name, techId },
  });
  const visit = await mkVisit(1);
  const techUser = { id: techAcc.id, level: 2 };
  const otherUser = { id: otherTech.id, level: 2 };
  const driverUser = { id: driver.id, level: 2 };

  const home = await inventory.home();
  const setItem = await prisma.item.create({ data: { name: 'ست SDN', assetKind: 'set', usageMode: 'multi' } });
  const electrode = await prisma.item.create({ data: { name: 'الکترود SDN', assetKind: 'consumable', unit: 'عدد', usageMode: 'single' } });
  const cable = await prisma.item.create({ data: { name: 'کابلِ رابط', assetKind: 'consumable', unit: 'عدد', usageMode: 'multi' } });
  const gel = await prisma.item.create({ data: { name: 'ژلِ هادی', assetKind: 'consumable', unit: 'تیوب', usageMode: 'single', showInTechPanel: true } });
  const probe = await prisma.item.create({ data: { name: 'پروبِ تحریک', assetKind: 'consumable', unit: 'عدد', usageMode: 'multi', showInTechPanel: true } });
  const hidden = await prisma.item.create({ data: { name: 'پیچِ پدیکول', assetKind: 'consumable', unit: 'عدد', usageMode: 'single', showInTechPanel: false } });
  const gauze = await prisma.item.create({ data: { name: 'گازِ استریل', assetKind: 'consumable', unit: 'بسته', usageMode: 'single' } });
  await prisma.itemComponent.createMany({ data: [
    { setId: setItem.id, label: 'الکترود SDN', quantity: 20, partId: electrode.id },
    { setId: setItem.id, label: 'کابلِ رابط', quantity: 2, partId: cable.id },
    { setId: setItem.id, label: 'سوزن', quantity: 5 },
  ] });
  const mkLot = async (itemId, data, qty) => {
    const lot = await prisma.stockLot.create({ data: { itemId, location: home, ...data } });
    await prisma.stockMovement.create({ data: { lotId: lot.id, kind: 'in', quantity: qty, location: home } });
    return lot;
  };
  const setLot = await mkLot(setItem.id, { serialNo: 'SE-07' }, 1);
  const elLot = await mkLot(electrode.id, { lotNo: 'E-100' }, 100);
  const cableLot = await mkLot(cable.id, { lotNo: 'C-1' }, 5);
  const gelLot = await mkLot(gel.id, { lotNo: 'G-1' }, 3);
  await mkLot(probe.id, { lotNo: 'P-1' }, 2);
  await mkLot(hidden.id, { lotNo: 'H-1' }, 9);
  const gauzeLot = await mkLot(gauze.id, { lotNo: 'GZ-1' }, 50);
  const setLoc = setLocationOf(setLot);
  const at = async (lotId, location) => {
    const rows = await prisma.stockMovement.findMany({ where: { lotId }, select: { quantity: true, location: true } });
    return rows.filter(r => (r.location ?? home) === location).reduce((s, r) => s + r.quantity, 0);
  };
  const f = await sets.fill(setLot.id, {}, admin);
  assert.equal(f.short.length, 0);
  assert.equal(await at(elLot.id, setLoc), 20);
  assert.equal(await at(cableLot.id, setLoc), 2);

  // board delivery → driver ships it → the set is awaiting the tech
  await board.planDelivery({ on: day, hospitalId: h.id, plannedAt: '08:00', handedTo: 'CSR', staffId: staff.id, lines: [{ lotId: setLot.id, quantity: 1 }, { lotId: gauzeLot.id, quantity: 10 }] }, admin);
  const t = await prisma.stockTransfer.findFirstOrThrow({ where: { visitId: visit.id }, include: { stop: true } });
  await transport.markDone(t.stopId, { handedActual: 'CSR' }, driverUser);
  assert.equal((await prisma.stockTransfer.findUniqueOrThrow({ where: { id: t.id } })).status, 'sent');

  // ── 1) locked until the tech confirms receipt ──
  let sh = await usage.sheet(visit.id, techUser);
  assert.equal(sh.awaiting, true);
  assert.equal(sh.canRecord, false);
  assert.equal(sh.editable, true);
  await rejects(() => usage.save(visit.id, { lines: [{ source: 'warehouse', itemId: gel.id, quantity: 1 }] }, techUser), /تحویلِ ست را تأیید/, 'no usage before the handshake');
  pass('the sheet is locked while the set awaits «تحویل گرفتم» — a set you have not received has no usage');

  // ── 2) composition: set contents, loose waybill lines, flagged warehouse items ──
  await inventory.confirmReceipt(t.id, {}, techUser);
  sh = await usage.sheet(visit.id, techUser);
  assert.equal(sh.awaiting, false);
  assert.equal(sh.code, 'AM-9101-V1');
  assert.equal(sh.sets.length, 1);
  assert.equal(sh.sets[0].serialNo, 'SE-07');
  const setEl = sh.sets[0].lines.find(l => l.itemId === electrode.id);
  const setCable = sh.sets[0].lines.find(l => l.itemId === cable.id);
  assert.deepEqual([setEl.mode, setEl.limit, setEl.quantity, setEl.source], ['consume', 20, 0, 'set']);
  assert.deepEqual([setCable.mode, setCable.limit, setCable.usesTotal], ['use', null, 0], 'multi-use parts are only counted');
  assert.equal(sh.sets[0].lines.length, 2, 'the label-only «سوزن» is not stock and has no line');
  assert.equal(sh.transfers.length, 1);
  const loose = sh.transfers[0].lines[0];
  assert.deepEqual([loose.itemId, loose.lotId, loose.limit, loose.quantity, loose.source], [gauze.id, gauzeLot.id, 10, 0, 'transfer']);
  const wh = Object.fromEntries(sh.warehouse.map(l => [l.itemId, l]));
  assert.ok(wh[gel.id] && wh[probe.id], 'flagged items come from the warehouse');
  assert.deepEqual([wh[gel.id].mode, wh[gel.id].limit], ['consume', 3]);
  assert.equal(wh[probe.id].mode, 'use');
  assert.equal(wh[hidden.id], undefined, 'an item without the tech-panel flag stays out');
  assert.equal(wh[electrode.id], undefined, 'a part already inside the set is not offered twice');
  pass('sheet: from the set (tracked parts), loose waybill lines, flagged warehouse items — nothing else');

  // ── 3) first save: set out, loose out, warehouse out; multi-use only counted ──
  sh = await usage.save(visit.id, { lines: [
    { source: 'set', itemId: electrode.id, setLotId: setLot.id, quantity: 2 },
    { source: 'set', itemId: cable.id, setLotId: setLot.id, quantity: 1 },
    { source: 'transfer', itemId: gauze.id, lotId: gauzeLot.id, quantity: 3 },
    { source: 'warehouse', itemId: gel.id, quantity: 1 },
    { source: 'warehouse', itemId: probe.id, quantity: 1 },
  ] }, techUser);
  assert.equal(await at(elLot.id, setLoc), 18, 'consumption comes out of the set itself');
  const setOut = await prisma.stockMovement.findMany({ where: { lotId: elLot.id, kind: 'out', location: setLoc } });
  assert.equal(setOut.length, 1);
  assert.deepEqual([setOut[0].quantity, setOut[0].visitId, setOut[0].transferId, setOut[0].visitCode], [-2, visit.id, t.id, 'AM-9101-V1']);
  assert.equal(await at(gauzeLot.id, h.name), 7, 'loose waybill lines use the old usage ledger');
  assert.equal(await at(gelLot.id, home), 2, 'warehouse items come out of the home location');
  const gelOut = await prisma.stockMovement.findFirst({ where: { lotId: gelLot.id, kind: 'out' } });
  assert.deepEqual([gelOut.visitId, gelOut.transferId], [visit.id, null]);
  assert.equal(await at(cableLot.id, setLoc), 2, 'multi-use: nothing leaves the ledger');
  assert.equal(await prisma.stockMovement.count({ where: { lot: { itemId: { in: [cable.id, probe.id] } }, kind: { in: ['out', 'return'] } } }), 0);
  assert.equal(await prisma.visitUsage.count({ where: { visitId: visit.id } }), 5);
  assert.equal(sh.sets[0].lines.find(l => l.itemId === cable.id).usesTotal, 1, '«تا امروز ۱ بار»');
  assert.equal(sh.warehouse.find(l => l.itemId === probe.id).usesTotal, 1);
  assert.ok(sh.recordedAt);
  const ag = await tech.agenda(techUser, 'today');
  const v1 = ag.visits.find(v => v.id === visit.id);
  assert.equal(v1.usage.canRecord, true);
  assert.deepEqual(v1.usage.lines.map(l => [l.name, l.quantity, l.mode]).sort(), [['الکترود SDN', 2, 'consume'], ['پروبِ تحریک', 1, 'use'], ['ژلِ هادی', 1, 'consume'], ['کابلِ رابط', 1, 'use'], ['گازِ استریل', 3, 'consume']].sort(), 'the card summary comes from the server');
  pass('save: set parts leave the set, loose lines leave the waybill, flagged items leave the warehouse; multi-use is only counted');

  // ── 4) corrections go back to the same lots; zero removes the row; counts can go up ──
  sh = await usage.save(visit.id, { lines: [
    { source: 'set', itemId: electrode.id, setLotId: setLot.id, quantity: 1 },
    { source: 'warehouse', itemId: gel.id, quantity: 0 },
    { source: 'warehouse', itemId: probe.id, quantity: 2 },
    { source: 'transfer', itemId: gauze.id, lotId: gauzeLot.id, quantity: 4 },
  ] }, techUser);
  assert.equal(await at(elLot.id, setLoc), 19);
  assert.equal((await prisma.stockMovement.findMany({ where: { lotId: elLot.id, kind: 'return', location: setLoc } })).length, 1, 'a correction is a return movement, not an edit');
  assert.equal(await at(gelLot.id, home), 3);
  assert.equal(await prisma.visitUsage.count({ where: { visitId: visit.id, itemId: gel.id } }), 0, 'zero deletes the row');
  assert.equal(sh.warehouse.find(l => l.itemId === probe.id).usesTotal, 2);
  assert.equal(await at(gauzeLot.id, h.name), 6);
  pass('corrections return to the lots this surgery consumed from; zero removes the row; use counts move both ways');

  // ── 5) limits and strangers ──
  await rejects(() => usage.save(visit.id, { lines: [{ source: 'set', itemId: electrode.id, setLotId: setLot.id, quantity: 25 }] }, techUser), /فقط 19 عدد در ست/, 'more than inside the set');
  await rejects(() => usage.save(visit.id, { lines: [{ source: 'warehouse', itemId: gel.id, quantity: 9 }] }, techUser), /فقط 3 عدد در انبار/, 'more than the warehouse holds');
  await rejects(() => usage.save(visit.id, { lines: [{ source: 'transfer', itemId: gauze.id, lotId: gauzeLot.id, quantity: 11 }] }, techUser), /ارسال شده/, 'more than sent');
  await rejects(() => usage.save(visit.id, { lines: [{ source: 'warehouse', itemId: hidden.id, quantity: 1 }] }, techUser), /در برگهٔ مصرفیِ این عمل نیست/, 'an unflagged item');
  await rejects(() => usage.save(visit.id, { lines: [{ source: 'set', itemId: electrode.id, setLotId: setLot.id, quantity: -1 }] }, techUser), /منفی/, 'negative');
  await rejects(() => usage.sheet(visit.id, otherUser), /در کارهای شما نیست/, 'another tech');
  assert.equal((await usage.sheet(visit.id, { id: admin.id, level: 6 })).sets.length, 1, 'the super admin reads every sheet');
  pass('limits are the set, the waybill and the warehouse; strangers and unflagged items are refused in Persian');

  // ── 6) the driver counts packages at pickup: expected = sent − used ──
  await inventory.releaseTransfer(t.id, { pickupAt: '17:00', leftAt: 'CSR' }, techUser);
  const run = await prisma.transportRun.findFirstOrThrow({ where: { staffId: staff.id } });
  const pick = await prisma.transportStop.create({ data: { runId: run.id, seq: 60, kind: 'pickup', hospitalId: h.id, plannedAt: '17:00' } });
  await prisma.stockTransfer.update({ where: { id: t.id }, data: { stopId: pick.id } });
  const agendaBefore = await transport.agenda(driverUser, 'today');
  const bag = agendaBefore.runs.flatMap(r => r.stops).find(s => s.id === pick.id).cargo[0];
  assert.deepEqual(bag.items.map(i => [i.lotId, i.quantity, i.remaining]).sort((a, b) => a[0] - b[0]), [[setLot.id, 1, 1], [gauzeLot.id, 10, 6]].sort((a, b) => a[0] - b[0]), 'the driver sees what should come back, not what was sent');
  assert.equal(bag.pickup, null);
  await rejects(() => transport.markDone(pick.id, { counts: [{ transferId: t.id, lotId: gauzeLot.id, counted: 7 }] }, driverUser), /بیشتر از آنچه باید برگردد/, 'counting more than remains');
  assert.equal((await prisma.transportStop.findUniqueOrThrow({ where: { id: pick.id } })).doneAt, null, 'a refused count does not stamp the stop');
  await transport.markDone(pick.id, { handedActual: 'کارشناس', notes: 'یک گاز کم بود', sealIntact: false, counts: [
    { transferId: t.id, lotId: setLot.id, counted: 1 }, { transferId: t.id, lotId: gauzeLot.id, counted: 5 },
  ] }, driverUser);
  const tp = await prisma.stockTransfer.findUniqueOrThrow({ where: { id: t.id } });
  assert.ok(tp.driverCountedAt);
  assert.deepEqual([tp.driverCountedById, tp.driverCountIssue, tp.driverSealIntact, tp.driverCountNote], [driver.id, true, false, 'یک گاز کم بود']);
  const shortages = await prisma.setShortage.findMany({ where: { transferId: t.id } });
  assert.deepEqual(shortages.map(x => [x.lotId, x.missing, x.kind, x.stage, x.notes]), [[gauzeLot.id, 1, 'missing', 'pickup', 'یک گاز کم بود']]);
  assert.equal(await at(gauzeLot.id, h.name), 6, 'the count moves no stock — it is the driver\'s signature');
  const agendaAfter = await transport.agenda(driverUser, 'today');
  const bagAfter = agendaAfter.runs.flatMap(r => r.stops).find(s => s.id === pick.id).cargo[0];
  assert.deepEqual([bagAfter.pickup.issue, bagAfter.pickup.sealIntact, bagAfter.pickup.note], [true, false, 'یک گاز کم بود']);
  assert.equal((await inventory.transfer(t.id, { id: admin.id, level: 6 })).pickup.issue, true, 'the warehouse sees the driver\'s count');
  assert.deepEqual(pickupOf({}), null);
  pass('pickup count: expected = sent − used, short = pickup-stage shortage, over = refused, stock untouched');

  // ── 7) a delivery stop ignores counts (sterile sets are not opened) ──
  const visit2 = await mkVisit(2, h2);
  const gauzeLot2 = await mkLot(gauze.id, { lotNo: 'GZ-2' }, 10);
  await board.planDelivery({ on: day, hospitalId: h2.id, plannedAt: '10:00', handedTo: 'CSR', staffId: staff.id, lines: [{ lotId: gauzeLot2.id, quantity: 4 }] }, admin);
  const t2 = await prisma.stockTransfer.findFirstOrThrow({ where: { visitId: visit2.id } });
  await transport.markDone(t2.stopId, { handedActual: 'CSR', counts: [{ transferId: t2.id, lotId: gauzeLot2.id, counted: 1 }], sealIntact: true }, driverUser);
  const t2b = await prisma.stockTransfer.findUniqueOrThrow({ where: { id: t2.id } });
  assert.equal(t2b.status, 'sent');
  assert.equal(t2b.driverCountedAt, null, 'delivery: no count recorded');
  assert.equal(await prisma.setShortage.count({ where: { transferId: t2.id } }), 0);
  pass('a delivery stop never counts — the sterile set is not opened on the way out');

  // ── 8) closed waybill → read-only sheet ──
  await inventory.returnTransfer(t.id, { id: admin.id, level: 6 });
  sh = await usage.sheet(visit.id, techUser);
  assert.equal(sh.editable, false);
  assert.equal(sh.sets.length, 0, 'a closed waybill is no longer a source');
  await rejects(() => usage.save(visit.id, { lines: [{ source: 'warehouse', itemId: gel.id, quantity: 1 }] }, techUser), /بسته شده/, 'closed');
  const ag2 = await tech.agenda(techUser, 'today');
  assert.equal(ag2.visits.find(v => v.id === visit.id).usage.lines.length, 4, 'the recorded summary stays on the card');
  pass('once the waybills are closed the sheet is read-only; the card keeps its summary');

  console.log(`\nall ${count} passed`);
} finally {
  await prisma?.$disconnect().catch(() => {});
  server.close();
  await db.close();
}
