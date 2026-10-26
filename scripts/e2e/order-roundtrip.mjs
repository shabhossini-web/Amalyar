/**
 * رفت‌وبرگشتِ درخواستِ پاراکلینیک بینِ پزشک و بیمار — گزارشِ مالک (۱۴۰۵/۰۸/۰۴):
 * ۱) توضیحِ صوتیِ پزشک ثبت و برای بیمار فرستاده نمی‌شد — صدای کارکنان سفارش را «پاسخ آمد»
 *    می‌کرد و صفحهٔ بیمار هیچ صدایی نشان نمی‌داد.
 * ۲) بیمار که عکسِ بیشتری اضافه می‌کرد خطای «قبلاً ثبت شده» می‌گرفت در حالی که فایل ثبت شده بود.
 * ۳) پس از «ناقص است» همان پاسخِ قبلی بی‌هیچ چیزِ تازه دوباره «پاسخ» می‌شد.
 * ۴) چیزِ تازه پس از «بررسی شد» کارِ بررسی را باز می‌کرد ولی دوباره بررسی‌کردن ممکن نبود.
 * فقط روی دیتابیسِ محلیِ جدا.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const API = process.env.E2E_API ?? 'http://localhost:3101/api', DB = process.env.E2E_DB;
if (!DB || ![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'ort' + randomBytes(4).toString('hex');
let token, count = 0;
const ok = (v, label, extra = '') => { assert.ok(v, `${label} ${extra}`); console.log('PASS ' + ++count + ' ' + label); };
const j = async (r) => ({ status: r.status, data: await r.json().catch(() => null) });
const api = (path, body, method = 'POST') => fetch(API + path, { method,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then(j);
const pub = (path, body, method = 'POST') => fetch(API + path, { method, headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then(j);

const wav = () => { const b = Buffer.alloc(64); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(56, 4); b.write('WAVE', 8, 'latin1'); b.write(randomBytes(8).toString('hex'), 20); return b; };
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
const form = (buf, name, type, extra = {}) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
};
const staffUpload = (patientId, visitId, buf, name, type, title) => fetch(`${API}/patients/${patientId}/documents`, {
  method: 'POST', headers: { Authorization: 'Bearer ' + token },
  body: form(buf, name, type, { category: 'lab', title, visitId: String(visitId) }),
}).then(j);
const patientUpload = (tok, buf, name, type) => fetch(`${API}/public/order/${tok}/files`, { method: 'POST', body: form(buf, name, type) }).then(j);

let patientId;
try {
  token = (await pub('/auth/login', { identifier: 'admin', password: 'test1234' })).data?.accessToken;
  assert.ok(token, 'ورود');
  patientId = (await db.patient.create({ data: { code: tag, firstName: 'بیمار', lastName: 'رفت‌وبرگشت', phone: '09120000931' } })).id;
  const visit = await db.visit.create({ data: { patientId, seq: 1, kind: 'clinic' } });

  console.log('۱) صدای پزشک = توضیحِ درخواست');
  const order = (await api('/orders/lab', { patientId, visitId: visit.id, tests: ['CBC diff', 'FBS'], note: 'ناشتا بروید' })).data;
  ok(order?.status === 'draft', 'سفارش ساخته شد');
  const voice = await staffUpload(patientId, visit.id, wav(), 'note.wav', 'audio/wav', 'توضیحِ صوتیِ پزشک — درخواستِ آزمایش');
  ok(voice.status === 201 || voice.status === 200, 'صدای پزشک بارگذاری شد', JSON.stringify(voice.data).slice(0, 120));
  const withVoice = await api(`/orders/lab/${order.id}`, { documentIds: [voice.data.id] }, 'PATCH');
  ok(withVoice.data?.status === 'draft', '**صدای پزشک وضعیت را «پاسخ آمد» نمی‌کند**', withVoice.data?.status);
  ok(withVoice.data?.documents?.find((d) => d.id === voice.data.id)?.requestNote === true, 'شیت صدا را «توضیحِ درخواست» می‌شناسد');
  await db.labOrder.update({ where: { id: order.id }, data: { status: 'sent', sentAt: new Date() } });
  ok((await api(`/orders/lab/${order.id}`, { tests: ['CBC diff'] }, 'PATCH')).status === 409, '**درخواستِ ارسال‌شده قفل است** (تغییرِ آزمایش‌ها ۴۰۹)');
  ok((await api(`/orders/lab/${order.id}`, { documentIds: [] }, 'PATCH')).status === 200, 'ذخیرهٔ بی‌تغییرِ درخواست رد نمی‌شود');

  const view = (await pub(`/public/order/${order.token}`, undefined, 'GET')).data;
  ok(view?.voices?.length === 1 && view.voices[0].id === voice.data.id, '**صفحهٔ بیمار صدای پزشک را دارد**');
  const stream = await fetch(`${API}/public/order/${order.token}/voice/${voice.data.id}`);
  const bytes = Buffer.from(await stream.arrayBuffer());
  ok(stream.status === 200 && stream.headers.get('content-type')?.startsWith('audio/wav') && bytes.subarray(8, 12).toString('latin1') === 'WAVE',
    '**صدا از لینکِ عمومی پخش می‌شود**');
  const other = await db.document.create({ data: { patientId, visitId: visit.id, category: 'lab', title: 'x', fileName: 'x.wav',
    mimeType: 'audio/wav', size: 1, sha256: 'x' } });
  ok((await fetch(`${API}/public/order/${order.token}/voice/${other.id}`)).status === 404, 'مدرکِ دیگرِ پرونده از این لینک بیرون نمی‌آید');
  await db.document.delete({ where: { id: other.id } });

  console.log('\n۲) پاسخِ بیمار — صدای پزشک «پاسخ» حساب نمی‌شود');
  ok((await pub(`/public/order/${order.token}/answer`, {})).status === 400, 'بی‌موادِ خودِ بیمار پاسخ پذیرفته نمی‌شود');
  ok((await patientUpload(order.token, png(), 'p1.png', 'image/png')).status === 201, 'بیمار عکسِ اول را فرستاد');
  const first = await pub(`/public/order/${order.token}/answer`, { text: 'جوابِ آزمایش' });
  ok(first.data?.status === 'answered', 'پاسخ ثبت شد');

  console.log('\n۳) عکسِ بیشتر = پاسخِ تازه، بی‌خطا');
  ok((await patientUpload(order.token, png(), 'p2.png', 'image/png')).status === 201, 'عکسِ دوم بارگذاری شد');
  ok((await pub(`/public/order/${order.token}`, undefined, 'GET')).data?.drafts === 1, 'صفحهٔ بیمار می‌گوید ۱ فایل آمادهٔ ارسال است');
  const add = await pub(`/public/order/${order.token}/answer`, { append: true });
  ok(add.status === 200 || add.status === 201, '**ارسالِ دوباره پس از بارگذاری خطای «قبلاً ثبت شده» نمی‌دهد**', JSON.stringify(add.data));
  const resps = await db.orderResponse.findMany({ where: { orderRef: 'lab_order', orderId: order.id }, orderBy: { seq: 'asc' }, include: { documents: true } });
  ok(resps.length === 2 && resps[0].documents.some((d) => d.fileName === 'p1.png') && resps[1].documents.some((d) => d.fileName === 'p2.png'),
    '**هر ارسال پاسخِ جدای خودش با مدارکِ خودش**', resps.map((r) => `${r.seq}:${r.documents.map((d) => d.fileName)}`).join(' | '));
  ok(resps[0].text === 'جوابِ آزمایش' && !resps[1].text, 'متنِ پاسخِ اول در پاسخِ دوم تکرار نمی‌شود');
  ok((await pub(`/public/order/${order.token}/answer`, { append: true })).status === 400, 'ارسالِ خالی (بی‌فایلِ تازه) رد می‌شود');

  console.log('\n۴) «بررسی شد» و سپس چیزِ تازه ← دوباره بررسی‌پذیر');
  const rv = await api(`/orders/lab/${order.id}/review`, { status: 'reviewed', receivedItems: ['FBS', 'جعلی'] });
  ok(rv.data?.status === 'reviewed', 'بررسی شد');
  ok(JSON.stringify(rv.data?.receivedItems) === '["FBS"]', '**چک‌لیست: فقط موردِ درخواستی «رسید» می‌خورد**', JSON.stringify(rv.data?.receivedItems));
  ok(rv.data?.responses?.every((r) => r.status === 'reviewed'), 'تصمیم روی پاسخ‌های بررسی‌نشده نشست');
  const pv = (await pub(`/public/order/${order.token}`, undefined, 'GET')).data;
  ok(pv?.items?.length === 2 && JSON.stringify(pv?.receivedItems) === '["FBS"]', '**بیمار می‌بیند کدام مورد رسیده و کدام نه**');
  ok(pv?.responses?.length === 2 && pv.responses[1].statusFa === 'بررسی شد', 'بیمار فهرستِ پاسخ‌هایش را با وضعیت می‌بیند');
  ok((await patientUpload(order.token, png(), 'p3.png', 'image/png')).status === 201, 'بیمار پس از بررسی عکسِ تازه گذاشت');
  const draftView = (await api(`/orders/lab/${order.id}`, { documentIds: [] }, 'PATCH')).data;
  ok(draftView?.status === 'reviewed' && !draftView?.documents?.some((d) => d.fresh), 'پیش‌نویسِ ارسال‌نشده کارِ بررسی را باز نمی‌کند');
  ok((await pub(`/public/order/${order.token}/answer`, { append: true })).data?.status === 'answered', 'ارسالِ تازه → دوباره «پاسخ آمد»');
  const rows = (await api(`/orders?patientId=${patientId}`, undefined, 'GET')).data;
  const live = (Array.isArray(rows) ? rows : rows?.lab ?? rows?.orders ?? []).find?.((o) => o.id === order.id && (o.kind ?? 'lab') === 'lab')
    ?? (await api(`/orders/lab/${order.id}`, {}, 'PATCH')).data;
  ok(live?.responses?.at(-1)?.status === 'new' && live?.responses?.at(-1)?.documents?.length === 1, '**ارسالِ تازه کارتِ «در انتظارِ بررسی»ِ خودش را دارد**');
  ok(live?.documents?.some((d) => d.from === 'patient') && live?.documents?.some((d) => d.from === 'staff'), 'هر مدرک می‌گوید از کیست');
  const again = await api(`/orders/lab/${order.id}/review`, { status: 'needs_action', reviewNote: 'صفحهٔ دوم ناخواناست' });
  ok(again.status === 200 || again.status === 201, '**سفارشِ بررسی‌شده با موادِ تازه دوباره بررسی می‌شود**', JSON.stringify(again.data).slice(0, 120));

  console.log('\n۵) پس از «ناقص است» ← فقط با چیزِ تازه');
  const v2 = (await pub(`/public/order/${order.token}`, undefined, 'GET')).data;
  ok(v2?.reviewNote === 'صفحهٔ دوم ناخواناست', 'بیمار دلیلِ ناقص‌بودن را می‌بیند');
  ok((await pub(`/public/order/${order.token}/answer`, {})).status === 400, '**همان موادِ قبلی دوباره «پاسخ» نمی‌شود**');
  ok((await patientUpload(order.token, png(), 'p4.png', 'image/png')).status === 201, 'عکسِ خواناتر فرستاده شد');
  const re = await pub(`/public/order/${order.token}/answer`, {});
  ok(re.data?.status === 'answered', 'با عکسِ تازه دوباره «پاسخ آمد»');
  const fresh = await db.labOrder.findUnique({ where: { id: order.id } });
  ok(fresh.resultText === 'جوابِ آزمایش', '**ارسالِ دومِ بی‌متن متنِ قبلی را پاک نمی‌کند**', String(fresh.resultText));
  let up = 0;
  for (let i = 0; i < 5; i++) up += (await patientUpload(order.token, png(), `d${i}.png`, 'image/png')).status === 201 ? 1 : 0;
  ok(up === 5 && (await patientUpload(order.token, wav(), 'p6.wav', 'audio/wav')).status === 400, 'سقفِ ۵ فایل در هر ارسال');
} finally {
  if (patientId) {
    await db.document.deleteMany({ where: { patientId } }).catch(() => {});
    await db.labOrder.deleteMany({ where: { patientId } }).catch(() => {});
    await db.domainEvent.deleteMany({ where: { patientId } }).catch(() => {});
    await db.visit.deleteMany({ where: { patientId } }).catch(() => {});
    await db.patient.delete({ where: { id: patientId } }).catch(() => {});
  }
  await db.$disconnect();
}
console.log(`\nسبز: ${count}`);
