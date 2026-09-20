/**
 * گاردهای نشانی‌های **عمومیِ** ثبت‌نام — نوعِ فایل از بایت‌ها، و نرخ‌گیرِ
 * پیش‌نویس. Real HTTP + Prisma. Only run against an isolated local database.
 *
 * دو بدهیِ ثبت‌شدهٔ لِینِ الف که در خودِ بسته‌هایشان نوشته شده بودند:
 *
 * ۱. **W0.8:** «`attachImage` هنوز به `file.mimetype`ِ کلاینت اعتماد می‌کند.»
 *    `attachReceipt` هم همان را داشت. `multipart` نوع را در هدرِ خودِ درخواست
 *    می‌گوید و آن هدر را **فرستنده** می‌نویسد؛ مقدارش ذخیره می‌شد و
 *    `record.controller` عیناً در `Content-Type` می‌گذارد (و برای `image/*`
 *    هم `inline`). یعنی برچسبِ یک آپلودکنندهٔ بی‌احراز روی مدرکِ پزشکی
 *    می‌نشست و به مرورگرِ کارکنان می‌رسید.
 *
 * ۲. **W1.8:** «`draft` نرخ‌گیر ندارد» — نشانیِ عمومی‌ای که در هر فراخوانی
 *    در دیتابیس می‌نویسد.
 *
 *  باید بیفتد:
 *   - نوعِ ذخیره‌شده از **بایت‌ها** بیاید، حتی وقتی کلاینت چیزِ دیگری ادعا کند
 *   - امضای ناشناس `application/octet-stream` شود (نه ادعای کلاینت)
 *   - هر دو مسیر — فیش و کادرِ عکس — یک رفتار داشته باشند
 *   - پیش‌نویس بعد از سقف ۴۲۹ بگیرد
 *  نباید بیفتد:
 *   - فایلِ سالم رد شود
 *   - ادعای خارج از فهرستِ مجاز از صافیِ اول رد نشود
 *   - نرخ‌گیر توکنِ **دیگری** را هم ببندد
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const API = process.env.E2E_API, DB = process.env.E2E_DB;
if (!DB || ![API, DB].every(u => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'grd' + randomBytes(4).toString('hex');

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const eq = (a, b, label) => { assert.equal(a, b, `${label} (${a} ≠ ${b})`); console.log('PASS ' + ++count + ' ' + label); };

/* بایت‌های واقعیِ هر نوع — امضا کافی است، فایلِ کامل لازم نیست. `sniffMime`
   دستِ‌کم ۱۲ بایت می‌خواهد، پس همه به ۳۲ بایت pad می‌شوند. */
const pad = (b) => Buffer.concat([b, Buffer.alloc(32)]);
const PNG = pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const JPEG = pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
const PDF = pad(Buffer.from('%PDF-1.7\n', 'latin1'));
const HTML = pad(Buffer.from('<html><script>alert(1)</script>', 'latin1'));

async function upload(path, bytes, claimed, name = 'x.png') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: claimed }), name);
  const r = await fetch(API + path, { method: 'POST', body: form });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const draft = async (token, values) => {
  const r = await fetch(`${API}/public/intake/form/${token}/draft`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }),
  });
  return r.status;
};
const lastDoc = (patientId) => db.document.findFirst({ where: { patientId }, orderBy: { id: 'desc' } });

try {
  const form = await db.formDef.create({
    data: {
      key: tag, title: 'فرمِ گاردها', scope: 'record', active: true,
      fields: { create: [
        { key: 'sharh', label: 'شرح', type: 'text', page: 1, sort: 1 },
        { key: 'aks', label: 'عکسِ مدرک', type: 'image', page: 1, sort: 2 },
      ] },
    },
  });
  const patient = await db.patient.create({ data: { code: tag, firstName: 'بیمارِ', lastName: 'گارد' } });
  const mk = async (status) => {
    const t = randomBytes(12).toString('base64url');
    await db.intakeSubmission.create({
      data: { token: t, formId: form.id, patientId: patient.id, amount: 0, status, data: {},
        expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000) },
    });
    return t;
  };

  console.log('\n۱) کادرِ عکسِ فرم — نوع از بایت‌ها');
  const t1 = await mk('pending_fill');
  eq((await upload(`/public/intake/form/${t1}/image/aks`, PNG, 'image/png')).status, 201, 'PNGِ سالم پذیرفته شد');
  eq((await lastDoc(patient.id)).mimeType, 'image/png', 'نوعِ ذخیره‌شده image/png است');

  /* 🔴 هستهٔ بدهی: ادعا یک چیز، بایت‌ها چیزِ دیگر. */
  eq((await upload(`/public/intake/form/${t1}/image/aks`, PDF, 'image/png')).status, 201, 'فایلِ PDF با ادعای png پذیرفته شد');
  eq((await lastDoc(patient.id)).mimeType, 'application/pdf',
    '**نوعِ ذخیره‌شده از بایت‌هاست، نه از ادعای کلاینت**');

  eq((await upload(`/public/intake/form/${t1}/image/aks`, HTML, 'image/png')).status, 201, 'فایلِ ناشناس پذیرفته شد');
  eq((await lastDoc(patient.id)).mimeType, 'application/octet-stream',
    '**امضای ناشناس octet-stream می‌شود — نه image/png که به inline می‌رسد**');

  console.log('\n۲) فیشِ واریزی — همان رفتار');
  const t2 = await mk('pending_payment');
  eq((await upload(`/public/intake/form/${t2}/receipt`, JPEG, 'image/jpeg')).status, 201, 'JPEGِ سالم پذیرفته شد');
  eq((await lastDoc(patient.id)).mimeType, 'image/jpeg', 'نوعِ ذخیره‌شده image/jpeg است');
  eq((await upload(`/public/intake/form/${t2}/receipt`, HTML, 'application/pdf')).status, 201, 'فایلِ ناشناس پذیرفته شد');
  eq((await lastDoc(patient.id)).mimeType, 'application/octet-stream',
    '**فیش هم همان قاعده را دارد — دو مسیر، یک رفتار**');

  console.log('\n۳) نباید بیفتد — صافیِ اول سرِ جایش است');
  const t3 = await mk('pending_fill');
  eq((await upload(`/public/intake/form/${t3}/image/aks`, PNG, 'text/html')).status, 400,
    'ادعای خارج از فهرستِ مجاز همان اول رد می‌شود');
  eq((await upload(`/public/intake/form/${t3}/image/nist`, PNG, 'image/png')).status, 400,
    'کادری که فیلدِ عکسِ این فرم نیست رد می‌شود');

  console.log('\n۴) نرخ‌گیرِ پیش‌نویس');
  const t4 = await mk('pending_fill');
  let statuses = [];
  for (let i = 0; i < 300; i++) statuses.push(await draft(t4, { sharh: 'م' + i }));
  ok(statuses.every((s) => s === 200 || s === 201), `۳۰۰ ذخیرهٔ پشت‌سرهم می‌گذرد (پرکردنِ یک فرم خیلی کمتر است)`);
  eq(await draft(t4, { sharh: 'بعدی' }), 429, '**ذخیرهٔ ۳۰۱ام ۴۲۹ می‌گیرد**');

  console.log('\n۵) نباید بیفتد — سهمِ هر توکن جداست');
  const t5 = await mk('pending_fill');
  const other = await draft(t5, { sharh: 'توکنِ دیگر' });
  ok(other === 200 || other === 201, '**توکنِ دیگر بابتِ سقفِ این یکی بسته نمی‌شود**');

  console.log(`\n${count} سنجه سبز`);
} finally {
  await db.$disconnect().catch(() => undefined);
}
