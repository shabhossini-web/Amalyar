/**
 * W1.10 — کشفِ دادهٔ ناقصِ تاریخی + صفِ تطبیق.
 * Real Prisma + real Nest services. Only run against an isolated local database.
 *
 * هر بستهٔ قبلیِ این لِین جلوی تکرارِ یک باگ را گرفت ولی ردیف‌های قبلی را دست
 * نزد، و هر بار همان جمله در STATUS نوشته شد: «ترمیمِ دادهٔ گذشته کارِ W1.10
 * است». این سوییت همان را می‌سنجد.
 *
 *  باید بیفتد:
 *   - لینکِ فرمِ خودکارتأییدشده که مدرک نشده بود پیدا و **ترمیم** شود
 *   - پاسخِ سفارشِ پیش از W1.2 که مدرک ندارد پیدا و ترمیم شود
 *   - پاسخِ پیگیریِ بی‌`followUpVisitId` **در صف** بنشیند، نه ترمیمِ حدسی
 *   - اجرای دوباره چیزی را دوبرابر نکند (هر سه تابع idempotentاند)
 *   - ردیفی که خودکار درست نشد به صف برود، نه اینکه بی‌صدا رد شود
 *   - **workerِ یادآوری خودش ترمیم را بدواند** — بدهیِ «ابزار هست، کسی اجرا نکرد»
 *   - و فقط **یک‌بار در هر پروسه**، نه هر sweep
 *  نباید بیفتد (⚠️ سنجهٔ منفی — درسِ «۶۳ هشدارِ دروغین»):
 *   - فرمی که لینکش **از قبل** مدرک دارد گزارش شود
 *   - سفارشی که مدرکش هست، یا اصلاً پاسخی ندارد، گزارش شود
 *   - فرمِ بی‌باکسِ لینک، یا ثبت‌نامِ تأییدنشده، گزارش شود
 *   - پاسخِ پیگیریِ **دارای** کلید گزارش شود
 *   - `scan()` چیزی بنویسد
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const DB = process.env.E2E_DB;
if (!DB || !['localhost', '127.0.0.1'].includes(new URL(DB).hostname)) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const { repairScan, repairRun } = require('./dist/patients/repair-core');
const { RemindersWorkerService } = require('./dist/reminders/reminders-worker.service');

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const tag = 'rep' + randomBytes(4).toString('hex');
/* ⚠️ هسته **خالص** است: نه Nest، نه DI، نه tenant-context — فقط یک client.
   دقیقاً همان چیزی که workerِ یادآوری در اختیار دارد، و همین آن را اجراشدنی کرد. */
const repair = { scan: (l) => repairScan(db, l), run: (_a, l) => repairRun(db, l) };

const of = (findings, check, id) => findings.filter((f) => f.check === check && f.id === id);
const docsOf = (pid) => db.document.count({ where: { patientId: pid, deletedAt: null } });

try {
  const pid = (await db.patient.create({
    data: { code: tag, firstName: 'بیمار', lastName: 'ترمیم', phone: '09120000002' } })).id;
  const visit = await db.visit.create({ data: { patientId: pid, seq: 1, kind: 'visit', opStatus: 'done' } });

  /* فرمی با یک باکسِ لینک + یک فرمِ پیگیری. */
  const linkForm = await db.formDef.create({
    data: { key: tag + 'lf', title: 'فرمِ لینک', scope: 'record', active: true,
      fields: { create: [{ key: 'mri', label: 'لینکِ تصویربرداری', type: 'links', page: 1, sort: 1 }] } },
  });
  const plainForm = await db.formDef.create({
    data: { key: tag + 'pf', title: 'فرمِ ساده', scope: 'record', active: true,
      fields: { create: [{ key: 'note', label: 'توضیح', type: 'text', page: 1, sort: 1 }] } },
  });
  const fuForm = await db.formDef.create({
    data: { key: tag + 'fu', title: 'پیگیریِ عمل', scope: 'record', followUp: 'general', active: true,
      fields: { create: [{ key: 'how', label: 'حالتان چطور است', type: 'text', page: 1, sort: 1 }] } },
  });

  /* ⚠️ `IntakeSubmission.visitId` یکتاست (یک ثبت‌نام = حداکثر یک مراجعه)، پس
     فرمِ زیرپرونده — که همان موردِ W1.3 است — مراجعه‌ای به خودش نمی‌گیرد. */
  const sub = (formId, data, status = 'approved') => db.intakeSubmission.create({
    data: { token: tag + randomBytes(5).toString('hex'), patientId: pid,
      formId, status, data, expiresAt: new Date(Date.now() + 864e5) },
  });
  const MRI = 'https://pacs.example.com/' + tag;

  console.log('\n۱) اسکن پیدا می‌کند، و فقط چیزی که واقعاً ناقص است');
  const broken = await sub(linkForm.id, { mri: [{ url: MRI, title: 'MRI کمر' }] });
  const healthyUrl = 'https://pacs.example.com/healthy-' + tag;
  const healthy = await sub(linkForm.id, { mri: [{ url: healthyUrl, title: 'MRI سالم' }] });
  await db.document.create({ data: { patientId: pid, visitId: visit.id, category: 'imaging',
    title: 'MRI سالم', fileName: 'pacs.example.com', mimeType: 'text/uri-list', size: 0, sha256: '',
    externalUrl: healthyUrl } });
  const noLinks = await sub(plainForm.id, { note: 'چیزی نیست' });
  const notApproved = await sub(linkForm.id, { mri: [{ url: MRI + '-x' }] }, 'pending_approval');

  const before = await repair.scan();
  ok(of(before.findings, 'form_links_missing', broken.id).length === 1,
    'فرمی که لینکش مدرک نشده گزارش شد');
  ok(of(before.findings, 'form_links_missing', healthy.id).length === 0,
    '⚠️ فرمی که لینکش از قبل مدرک دارد گزارش نشد');
  ok(of(before.findings, 'form_links_missing', noLinks.id).length === 0, 'فرمِ بی‌باکسِ لینک گزارش نشد');
  ok(of(before.findings, 'form_links_missing', notApproved.id).length === 0,
    'ثبت‌نامِ تأییدنشده گزارش نشد — هنوز مسیرِ عادی‌اش را نرفته');

  console.log('\n۲) سفارش: پاسخِ بی‌مدرک در برابرِ پاسخِ مدرک‌دار');
  const mkOrder = (extra) => db.labOrder.create({ data: { patientId: pid, visitId: visit.id, tests: ['CBC'],
    token: tag + randomBytes(6).toString('hex'), status: 'answered', ...extra } });
  const oldOrder = await mkOrder({ resultText: 'هموگلوبین ۱۴' });
  const okOrder = await mkOrder({ resultText: 'پاسخِ ثبت‌شده' });
  await db.document.create({ data: { patientId: pid, visitId: visit.id, category: 'lab',
    refType: 'lab_order', refId: okOrder.id, title: 'پاسخ', fileName: 'x.txt', mimeType: 'text/plain',
    size: 10, sha256: 'x', contentText: 'پاسخِ ثبت‌شده' } });
  const emptyOrder = await mkOrder({});
  const draftOrder = await db.labOrder.create({ data: { patientId: pid, visitId: visit.id, tests: ['CBC'],
    token: tag + randomBytes(6).toString('hex'), status: 'draft', resultText: 'چرک‌نویس' } });

  const s2 = await repair.scan();
  ok(of(s2.findings, 'order_answer_no_document', oldOrder.id).length === 1, 'سفارشِ پاسخ‌دارِ بی‌مدرک گزارش شد');
  ok(of(s2.findings, 'order_answer_no_document', okOrder.id).length === 0,
    '⚠️ سفارشی که مدرکش هست گزارش نشد');
  ok(of(s2.findings, 'order_answer_no_document', emptyOrder.id).length === 0, 'سفارشِ بی‌پاسخ گزارش نشد');
  ok(of(s2.findings, 'order_answer_no_document', draftOrder.id).length === 0, 'سفارشِ draft گزارش نشد');

  console.log('\n۳) پیگیریِ بی‌موعد — صف، نه حدس');
  const loose = await sub(fuForm.id, { how: 'خوبم' });
  const tied = await sub(fuForm.id, { how: 'خوبم', followUpVisitId: visit.id, followUpDay: 7 });
  const s3 = await repair.scan();
  const looseF = of(s3.findings, 'followup_unattributed', loose.id);
  ok(looseF.length === 1 && looseF[0].fix === 'queue',
    '⚠️ پاسخِ پیگیریِ بی‌کلید به صف می‌رود، نه ترمیمِ خودکار');
  ok(of(s3.findings, 'followup_unattributed', tied.id).length === 0, 'پاسخِ دارای کلید گزارش نشد');

  console.log('\n۴) scan هیچ‌چیز نمی‌نویسد');
  const docsBefore = await docsOf(pid);
  const worksBefore = await db.workItem.count({ where: { patientId: pid } });
  await repair.scan();
  ok((await docsOf(pid)) === docsBefore && (await db.workItem.count({ where: { patientId: pid } })) === worksBefore,
    'دو اسکنِ پشت‌سرهم نه مدرکی ساخت نه کاری — گزارش معیارِ تصمیم است، نه خودِ اقدام');

  console.log('\n۵) اجرا: ترمیم + صف');
  const res = await repair.run(null);
  ok(res.repaired >= 2, `ترمیم انجام شد (${res.repaired} مورد)`);
  ok((await db.document.count({ where: { patientId: pid, externalUrl: MRI, deletedAt: null } })) === 1,
    'لینکِ گم‌شده حالا مدرکِ پرونده است');
  ok((await db.document.count({ where: { refType: 'lab_order', refId: oldOrder.id, deletedAt: null } })) === 1,
    'پاسخِ سفارشِ قدیمی حالا مدرک دارد');
  const queued = await db.workItem.findFirst({ where: { refType: 'intake_submission', refId: loose.id, type: 'repair_data' } });
  ok(!!queued && queued.ownerRole === 'admin', 'کارِ تطبیق برای پاسخِ بی‌موعد ساخته شد');
  ok((await db.intakeSubmission.findUnique({ where: { id: loose.id } })).data.followUpVisitId === undefined,
    '⚠️ و هیچ حدسی در داده نوشته نشد — حدسی که مثلِ واقعیت ذخیره شود بدتر از دادهٔ ناقص است');

  console.log('\n۶) دوباره‌دواندن دوبرابر نمی‌کند');
  const docsAfter = await docsOf(pid);
  const worksAfter = await db.workItem.count({ where: { patientId: pid, type: 'repair_data' } });
  const second = await repair.run(null);
  ok((await docsOf(pid)) === docsAfter, 'اجرای دوم مدرکِ تکراری نساخت');
  ok((await db.workItem.count({ where: { patientId: pid, type: 'repair_data' } })) === worksAfter,
    'و کارِ تکراری هم نساخت (idempotencyKey)');
  ok(second.repaired === 0, 'و چیزی برای ترمیم نمانده بود');
  const s6 = await repair.scan();
  ok(of(s6.findings, 'form_links_missing', broken.id).length === 0
    && of(s6.findings, 'order_answer_no_document', oldOrder.id).length === 0,
    'اسکنِ بعدی دیگر آن دو را نمی‌بیند');

  console.log('\n۷) ردیفی که خودکار درست نمی‌شود بی‌صدا رد نمی‌شود');
  const badLink = await db.labOrder.create({ data: { patientId: pid, visitId: visit.id, tests: ['CBC'],
    token: tag + randomBytes(6).toString('hex'), status: 'answered', resultLink: 'ftp://not-http/' + tag } });
  const s7 = await repair.scan();
  ok(of(s7.findings, 'order_answer_no_document', badLink.id).length === 1, 'سفارشِ با لینکِ نامعتبر پیدا شد');
  const res7 = await repair.run(null);
  ok(res7.failed.some((f) => f.id === badLink.id), 'ترمیمش شکست خورد و **گزارش** شد');
  ok(!!(await db.workItem.findFirst({ where: { refType: 'lab_order', refId: badLink.id, type: 'repair_data' } })),
    '⚠️ و به صف رفت تا آدم ببیندش — وگرنه «۰ خطا» گزارش می‌شد بی‌آنکه چیزی ترمیم شده باشد');

  console.log('\n۸) workerِ یادآوری خودش ترمیم را می‌دواند (بدهیِ «هیچ‌کس اجرایش نکرد»)');
  const control = { tenant: { findMany: async () => [{ slug: tag, databaseUrlEncrypted: 'x' }] } };
  const sms = { send: async () => ({ sent: true }) };
  const worker = new RemindersWorkerService(control, sms);
  const LATE = 'https://pacs.example.com/late-' + tag;
  const AGAIN = 'https://pacs.example.com/again-' + tag;
  const docByUrl = (u) => db.document.count({ where: { patientId: pid, externalUrl: u, deletedAt: null } });

  await sub(linkForm.id, { mri: [{ url: LATE }] });
  /* ⚠️ عمداً **`sweepTenant`** صدا زده می‌شود نه `repairOnce`.
     نسخهٔ اولِ همین سنجه مستقیم `repairOnce` را صدا می‌زد «تا نویزِ بقیهٔ sweep
     نباشد» — و رگرسیونِ عمدی نشان داد که با آن میان‌بر، **برداشتنِ کاملِ فراخوانی
     از `sweepTenant` هم سبز می‌ماند**. یعنی دقیقاً همان چیزی که این بسته باید
     ثابت کند (اینکه worker خودش می‌دواندش) سنجیده نمی‌شد. خودِ سیم‌کشی موضوعِ
     آزمون است، پس مسیرِ واقعی باید بدود. */
  await worker.sweepTenant(DB, tag);
  ok((await docByUrl(LATE)) === 1,
    '⚠️ worker بدونِ هیچ دخالتِ انسانی ترمیم کرد — ابزاری که به یادِ کسی بند باشد اجرا نمی‌شود');

  console.log('\n۹) یک‌بار در هر پروسه، نه هر sweep');
  const again = await sub(linkForm.id, { mri: [{ url: AGAIN }] });
  await worker.sweepTenant(DB, tag);
  ok((await docByUrl(AGAIN)) === 0,
    'sweepِ دومِ همان پروسه دوباره اسکن نکرد — اسکنِ هر پنج دقیقه تا ابد بارِ بی‌دلیل است');
  ok(of((await repair.scan()).findings, 'form_links_missing', again.id).length === 1,
    'و آن ایراد هنوز پیدا می‌شود — یعنی «اسکن نشد»، نه «از دست رفت»');

  console.log('\n۱۰) خاموشیِ صریح، و شکستی که sweep را نمی‌شکند');
  process.env.REPAIR_DISABLED = '1';
  await new RemindersWorkerService(control, sms).sweepTenant(DB, tag + 'off');
  ok((await docByUrl(AGAIN)) === 0, 'با REPAIR_DISABLED=1 هیچ ترمیمی نشد');
  delete process.env.REPAIR_DISABLED;

  let threw = false;
  const dead = { intakeSubmission: { findMany: async () => { throw new Error('دیتابیس رفت'); } } };
  try { await new RemindersWorkerService(control, {}).repairOnce(dead, tag + 'dead'); } catch { threw = true; }
  ok(!threw, '⚠️ شکستِ ترمیم پرتاب نمی‌کند — یادآوری کارِ حساس به زمان است، ترمیمِ گذشته نیست');

  console.log(`\n✅ ${count}/${count}`);
} finally {
  await db.$disconnect();
}
