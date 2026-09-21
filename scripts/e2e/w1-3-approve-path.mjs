/**
 * W1.3 — مسیرِ مشترکِ «تصویبِ پاسخ» (D03a). Real HTTP + Prisma.
 * Only run against an isolated local database.
 *
 * یافتهٔ D03a: فرمِ زیرپرونده دو مسیرِ تأیید دارد و فقط یکی‌شان لینک‌های فرم را
 * به **مدرکِ پرونده** تبدیل می‌کرد:
 *
 *   `approve()` دستی  → `syncLinkDocuments` ✅
 *   شاخهٔ `direct` در `fill()` (فرمِ رایگانِ زیرپرونده) → ✗
 *
 * و جبران‌پذیر هم نبود: `approve()` فقط ردیفِ `pending_approval` را می‌پذیرد،
 * پس ردیفی که خودکار `approved` شده دیگر هیچ‌وقت از آن مسیر رد نمی‌شود. لینکِ
 * MRI برای همیشه فقط داخلِ `data` می‌ماند و در تبِ مدارک دیده نمی‌شود.
 *
 *  باید بیفتد:
 *   - فرمِ رایگانِ زیرپرونده با لینک ← مدرکِ لینکی در پرونده (معیارِ پذیرشِ سند)
 *   - نام/کاربری/رمزِ لینک هم با مدرک بیاید، نه فقط نشانی
 *   - مسیرِ دستی همان نتیجه را بدهد — یک تابع، دو مسیر
 *  نباید بیفتد:
 *   - ارسالِ دوباره مدرکِ تکراری نسازد
 *   - فرمِ بی‌باکسِ لینک مدرکِ الکی نسازد
 *   - مدرکِ بیمارِ دیگر ساخته نشود
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const API = process.env.E2E_API ?? 'http://localhost:3101/api', DB = process.env.E2E_DB;
if (!DB || ![API, DB].every(u => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'lnk' + randomBytes(4).toString('hex');

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const made = { patients: [], forms: [] };
const savedAccess = [];
let token;

async function pub(path, body, method = 'POST') {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function adm(path, body, method = 'POST') {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, data: await r.json().catch(() => null) };
}

/** فرمِ زیرپروندهٔ رایگان با یک باکسِ لینک (بدونِ باکسِ پرداخت → مسیرِ `direct`). */
async function recordForm({ withLinks = true, key = 'mri' } = {}) {
  const f = await db.formDef.create({
    data: {
      key: tag + made.forms.length, title: 'پرسش‌نامهٔ زیرپرونده', scope: 'record', active: true,
      fields: { create: withLinks
        ? [{ key, label: 'لینکِ تصویربرداری', type: 'links', docCategory: 'imaging', sort: 1 }]
        : [{ key: 'note', label: 'توضیح', type: 'text', sort: 1 }] },
    },
  });
  made.forms.push(f.id);
  return f;
}

async function submission(formId, patientId) {
  const tok = randomBytes(12).toString('base64url');
  await db.intakeSubmission.create({
    data: { token: tok, formId, patientId, amount: 0, status: 'pending_fill',
      expiresAt: new Date(Date.now() + 30 * 864e5) },
  });
  return tok;
}

const newPatient = async () => {
  const p = await db.patient.create({ data: { code: tag + made.patients.length, firstName: 'بیمار', lastName: 'لینک' } });
  made.patients.push(p.id);
  return p.id;
};
const linkDocs = (patientId) => db.document.findMany({
  where: { patientId, externalUrl: { not: null }, deletedAt: null }, orderBy: { id: 'asc' },
});

try {
  token = (await pub('/auth/login', { identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' })).data?.accessToken;
  assert.ok(token, 'login');
  for (const [table, key] of [['feature', 'formgen'], ['permission', 'intake.read'], ['permission', 'intake.approve']]) {
    savedAccess.push([table, key, await db[table].findUnique({ where: { key } })]);
    await db[table].upsert({ where: { key }, create: { key, minLevel: 3, enabled: true }, update: { minLevel: 3, enabled: true, roles: [] } });
  }

  console.log('\n۱) فرمِ رایگانِ زیرپرونده با لینک — معیارِ پذیرشِ سند');
  const form = await recordForm();
  const p1 = await newPatient();
  const t1 = await submission(form.id, p1);
  const filled = await pub(`/public/intake/form/${t1}/fill`, {
    values: { mri: [{ url: 'https://pacs.example.test/study/1', title: 'MRI کمر', user: 'u1', pass: 'p1' }] },
  });
  ok(filled.status === 200 || filled.status === 201, `فرم پر شد (${filled.status})`);
  const row1 = await db.intakeSubmission.findFirst({ where: { token: t1 } });
  ok(row1.status === 'approved', 'مسیرِ `direct` واقعاً فعال شد — ردیف خودکار تأیید شده');

  const d1 = await linkDocs(p1);
  ok(d1.length === 1 && d1[0].externalUrl === 'https://pacs.example.test/study/1',
    `**باید بیفتد:** لینکِ فرم مدرکِ پرونده شد (${d1.length} مدرک)`);
  ok(d1[0].title?.includes('MRI کمر') || d1[0].title === 'MRI کمر', `عنوانِ لینک با مدرک آمد («${d1[0].title}»)`);
  ok(d1[0].category === 'imaging', `دستهٔ باکس روی مدرک نشست («${d1[0].category}») — زیرِ «متفرقه» دفن نشد`);
  ok(d1[0].externalUser === 'u1' && d1[0].externalPass === 'p1', 'کاربری/رمزِ پورتال هم ذخیره شد');

  console.log('\n۲) نباید بیفتد — ارسالِ دوباره مدرکِ تکراری نمی‌سازد');
  const p2 = await newPatient();
  const t2 = await submission(form.id, p2);
  const body2 = { values: { mri: [{ url: 'https://pacs.example.test/study/2', title: 'سی‌تی' }] } };
  await pub(`/public/intake/form/${t2}/fill`, body2);
  const again = await pub(`/public/intake/form/${t2}/fill`, body2);
  ok(again.status >= 400, `فرمِ تأییدشده دیگر پر نمی‌شود (${again.status})`);
  ok((await linkDocs(p2)).length === 1, '**نباید بیفتد:** فقط یک مدرک، نه دوتا');

  console.log('\n۳) نباید بیفتد — لینکِ بیمارِ الف به پروندهٔ ب نمی‌رود');
  ok((await linkDocs(p1)).length === 1 && (await linkDocs(p1))[0].externalUrl.endsWith('/1'),
    '**نباید بیفتد:** پروندهٔ اول همان یک مدرکِ خودش را دارد');

  console.log('\n۴) نباید بیفتد — فرمِ بی‌باکسِ لینک مدرک نمی‌سازد');
  const plain = await recordForm({ withLinks: false });
  const p3 = await newPatient();
  const t3 = await submission(plain.id, p3);
  await pub(`/public/intake/form/${t3}/fill`, { values: { note: 'حالم خوب است' } });
  ok((await db.intakeSubmission.findFirst({ where: { token: t3 } })).status === 'approved', 'این هم خودکار تأیید شد');
  ok((await linkDocs(p3)).length === 0, '**نباید بیفتد:** بی‌لینک، هیچ مدرکی ساخته نشد');

  console.log('\n۵) مسیرِ دستی همان نتیجه را می‌دهد — یک تابع، دو مسیر');
  /* ردیفی که منتظرِ تأییدِ دستی است ساخته می‌شود، نه با ترفند: فرمِ زیرپرونده
     **نمی‌تواند** مبلغ داشته باشد (`approve` صریحاً ردش می‌کند)، پس تنها راهِ
     رسیدن به این وضعیت ردیفِ تاریخی است — ثبت‌نامی که پیش از تأییدِ خودکار
     ساخته شده و در صفِ ادمین مانده. دقیقاً همان چیزی که `approve()` شاخهٔ
     بی‌مراجعه‌اش را برایش دارد. */
  const p4 = await newPatient();
  const row4 = await db.intakeSubmission.create({
    data: {
      token: randomBytes(12).toString('base64url'), formId: form.id, patientId: p4, amount: 0,
      status: 'pending_approval', expiresAt: new Date(Date.now() + 30 * 864e5),
      data: { mri: [{ url: 'https://pacs.example.test/study/4', title: 'رادیوگرافی' }] },
    },
  });
  const approved = await adm(`/intake/submissions/${row4.id}/approve`, {});
  ok(approved.status === 200 || approved.status === 201,
    `تأییدِ دستی پاسخ داد (${approved.status}) ${approved.status >= 400 ? JSON.stringify(approved.data) : ''}`);
  const d4 = await linkDocs(p4);
  ok(d4.length === 1 && d4[0].externalUrl.endsWith('/study/4'),
    '**باید بیفتد:** مسیرِ دستی هم همان مدرک را ساخت — هر دو از `commitAnswers` رد می‌شوند');
  ok((await db.intakeSubmission.findUnique({ where: { id: row4.id } })).visitId === null,
    'فرمِ زیرپرونده مراجعه نساخت — مدرک مستقیم به پرونده چسبید');
} finally {
  await db.document.deleteMany({ where: { patientId: { in: made.patients } } });
  await db.intakeSubmission.deleteMany({ where: { OR: [{ patientId: { in: made.patients } }, { formId: { in: made.forms } }] } });
  await db.visit.deleteMany({ where: { patientId: { in: made.patients } } });
  await db.patient.deleteMany({ where: { id: { in: made.patients } } });
  await db.formField.deleteMany({ where: { formId: { in: made.forms } } });
  await db.formDef.deleteMany({ where: { id: { in: made.forms } } });
  for (const [table, key, row] of savedAccess) {
    if (row) await db[table].update({ where: { key }, data: { minLevel: row.minLevel, enabled: row.enabled, roles: row.roles ?? [] } });
    else await db[table].delete({ where: { key } }).catch(() => {});
  }
  await db.$disconnect();
}
console.log(`\nسبز: ${count}`);
