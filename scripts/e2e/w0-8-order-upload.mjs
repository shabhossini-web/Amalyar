/**
 * W0.8 — گاردِ وضعیتِ `publicAnswer` + آپلودِ فایلِ پاسخ (قرارداد §۴–۵).
 * Real Prisma + real HTTP. Only run against an isolated local database.
 *
 * تا امروز بیمار هیچ راهی نداشت جوابِ آزمایشش را بفرستد جز اینکه جایی
 * آپلود کند و **لینکش** را بگذارد — یعنی مدرکِ پزشکی روی سرورِ یک غریبه؛ و
 * اگر فقط فایل داشت، `publicAnswer` می‌گفت «متن یا لینکِ پاسخ را وارد کنید».
 *
 *  باید بیفتد:
 *   - آپلودِ فایل مدرک بسازد، به همان سفارش وصل شود و `{id,name,size}` بدهد
 *   - فایلِ تنها یک پاسخِ کامل باشد (بدونِ متن و لینک هم `answered` شود)
 *   - پاسخِ دوم بدونِ `append` ⇒ ۴۰۹
 *   - `append` مدرکِ تازه بسازد و کارِ بررسی را دوباره باز کند
 *   - نوع از **بایت‌ها** سنجیده شود، نه از ادعای کلاینت
 *   - سقفِ ۵ فایل و سقفِ ۱۰ مگابایت برقرار باشد
 *   - `draft` (هنوز ارسال‌نشده) و «نامهٔ ارجاع» آپلود نگیرند
 *  نباید بیفتد:
 *   - ⚠️ `append` تصمیمِ بررسیِ ثبت‌شده (`reviewNote`/`reviewedAt`) را پاک کند
 *   - `append`ِ تکراری مدرکِ دوم بسازد یا کارِ بررسی را الکی باز کند
 *   - آپلود روی سفارشِ **ارسال‌شده** وضعیت را جلو ببرد (سه صفحه = سه گذار)
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const DB = process.env.E2E_DB, API = process.env.E2E_API;
if (!DB || !['localhost', '127.0.0.1'].includes(new URL(DB).hostname)) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'ord' + randomBytes(4).toString('hex');

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };

/** PNGِ ۱×۱ واقعی — امضای درست، پس sniff باید قبولش کند. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const pngOf = (n) => Buffer.concat([PNG, Buffer.from(`%${'x'.repeat(n)}`)]); // محتوای متفاوت ⇒ sha متفاوت

const upload = (token, buf, name = 'result.png', type = 'image/png') => {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), name);
  return fetch(`${API}/public/order/${token}/files`, { method: 'POST', body: fd });
};
const answer = (token, body) => fetch(`${API}/public/order/${token}/answer`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const docsOf = (id, kind = 'lab_order') =>
  db.document.findMany({ where: { refType: kind, refId: id, deletedAt: null }, orderBy: { id: 'asc' } });
const eventsOf = (id, kind = 'lab_order') =>
  db.domainEvent.findMany({ where: { refType: kind, refId: id }, orderBy: { id: 'asc' } });

try {
  const pid = (await db.patient.create({
    data: { code: tag, firstName: 'بیمار', lastName: 'جواب', phone: '09120000001' } })).id;
  const visit = await db.visit.create({ data: { patientId: pid, seq: 1, kind: 'visit', opStatus: 'pending' } });
  const mkOrder = (status, extra = {}) => db.labOrder.create({
    data: { patientId: pid, visitId: visit.id, tests: ['CBC'], token: tag + randomBytes(6).toString('hex'), status, ...extra } });

  console.log('\n۱) آپلودِ فایل روی سفارشِ ارسال‌شده');
  const sent = await mkOrder('sent');
  const up = await upload(sent.token, pngOf(1));
  const body = await up.json();
  ok(up.status < 300 && Number.isInteger(body.id) && body.size > 0,
    `فایل ثبت شد و {id,name,size} برگشت (id=${body.id}، ${body.size} بایت)`);
  const attached = await docsOf(sent.id);
  ok(attached.length === 1 && attached[0].patientId === pid && attached[0].visitId === visit.id
    && attached[0].category === 'lab',
    'مدرک به همان بیمار/مراجعه/سفارش وصل شد و دستهٔ درست گرفت');
  ok((await db.labOrder.findUnique({ where: { id: sent.id } })).status === 'sent',
    '⚠️ آپلود به‌تنهایی وضعیت را جلو نبرد — سه صفحهٔ جواب یعنی یک گذار، نه سه تا');
  ok((await eventsOf(sent.id)).length === 0, 'آپلودِ ساده رویدادی صادر نکرد');

  console.log('\n۲) فایل خودش یک پاسخِ کامل است');
  const bare = await answer(sent.token, {});
  ok(bare.status < 300, 'پاسخ بدونِ متن و لینک پذیرفته شد چون فایل پیوست است');
  const afterAnswer = await db.labOrder.findUnique({ where: { id: sent.id } });
  ok(afterAnswer.status === 'answered', 'وضعیت به answered رفت');
  ok((await eventsOf(sent.id)).some(e => e.type === 'order.answered'), 'رویدادِ order.answered صادر شد');

  const empty = await mkOrder('sent');
  const none = await answer(empty.token, {});
  ok(none.status === 400 && (await none.json()).message?.includes('فایلِ پاسخ'),
    'ولی سفارشِ بی‌فایل و بی‌متن همچنان ۴۰۰ می‌گیرد (پیام هر سه راه را می‌گوید)');

  console.log('\n۳) گاردِ وضعیت و مسیرِ افزودن');
  const again = await answer(sent.token, { text: 'جوابِ دوم' });
  ok(again.status === 409, 'پاسخِ دوم بدونِ append ⇒ ۴۰۹');

  await db.labOrder.update({ where: { id: sent.id },
    data: { status: 'reviewed', reviewNote: 'تأییدِ پزشک', reviewedAt: new Date() } });
  const beforeAppend = await db.labOrder.findUnique({ where: { id: sent.id } });
  const app1 = await answer(sent.token, { append: true, text: 'صفحهٔ دومِ جواب' });
  ok(app1.status < 300, 'با append پذیرفته شد');
  const afterAppend = await db.labOrder.findUnique({ where: { id: sent.id } });
  /* ۱۴۰۵/۰۸/۰۴ — «هر ارسال، پاسخِ جدا»: ارسالِ تازه پاسخِ تازه‌ای است که باید بررسی شود (سفارش دوباره
     «پاسخ آمد»)؛ تصمیمِ قبلی روی **پاسخِ قبلی** می‌ماند — سندِ پرونده پاک نمی‌شود. */
  ok(afterAppend.status === 'answered', 'ارسالِ تازه سفارش را دوباره «پاسخ آمد» کرد تا بررسی شود');
  ok(afterAppend.resultText === beforeAppend.resultText,
    'متنِ پاسخِ اولِ روی خودِ سفارش هم بازنویسی نشد');
  const respRows = await db.orderResponse.findMany({ where: { orderRef: 'lab_order', orderId: sent.id }, orderBy: { seq: 'asc' } });
  ok(respRows.length === 2 && respRows[1].text === 'صفحهٔ دومِ جواب', 'پاسخِ تازه ردیفِ خودش را با متنِ خودش گرفت');
  ok((await docsOf(sent.id)).some(d => d.contentText === 'صفحهٔ دومِ جواب'),
    'متنِ افزوده مدرکِ تازهٔ خودش را گرفت');
  ok((await eventsOf(sent.id)).filter(e => e.type === 'order.answered').length === 2,
    'رویدادِ تازه رفت تا کارِ بررسی دوباره باز شود');

  const dup = await answer(sent.token, { append: true });
  ok(dup.status === 400, 'ارسالِ خالی (بی‌فایل/متنِ تازه) ۴۰۰ می‌گیرد — دوبار زدنِ دکمه کارِ بررسی را باز نمی‌کند');
  ok((await eventsOf(sent.id)).filter(e => e.type === 'order.answered').length === 2,
    'و رویدادِ سومی صادر نشد');

  console.log('\n۴) آپلود روی سفارشِ پاسخ‌داده‌شده = پیش‌نویسِ پاسخِ تازه');
  const upAfter = await upload(sent.token, pngOf(2));
  ok(upAfter.status < 300, 'فایلِ تازه روی سفارشِ پاسخ‌دار پذیرفته شد');
  ok((await eventsOf(sent.id)).filter(e => e.type === 'order.answered').length === 2,
    'پیش‌نویس تا «ارسال» رویدادی نمی‌سازد');
  ok((await answer(sent.token, { append: true })).status < 300, 'ارسالِ همان فایل پذیرفته شد');
  ok((await eventsOf(sent.id)).filter(e => e.type === 'order.answered').length === 3,
    'و رویداد رفت — مادهٔ تازه باید دوباره دیده شود');

  console.log('\n۵) گاردهای فایل');
  const lie = await upload(sent.token, Buffer.from('<html><script>alert(1)</script></html>'), 'x.png', 'image/png');
  ok(lie.status === 400,
    '⚠️ HTMLی که خودش را image/png می‌نامد رد شد — نوع از بایت‌ها سنجیده می‌شود');
  const svg = await upload(sent.token, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'x.svg', 'image/svg+xml');
  ok(svg.status === 400, 'SVG پذیرفته نمی‌شود (XML است و اسکریپت حمل می‌کند)');
  const big = await upload(sent.token, Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024, 1)]));
  ok(big.status >= 400, 'فایلِ بزرگ‌تر از ۱۰ مگابایت رد شد');

  const capped = await mkOrder('sent');
  for (let i = 0; i < 5; i++) ok((await upload(capped.token, pngOf(10 + i))).status < 300, `فایلِ ${i + 1} از ۵ پذیرفته شد`);
  const sixth = await upload(capped.token, pngOf(99));
  ok(sixth.status === 400 && (await sixth.json()).message?.includes('۵'),
    'فایلِ ششم رد شد (سقفِ قرارداد §۵)');

  console.log('\n۶) نشانی‌هایی که اصلاً نباید فایل بگیرند');
  const draft = await mkOrder('draft');
  ok((await upload(draft.token, pngOf(3))).status === 409,
    'سفارشِ draft — که هنوز برای بیمار نرفته — آپلود نمی‌گیرد');
  ok((await docsOf(draft.id)).length === 0, 'و هیچ مدرکی برایش ساخته نشد');
  const ref = await db.referralOrder.create({
    data: { patientId: pid, visitId: visit.id, token: tag + 'ref', status: 'sent' } });
  ok((await upload(ref.token, pngOf(4))).status === 400, 'نامهٔ ارجاع پاسخ نمی‌گیرد');
  ok((await upload('nope-' + tag, pngOf(5))).status === 404, 'توکنِ ناشناس ۴۰۴ می‌گیرد');

  console.log(`\n✅ ${count}/${count}`);
} finally {
  await db.$disconnect();
}
