/**
 * ردیف‌های ایمپلنت — «طبقِ نسخه» در تأیید قفل می‌شود، برنامه عوض می‌شود، موجودی فقط نشان داده می‌شود.
 * Real services + disposable PGlite database (همان الگوی `profile-workflows.mjs`). No production data.
 *
 * زمینه (مالک، ۱۴۰۵/۰۷/۰۱): «ردیف‌های مدلِ ایمپلنت از انبار × تعداد؛ تعدادِ اصلی طبقِ نسخه روی
 * مراجعه ثبت می‌شود و به اتاقِ عمل می‌رود» + پیش‌فرض: «ردیف‌ها فقط موجودی را نشان می‌دهند، رزرو
 * نمی‌کنند؛ تعدادِ طبقِ نسخه پس از تأیید قفل است و کنارِ تعدادِ برنامه سرِ عمل دیده می‌شود».
 *
 *  باید بیفتد:
 *   - ویرایشِ پرتالِ جراح عددِ نسخه را بازنویسی نمی‌کند (تا دیروز یک `quantity` بود و می‌کرد)
 *   - ردیفِ نسخه‌دار حذف نمی‌شود؛ ردیفِ افزوده‌شده بعد از تأیید نسخه ندارد و حذف می‌شود
 *   - کالای تازهٔ غیرفعال پذیرفته نمی‌شود
 *   - موجودی: لاتِ منقضی و کالای بیرون از انبار شمرده نمی‌شوند
 *  نباید بیفتد:
 *   - تأیید تعدادها را «طبقِ نسخه» ثبت می‌کند
 *   - کالای نسخه‌داری که بعداً غیرفعال شد ویرایشِ همان مراجعه را قفل نمی‌کند
 *   - سرِ عمل نسخه کنارِ برنامه دیده می‌شود
 *   - موجودی‌خوانی هیچ حرکتی نمی‌سازد (رزرو نمی‌کند)
 */
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
const ok = (v, label, detail = '') => { assert.ok(v, `${label}${detail ? ' — ' + detail : ''}`); console.log(`PASS ${++count}: ${label}`); };
const rows = async (id) => (await prisma.visit.findUnique({ where: { id } })).requiredItems;
const byItem = (list, itemId) => list.find((r) => r.itemId === itemId);
try {
  const migrations = new URL('../../server/prisma/migrations/', import.meta.url);
  for (const dir of (await readdir(migrations)).sort()) if (dir.startsWith('20')) await db.exec(await readFile(new URL(`${dir}/migration.sql`, migrations), 'utf8'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  prisma = new PrismaClient({ datasources: { db: { url: `postgresql://postgres@127.0.0.1:${server.address().port}/postgres?connection_limit=1` } } });
  const config = { vertical: async () => 'implant', profile: async () => cls('config/tenant-profile', 'profileOf')('implant', null) };
  const forms = new (cls('patients/forms.service', 'FormsService'))(prisma, config);
  const audit = new (cls('audit/audit.service', 'AuditService'))(prisma);
  const reminders = { syncNextVisit: async () => {}, syncAppointment: async () => {} };
  const events = new (cls('work/events.service', 'EventsService'))(prisma);
  const patients = new (cls('patients/patients.service', 'PatientsService'))(prisma, audit, forms, reminders, events);
  const treasury = new (cls('patients/treasury.service', 'TreasuryService'))(prisma, audit);
  const billing = new (cls('patients/billing.service', 'BillingService'))(prisma, audit, {}, treasury);
  const tenant = { require: () => ({ hostname: 'fixture.test' }) };
  const portalSvc = new (cls('patients/portal.service', 'PortalService'))(prisma, audit, {}, { brand: async () => ({}), sms: async () => ({ portalText: '{link}' }) }, tenant);
  const settings = { text: async () => '', textOr: async (_k, fb) => fb, sms: async () => ({}) };
  const intake = new (cls('patients/intake.service', 'IntakeService'))(prisma, audit, patients, {}, billing, {}, forms, {}, tenant, {}, portalSvc, reminders, settings, events);
  const surgeonPortal = new (cls('patients/surgeon-portal.service', 'SurgeonPortalService'))(prisma, config, audit);
  const inventory = new (cls('patients/inventory.service', 'InventoryService'))(prisma, audit, {}, { textOr: async (_k, fb) => fb }, {}, events, {});
  const Theatre = cls('patients/theatre.service', 'TheatreService');

  const admin = await prisma.account.create({ data: { passwordHash: 'fixture', level: 6, status: 'active', person: { create: { firstName: 'مدیر', lastName: 'تست' } } } });
  const patient = await prisma.patient.create({ data: { code: 'IR-1', firstName: 'بیمار', lastName: 'ایمپلنت' } });
  const surgeon = await prisma.surgeon.create({ data: { person: { create: { firstName: 'جراح', lastName: 'نسخه', phone: '09123456700' } } } });
  const hospital = await prisma.hospital.create({ data: { name: 'مرکز ایمپلنت' } });
  const [A, B, C, D] = await Promise.all(['پیچ پدیکولار', 'راد', 'کیج', 'غیرفعال'].map((name, i) => prisma.item.create({ data: { name, active: i !== 3 } })));
  await forms.list();
  const reg = await prisma.formDef.findUnique({ where: { key: 'intake.implant' } });
  const sub = await prisma.intakeSubmission.create({ data: { token: 'ir-' + Math.random(), patientId: patient.id, formId: reg.id, amount: 0,
    expiresAt: new Date('2027-01-01'), status: 'pending_approval', data: { surgeonName: 'دکتر نسخه', hospitalName: 'مرکز ایمپلنت', procedure: 'فیوژن' } } });

  console.log('۱) تأیید = نسخه');
  const approved = await intake.approve(sub.id, { surgeonId: surgeon.id, hospitalId: hospital.id, opDate: '2026-10-01', registerPayment: false,
    requiredItems: [{ itemId: A.id, quantity: 4, notes: '' }, { itemId: B.id, quantity: 2, notes: '' }] }, admin);
  const vid = approved.visitId;
  let r = await rows(vid);
  ok(byItem(r, A.id)?.prescribedQuantity === 4 && byItem(r, B.id)?.prescribedQuantity === 2, '**تأیید تعدادها را «طبقِ نسخه» ثبت می‌کند**', JSON.stringify(r));

  console.log('\n۲) پرتالِ جراح — برنامه عوض می‌شود، نسخه نه');
  /* بستهٔ PS (PS6): شماره را سوپرادمین از خودِ جراح می‌پرسد و با تعاریف سنجیده می‌شود. */
  const surgeonPhone = (await prisma.person.findUnique({ where: { id: surgeon.personId }, select: { phone: true } })).phone;
  const grant = await surgeonPortal.grantAccount(surgeon.id, admin, surgeonPhone);
  const doctor = await prisma.account.findUnique({ where: { id: grant.id } });
  await surgeonPortal.saveInstructions(vid, { instructions: 'یک پیچِ یدک هم بیاورید', requiredItems: [
    { itemId: A.id, quantity: 5, notes: 'یدک' }, { itemId: B.id, quantity: 2, notes: '' }, { itemId: C.id, quantity: 1, notes: '' }] }, doctor);
  r = await rows(vid);
  ok(byItem(r, A.id).quantity === 5 && byItem(r, A.id).prescribedQuantity === 4, '**ویرایشِ جراح فقط برنامه را عوض می‌کند** — نسخه همان ۴', JSON.stringify(byItem(r, A.id)));
  ok(byItem(r, C.id).prescribedQuantity === null, 'ردیفِ افزوده‌شده بعد از تأیید نسخه ندارد');
  await assert.rejects(() => surgeonPortal.saveInstructions(vid, { instructions: 'x', requiredItems: [{ itemId: A.id, quantity: 5 }, { itemId: C.id, quantity: 1 }] }, doctor), /طبقِ نسخه است و حذف نمی‌شود/);
  ok(byItem(await rows(vid), B.id)?.prescribedQuantity === 2, '**ردیفِ نسخه‌دار حذف نمی‌شود** — و مراجعه دست نخورد');
  await surgeonPortal.saveInstructions(vid, { instructions: 'بی‌کیج', requiredItems: [{ itemId: A.id, quantity: 5 }, { itemId: B.id, quantity: 2 }] }, doctor);
  ok(!byItem(await rows(vid), C.id), 'ردیفِ بی‌نسخه حذف می‌شود');
  await prisma.item.update({ where: { id: B.id }, data: { active: false } });
  await surgeonPortal.saveInstructions(vid, { instructions: 'باز هم', requiredItems: [{ itemId: A.id, quantity: 6 }, { itemId: B.id, quantity: 2 }] }, doctor);
  ok(byItem(await rows(vid), A.id).quantity === 6, 'کالای نسخه‌داری که بعداً غیرفعال شد ویرایشِ همان مراجعه را قفل نمی‌کند');
  await assert.rejects(() => surgeonPortal.saveInstructions(vid, { instructions: 'x', requiredItems: [{ itemId: A.id, quantity: 6 }, { itemId: B.id, quantity: 2 }, { itemId: D.id, quantity: 1 }] }, doctor), /موجود یا فعال نیست/);
  ok(!byItem(await rows(vid), D.id), '**کالای تازهٔ غیرفعال پذیرفته نمی‌شود**');

  console.log('\n۳) سرِ عمل');
  const items = Theatre.items(await prisma.visit.findUnique({ where: { id: vid } }));
  const a = items.find((x) => x.name.startsWith('پیچ'));
  ok(a?.quantity === 6 && a?.prescribed === 4, '**نسخه کنارِ برنامه سرِ عمل** (×۶، طبقِ نسخه ×۴)', JSON.stringify(a));

  console.log('\n۴) موجودی — فقط نمایش');
  const home = 'انبارِ مرکزی';
  const lot = async (itemId, qty, extra = {}) => {
    const l = await prisma.stockLot.create({ data: { itemId, location: home, ...extra } });
    await prisma.stockMovement.create({ data: { lotId: l.id, kind: 'in', quantity: qty, location: home } });
    return l;
  };
  await lot(A.id, 3);
  await lot(A.id, 7, { expiresAt: new Date('2020-01-01') });
  const out = await lot(A.id, 5);
  await prisma.stockMovement.createMany({ data: [{ lotId: out.id, kind: 'adjust', quantity: -2, location: home }, { lotId: out.id, kind: 'adjust', quantity: 2, location: 'بیمارستانِ آزمون' }] });
  const moves = await prisma.stockMovement.count();
  const av = await inventory.availability([A.id, B.id, A.id, -1]);
  ok(JSON.stringify(av) === JSON.stringify([{ itemId: A.id, available: 6 }, { itemId: B.id, available: 0 }]),
    '**منقضی و بیرون‌از‌انبار شمرده نمی‌شوند** (۳ + ۳ = ۶، نه ۱۵)', JSON.stringify(av));
  ok(await prisma.stockMovement.count() === moves, 'موجودی‌خوانی هیچ حرکتی نساخت — رزرو نمی‌کند');

  console.log(`\n${count} سنجه سبز`);
} finally { if (prisma) await prisma.$disconnect(); server.close(); await db.close(); }
