/** Real services on a disposable database: one delivery = transfer + driver run + stop, per hospital/day. */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'pglite-server';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client');
const cls = (f, n) => require(`../../server/dist/${f}.js`)[n];
const db = new PGlite(); await db.waitReady;
const server = createServer(db, { logLevel: 0 });
let prisma, count = 0;
const pass = name => console.log(`PASS ${++count}: ${name}`);
try {
  const migrations = new URL('../../server/prisma/migrations/', import.meta.url);
  for (const dir of (await readdir(migrations)).sort()) if (dir.startsWith('20')) await db.exec(await readFile(new URL(`${dir}/migration.sql`, migrations), 'utf8'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  prisma = new PrismaClient({ datasources: { db: { url: `postgresql://postgres@127.0.0.1:${server.address().port}/postgres?connection_limit=1` } } });
  pass('all migrations apply (procedure_type_items dropped)');
  assert.equal((await prisma.$queryRawUnsafe(`select to_regclass('procedure_type_items')::text as t`))[0].t, null);
  pass('procedure template table no longer exists');

  const audit = new (cls('audit/audit.service', 'AuditService'))(prisma);
  const settings = new (cls('config/settings.service', 'SettingsService'))(prisma, audit, { require: () => ({ tenantId: 'fixture' }) }, {});
  const events = new (cls('work/events.service', 'EventsService'))(prisma);
  const places = { canonical: async v => (typeof v === 'string' && v.trim() ? v.trim() : null) };
  const noConflict = { conflicts: async () => [], consignedElsewhere: async () => [] };
  const routes = new (cls('patients/routes.service', 'RoutesService'))(prisma, audit, {}, {}, settings, places, { queueStaffNotice: async () => ({}), sweep: async () => ({ sent: 0 }) });
  const inventory = new (cls('patients/inventory.service', 'InventoryService'))(prisma, audit, noConflict, settings, places, events, routes);
  const board = new (cls('patients/transport-board.service', 'TransportBoardService'))(prisma, audit, inventory, routes);

  const admin = await prisma.account.create({ data: { username: 'tb-admin', passwordHash: 'x', level: 6, person: { create: { firstName: 'مدیر', lastName: 'تست' } } } });
  const tech = await prisma.account.create({ data: { passwordHash: 'x', level: 2, status: 'active', person: { create: { firstName: 'شهاب', lastName: 'کارشناس', phone: '09120000001' } } } });
  const d1 = await prisma.transportStaff.create({ data: { role: 'driver', vehicle: 'پژو', person: { create: { firstName: 'راننده', lastName: 'اول' } } } });
  const d2 = await prisma.transportStaff.create({ data: { role: 'driver', person: { create: { firstName: 'راننده', lastName: 'دوم' } } } });
  const h1 = await prisma.hospital.create({ data: { name: 'بیمارستان آزاد' } });
  const h2 = await prisma.hospital.create({ data: { name: 'بیمارستان کوثر' } });
  const patient = await prisma.patient.create({ data: { code: 'AM-TB', firstName: 'بیمار', lastName: 'تست' } });
  const day = '2026-10-07';
  const v1 = await prisma.visit.create({ data: { patientId: patient.id, seq: 1, hospitalId: h1.id, opDate: new Date(day), opStartTime: '09:00', techId: tech.id, techArriveTime: '08:00' } });
  await prisma.visit.create({ data: { patientId: patient.id, seq: 2, hospitalId: h1.id, opDate: new Date(day), opStartTime: '11:00' } });
  await prisma.visit.create({ data: { patientId: patient.id, seq: 3, hospitalId: h2.id, opDate: new Date(day), opStartTime: '08:00' } });
  await prisma.visit.create({ data: { patientId: patient.id, seq: 4, hospitalId: h2.id, opDate: new Date(day), opStatus: 'cancelled', opStartTime: '07:00' } });
  const device = await prisma.item.create({ data: { name: 'دستگاه مانیتورینگ', assetKind: 'device' } });
  const lot = await prisma.stockLot.create({ data: { itemId: device.id, serialNo: '12345', location: 'انبار' } });
  await prisma.stockMovement.create({ data: { lotId: lot.id, kind: 'in', quantity: 1, location: 'انبار' } });

  let b = await board.board(day);
  assert.equal(b.hospitals.length, 2, 'cancelled visit does not create a card');
  assert.deepEqual(b.hospitals.map(h => h.name), ['بیمارستان کوثر', 'بیمارستان آزاد'], 'ordered by first operation time');
  const azad = b.hospitals.find(h => h.hospitalId === h1.id);
  assert.equal(azad.visits.length, 2); assert.equal(azad.techs[0].name, 'شهاب کارشناس'); assert.equal(azad.techs[0].arriveTime, '08:00');
  assert.equal(b.summary.noCargo, 2); assert.equal(b.drivers.length, 2);
  pass('board lists the day hospitals with their visits and present technician; cancelled excluded; nothing has cargo yet');

  b = await board.planDelivery({ on: day, hospitalId: h1.id, lines: [{ lotId: lot.id, quantity: 1 }], plannedAt: '۰۸:۳۰', handedTo: 'کارشناسِ حاضر', staffId: d1.id }, admin);
  const a1 = b.hospitals.find(h => h.hospitalId === h1.id);
  assert.equal(a1.deliveries.length, 1); assert.equal(a1.deliveries[0].plannedAt, '08:30'); assert.equal(a1.deliveries[0].handedTo, 'کارشناسِ حاضر');
  assert.equal(a1.deliveries[0].staffId, d1.id); assert.equal(a1.deliveries[0].transfers.length, 1); assert.equal(a1.hasCargo, true);
  assert.equal(a1.deliveries[0].transfers[0].lines[0].serialNo, '12345');
  const t = await prisma.stockTransfer.findFirst();
  assert.equal(t.status, 'planned'); assert.equal(t.visitId, v1.id, 'transfer anchors to the earliest operation of that hospital/day');
  assert.equal(t.plannedFor.toISOString().slice(0, 10), day); assert.equal(t.hospitalId, h1.id);
  assert.equal(await prisma.transportRun.count(), 1);
  assert.equal(await prisma.stockMovement.count({ where: { kind: 'transfer' } }), 0, 'planning must not move stock');
  assert.equal(b.summary.noCargo, 1);
  pass('one save creates the planned transfer, the driver run and the stop for that hospital/day');

  b = await board.planDelivery({ on: day, hospitalId: h1.id, stopId: a1.deliveries[0].id, staffId: d2.id, plannedAt: '09:15' }, admin);
  const moved = b.hospitals.find(h => h.hospitalId === h1.id).deliveries[0];
  assert.equal(moved.staffId, d2.id); assert.equal(moved.plannedAt, '09:15'); assert.equal(moved.transfers.length, 1);
  assert.equal(await prisma.transportRun.count(), 2); assert.equal(await prisma.transportStop.count(), 1);
  pass('changing the driver moves the same stop (no duplicate stop or transfer)');

  await assert.rejects(() => board.planDelivery({ on: day, hospitalId: h2.id }, admin), /قلم|راننده/);
  await assert.rejects(() => board.planDelivery({ on: day, hospitalId: h2.id, staffId: d1.id, plannedAt: '25:99' }, admin), /ساعت/);
  await assert.rejects(() => board.planDelivery({ on: day, hospitalId: 999999, staffId: d1.id }, admin), /بیمارستان/);
  pass('empty delivery, bad time and unknown hospital are rejected before anything is written');

  const before = await prisma.transportStop.count();
  const loose = await board.planDelivery({ on: day, hospitalId: h2.id, staffId: null, lines: [{ lotId: lot.id, quantity: 1 }], force: true }, admin);
  const k = loose.hospitals.find(h => h.hospitalId === h2.id);
  assert.equal(k.deliveries.length, 1); assert.equal(k.deliveries[0].staffId, null); assert.equal(loose.summary.noDriver, 1);
  assert.equal(await prisma.transportStop.count(), before + 1);
  pass('delivery without a driver is kept, dated by its transfer, and flagged as needing a driver');

  const stopId = k.deliveries[0].id;
  const tId = k.deliveries[0].transfers[0].id;
  let after = await board.removeTransfer(tId, admin);
  assert.equal(after.hospitals.find(h => h.hospitalId === h2.id).deliveries.length, 0, 'last item of a driverless delivery takes the empty stop with it');
  assert.equal(await prisma.transportStop.count({ where: { id: stopId } }), 0);
  const second = await board.planDelivery({ on: day, hospitalId: h2.id, lines: [{ lotId: lot.id, quantity: 1 }], force: true }, admin);
  after = await board.removeDelivery(second.hospitals.find(h => h.hospitalId === h2.id).deliveries[0].id, admin);
  assert.equal(after.hospitals.find(h => h.hospitalId === h2.id).deliveries.length, 0);
  assert.equal(await prisma.stockTransfer.count({ where: { hospitalId: h2.id } }), 0, 'removing a delivery removes its planned transfers');
  await prisma.stockTransfer.updateMany({ where: { stopId: moved.id }, data: { status: 'sent' } });
  await assert.rejects(() => board.removeDelivery(moved.id, admin), /ارسال/);
  await assert.rejects(() => board.removeTransfer(moved.transfers[0].id, admin), /ارسال/);
  pass('planned items can be removed; a shipped transfer can never be deleted from the board');

  const ok = await routes.day(new Date(day));
  assert.equal(ok.runs.length, 2);
  console.log(`${count} transport board scenarios passed`);
} finally { if (prisma) await prisma.$disconnect(); server.close(); await db.close(); }
