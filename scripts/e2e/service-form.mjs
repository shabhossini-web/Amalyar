/**
 * فرمِ ثبتِ خدمت — اطلاعاتِ خدمت، کارت ملی، دستور پزشک و «رزرو بدون تاریخ».
 * Real HTTP + Nest + Prisma + PGlite (`service-form-local.mjs`). Only against an isolated local database.
 *
 * زمینه (مالک، ۱۴۰۵/۰۷/۰۱): بیمار «نام عمل، نام جراح، بیمارستان، تاریخ عمل (با قابلیتِ
 * رزرو بدون تاریخ)، آپلود کارت ملی و دستور پزشک» را پر می‌کند؛ هر دو خدمت.
 *
 *  باید بیفتد:
 *   - بی‌تاریخ و بی‌«رزرو بدون تاریخ» ← ۴۰۰
 *   - بی‌کارتِ ملی یا بی‌دستورِ پزشک ← ۴۰۰ (هر دو خدمت)
 *   - «رزرو بدون تاریخ» تاریخِ نیمه‌پرِ قبلی را پاک می‌کند (دو ادعای متناقض نمی‌ماند)
 *   - با نوبت‌دهیِ روشن، «رزرو بدون تاریخ» روزِ نوبت نمی‌خواهد
 *   - فرمِ نصب‌شدهٔ قدیمی یک‌بار فیلدهای تازه را می‌گیرد؛ برچسبِ دست‌خورده و فیلدِ خاموش دست نمی‌خورند؛
 *     فیلدِ پاک‌شده بعد از ارتقا برنمی‌گردد
 *  نباید بیفتد:
 *   - کارتِ ملی با دستهٔ «مدرکِ شناسایی» در پرونده می‌نشیند
 *   - تأییدِ «رزرو بدون تاریخ» مراجعهٔ بی‌تاریخ می‌سازد (نورومانیتورینگ و ایمپلنت)
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const API = process.env.E2E_API, DB = process.env.E2E_DB;
if (![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'sf' + randomBytes(3).toString('hex');
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
async function upload(token, field) {
  const form = new FormData(); form.append('file', new Blob([JPEG], { type: 'image/jpeg' }), field + '.jpg');
  const r = await fetch(`${API}/public/intake/form/${token}/image/${field}`, { method: 'POST', body: form });
  return r.status;
}
const setSetting = (key, value) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
async function register(linkToken) {
  const r = await pub(`/public/intake/link/${linkToken}/register`, {
    firstName: 'بیمارِ', lastName: 'خدمت', nationalId: nid(++seed * 7919), phone: '0912' + String(1000000 + (seed % 8999999)), captchaA: 2, captchaB: 3, captchaAnswer: 5,
  });
  assert.ok(r.status < 300 && r.data?.token, msg(r));
  return r.data.token;
}
const base = { surgeonName: 'دکتر آزمون', hospitalName: 'بیمارستان آزمون', procedure: 'فیوژن کمری' };

try {
  auth = (await api('/auth/login', { identifier: 'admin', password: 'test1234' })).data.accessToken;
  assert.ok(auth, 'ورود');

  console.log('۱) فرمِ نصب‌شدهٔ قدیمی — ارتقای افزایشی (پیش از اولین خواندن)');
  /* نصبِ واقعیِ دیروز: فرمِ ایمپلنت با فیلدهای قبلی و پرچمِ نصب؛ مدیر برچسبِ بیمارستان را
     عوض کرده و توضیحات را خاموش. */
  await setSetting('vertical', 'implant');
  const old = await db.formDef.create({ data: { key: 'intake.implant', title: 'ثبت‌نام تأمین تجهیزات و ایمپلنت', scope: 'intake', visitKind: 'surgery', fields: { create: [
    { key: 'surgeonName', label: 'نام جراح', required: true, sort: 10 },
    { key: 'hospitalName', label: 'بیمارستانِ محلِ عمل', required: true, sort: 20 },
    { key: 'procedure', label: 'نوع عمل', sort: 30 },
    { key: 'opDate', label: 'تاریخ عمل', type: 'date', sort: 40 },
    { key: 'prescription', label: 'تصویر دستور جراح', type: 'image', required: true, sort: 50 },
    { key: 'patientNotes', label: 'شرح دستور و توضیحات', type: 'textarea', active: false, sort: 60 },
  ] } } });
  await setSetting('registration_implant_installed', 'true');
  await api('/forms');
  const up = await db.formField.findMany({ where: { formId: old.id } });
  const f = (k) => up.find((x) => x.key === k);
  ok(f('nationalIdImage')?.type === 'image' && f('nationalIdImage')?.required && f('nationalIdImage')?.docCategory === 'identity', '**فرمِ قدیمی کارتِ ملی (اجباری، دستهٔ شناسایی) گرفت**', JSON.stringify(f('nationalIdImage')));
  ok(f('opDateOpen')?.type === 'bool', 'و «رزرو بدون تاریخ»');
  ok(f('procedure')?.label === 'نام عمل' && f('procedure')?.required === true, 'برچسبِ پیش‌فرضِ «نوع عمل» به «نام عمل» (اجباری) رفت');
  ok(f('hospitalName')?.label === 'بیمارستانِ محلِ عمل', '**برچسبِ دست‌خوردهٔ مدیر دست نخورد**');
  ok(f('patientNotes')?.active === false, '**فیلدِ خاموش خاموش ماند**');
  ok(f('prescription')?.label === 'تصویر دستور جراح' && up.filter((x) => x.key === 'prescription').length === 1, 'دستورِ موجود تکرار نشد');
  await db.formField.delete({ where: { id: f('nationalIdImage').id } });
  await api('/forms');
  ok(!(await db.formField.findFirst({ where: { formId: old.id, key: 'nationalIdImage' } })), '**فیلدی که مدیر بعد از ارتقا پاک کرد برنمی‌گردد**');

  console.log('\n۲) شرکتِ دوخدمته — فرمِ تازهٔ نورومانیتورینگ');
  await setSetting('vertical', 'ionm');
  await setSetting('services', JSON.stringify(['ionm', 'implant']));
  await api('/forms');
  const ionm = await db.formDef.findUnique({ where: { key: 'intake.ionm' }, include: { fields: true } });
  const g = (k) => ionm.fields.find((x) => x.key === k);
  ok(g('nationalIdImage')?.docCategory === 'identity' && g('prescription')?.required && g('procedure')?.label === 'نام عمل', '**نصبِ تازه همهٔ فیلدهای خدمت را با دستهٔ مدرک دارد**');
  const link = await api('/intake/links', { title: 'نورو ' + tag, formId: ionm.id, amount: 1000000 });
  assert.ok(link.status < 300, msg(link));

  console.log('\n۳) اعتبارسنجیِ صفحهٔ خدمت (باید بیفتد)');
  let t = await register(link.data.token);
  let r = await pub(`/public/intake/form/${t}/fill`, { values: { ...base } });
  ok(r.status === 400 && /تاریخ عمل/.test(msg(r)), '**بی‌تاریخ و بی‌«رزرو بدون تاریخ» ← ۴۰۰**', `${r.status} ${msg(r)}`);
  r = await pub(`/public/intake/form/${t}/fill`, { values: { ...base, opDateOpen: true } });
  ok(r.status === 400 && /کارت ملی/.test(msg(r)) && /دستور پزشک/.test(msg(r)), '**بی‌کارتِ ملی و بی‌دستور ← ۴۰۰**', `${r.status} ${msg(r)}`);
  ok(await upload(t, 'nationalIdImage') === 201 && await upload(t, 'prescription') === 201, 'آپلودِ کارتِ ملی و دستورِ پزشک');
  r = await pub(`/public/intake/form/${t}/fill`, { values: { ...base, opDate: '1405/08/10', opDateOpen: true } });
  ok(r.status === 200 || r.status === 201, '«رزرو بدون تاریخ» + مدارک ← پذیرفته', `${r.status} ${msg(r)}`);
  let row = await db.intakeSubmission.findUnique({ where: { token: t } });
  ok(row.status === 'pending_payment' && row.data.opDateOpen === true && !('opDate' in row.data), '**تاریخِ نیمه‌پر کنارِ «رزرو بدون تاریخ» پاک شد**؛ به «در انتظارِ واریز» رفت', JSON.stringify({ s: row.status, d: row.data.opDate }));
  const idDoc = await db.document.findFirst({ where: { patientId: row.patientId, category: 'identity' } });
  ok(!!idDoc, 'کارتِ ملی با دستهٔ «مدرکِ شناسایی» در پرونده نشست');

  console.log('\n۴) نوبت‌دهیِ روشن');
  await db.availabilityRule.create({ data: { weekday: 1, startMin: 540, endMin: 720, active: true } });
  t = await register(link.data.token);
  await upload(t, 'nationalIdImage'); await upload(t, 'prescription');
  r = await pub(`/public/intake/form/${t}/fill`, { values: { ...base, opDate: '1405/08/10' } });
  ok(r.status === 400 && /روزِ نوبت/.test(msg(r)), 'تاریخ‌دار بی‌نوبت ← «روزِ نوبت را انتخاب کنید» (نباید بیفتد)', `${r.status} ${msg(r)}`);
  r = await pub(`/public/intake/form/${t}/fill`, { values: { ...base, opDateOpen: true } });
  ok(r.status === 200 || r.status === 201, '**«رزرو بدون تاریخ» روزِ نوبت نمی‌خواهد**', `${r.status} ${msg(r)}`);
  await db.availabilityRule.deleteMany({});

  console.log('\n۵) تأییدِ «رزرو بدون تاریخ» ← مراجعهٔ بی‌تاریخ');
  const surgeon = await db.surgeon.create({ data: { person: { create: { firstName: 'جراح', lastName: tag } } } });
  const hospital = await db.hospital.create({ data: { name: 'بیمارستان ' + tag } });
  const item = await db.item.create({ data: { name: 'پیچ ' + tag } });
  await db.intakeSubmission.update({ where: { id: row.id }, data: { status: 'pending_approval' } });
  r = await api(`/intake/submissions/${row.id}/approve`, { surgeonId: surgeon.id, hospitalId: hospital.id, registerPayment: false });
  ok(r.status === 201, 'نورومانیتورینگِ بی‌تاریخ تأیید شد', `${r.status} ${msg(r)}`);
  let v = await db.visit.findUnique({ where: { id: r.data.visitId } });
  ok(v.opDate === null && !('opDateOpen' in (v.extra ?? {})), '**مراجعهٔ بی‌تاریخ؛ نشانِ رزرو در extra نیست**', JSON.stringify({ d: v.opDate, e: v.extra }));
  const implantForm = await db.formDef.findUnique({ where: { key: 'intake.implant' } });
  const sub = await db.intakeSubmission.create({ data: { token: tag + 'i', patientId: row.patientId, formId: implantForm.id, status: 'pending_approval', amount: 0,
    data: { ...base, opDateOpen: 'true' }, expiresAt: new Date(Date.now() + 864e5) } });
  r = await api(`/intake/submissions/${sub.id}/approve`, { surgeonId: surgeon.id, hospitalId: hospital.id, registerPayment: false, requiredItems: [{ itemId: item.id, quantity: 2, notes: '' }] });
  ok(r.status === 201, '**ایمپلنتِ بی‌تاریخ هم تأیید می‌شود** (پیش‌تر ستارهٔ تاریخِ فرمِ عمل ردش می‌کرد)', `${r.status} ${msg(r)}`);
  v = await db.visit.findUnique({ where: { id: r.data.visitId } });
  ok(v.opDate === null && v.requiredItems?.[0]?.quantity === 2, 'بی‌تاریخ، با ردیفِ اقلام');

  console.log(`\n${count} سنجه سبز`);
} finally {
  await db.$disconnect().catch(() => undefined);
}
