/**
 * Real services on a disposable database: a driver account sees its own route.
 *
 * Owner report 1405/07/09 (account «test car»): the role «راننده» was set from the users page,
 * a delivery was put on the transport board for today, and the account
 *  - had no «حمل‌ونقل» tile (setJobRole never created the TransportStaff row),
 *  - saw nothing on «امروز»,
 *  - saw clinical tiles (front desk, theatre, pathway) that have nothing to do with driving,
 * and the driver/tech panels listed a board delivery as a bare waybill number (planned transfers
 * keep their lines in `plannedLines`, not in stock movements).
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
const BACKFILL = '20261001000000_field_role_staff';
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
  const transport = new (cls('patients/transport.service', 'TransportService'))(prisma, audit, places, routes);
  const tech = new (cls('patients/tech.service', 'TechService'))(prisma, null, null, null, events, routes);
  const dispatch = new (cls('patients/dispatch.service', 'DispatchService'))(prisma, audit, routes);
  const features = new (cls('features/features.service', 'FeaturesService'))(prisma);
  const accounts = new (cls('accounts/accounts.service', 'AccountsService'))(prisma, { publicUser: a => a });
  const work = { counts: async () => ({ total: 0, overdue: 0 }), list: async () => [], targets: async () => [] };
  const today = new (cls('work/today.service', 'TodayService'))(prisma, work, features);

  const admin = await prisma.account.create({ data: { username: 'fr-admin', passwordHash: 'x', level: 6, status: 'active', person: { create: { firstName: 'مدیر', lastName: 'تست' } } } });
  const techAcc = await prisma.account.create({ data: { username: 'fr-tech', passwordHash: 'x', level: 2, status: 'active', jobRole: 'technician', person: { create: { firstName: 'شهاب', lastName: 'کارشناس', phone: '09120000011' } } } });
  // Exactly the owner's path: an account made as something else, then given the role «راننده».
  const drvAcc = await prisma.account.create({ data: { username: 'testcar', passwordHash: 'x', level: 2, status: 'active', jobRole: 'technician', person: { create: { firstName: 'test', lastName: 'car', phone: '09120000012' } } } });
  await accounts.setJobRole(drvAcc.id, 'driver', admin.id);
  const staff = await prisma.transportStaff.findUnique({ where: { personId: drvAcc.personId } });
  assert.ok(staff, 'role «راننده» from the users page creates the driver record for the same person');
  assert.equal(staff.role, 'driver'); assert.equal(staff.active, true);
  pass('setting the driver role links the account to a TransportStaff row (parity with temporary accounts)');

  await prisma.transportStaff.update({ where: { id: staff.id }, data: { active: false } });
  await accounts.setJobRole(drvAcc.id, 'courier', admin.id);
  const again = await prisma.transportStaff.findUnique({ where: { personId: drvAcc.personId } });
  assert.equal(again.id, staff.id, 'no second row for the same person');
  assert.equal(again.role, 'courier'); assert.equal(again.active, true, 'choosing the role again reactivates the record');
  await accounts.setJobRole(drvAcc.id, 'driver', admin.id);
  pass('choosing the role again updates and reactivates the same record, never duplicates it');

  const drvUser = { id: drvAcc.id, level: 2, jobRole: 'driver' };
  const techUser = { id: techAcc.id, level: 2, jobRole: 'technician' };
  const allowedOf = async (u) => Object.fromEntries((await features.forUser(u)).map(r => [r.key, r.allowed]));
  const drvF = await allowedOf(drvUser);
  assert.equal(drvF.transport, true, 'the driver sees «حمل‌ونقل»');
  for (const k of ['frontdesk', 'theatre', 'pathway', 'tech']) assert.equal(drvF[k], false, `the driver must not see ${k}`);
  assert.equal(drvF.messenger, true, 'messenger stays for the field roles');
  const techF = await allowedOf(techUser);
  for (const k of ['frontdesk', 'theatre', 'pathway', 'tech']) assert.equal(techF[k], true, `the technician keeps ${k}`);
  assert.equal(techF.transport, false, 'a technician without a driver record has no transport tile');
  pass('driver sees transport and messenger, not the clinical floor; technician unchanged');

  const accessPreview = new (cls('auth/access.service', 'AccessService'))(prisma);
  const prev = await accessPreview.preview('feature', 'theatre', { minLevel: 2 });
  assert.ok(Array.isArray(prev.lost) && Array.isArray(prev.gained), 'access preview still answers for a role-gated module');
  pass('the access matrix preview reads the same eligibility for the clinical floor');

  const h = await prisma.hospital.create({ data: { name: 'بیمارستان آرمان' } });
  const patient = await prisma.patient.create({ data: { code: 'AM-FR', firstName: 'بیمار', lastName: 'تست' } });
  const day = clinicTodayIso();
  const visit = await prisma.visit.create({ data: { patientId: patient.id, seq: 1, hospitalId: h.id, opDate: new Date(day), opStartTime: '09:00', techId: techAcc.id, techArriveTime: '08:00' } });
  const device = await prisma.item.create({ data: { name: 'دستگاه مانیتورینگ', assetKind: 'device' } });
  const lot = await prisma.stockLot.create({ data: { itemId: device.id, serialNo: '12345', location: 'انبار' } });
  await prisma.stockMovement.create({ data: { lotId: lot.id, kind: 'in', quantity: 1, location: 'انبار' } });
  await board.planDelivery({ on: day, hospitalId: h.id, lines: [{ lotId: lot.id, quantity: 1 }], plannedAt: '08:00', handedTo: 'کارشناسِ حاضر', staffId: staff.id }, admin);
  assert.equal((await prisma.stockTransfer.findFirst()).status, 'planned', 'the board plans, it does not ship');

  const ag = await transport.agenda(drvUser, 'today');
  const stop = ag.runs.flatMap(r => r.stops)[0];
  assert.ok(stop, 'the driver panel lists today\'s stop');
  assert.equal(stop.cargo[0].items.length, 1, 'a planned transfer lists its items in the driver panel');
  assert.equal(stop.cargo[0].items[0].name, 'دستگاه مانیتورینگ'); assert.equal(stop.cargo[0].items[0].serialNo, '12345');
  assert.ok(!JSON.stringify(ag).includes('AM-FR'), 'still nothing from the patient reaches the driver');
  pass('driver panel: a board delivery shows what to carry, not only the waybill number');

  const tag = await tech.agenda(techUser, 'today');
  const tv = tag.visits.find(v => v.id === visit.id);
  assert.equal(tv.transfers[0].items[0].name, 'دستگاه مانیتورینگ', 'the technician sees the set that is coming');
  pass('tech panel: the planned transfer of the visit lists its items');

  const br = await dispatch.briefing(visit.id, 'tech');
  assert.match(br.text, /دستگاه مانیتورینگ \(12345\)/, 'the technician briefing names the planned set');
  pass('technician briefing names the planned set instead of leaving it out');

  const td = await today.today(drvUser);
  assert.equal(td.sections.route, true, '«امروز» has a route section for the driver');
  assert.equal(td.route.length, 1); assert.equal(td.route[0].place, 'بیمارستان آرمان');
  assert.equal(td.route[0].kindFa, 'تحویل'); assert.equal(td.route[0].plannedAt, '08:00'); assert.equal(td.route[0].done, false);
  assert.equal(td.brief.stopsLeft, 1);
  const tt = await today.today(techUser);
  assert.equal(tt.sections.route, false, 'a technician has no route section');
  const ta = await today.today({ id: admin.id, level: 6, jobRole: null });
  assert.equal(ta.sections.route, false, 'the super admin keeps the board, not a personal route');
  pass('«امروز» shows the driver\'s stops for today; others are unchanged');

  // Backfill: an account that got the role before this fix (no record) is repaired by the migration.
  const old = await prisma.account.create({ data: { username: 'oldpeyk', passwordHash: 'x', level: 2, status: 'active', jobRole: 'courier', person: { create: { firstName: 'پیک', lastName: 'قدیمی' } } } });
  const off = await prisma.account.create({ data: { username: 'offdrv', passwordHash: 'x', level: 2, status: 'disabled', jobRole: 'driver', person: { create: { firstName: 'راننده', lastName: 'غیرفعال' } } } });
  const sql = await readFile(new URL(`${BACKFILL}/migration.sql`, migrations), 'utf8');
  await db.exec(sql); await db.exec(sql);
  const fixed = await prisma.transportStaff.findMany({ where: { personId: old.personId } });
  assert.equal(fixed.length, 1); assert.equal(fixed[0].role, 'courier');
  assert.equal(await prisma.transportStaff.count({ where: { personId: off.personId } }), 0, 'a disabled account gets no record');
  assert.equal(await prisma.transportStaff.count({ where: { personId: drvAcc.personId } }), 1, 'an existing record is left as it is');
  pass('migration backfills missing driver/courier records once, only for active accounts');

  console.log(`${count} field-role scenarios passed`);
} finally { if (prisma) await prisma.$disconnect(); server.close(); await db.close(); }
