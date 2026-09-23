/**
 * شرکتِ دوخدمته — تأییدِ ثبت‌نام بر اساسِ خدمتِ **همان ثبت‌نام**، نه حوزهٔ کلِ شرکت.
 * Real HTTP + Nest + Prisma + PGlite (`company-services-local.mjs`). Only against an isolated local database.
 *
 * زمینه (مالک، ۱۴۰۵/۰۷/۰۱): نصب یا مطب/کلینیک است یا شرکتی و شرکت خودش خدماتش را
 * می‌چیند؛ خیلی شرکت‌ها هر دو خدمت را دارند. تا دیروز تأیید از `vertical`ِ شرکت
 * می‌پرسید «اقلامِ ایمپلنت لازم است؟» — شرکتِ دوخدمته یا هر نورومانیتورینگ را بی‌اقلام
 * رد می‌کرد یا هیچ ایمپلنتی ویرایشگرِ اقلام نمی‌گرفت.
 * و تصمیمِ مالک: جراح و بیمارستانِ **تعریف‌شده** برای هر دو خدمت الزامی.
 *
 *  باید بیفتد:
 *   - ثبت‌نامِ ایمپلنت بی‌ردیفِ اقلام ← ۴۰۰ (در شرکتی که خدمتِ اصلی‌اش نورومانیتورینگ است)
 *   - نورومانیتورینگ بی‌بیمارستانِ تعریف‌شده ← ۴۰۰ (قبلاً فقط جراح لازم بود)
 *   - بیمارستانِ «پیشنهادی» (تطبیقِ فازی) خودکار چسبانده نمی‌شود ← ۴۰۰
 *   - بی‌جراحِ تعریف‌شده ← ۴۰۰
 *   - فرمِ دلخواه با خدمتِ ناشناخته/ارائه‌نشده ← ۴۰۰؛ با «ایمپلنت» بی‌اقلام ← ۴۰۰
 *   - پرتالِ جراح: ویرایشگرِ اقلام فقط روی مراجعهٔ ایمپلنتی (`implant` per-مراجعه)
 *  نباید بیفتد:
 *   - نورومانیتورینگِ کامل **بی‌اقلام** تأیید می‌شود؛ ایمپلنتِ کامل با تعداد ۴ ذخیره می‌شود
 *   - نامِ بیمارستانی که بیمار **دقیق** نوشته خودکار مچ می‌شود
 *   - فرمِ دلخواهِ مبهم پیش‌فرضِ خدمتِ اصلی می‌گیرد، نه خطا
 *   - شرکتِ تک‌خدمته: فرمِ دلخواه خدمتِ همان شرکت است و مبهم نیست
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const API = process.env.E2E_API, DB = process.env.E2E_DB;
if (![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'cs' + randomBytes(3).toString('hex');
let count = 0, auth;
const ok = (v, label, detail = '') => { assert.ok(v, `${label}${detail ? ' — ' + detail : ''}`); console.log('PASS ' + ++count + ' ' + label); };
async function api(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const setSetting = (key, value) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
const msg = (r) => JSON.stringify(r.data?.message ?? r.data);

try {
  auth = (await api('/auth/login', { identifier: 'admin', password: 'test1234' })).data.accessToken;
  assert.ok(auth, 'ورود');

  /* شرکتِ دوخدمته: `vertical` خدمتِ اصلی (نورومانیتورینگ) و بستهٔ خدمات هر دو. */
  await setSetting('vertical', 'ionm');
  await setSetting('services', JSON.stringify(['ionm', 'implant']));

  const patient = await db.patient.create({ data: { code: tag, firstName: 'بیمارِ', lastName: 'دوخدمته', phone: '09120001' + String(Math.floor(Math.random() * 900) + 100) } });
  const surgeon = await db.surgeon.create({ data: { person: { create: { firstName: 'جراحِ', lastName: 'تعریف‌شده' } } } });
  const hospital = await db.hospital.create({ data: { name: 'بیمارستان آزمون مرکزی ' + tag } });
  const item = await db.item.create({ data: { name: 'پیچ پدیکولار ' + tag } });
  const mkForm = (key, title) => db.formDef.create({ data: { key, title, scope: 'intake', visitKind: 'surgery' } });
  const ionmForm = await mkForm('intake.ionm', 'ثبت‌نام نورومانیتورینگ');
  const implantForm = await mkForm('intake.implant', 'ثبت‌نام ایمپلنت');
  const customForm = await mkForm('custom' + tag, 'فرمِ دلخواه');
  const sub = (formId, data = {}) => db.intakeSubmission.create({ data: {
    token: tag + Math.random().toString(36).slice(2, 8), patientId: patient.id, formId, status: 'pending_approval', amount: 0,
    data: { firstName: 'بیمارِ', lastName: 'دوخدمته', surgeonName: 'دکتر آزمون', ...data }, expiresAt: new Date(Date.now() + 864e5) } });
  const approve = (id, body) => api(`/intake/submissions/${id}/approve`, { registerPayment: false, ...body });
  const full = { surgeonId: surgeon.id, hospitalId: hospital.id };
  const rows = [{ itemId: item.id, quantity: 4, notes: '' }];

  console.log('\n۱) صفِ ثبت‌نام خدمتِ هر ردیف را می‌گوید');
  const sIonm = await sub(ionmForm.id), sImplant = await sub(implantForm.id), sCustom = await sub(customForm.id);
  const list = (await api('/intake/submissions?status=pending_approval')).data;
  const rowOf = (id) => list.find((r) => r.id === id);
  ok(rowOf(sIonm.id)?.service === 'ionm' && rowOf(sIonm.id)?.serviceAmbiguous === false, 'فرمِ نورومانیتورینگ ← ionm', JSON.stringify(rowOf(sIonm.id)?.service));
  ok(rowOf(sImplant.id)?.service === 'implant' && rowOf(sImplant.id)?.serviceLabel === 'ایمپلنت و تجهیزات', 'فرمِ ایمپلنت ← implant با برچسب');
  ok(rowOf(sCustom.id)?.service === 'ionm' && rowOf(sCustom.id)?.serviceAmbiguous === true, '**فرمِ دلخواه در شرکتِ دوخدمته مبهم است؛ پیش‌فرض خدمتِ اصلی**');

  console.log('\n۲) ایمپلنت اقلام می‌خواهد، حتی وقتی خدمتِ اصلی نورومانیتورینگ است (باید بیفتد)');
  let r = await approve(sImplant.id, full);
  ok(r.status === 400 && /اقلام/.test(msg(r)), '**ایمپلنت بی‌ردیف ← ۴۰۰ اقلام**', `${r.status} ${msg(r)}`);

  console.log('\n۳) جراح و بیمارستانِ تعریف‌شده برای هر دو خدمت (تصمیمِ مالک)');
  r = await approve(sIonm.id, { surgeonId: surgeon.id });
  ok(r.status === 400 && /بیمارستان/.test(msg(r)), '**نورومانیتورینگ بی‌بیمارستانِ تعریف‌شده ← ۴۰۰**', `${r.status} ${msg(r)}`);
  r = await approve(sIonm.id, { hospitalId: hospital.id });
  ok(r.status === 400 && /جراح/.test(msg(r)), 'بی‌جراحِ تعریف‌شده ← ۴۰۰', `${r.status} ${msg(r)}`);
  /* نامِ نزدیک ولی نه دقیق: تطبیقِ فازی «پیشنهاد» می‌دهد، و پیشنهاد نباید خودکار بنشیند. */
  const sFuzzy = await sub(ionmForm.id, { hospitalName: 'بیمارستان آزمون مرکز ' + tag });
  const refs = (await api(`/intake/submissions/${sFuzzy.id}/refs`)).data;
  ok(refs?.hospital?.source === 'suggested' && refs.hospital.id === hospital.id, 'پیش‌شرط: نامِ نزدیک «پیشنهادی» است', JSON.stringify(refs?.hospital));
  r = await approve(sFuzzy.id, { surgeonId: surgeon.id });
  ok(r.status === 400 && /بیمارستان/.test(msg(r)), '**بیمارستانِ پیشنهادی خودکار چسبانده نمی‌شود**', `${r.status} ${msg(r)}`);

  console.log('\n۴) مسیرهای درست (نباید بیفتد)');
  r = await approve(sIonm.id, full);
  ok(r.status === 201, '**نورومانیتورینگِ کامل بی‌اقلام تأیید می‌شود**', `${r.status} ${msg(r)}`);
  const vIonm = await db.visit.findUnique({ where: { id: r.data.visitId } });
  ok(vIonm.requiredItems == null && vIonm.hospitalId === hospital.id && vIonm.surgeonId === surgeon.id, 'مراجعهٔ نورومانیتورینگ بی‌اقلام، با جراح و بیمارستان');
  r = await approve(sImplant.id, { ...full, requiredItems: rows });
  ok(r.status === 201, 'ایمپلنتِ کامل تأیید می‌شود', `${r.status} ${msg(r)}`);
  const vImplant = await db.visit.findUnique({ where: { id: r.data.visitId } });
  ok(vImplant.requiredItems?.[0]?.quantity === 4, 'ردیفِ ایمپلنت با تعدادِ ۴ روی مراجعه');
  const sExact = await sub(ionmForm.id, { hospitalName: hospital.name });
  r = await approve(sExact.id, { surgeonId: surgeon.id });
  ok(r.status === 201, 'نامِ **دقیقِ** بیمارستان خودکار مچ می‌شود', `${r.status} ${msg(r)}`);
  ok((await db.visit.findUnique({ where: { id: r.data.visitId } })).hospitalId === hospital.id, 'و همان بیمارستان روی مراجعه نشست');

  console.log('\n۵) فرمِ دلخواه — خدمت را تأییدکننده می‌گوید');
  r = await approve(sCustom.id, { ...full, service: 'dental' });
  ok(r.status === 400, 'خدمتِ ناشناخته ← ۴۰۰', `${r.status} ${msg(r)}`);
  r = await approve(sCustom.id, { ...full, service: 'implant' });
  ok(r.status === 400 && /اقلام/.test(msg(r)), '**«ایمپلنت» روی فرمِ دلخواه هم اقلام می‌خواهد**', `${r.status} ${msg(r)}`);
  r = await approve(sCustom.id, { ...full, service: 'implant', requiredItems: rows });
  ok(r.status === 201, 'با اقلام تأیید می‌شود', `${r.status} ${msg(r)}`);
  const vCustom = r.data.visitId;
  const sCustom2 = await sub(customForm.id);
  r = await approve(sCustom2.id, full);
  ok(r.status === 201, 'فرمِ دلخواهِ مبهم بی‌انتخاب ← خدمتِ اصلی (نورومانیتورینگ)، نه خطا', `${r.status} ${msg(r)}`);

  console.log('\n۶) پرتالِ جراح — ویرایشگرِ اقلام per-مراجعه');
  const portal = (await api('/surgeon/visits')).data;
  const pr = (id) => portal?.rows?.find((x) => x.id === id);
  ok(pr(vImplant.id)?.implant === true && pr(vCustom)?.implant === true, 'مراجعهٔ ایمپلنتی ← ویرایشگرِ اقلام', JSON.stringify(pr(vImplant.id)?.implant));
  ok(pr(vIonm.id)?.implant === false, '**مراجعهٔ نورومانیتورینگ در شرکتِ دوخدمته ویرایشگرِ اقلام ندارد**', JSON.stringify(pr(vIonm.id)?.implant));
  ok(JSON.stringify(portal.services) === '["ionm","implant"]', 'پرتال بستهٔ خدمات را می‌گوید');

  console.log('\n۷) شرکتِ تک‌خدمته');
  await setSetting('services', JSON.stringify(['ionm']));
  const sCustom3 = await sub(customForm.id);
  const list2 = (await api('/intake/submissions?status=pending_approval')).data;
  const row3 = list2.find((x) => x.id === sCustom3.id);
  ok(row3?.service === 'ionm' && row3?.serviceAmbiguous === false, 'فرمِ دلخواه در شرکتِ تک‌خدمته مبهم نیست');
  r = await approve(sCustom3.id, { ...full, service: 'implant' });
  ok(r.status === 400 && /ارائه نمی‌کند/.test(msg(r)), 'خدمتی که شرکت ندارد ← ۴۰۰', `${r.status} ${msg(r)}`);
  const sImplant2 = await sub(implantForm.id);
  r = await approve(sImplant2.id, full);
  ok(r.status === 400 && /اقلام/.test(msg(r)), 'فرمِ ایمپلنت خدمتش را خودش می‌گوید، حتی وقتی شرکت دیگر ایمپلنت ندارد');

  console.log(`\n${count} سنجه سبز`);
} finally {
  await db.$disconnect().catch(() => undefined);
}
