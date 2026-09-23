/**
 * صفحهٔ پرداخت و پاپ‌آپِ تأیید — توضیحِ شرکت، **همهٔ** فیش‌ها، مدارکِ فرم، اصلاحِ هویت.
 * Real HTTP + Nest + Prisma + PGlite (`approval-cards-local.mjs`). Only against an isolated local database.
 *
 * زمینه (مالک، ۱۴۰۵/۰۷/۰۱): صفحهٔ پرداخت «کارتِ بانکی با شماره کارت و شبا، دکمهٔ کپی
 * و توضیحات»؛ پاپ‌آپِ تأیید «کارتِ هویت، کارتِ خدمت، کارتِ پرداخت»؛ غلطِ هویتی را
 * تأییدکننده همان‌جا درست می‌کند. رابط را `approval-cards-ui.mjs` و `payment-step-ui.mjs` می‌سنجند.
 *
 *  باید بیفتد:
 *   - توضیحِ خالیِ ذخیره‌شده ← متنِ پیش‌فرض (نه صفحهٔ بی‌توضیح)
 *   - فیشِ دوم در ردیفِ صف هست (تا دیروز فقط `receiptDocumentId` = اولی)
 *   - فیشِ پاک‌شده (`deletedAt`) در ردیف نمی‌آید
 *   - کارتِ ملی و دستورِ پزشک با برچسبِ کادرشان مدرکِ ردیف‌اند؛ PDF نشانِ `pdf` دارد
 *   - مقدارِ شیء‌وارِ کادرِ غیرِعکس مدرک حساب نمی‌شود
 *   - اصلاحِ هویت کدِ ملی را عوض نمی‌کند
 *  نباید بیفتد:
 *   - توضیحِ دلخواهِ شرکت همان‌طور به بیمار می‌رسد
 *   - اصلاحِ نام از مسیرِ پرونده در ردیفِ صف دیده می‌شود و ردِ ممیزی دارد
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { imageRefsOf, receiptIdsOf } = require('./dist/patients/intake-docs.js');

const API = process.env.E2E_API, DB = process.env.E2E_DB;
if (![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'ac' + randomBytes(3).toString('hex');
let count = 0, auth, seed = Number.parseInt(randomBytes(3).toString('hex'), 16);
const ok = (v, label, detail = '') => { assert.ok(v, `${label}${detail ? ' — ' + detail : ''}`); console.log('PASS ' + ++count + ' ' + label); };
const msg = (r) => JSON.stringify(r.data?.message ?? r.data);
async function api(path, body, method = body ? 'POST' : 'GET', token = auth) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const pub = (path, body, method) => api(path, body, method, null);
function nid(n) {
  const base = String(n % 1_000_000_000).padStart(9, '0');
  let sum = 0; for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
  const r = sum % 11; return base + String(r < 2 ? r : 11 - r);
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
async function send(path, buf, type, name) {
  const form = new FormData(); form.append('file', new Blob([buf], { type }), name);
  const r = await fetch(API + path, { method: 'POST', body: form });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const setSetting = (key, value) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

try {
  auth = (await api('/auth/login', { identifier: 'admin', password: 'test1234' })).data.accessToken;
  assert.ok(auth, 'ورود');

  console.log('۰) قاعدهٔ «کدام مقدار مدرک است» (خالص)');
  ok(JSON.stringify(receiptIdsOf({ receiptDocumentId: 5 })) === '[5]', 'کلیدِ تکیِ قدیمی خوانده می‌شود');
  ok(JSON.stringify(receiptIdsOf({ receiptDocumentIds: [3, 3, '4', 0, null] })) === '[3,4]', 'چندتایی، بی‌تکرار، بی‌مقدارِ خراب');
  ok(imageRefsOf({ links: [{ id: 9, url: 'https://x.test' }], hospital: { id: 3 } }, []).length === 0,
    '**مقدارِ شیء‌وارِ کادرِ غیرِعکس مدرک نیست** (لینک، انتخابِ بیمارستان)');
  ok(JSON.stringify(imageRefsOf({ card: { id: 7, name: 'a.jpg' }, rx: [{ id: 8 }, { id: 7 }] }, [{ key: 'card', label: 'کارت' }, { key: 'rx', label: 'نسخه' }]))
    === JSON.stringify([{ id: 7, field: 'card', label: 'کارت' }, { id: 8, field: 'rx', label: 'نسخه' }]), 'شیءِ تکیِ قدیمی و آرایه، به ترتیبِ فیلدها، بی‌تکرار');

  await setSetting('vertical', 'ionm');
  await api('/forms');
  const form = await db.formDef.findUnique({ where: { key: 'intake.ionm' } });
  const acct = await api('/bank-accounts', { ownerName: 'شرکتِ آزمون ' + tag, bankName: 'ملت', cardNumber: '6104337712345678', accountNumber: '1234567890', iban: '820120000000001234567890', showOnIntake: true });
  assert.ok(acct.status < 300, msg(acct));
  const link = await api('/intake/links', { title: 'نورو ' + tag, formId: form.id, amount: 2_000_000 });
  assert.ok(link.status < 300, msg(link));
  const reg = await pub(`/public/intake/link/${link.data.token}/register`, {
    firstName: 'بیمارِ', lastName: 'کارت‌ها', nationalId: nid(++seed * 7919), phone: '0912' + String(1000000 + (seed % 8999999)),
    birthDate: '1990-03-21', captchaA: 2, captchaB: 3, captchaAnswer: 5,
  });
  assert.ok(reg.status < 300 && reg.data?.token, msg(reg));
  const t = reg.data.token;
  for (const field of ['nationalIdImage', 'prescription']) {
    const up = await send(`/public/intake/form/${t}/image/${field}`, JPEG, 'image/jpeg', field + '.jpg');
    assert.equal(up.status, 201, msg(up));
  }
  const rx2 = await send(`/public/intake/form/${t}/image/prescription`, PDF, 'application/pdf', 'rx-page2.pdf');
  assert.equal(rx2.status, 201, msg(rx2));
  const filled = await pub(`/public/intake/form/${t}/fill`, { values: { surgeonName: 'دکتر آزمون', hospitalName: 'بیمارستان آزمون', procedure: 'فیوژن', opDateOpen: true } });
  assert.ok(filled.status < 300 && filled.data?.status === 'pending_payment', msg(filled));

  console.log('\n۱) صفحهٔ پرداخت — توضیحِ شرکت');
  let view = (await pub(`/public/intake/form/${t}`)).data;
  const DEFAULT = view.paymentNote;
  ok(/فیش/.test(DEFAULT ?? ''), 'توضیحِ پیش‌فرض به بیمار می‌رسد', DEFAULT);
  ok(view.payTo?.[0]?.cardNumber === '6104337712345678' && /1234567890$/.test(view.payTo?.[0]?.iban ?? ''), 'کارت و شبا برای کارتِ بانکی', JSON.stringify(view.payTo?.[0]));
  const custom = 'لطفاً فقط از کارتِ به نامِ خودِ بیمار واریز کنید.';
  let r = await api('/settings', { values: { intake_payment_note: custom } }, 'PATCH');
  assert.ok(r.status < 300, msg(r));
  view = (await pub(`/public/intake/form/${t}`)).data;
  ok(view.paymentNote === custom, 'توضیحِ دلخواهِ شرکت همان‌طور می‌رسد', view.paymentNote);
  r = await api('/settings', { values: { intake_payment_note: '' } }, 'PATCH');
  assert.ok(r.status < 300, msg(r));
  view = (await pub(`/public/intake/form/${t}`)).data;
  ok(view.paymentNote === DEFAULT, '**توضیحِ خالیِ ذخیره‌شده ← متنِ پیش‌فرض**', JSON.stringify(view.paymentNote));

  console.log('\n۲) ردیفِ صف — همهٔ فیش‌ها و مدارکِ فرم');
  const r1 = await send(`/public/intake/form/${t}/receipt`, JPEG, 'image/jpeg', 'qest-1.jpg');
  const r2 = await send(`/public/intake/form/${t}/receipt`, PDF, 'application/pdf', 'qest-2.pdf');
  ok(r1.status === 201 && r2.status === 201, 'دو فیش بارگذاری شد', `${r1.status}/${r2.status} ${msg(r2)}`);
  const sub = await db.intakeSubmission.findUnique({ where: { token: t } });
  if (sub.status !== 'pending_approval') await db.intakeSubmission.update({ where: { id: sub.id }, data: { status: 'pending_approval' } });
  const rowOf = async () => (await api('/intake/submissions?status=pending_approval')).data.find((x) => x.token === t);
  let row = await rowOf();
  const ids = sub.data.receiptDocumentIds;
  ok(row?.receipts?.length === 2 && row.receipts.map((x) => x.id).join() === ids.join(), '**هر دو فیش در ردیف** — نه فقط اولی', JSON.stringify(row?.receipts));
  ok(row.receipts[1].pdf === true && row.receipts[0].pdf === false && row.receipts[1].name === 'qest-2.pdf', 'فیشِ PDF نشانِ pdf دارد (با `<img>` باز نمی‌شود)');
  const docs = row.documents ?? [];
  ok(docs.some((x) => x.field === 'nationalIdImage' && x.label === 'تصویر کارت ملی'), '**کارتِ ملی با برچسبِ کادرش مدرکِ ردیف است**', JSON.stringify(docs));
  ok(docs.filter((x) => x.field === 'prescription').length === 2 && docs.some((x) => x.field === 'prescription' && x.pdf), 'هر دو صفحهٔ دستورِ پزشک، PDF با نشانش');
  ok(!docs.some((x) => ids.includes(x.id)), 'فیش جزوِ مدارکِ خدمت تکرار نمی‌شود');
  await db.document.update({ where: { id: ids[0] }, data: { deletedAt: new Date() } });
  row = await rowOf();
  ok(row.receipts.length === 1 && row.receipts[0].id === ids[1], '**فیشِ پاک‌شده در ردیف نمی‌آید**', JSON.stringify(row.receipts));

  console.log('\n۳) کارتِ هویت — اصلاح از مسیرِ پرونده');
  const before = row.patient;
  ok(before?.birthDate && String(before.birthDate).startsWith('1990-03-21'), 'تاریخِ تولد در ردیف هست', JSON.stringify(before?.birthDate));
  r = await api(`/patients/${before.id}`, { firstName: 'بیمارِ اصلاح‌شده', nationalId: '0000000000' }, 'PATCH');
  ok(r.status === 200, 'اصلاحِ نام پذیرفته شد', `${r.status} ${msg(r)}`);
  row = await rowOf();
  ok(row.patient.firstName === 'بیمارِ اصلاح‌شده', 'نامِ اصلاح‌شده در ردیفِ صف دیده می‌شود');
  ok(row.patient.nationalId === before.nationalId, '**کدِ ملی از این مسیر عوض نمی‌شود** — کلیدِ پرونده است', row.patient.nationalId);
  const audit = await db.auditEvent.findFirst({ where: { action: 'patient.update', entityType: 'patient', entityId: String(before.id) }, orderBy: { id: 'desc' } });
  ok(audit && JSON.stringify(audit.afterJson).includes('بیمارِ اصلاح‌شده'), 'و ردِ ممیزی دارد', JSON.stringify(audit?.afterJson));

  console.log(`\n${count} سنجه سبز`);
} finally {
  await db.$disconnect().catch(() => undefined);
}
