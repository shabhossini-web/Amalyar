/**
 * Real services on a disposable database: deleting a stop (or a whole run) cancels its planned cargo.
 *
 * Owner report 1405/07/09 (roham): a delivery was put on the transport board, then its stop was deleted
 * from «مسیرِ راننده‌ها». The stop went away but the planned transfer stayed — detached, invisible on the
 * board, and still reserving the warehouse: the device read «آزاد نیست» and the set lost two from its
 * free count. «پاک کردن مساوی لغو است» — the reservation must go back to the warehouse.
 *
 * Same report: neither the driver nor the super admin saw the «حمل‌ونقل» tile, because the module had
 * stayed disabled on that install. The migration turns it on where transport staff exists.
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
const db = new PGlite(); await db.waitReady;
const server = createServer(db, { logLevel: 0 });
let prisma, count = 0;
const pass = name => console.log(`PASS ${++count}: ${name}`);
const MODULE_ON = '20261001100000_transport_module_in_use';
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
  const accounts = new (cls('accounts/accounts.service', 'AccountsService'))(prisma, { publicUser: a => a });

  const admin = await prisma.account.create({ data: { username: 'sd-admin', passwordHash: 'x', level: 6, status: 'active', person: { create: { firstName: 'مدیر', lastName: 'تست' } } } });
  const drvPerson = await prisma.person.create({ data: { firstName: 'راننده', lastName: 'یکم', phone: '09120000021' } });
  const staff = await prisma.transportStaff.create({ data: { personId: drvPerson.id, role: 'driver' } });
  const h = await prisma.hospital.create({ data: { name: 'بیمارستان آرمان' } });
  const day = clinicTodayIso();
  const home = await inventory.home();
  const device = await prisma.item.create({ data: { name: 'دستگاه ۳۲', assetKind: 'device' } });
  const set = await prisma.item.create({ data: { name: 'ست کامل ۲۰ تایی', assetKind: 'set' } });
  const devLot = await prisma.stockLot.create({ data: { itemId: device.id, serialNo: '12345', location: home } });
  const setLot = await prisma.stockLot.create({ data: { itemId: set.id, lotNo: 'A-225', location: home } });
  await prisma.stockMovement.create({ data: { lotId: devLot.id, kind: 'in', quantity: 1, location: home } });
  await prisma.stockMovement.create({ data: { lotId: setLot.id, kind: 'in', quantity: 10, location: home } });

  const free = async () => {
    const av = await board.availability([devLot.id, setLot.id], day, h.id);
    return { device: av.get(devLot.id).free, set: av.get(setLot.id).free };
  };
  const plan = (extra = {}) => board.planDelivery({
    on: day, hospitalId: h.id, plannedAt: '08:00', handedTo: 'کارشناسِ حاضر', staffId: staff.id,
    lines: [{ lotId: devLot.id, quantity: 1 }, { lotId: setLot.id, quantity: 2 }], ...extra,
  }, admin);
  const deliveryStop = async () => prisma.transportStop.findFirst({ where: { kind: 'deliver', hospitalId: h.id }, orderBy: { id: 'desc' } });

  assert.deepEqual(await free(), { device: 1, set: 10 });
  await plan();
  assert.deepEqual(await free(), { device: 0, set: 8 }, 'the board reserves what it plans');
  const s1 = await deliveryStop();
  await routes.removeStop(s1.id, admin);
  assert.equal(await prisma.stockTransfer.count({ where: { status: 'planned' } }), 0, 'the planned transfer of the deleted stop is cancelled, not left behind');
  assert.deepEqual(await free(), { device: 1, set: 10 }, 'deleting the stop gives the device and both sets back to the warehouse');
  const ev = await prisma.auditEvent.findFirst({ where: { action: 'transport.stop.remove', entityId: String(s1.id) } });
  assert.equal(ev.afterJson.cancelledTransfers.length, 1, 'the cancellation is recorded with the stop removal');
  pass('deleting a stop from the driver routes cancels its planned cargo (owner: deleting = cancel)');

  await plan();
  assert.deepEqual(await free(), { device: 0, set: 8 });
  const run = await prisma.transportRun.findFirst({ where: { staffId: staff.id } });
  await routes.deleteRun(run.id, admin);
  assert.equal(await prisma.stockTransfer.count({ where: { status: 'planned' } }), 0);
  assert.deepEqual(await free(), { device: 1, set: 10 }, 'deleting the whole run releases every reservation it carried');
  pass('deleting a whole run cancels the planned cargo of all its stops');

  await plan();
  const s3 = await deliveryStop();
  const t3 = await prisma.stockTransfer.findFirst({ where: { stopId: s3.id } });
  await routes.detach(s3.id, t3.id, admin);
  const loose = await routes.unassigned(new Date(day));
  const row = loose.find((t) => t.id === t3.id);
  assert.ok(row, 'a detached planned transfer is listed as unrouted cargo');
  assert.equal(row.status, 'planned', 'the list says it is not shipped — the run view offers the cancel button on that basis');
  assert.deepEqual(await free(), { device: 0, set: 8 }, 'detach is deliberate: the cargo stays reserved until it is cancelled or routed');
  await board.removeTransfer(t3.id, admin);
  assert.deepEqual(await free(), { device: 1, set: 10 }, 'cancelling unrouted cargo returns it to the warehouse');
  await routes.removeStop(s3.id, admin);
  pass('unrouted planned cargo can be cancelled and its reservation is released');

  await plan();
  const s4 = await deliveryStop();
  const t4 = await prisma.stockTransfer.findFirst({ where: { stopId: s4.id } });
  await inventory.shipTransfer(t4.id, admin);
  await routes.removeStop(s4.id, admin);
  const shipped = await prisma.stockTransfer.findUnique({ where: { id: t4.id } });
  assert.equal(shipped.status, 'sent', 'shipped cargo is never cancelled by deleting a stop — it physically left');
  assert.equal(shipped.stopId, null, 'it is only detached, as before');
  const av = await board.availability([devLot.id], day, h.id);
  assert.equal(av.get(devLot.id).available, 0, 'and the warehouse still knows the device is out');
  pass('shipped cargo stays shipped: the stop goes, the stock movement stays');

  /* «چرا آزاد نیست» — گزارشِ دومِ مالک: دستگاه و دو ست گیر بودند و «بارِ بی‌مسیر»ِ همان روز چیزی
     نشان نمی‌داد. رزروِ جامانده از حذفِ پیش از این اصلاح (همان کارِ کدِ قبلی: جداکردن + پاک‌کردنِ
     توقف) و رزروِ مصرفیِ روزِ دیگر باید زیرِ همان قلم در فرمِ تحویل دیده و لغو شوند. */
  const lotRow = async (lotId) => (await board.lots(day, '', h.id)).find((r) => r.id === lotId);
  await routes.removeStop(s4.id, admin).catch(() => {});
  const back = await prisma.stockTransfer.findUnique({ where: { id: t4.id } });
  await prisma.stockMovement.createMany({ data: [
    { lotId: devLot.id, kind: 'adjust', quantity: 1, location: home }, { lotId: devLot.id, kind: 'adjust', quantity: -1, location: back.toLocation },
    { lotId: setLot.id, kind: 'adjust', quantity: 2, location: home }, { lotId: setLot.id, kind: 'adjust', quantity: -2, location: back.toLocation },
  ] });
  await prisma.stockTransfer.update({ where: { id: t4.id }, data: { status: 'closed' } });
  assert.deepEqual(await free(), { device: 1, set: 10 }, 'stock is back home before the next scenario');

  await plan();
  const s5 = await deliveryStop();
  await prisma.stockTransfer.updateMany({ where: { stopId: s5.id }, data: { stopId: null } });
  await prisma.transportStop.delete({ where: { id: s5.id } });
  const devRow = await lotRow(devLot.id);
  assert.equal(devRow.free, 0, 'the orphan still reserves the device (data left by the old removeStop)');
  const dh = devRow.holds.find((x) => x.kind === 'planned');
  assert.ok(dh, 'the device row says why it is not free');
  assert.equal(dh.stopId, null); assert.equal(dh.place, 'بیمارستان آرمان'); assert.equal(dh.quantity, 1); assert.match(dh.code, /^HV-/);
  const setRow = await lotRow(setLot.id);
  assert.equal(setRow.free, 8);
  assert.equal(setRow.holds.find((x) => x.transferId === dh.transferId)?.quantity, 2, 'and the set row names the same waybill with its two sets');
  await board.removeTransfer(dh.transferId, admin);
  assert.deepEqual(await free(), { device: 1, set: 10 });
  assert.equal((await lotRow(devLot.id)).holds.length, 0, 'nothing left to explain once it is cancelled');
  pass('a stuck reservation is named under the item it blocks, and cancelling it there frees it');

  const kit = await prisma.item.create({ data: { name: 'الکترود سوزنی' } }); // بی‌نوع = مصرفی
  const kitLot = await prisma.stockLot.create({ data: { itemId: kit.id, lotNo: 'EN-1', location: home } });
  await prisma.stockMovement.create({ data: { lotId: kitLot.id, kind: 'in', quantity: 5, location: home } });
  const tomorrow = new Date(new Date(day).getTime() + 864e5).toISOString().slice(0, 10);
  await board.planDelivery({ on: tomorrow, hospitalId: h.id, plannedAt: '09:00', staffId: staff.id, lines: [{ lotId: kitLot.id, quantity: 3 }] }, admin);
  const s6 = await prisma.transportStop.findFirst({ where: { kind: 'deliver' }, orderBy: { id: 'desc' } });
  await prisma.stockTransfer.updateMany({ where: { stopId: s6.id }, data: { stopId: null } });
  await prisma.transportStop.delete({ where: { id: s6.id } });
  assert.equal((await routes.unassigned(new Date(day))).length, 0, 'today\'s unrouted list cannot show a reservation dated tomorrow');
  const kitRow = await lotRow(kitLot.id);
  assert.equal(kitRow.free, 2, 'a consumable is reserved whatever the day');
  const kh = kitRow.holds.find((x) => x.kind === 'planned');
  assert.equal(kh?.quantity, 3); assert.equal(kh.stopId, null);
  assert.equal(new Date(kh.plannedFor).toISOString().slice(0, 10), tomorrow, 'the row says which day holds it');
  await board.removeTransfer(kh.transferId, admin);
  assert.equal((await lotRow(kitLot.id)).free, 5);
  pass('a reservation from another day is visible and cancellable from today\'s form');

  await plan();
  const s7 = await deliveryStop();
  const t7 = await prisma.stockTransfer.findFirst({ where: { stopId: s7.id } });
  await inventory.shipTransfer(t7.id, admin);
  const outRow = await lotRow(devLot.id);
  const oh = outRow.holds.find((x) => x.kind === 'out');
  assert.ok(oh, 'shipped stock is explained as outside the warehouse');
  assert.equal(oh.place, 'بیمارستان آرمان'); assert.equal(oh.quantity, 1); assert.equal(oh.transferId, t7.id);
  assert.ok(!outRow.holds.some((x) => x.kind === 'planned'), 'a shipped waybill is not also counted as a reservation');
  pass('stock that already left is named with its place and waybill, never offered for cancelling');

  /* ماژولِ «حمل‌ونقل»: خاموش‌ماندهٔ یک نصبِ قدیمی، و پیامِ «چرا هیچ نمی‌بیند». */
  const sql = await readFile(new URL(`${MODULE_ON}/migration.sql`, migrations), 'utf8');
  const enabled = async () => (await prisma.feature.findUnique({ where: { key: 'transport' } })).enabled;
  await prisma.feature.upsert({ where: { key: 'transport' }, update: { enabled: false }, create: { key: 'transport', minLevel: 2, enabled: false } });

  const acc = await prisma.account.create({ data: { username: 'sd-driver', passwordHash: 'x', level: 2, status: 'active', jobRole: 'technician', person: { create: { firstName: 'test', lastName: 'car', phone: '09120000022' } } } });
  const r1 = await accounts.setJobRole(acc.id, 'driver', admin.id);
  assert.match(r1.notice ?? '', /حمل‌ونقل.*خاموش/, 'giving the driver role while the module is off says why nothing will show');

  await prisma.transportStaff.updateMany({ data: { active: false } });
  await db.exec(sql);
  assert.equal(await enabled(), false, 'an install without any active transport staff is left as it is');
  await prisma.transportStaff.updateMany({ data: { active: true } });
  await prisma.setting.upsert({ where: { key: 'vertical' }, update: { value: 'clinic' }, create: { key: 'vertical', value: 'clinic' } });
  await db.exec(sql);
  assert.equal(await enabled(), false, 'a clinic never gets the transport module from this migration');
  await prisma.setting.delete({ where: { key: 'vertical' } });
  await db.exec(sql);
  assert.equal(await enabled(), true, 'a company that has drivers gets the module back');
  await db.exec(sql);
  assert.equal(await enabled(), true, 'running it again changes nothing');
  const r2 = await accounts.setJobRole(acc.id, 'courier', admin.id);
  assert.equal(r2.notice, undefined, 'no notice once the module is on');
  const r3 = await accounts.setJobRole(acc.id, 'technician', admin.id);
  assert.equal(r3.notice, undefined, 'other roles never get the transport notice');
  pass('the transport module comes back where drivers exist; the role change explains a disabled module');

  console.log(`${count} stop-release scenarios passed`);
} finally { if (prisma) await prisma.$disconnect(); server.close(); await db.close(); }
