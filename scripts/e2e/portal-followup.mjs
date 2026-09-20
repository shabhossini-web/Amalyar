/**
 * پورتالِ بیمار — فرمِ پیگیریِ پس از عمل فقط از **روزِ موعدش** «کار» است.
 * Real HTTP + Prisma + PGlite. Only run against an isolated local database.
 *
 * زمینه (تصمیمِ مالک، ۱۴۰۵/۰۶/۲۹): قراردادِ لِینِ الف می‌ماند — به‌ازای هر موعدِ
 * پیگیری (روزِ ۱، ۷، ۳۰) یک ردیفِ `intakeSubmission` با کلیدِ
 * `followUpVisitId`/`followUpDay` **از لحظهٔ ثبتِ مراجعه** ساخته می‌شود (متنِ
 * پیامکِ هر موج لینکش را همان موقع لازم دارد). ولی `portal.service.ts` همهٔ
 * `pending_fill`ها را «تکمیلِ فرم» نشان می‌داد: بیمارِ «۱،۷،۳۰» پیش از خودِ عمل
 * سه کارِ باز می‌دید و می‌توانست فرمِ موجی را پر کند که هنوز نیامده.
 *
 * ردیف‌ها با **خودِ `syncNextVisit`** ساخته می‌شوند، نه با دست (الگوی W1.1).
 *
 *  باید بیفتد:
 *   - عملِ آینده: هیچ فرمِ پیگیری‌ای کار نیست (قبلاً سه‌تا)
 *   - عملِ ۸ روز پیش با «۱،۷،۳۰»: فقط موعدهای ۱ و ۷، نه ۳۰
 *   - بعد از پرشدنِ فرمِ روزِ ۱: فقط روزِ ۷
 *   - عملِ لغوشده: فرمِ پیگیری‌اش کار نیست، حتی اگر موعدش رسیده
 *   - روزِ ۰ از خودِ روزِ عمل کار است
 *  نباید بیفتد:
 *   - ثبت‌نامِ عادی (بی‌کلیدِ پیگیری) پنهان شود
 *   - فرمی که مراجعه‌اش پیدا نمی‌شود پنهان شود (صافی فقط چیزی را پنهان می‌کند
 *     که **قطعاً** هنوز کار نیست)
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const API = process.env.E2E_API, DB = process.env.E2E_DB;
if (!DB || ![API, DB].every(u => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const { sync } = globalThis.__pgate;
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'pgt' + randomBytes(4).toString('hex');

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const eq = (a, b, label) => { assert.equal(a, b, `${label} (${a} ≠ ${b})`); console.log('PASS ' + ++count + ' ' + label); };

const DAY = 24 * 3600 * 1000;
const tokenOf = (t) => t.url.match(/\/f\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
/** کارهای «فرم» از پورتالِ عمومی — همان چیزی که بیمار می‌بیند. */
async function formTasks(portalToken) {
  const r = await fetch(`${API}/public/portal/${portalToken}`);
  assert.equal(r.status, 200, `پورتال ${r.status}`);
  const j = await r.json();
  return (j.tasks ?? []).filter((t) => t.kind === 'intake');
}
const rowsOf = (visitId) => db.intakeSubmission.findMany({
  where: { data: { path: ['followUpVisitId'], equals: visitId } }, orderBy: { id: 'asc' },
});
const dayOf = (row) => row.data.followUpDay;

let n = 0;
async function patientWith(opDate, followUpDays) {
  const pt = 'p' + tag + (++n);
  const patient = await db.patient.create({
    data: { code: tag + n, firstName: 'بیمارِ', lastName: 'پورتال', phone: '0912000' + String(9300 + n), portalToken: pt },
  });
  const visit = await db.visit.create({
    data: { patientId: patient.id, seq: 1, kind: 'surgery', opDate, procedureTypeId: proc.id, followUpDays },
  });
  await sync(visit.id);
  return { patient, visit, pt };
}

let proc;
try {
  const form = await db.formDef.create({
    data: {
      key: tag, title: 'پیگیریِ عمومی', scope: 'record', active: true, followUp: 'general',
      fields: { create: [{ key: 'fuPain', label: 'شدتِ درد', type: 'text', page: 1, sort: 1 }] },
    },
  });
  proc = await db.procedureType.create({
    data: { name: `عملِ ${tag}`, followUpDays: '1,7,30', postOpCare: 'پانسمان را خشک نگه دارید.' },
  });

  console.log('\n۱) عملِ آینده — هیچ فرمِ پیگیری‌ای هنوز کار نیست');
  const a = await patientWith(new Date(Date.now() + 5 * DAY), '1,7,30');
  const rowsA = await rowsOf(a.visit.id);
  eq(rowsA.length, 3, 'قرارداد: سه موعد، سه ردیفِ فرم (per-wave)');
  eq(rowsA.map(dayOf).sort((x, y) => x - y).join(','), '1,7,30', 'کلیدِ followUpDay روی هر ردیف');
  const tasksA = await formTasks(a.pt);
  eq(tasksA.length, 0, '**پورتال هیچ‌کدام را کار نشان نمی‌دهد — قبلاً هر سه را نشان می‌داد**');

  console.log('\n۲) عملِ ۸ روز پیش — فقط موعدهای رسیده');
  const b = await patientWith(new Date(Date.now() - 8 * DAY), '1,7,30');
  const rowsB = await rowsOf(b.visit.id);
  const tasksB = await formTasks(b.pt);
  eq(tasksB.length, 2, '**دو کار: روزِ ۱ و روزِ ۷**');
  const shownDays = tasksB.map((t) => dayOf(rowsB.find((r) => r.token === tokenOf(t)))).sort((x, y) => x - y);
  eq(shownDays.join(','), '1,7', 'همان دو موعد، نه روزِ ۳۰');
  ok(tasksB.every((t) => t.label === 'تکمیلِ فرم'), 'برچسبِ کار همان «تکمیلِ فرم» است');

  console.log('\n۳) پرشدنِ فرمِ روزِ ۱ از مسیرِ عمومی — فقط روزِ ۷ می‌ماند');
  const day1 = rowsB.find((r) => dayOf(r) === 1);
  const fill = await fetch(`${API}/public/intake/form/${day1.token}/fill`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: { fuPain: '۳' } }),
  });
  ok(fill.status === 200 || fill.status === 201, `فرمِ روزِ ۱ پر شد (${fill.status})`);
  const tasksB2 = await formTasks(b.pt);
  eq(tasksB2.length, 1, 'یک کار مانده');
  eq(dayOf(rowsB.find((r) => r.token === tokenOf(tasksB2[0]))), 7, '**و آن روزِ ۷ است**');

  console.log('\n۴) نباید بیفتد — ثبت‌نامِ عادی همیشه کار است');
  await db.intakeSubmission.create({
    data: {
      token: 'reg-' + tag, formId: form.id, patientId: a.patient.id, amount: 0, status: 'pending_fill',
      data: { firstName: 'بیمارِ' }, expiresAt: new Date(Date.now() + 14 * DAY),
    },
  });
  const tasksA2 = await formTasks(a.pt);
  eq(tasksA2.length, 1, '**ثبت‌نامِ عادی (بی‌کلیدِ پیگیری) کنارِ عملِ آینده نشان داده می‌شود**');
  eq(tokenOf(tasksA2[0]), 'reg-' + tag, 'و همان است، نه فرمِ پیگیری');

  console.log('\n۵) عملِ لغوشده — فرمِ پیگیری‌اش کار نیست');
  await db.visit.update({ where: { id: b.visit.id }, data: { opStatus: 'cancelled' } });
  await sync(b.visit.id);
  eq((await formTasks(b.pt)).length, 0, '**موعدِ رسیده ولی عمل لغو شده → هیچ کاری**');
  /* سه موعد، یکی پر شده → دو ردیفِ باز (روزِ ۷ و ۳۰) همچنان در دیتابیس‌اند. */
  eq((await db.intakeSubmission.count({ where: { data: { path: ['followUpVisitId'], equals: b.visit.id }, status: 'pending_fill' } })), 2,
    'ردیف‌های بازِ فرم سرِ جایشان‌اند — صافی است، نه حذف');

  console.log('\n۶) نباید بیفتد — فرمی که مراجعه‌اش پیدا نمی‌شود پنهان نمی‌شود');
  await db.intakeSubmission.create({
    data: {
      token: 'orphan-' + tag, formId: form.id, patientId: a.patient.id, amount: 0, status: 'pending_fill',
      data: { followUpVisitId: 987654321, followUpDay: 30 }, expiresAt: new Date(Date.now() + 14 * DAY),
    },
  });
  const tasksA3 = await formTasks(a.pt);
  ok(tasksA3.some((t) => tokenOf(t) === 'orphan-' + tag), '**مراجعهٔ ناشناس → fail-open، فرم نشان داده می‌شود**');

  console.log('\n۷) روزِ ۰ — از خودِ روزِ عمل کار است');
  const c = await patientWith(new Date(Date.now() - 3600 * 1000), '0,3');
  const rowsC = await rowsOf(c.visit.id);
  const tasksC = await formTasks(c.pt);
  eq(tasksC.length, 1, 'یک کار');
  eq(dayOf(rowsC.find((r) => r.token === tokenOf(tasksC[0]))), 0, '**روزِ ۰ کار است، روزِ ۳ هنوز نه**');

  console.log(`\n${count} سنجه سبز`);
} finally {
  await db.$disconnect().catch(() => undefined);
}
