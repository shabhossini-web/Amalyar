/**
 * Real services on a disposable database: a set is a stock package (owner, 1405/07/11, package ب).
 *
 * The owner's own numbers: «100 SDN electrodes and 2 sets of 20 each → the warehouse holds 60; set A loses
 * 2 at surgery → 18 inside; refill from the warehouse → A back to 20 and the warehouse 58.» Every serialized
 * set is a ledger location («ست SE-A»); its contents are movements at that location; standard comes from the
 * contents template; shortage is computed. Damage goes to «خرابی‌ها» where it is scrapped or repaired; the
 * return count on a waybill records lost (not consumed) and damaged items as return-stage shortages.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'pglite-server';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client');
const cls = (f, n) => require(`../../server/dist/${f}.js`)[n];
const { DAMAGED_LOCATION, setLocationOf } = require('../../server/dist/patients/stock-math.js');
const { PERMISSIONS } = require('../../server/dist/auth/access-registry.js');
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
  const noConflict = { conflicts: async () => [], consignedElsewhere: async () => [] };
  const inventory = new (cls('patients/inventory.service', 'InventoryService'))(prisma, audit, noConflict, settings, {}, events, {});
  const sets = new (cls('patients/set-stock.service', 'SetStockService'))(prisma, audit, settings, inventory);
  const defs = new (cls('patients/definitions.service', 'DefinitionsService'))(prisma, audit);
  const user = await prisma.account.create({ data: { username: 'ws-keeper', passwordHash: 'x', level: 3, status: 'active', person: { create: { firstName: 'انباردار', lastName: 'تست' } } } });
  const home = await inventory.home();
  const at = async (lotId, location) => {
    const rows = await prisma.stockMovement.findMany({ where: { lotId }, select: { quantity: true, location: true } });
    return rows.filter(r => (r.location ?? home) === location).reduce((s, r) => s + r.quantity, 0);
  };

  // ── 1) the two item flags; returnables are always multi-use ──
  assert.equal(PERMISSIONS.find(p => p.key === 'inventory.items')?.defaultLevel, 3, 'item catalog opens at level 3 (warehouse keeper)');
  const electrode = await defs.createItem({ name: 'الکترود SDN', assetKind: 'consumable', unit: 'عدد', showInTechPanel: true, usageMode: 'multi' });
  assert.equal(electrode.showInTechPanel, true);
  assert.equal(electrode.usageMode, 'multi');
  const setItem = await defs.createItem({ name: 'ست SDN', assetKind: 'set', usageMode: 'single' });
  assert.equal(setItem.usageMode, 'multi', 'a set cannot be single-use — it comes back');
  await rejects(() => defs.createItem({ name: 'قلمِ بد', usageMode: 'weekly' }), /نوعِ مصرف/, 'bad usage mode');
  const single = await defs.updateItem(electrode.id, { usageMode: 'single' });
  assert.equal(single.usageMode, 'single');
  await defs.updateItem(electrode.id, { usageMode: 'multi' });
  const rawDevice = await prisma.item.create({ data: { name: 'دستگاهِ بی‌تیک', assetKind: 'device' } });
  const cat = await inventory.catalog();
  assert.equal(cat.find(x => x.id === rawDevice.id).usageMode, 'multi', 'catalog normalizes returnables to multi-use even when seeded without the flag');
  assert.equal(cat.find(x => x.id === electrode.id).usageLabel, 'چندبارمصرف');
  pass('item flags: show-in-tech-panel + single/multi; set and device are always multi-use');

  // ── 2) template + lots: 100 electrodes, two serialized sets ──
  await prisma.itemComponent.createMany({ data: [
    { setId: setItem.id, partId: electrode.id, label: 'الکترود SDN', quantity: 20 },
    { setId: setItem.id, label: 'سوزن', quantity: 5 },
  ] });
  const elLot = await prisma.stockLot.create({ data: { itemId: electrode.id, lotNo: 'E-100', location: home } });
  await prisma.stockMovement.create({ data: { lotId: elLot.id, kind: 'in', quantity: 100, location: home } });
  const mkSet = async (serial) => {
    const lot = await prisma.stockLot.create({ data: { itemId: setItem.id, serialNo: serial, location: home } });
    await prisma.stockMovement.create({ data: { lotId: lot.id, kind: 'in', quantity: 1, location: home } });
    return lot;
  };
  const A = await mkSet('SE-A'), B = await mkSet('SE-B');
  const locA = setLocationOf(A);
  assert.equal(locA, 'ست SE-A');
  let [sa] = await sets.sets({ lotId: A.id });
  assert.equal(sa.contents.length, 2);
  const el = sa.contents.find(c => c.partId === electrode.id);
  assert.deepEqual([el.standard, el.inside, el.shortage, el.tracked], [20, 0, 20, true]);
  const needle = sa.contents.find(c => c.label === 'سوزن');
  assert.deepEqual([needle.standard, needle.inside, needle.shortage, needle.tracked], [5, null, null, false], 'a label-only part is listed but not tracked');
  assert.equal(sa.totals.untracked, 1);
  assert.equal(sa.totals.complete, false);
  assert.equal(sa.atHome, true);
  pass('serialized set = ledger location; standard from the template, inside from the ledger, shortage computed');

  // ── 3) the owner's example ──
  const f1 = await sets.fill(A.id, {}, user);
  assert.deepEqual(f1.filled, [{ partId: electrode.id, lotId: elLot.id, quantity: 20 }]);
  assert.deepEqual(f1.short, []);
  await sets.fill(B.id, {}, user);
  assert.equal(await at(elLot.id, home), 60, '100 − 2 × 20 = 60 in the warehouse');
  assert.equal(await at(elLot.id, locA), 20);
  [sa] = await sets.sets({ lotId: A.id });
  assert.equal(sa.totals.complete, true);
  assert.equal(sa.totals.shortage, 0);
  const lotRow = await inventory.lot(elLot.id);
  assert.equal(lotRow.available, 60, 'electrodes inside sets are not «available» in the warehouse');
  assert.equal(lotRow.quantity, 100, '… but they are still ours');
  await inventory.consume({ lotId: elLot.id, quantity: 2, location: locA, reason: 'مصرفِ سرِ عمل' }, user);
  [sa] = await sets.sets({ lotId: A.id });
  assert.equal(sa.contents.find(c => c.partId === electrode.id).inside, 18);
  assert.equal(sa.totals.shortage, 2);
  const f2 = await sets.fill(A.id, {}, user);
  assert.equal(f2.filled[0].quantity, 2);
  assert.equal(await at(elLot.id, locA), 20, 'A is back to 20');
  assert.equal(await at(elLot.id, home), 58, '… and the warehouse is 58 (the owner\'s numbers)');
  const fNoop = await sets.fill(A.id, {}, user);
  assert.deepEqual(fNoop.filled, [], 'a complete set has nothing to fill');
  pass('owner\'s example: 100 electrodes, two sets of 20 → 60; use 2 from A → 18; refill → A 20, warehouse 58');

  // ── 4) damage → «خرابی‌ها» → repair / scrap ──
  await sets.damage(A.id, { partLotId: elLot.id, quantity: 2, note: 'کابل پاره' }, user);
  assert.equal(await at(elLot.id, locA), 18);
  assert.equal(await at(elLot.id, DAMAGED_LOCATION), 2);
  let dmg = await sets.damaged();
  assert.equal(dmg.length, 1);
  assert.equal(dmg[0].quantity, 2);
  assert.equal(dmg[0].reason, 'کابل پاره');
  assert.equal(dmg[0].usageMode, 'multi');
  await sets.repair(elLot.id, { quantity: 1 }, user);
  assert.equal(await at(elLot.id, home), 59, 'repaired item is back in the warehouse');
  assert.equal(await at(elLot.id, DAMAGED_LOCATION), 1);
  await sets.scrap(elLot.id, { quantity: 1, note: 'غیرقابلِ تعمیر' }, user);
  assert.equal(await at(elLot.id, DAMAGED_LOCATION), 0);
  dmg = await sets.damaged();
  assert.equal(dmg.length, 0, 'the damaged bin is empty once decided');
  const scrapMove = await prisma.stockMovement.findFirst({ where: { lotId: elLot.id, kind: 'out', location: DAMAGED_LOCATION } });
  assert.match(scrapMove.reason, /اسقاط/);
  assert.equal((await inventory.lot(elLot.id)).quantity, 97, '100 − 2 consumed − 1 scrapped: scrap leaves the books, repair does not');
  await rejects(() => sets.scrap(elLot.id, { quantity: 1 }, user), /موجود نیست|موجودی/, 'nothing left to scrap');
  pass('damage goes to «خرابی‌ها»; repair returns it to the warehouse, scrap writes it off with its reason');

  // ── 5) withdraw to the warehouse; damage straight from the warehouse ──
  await sets.withdraw(A.id, { partLotId: elLot.id, quantity: 3 }, user);
  assert.equal(await at(elLot.id, locA), 15);
  assert.equal(await at(elLot.id, home), 62);
  await sets.lotDamage(elLot.id, { quantity: 2, note: 'بسته‌بندی باز' }, user);
  assert.equal(await at(elLot.id, home), 60);
  assert.equal((await sets.damaged())[0].quantity, 2);
  await sets.repair(elLot.id, { quantity: 2 }, user);
  await sets.fill(A.id, {}, user);
  assert.equal(await at(elLot.id, locA), 20);
  assert.equal(await at(elLot.id, home), 57);
  await rejects(() => sets.withdraw(A.id, { partLotId: elLot.id, quantity: 99 }, user), /موجود نیست|موجودی/, 'cannot withdraw more than inside');
  pass('withdraw and warehouse damage are ledger moves too; nothing is overwritten');

  // ── 6) FEFO: earliest expiry first, expired skipped, shortfall reported ──
  const soon = await prisma.stockLot.create({ data: { itemId: electrode.id, lotNo: 'E-SOON', location: home, expiresAt: new Date(Date.now() + 30 * 864e5) } });
  await prisma.stockMovement.create({ data: { lotId: soon.id, kind: 'in', quantity: 10, location: home } });
  const expired = await prisma.stockLot.create({ data: { itemId: electrode.id, lotNo: 'E-EXP', location: home, expiresAt: new Date(Date.now() - 864e5) } });
  await prisma.stockMovement.create({ data: { lotId: expired.id, kind: 'in', quantity: 5, location: home } });
  const C = await mkSet('SE-C');
  const f3 = await sets.fill(C.id, {}, user);
  assert.deepEqual(f3.filled.map(x => [x.lotId, x.quantity]), [[soon.id, 10], [elLot.id, 10]], 'FEFO: the soon-to-expire lot first, then the big lot; the expired lot never');
  assert.equal(await at(expired.id, home), 5);
  [,] = [];
  const [sc] = await sets.sets({ lotId: C.id });
  assert.equal(sc.contents.find(c => c.partId === electrode.id).lots.length, 2, 'inside is broken down per lot');
  const D = await mkSet('SE-D');
  // adjust() targets the lot's *total* balance (home + inside sets), so trim the home pile directly
  await inventory.writeOff(elLot.id, (await at(elLot.id, home)) - 7, home, { reason: 'آزمون: فقط ۷ تا در انبار' }, user);
  assert.equal(await at(elLot.id, home), 7, 'only 7 left in the warehouse');
  const f4 = await sets.fill(D.id, {}, user);
  assert.equal(f4.filled.reduce((s, x) => s + x.quantity, 0), 7);
  assert.deepEqual(f4.short, [{ partId: electrode.id, label: 'الکترود SDN', missing: 13 }], 'the shortfall is reported, not silently ignored');
  pass('fill takes FEFO, skips expired lots and reports what the warehouse could not give');

  // ── 7) return count on a waybill: lost ≠ consumed; damaged → bin; return-stage shortages ──
  const hospital = await prisma.hospital.create({ data: { name: 'بیمارستان آرمان' } });
  const t = await inventory.sendTransfer({ toLocation: hospital.name, hospitalId: hospital.id, lines: [{ lotId: A.id, quantity: 1 }], force: true }, user);
  assert.equal(t.status, 'sent', 'the level-3 keeper reads back the waybill they just issued (createdById is "own" too)');
  assert.equal(await at(A.id, hospital.name), 1, 'the set itself travelled');
  assert.equal(await at(elLot.id, locA), 20, '… its contents stayed at the set location');
  let [saOut] = await sets.sets({ lotId: A.id });
  assert.equal(saOut.atHome, false);
  assert.equal(saOut.at, hospital.name);
  await rejects(() => sets.returnCount(t.id, { lines: [{ lotId: A.id, partId: electrode.id, counted: 25 }] }, user), /بیشتر از آنچه/, 'counting more than inside');
  await rejects(() => sets.returnCount(t.id, { lines: [{ lotId: B.id, partId: electrode.id, counted: 20 }] }, user), /در حواله نیست/, 'a set not on this waybill');
  const rc = await sets.returnCount(t.id, { note: 'دو تا گم، یکی خراب', lines: [{ lotId: A.id, partId: electrode.id, counted: 17, damaged: 1 }] }, user);
  assert.deepEqual(rc.lines.map(l => [l.inside, l.counted, l.damaged, l.lost]), [[20, 17, 1, 2]]);
  assert.equal(await at(elLot.id, locA), 17);
  assert.equal(await at(elLot.id, DAMAGED_LOCATION), 1);
  const lost = await prisma.stockMovement.findMany({ where: { lotId: elLot.id, kind: 'out', location: locA, transferId: t.id } });
  assert.equal(lost.reduce((s, m) => s + m.quantity, 0), -2);
  assert.match(lost[0].reason, /گم‌شده/);
  const sh = await prisma.setShortage.findMany({ where: { transferId: t.id }, orderBy: { id: 'asc' } });
  assert.deepEqual(sh.map(x => [x.label, x.missing, x.kind, x.stage]), [['الکترود SDN', 2, 'missing', 'return'], ['الکترود SDN', 1, 'damaged', 'return']]);
  assert.equal(rc.sets[0].totals.shortage, 3);
  await inventory.returnTransfer(t.id, user);
  assert.equal(await at(A.id, home), 1, 'the set came home');
  assert.equal(await at(elLot.id, home), 0, 'scenario 6 drained the warehouse; a new receipt is needed before the refill');
  await prisma.stockMovement.create({ data: { lotId: elLot.id, kind: 'in', quantity: 10, location: home, reason: 'رسیدِ تازه' } });
  const f5 = await sets.fill(A.id, {}, user);
  assert.equal(f5.filled.reduce((s, x) => s + x.quantity, 0), 3, 'refilled from the warehouse for the next surgery');
  assert.equal(await at(elLot.id, home), 7);
  await rejects(() => sets.returnCount(t.id, { lines: [{ lotId: A.id, partId: electrode.id, counted: 20 }] }, user), /بسته شده/, 'closed waybill');
  pass('return count: lost is written off (not consumed), damaged goes to the bin, both land as return-stage shortages; refill works after');

  // ── 8) renaming the serial keeps the contents ──
  await inventory.updateLot(A.id, { serialNo: 'SE-A2' }, user);
  const [sa2] = await sets.sets({ lotId: A.id });
  assert.equal(sa2.location, 'ست SE-A2');
  assert.equal(sa2.contents.find(c => c.partId === electrode.id).inside, 20, 'movements followed the new set location');
  pass('changing a set\'s serial renames its ledger location instead of orphaning its contents');

  console.log(`\nall ${count} passed`);
} finally {
  await prisma?.$disconnect().catch(() => {});
  server.close();
  await db.close();
}
