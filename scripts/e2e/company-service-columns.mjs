/**
 * «اصلاحاتِ شرکتی» — سه بدهیِ آخر: خدمتِ فرم (`FormDef.service`)، خدمتِ مراجعه (`Visit.service`)،
 * دستهٔ مدرکِ «دستورِ پزشک» (`prescription`) — و مهاجرتِ `20260925000000_company_service_columns`.
 * Real HTTP + Nest + Prisma + PGlite (`company-service-columns-local.mjs`). Only against an isolated local database.
 *
 *  باید بیفتد:
 *   - فرمِ دلخواه با خدمتِ «ایمپلنت» در صفِ تأیید دیگر «مبهم» نیست
 *   - مراجعهٔ **دستیِ** ایمپلنت در شرکتِ دوخدمته، بی‌ردیفِ اقلام، ویرایشگرِ اقلامِ پرتالِ جراح را می‌گیرد
 *   - تأییدِ ثبت‌نام خدمت را روی مراجعه می‌نویسد
 *   - خدمتِ بیرون از بسته / فرمِ زیرپرونده / نصبِ مطب ← ۴۰۰
 *   - دستورِ پزشکِ ثبت‌نام «دستورِ پزشک» ذخیره می‌شود نه «متفرقه»، و در پرتالِ جراح هم دیده می‌شود
 *   - مهاجرتِ داده: فرم‌ها، مراجعه‌های ثبت‌نامی، کادرِ دستور و مدارکِ قبلی (حتی کنارگذاشته‌ها) پر می‌شوند
 *  نباید بیفتد:
 *   - شرکتِ تک‌خدمته: مراجعهٔ دستی خودش خدمتِ همان شرکت را می‌گیرد
 *   - مدرکِ «متفرقه»ای که از کادرِ دستور نیامده، دست نمی‌خورد
 *   - مراجعهٔ دستیِ بی‌خدمتِ قدیمی همان قاعدهٔ «ردیف دارد» را دارد
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { captchaFor } from './lib/captcha.mjs';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const API = process.env.E2E_API, DB = process.env.E2E_DB;
if (![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'sc' + randomBytes(3).toString('hex');
let count = 0, auth, seed = Number.parseInt(randomBytes(3).toString('hex'), 16);
const ok = (v, label, detail = '') => { assert.ok(v, `${label}${detail ? ' — ' + detail : ''}`); console.log('PASS ' + ++count + ' ' + label); };
const msg = (r) => JSON.stringify(r.data?.message ?? r.data);
async function api(path, body, method = body ? 'POST' : 'GET', token = auth) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
function nid(n) {
  const base = String(n % 1_000_000_000).padStart(9, '0');
  let sum = 0; for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
  const r = sum % 11; return base + String(r < 2 ? r : 11 - r);
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
async function upload(t, field) {
  const form = new FormData(); form.append('file', new Blob([JPEG], { type: 'image/jpeg' }), field + '.jpg');
  const r = await fetch(`${API}/public/intake/form/${t}/image/${field}`, { method: 'POST', body: form });
  assert.equal(r.status, 201, await r.text());
}
const profile = (kind, services) => api('/config/profile', { kind, services }, 'PATCH');

try {
  auth = (await api('/auth/login', { identifier: 'admin', password: 'test1234' })).data.accessToken;
  assert.ok(auth, 'ورود');
  let r = await profile('company', ['ionm', 'implant']);
  assert.ok(r.status < 300, msg(r));
  await api('/forms');
  const surgeon = await db.surgeon.create({ data: { active: true, person: { create: { firstName: 'جراحِ', lastName: 'ستون ' + tag } } } });
  const hospital = await db.hospital.create({ data: { name: 'بیمارستانِ ستون ' + tag } });
  const item = await db.item.create({ data: { name: 'کیجِ آزمون ' + tag } });
  const full = { surgeonId: surgeon.id, hospitalId: hospital.id };
  const today = new Date().toISOString().slice(0, 10);

  console.log('۱) خدمتِ فرم');
  const ionmForm = await db.formDef.findUnique({ where: { key: 'intake.ionm' } });
  const implantForm = await db.formDef.findUnique({ where: { key: 'intake.implant' } });
  ok(ionmForm?.service === 'ionm' && implantForm?.service === 'implant', 'فرم‌های پیش‌فرضِ ثبت‌نام خدمتِ خودشان را دارند', `${ionmForm?.service}/${implantForm?.service}`);
  r = await api('/forms', { key: 'imp' + tag, title: 'ثبت‌نامِ ایمپلنتِ دلخواه', scope: 'visit', service: 'implant' });
  ok(r.status === 201 || r.status === 200, 'فرمِ دلخواه با خدمت ساخته شد', `${r.status} ${msg(r)}`);
  const custom = await db.formDef.findUnique({ where: { key: 'visit.imp' + tag } });
  ok(custom?.service === 'implant', 'خدمت روی فرم نشست', JSON.stringify(custom?.service));
  const view = (await api('/forms')).data.find((f) => f.id === custom.id);
  ok(view?.service === 'implant', 'فهرستِ فرم‌ها خدمت را برمی‌گرداند (فرم‌ساز از همین می‌خواند)');
  r = await api(`/forms/${custom.id}`, { service: 'dental' }, 'PATCH');
  ok(r.status === 400, 'خدمتِ ناشناخته ← ۴۰۰', `${r.status} ${msg(r)}`);
  const rec = await db.formDef.create({ data: { key: 'rec' + tag, title: 'زیرپرونده', scope: 'record' } });
  r = await api(`/forms/${rec.id}`, { service: 'ionm' }, 'PATCH');
  ok(r.status === 400 && /مراجعه می‌سازد/.test(msg(r)), '**فرمِ زیرپرونده خدمت نمی‌گیرد** — مراجعه نمی‌سازد', `${r.status} ${msg(r)}`);

  const patient = await db.patient.create({ data: { code: tag, firstName: 'بیمارِ', lastName: 'ستون', phone: '0912' + String(1000000 + (seed % 8999999)) } });
  const sub = (formId, data = {}) => db.intakeSubmission.create({ data: {
    token: tag + Math.random().toString(36).slice(2, 8), patientId: patient.id, formId, status: 'pending_approval', amount: 0,
    data: { firstName: 'بیمارِ', lastName: 'ستون', ...data }, expiresAt: new Date(Date.now() + 864e5) } });
  const sCustom = await sub(custom.id);
  const row = (await api('/intake/submissions?status=pending_approval')).data.find((x) => x.id === sCustom.id);
  ok(row?.service === 'implant' && row?.serviceAmbiguous === false, '**فرمِ دلخواه با خدمتِ «ایمپلنت» دیگر مبهم نیست**', JSON.stringify({ s: row?.service, a: row?.serviceAmbiguous }));

  console.log('\n۲) خدمتِ مراجعه — از تأیید');
  r = await api(`/intake/submissions/${sCustom.id}/approve`, { ...full, opDate: today, registerPayment: false, requiredItems: [{ itemId: item.id, quantity: 2, notes: '' }] });
  ok(r.status === 201, 'ثبت‌نامِ فرمِ دلخواه تأیید شد', `${r.status} ${msg(r)}`);
  ok((await db.visit.findUnique({ where: { id: r.data.visitId } })).service === 'implant', '**تأیید خدمت را روی مراجعه نوشت**');
  const sIonm = await sub(ionmForm.id);
  r = await api(`/intake/submissions/${sIonm.id}/approve`, { ...full, registerPayment: false });
  ok(r.status === 201 && (await db.visit.findUnique({ where: { id: r.data.visitId } })).service === 'ionm', 'فرمِ پیش‌فرضِ نورومانیتورینگ ← ionm', `${r.status} ${msg(r)}`);
  const vIonm = r.data.visitId;

  console.log('\n۳) خدمتِ مراجعه — مراجعهٔ دستی');
  const manual = (extra) => api('/visits', { kind: 'surgery', firstName: 'دستیِ', lastName: 'مراجعه', nationalId: nid(++seed * 7919), ...full, opDate: today, ...extra });
  r = await manual({ service: 'implant' });
  ok(r.status === 201 && r.data?.service === 'implant', 'مراجعهٔ دستی با خدمتِ «ایمپلنت»؛ پاسخ خدمت را دارد', `${r.status} ${msg(r)}`);
  const vManualImplant = r.data.id;
  r = await manual({});
  ok(r.status === 201 && r.data?.service === null, 'شرکتِ دوخدمته بی‌انتخاب ← خالی (سرور حدس نمی‌زند)', `${r.status} ${JSON.stringify(r.data?.service)}`);
  const vManualNone = r.data.id;
  r = await manual({ service: 'dental' });
  ok(r.status === 400, 'خدمتِ ناشناخته ← ۴۰۰', `${r.status} ${msg(r)}`);
  const portal = async () => (await api('/surgeon/visits')).data.rows;
  let rows = await portal();
  const pr = (id) => rows.find((x) => x.id === id);
  ok(pr(vManualImplant)?.implant === true && pr(vManualImplant)?.requiredItems?.length === 0,
    '**مراجعهٔ دستیِ ایمپلنت بی‌ردیف ویرایشگرِ اقلام را می‌گیرد** (تا دیروز هرگز)', JSON.stringify(pr(vManualImplant)?.implant));
  ok(pr(vIonm)?.implant === false, 'مراجعهٔ نورومانیتورینگ ویرایشگر ندارد');
  ok(pr(vManualNone)?.implant === false, 'مراجعهٔ بی‌خدمت و بی‌ردیف همان قاعدهٔ قبلی (بی‌ویرایشگر)');
  r = await api(`/visits/${vManualImplant}`, { service: 'ionm' }, 'PATCH');
  ok(r.status === 200 && r.data?.service === 'ionm', 'ویرایش خدمت را عوض می‌کند', `${r.status} ${msg(r)}`);
  rows = await portal();
  ok(pr(vManualImplant)?.implant === false, 'و پرتال همان لحظه تصمیم را عوض می‌کند');
  r = await api(`/visits/${vManualImplant}`, { service: '' }, 'PATCH');
  ok(r.status === 200 && r.data?.service === null, "'' خدمت را پاک می‌کند", `${r.status} ${JSON.stringify(r.data?.service)}`);
  ok((await api(`/visits/${vIonm}`)).data?.service === 'ionm', 'نمای کاملِ مراجعه خدمت را برمی‌گرداند');

  r = await profile('company', ['ionm']);
  assert.ok(r.status < 300, msg(r));
  r = await manual({});
  ok(r.status === 201 && r.data?.service === 'ionm', '**شرکتِ تک‌خدمته: مراجعهٔ دستی خودش خدمتِ شرکت را می‌گیرد**', `${r.status} ${JSON.stringify(r.data?.service)}`);
  r = await manual({ service: 'implant' });
  ok(r.status === 400 && /بستهٔ خدمات/.test(msg(r)), 'خدمتِ بیرون از بستهٔ شرکت ← ۴۰۰', `${r.status} ${msg(r)}`);
  r = await profile('company', ['ionm', 'implant']);
  assert.ok(r.status < 300, msg(r));

  console.log('\n۴) دستورِ پزشک');
  const implantField = await db.formField.findFirst({ where: { form: { key: 'intake.implant' }, key: 'prescription' } });
  ok(implantField?.docCategory === 'prescription', 'کادرِ «تصویر دستور پزشک»ِ فرمِ ایمپلنت دستهٔ خودش را دارد', JSON.stringify(implantField?.docCategory));
  const link = await api('/intake/links', { title: 'ایمپلنت ' + tag, formId: implantForm.id, amount: 0 });
  assert.ok(link.status < 300, msg(link));
  const reg = await api(`/public/intake/link/${link.data.token}/register`, {
    firstName: 'بیمارِ', lastName: 'دستور', nationalId: nid(++seed * 7919), phone: '0912' + String(1000000 + (++seed % 8999999)), ...(await captchaFor(API, link.data.token)),
  }, 'POST', null);
  assert.ok(reg.status < 300 && reg.data?.token, msg(reg));
  await upload(reg.data.token, 'prescription');
  const regRow = await db.intakeSubmission.findUnique({ where: { token: reg.data.token } });
  const rxId = regRow.data.prescription?.[0]?.id;
  const rxDoc = await db.document.findUnique({ where: { id: rxId } });
  ok(rxDoc?.category === 'prescription', '**دستورِ پزشکِ ثبت‌نام «دستورِ پزشک» ذخیره شد، نه «متفرقه»**', JSON.stringify(rxDoc?.category));
  await db.document.update({ where: { id: rxId }, data: { visitId: vIonm } });
  rows = await portal();
  ok(pr(vIonm)?.documents?.some((d) => d.id === rxId), '**و در پرتالِ جراح هم دیده می‌شود** (تا دیروز از راهِ «متفرقه» دیده می‌شد)');

  console.log('\n۵) مهاجرتِ داده روی ردیف‌های قدیمی');
  const sql = (await readFile(new URL('../../server/prisma/migrations/20260925000000_company_service_columns/migration.sql', import.meta.url), 'utf8'))
    .replace(/^\s*--.*$/gm, '').split(';').map((x) => x.trim()).filter((x) => /^UPDATE/i.test(x));
  ok(sql.length === 4, 'چهار UPDATEِ داده در مهاجرت', String(sql.length));
  // وضعیتِ «پیش از مهاجرت» را می‌سازیم: ستون‌های خالی، کادرِ بی‌دسته، مدرکِ «متفرقه».
  await db.formDef.update({ where: { id: implantForm.id }, data: { service: null } });
  await db.formField.update({ where: { id: implantField.id }, data: { docCategory: null } });
  const legacyVisit = await db.visit.findUnique({ where: { id: vIonm } });
  await db.visit.update({ where: { id: vIonm }, data: { service: null } });
  await db.visit.update({ where: { id: vManualNone }, data: { service: null } });
  const mkDoc = (title) => db.document.create({ data: { patientId: patient.id, category: 'other', title, fileName: title + '.jpg', mimeType: 'image/jpeg', size: 1, sha256: '0'.repeat(64) } });
  const [dForm, dReturned, dOther] = [await mkDoc('rx-form'), await mkDoc('rx-returned'), await mkDoc('unrelated')];
  await db.intakeSubmission.create({ data: {
    token: tag + 'legacy', patientId: patient.id, formId: implantForm.id, status: 'pending_fill', amount: 0, expiresAt: new Date(Date.now() + 864e5),
    data: { prescription: { id: dForm.id, name: 'rx.jpg' }, _returns: [{ stage: 'documents', note: 'x', at: 'x', by: 1, images: { prescription: [{ id: dReturned.id }] } }], junk: { prescription: [{ id: 'abc' }] } },
  } });
  await db.intakeSubmission.create({ data: {
    token: tag + 'bad', patientId: patient.id, formId: implantForm.id, status: 'pending_fill', amount: 0, expiresAt: new Date(Date.now() + 864e5),
    data: { prescription: [{ id: 'not-a-number' }, null] },
  } });
  let migrated = true;
  try { for (const q of sql) await db.$executeRawUnsafe(q); } catch (e) { migrated = false; console.error(e); }
  ok(migrated, '**شناسهٔ خرابِ داخلِ JSON مهاجرت را نمی‌شکند**');
  ok((await db.formDef.findUnique({ where: { id: implantForm.id } })).service === 'implant', 'فرمِ پیش‌فرض پر شد');
  ok((await db.formField.findUnique({ where: { id: implantField.id } })).docCategory === 'prescription', 'کادرِ دستور دسته گرفت');
  ok((await db.visit.findUnique({ where: { id: vIonm } })).service === (legacyVisit.service ?? 'ionm') && (await db.visit.findUnique({ where: { id: vIonm } })).service === 'ionm',
    'مراجعهٔ ثبت‌نامی از فرمِ خودش پر شد');
  ok((await db.visit.findUnique({ where: { id: vManualNone } })).service === null, '**مراجعهٔ دستی حدس زده نمی‌شود** — خالی می‌ماند');
  ok((await db.document.findUnique({ where: { id: dForm.id } })).category === 'prescription', 'مدرکِ کادرِ دستور (شیءِ تکیِ قدیمی) ← دستورِ پزشک');
  ok((await db.document.findUnique({ where: { id: dReturned.id } })).category === 'prescription', '**مدرکِ کنارگذاشته در `_returns` هم** ← دستورِ پزشک');
  ok((await db.document.findUnique({ where: { id: dOther.id } })).category === 'other', 'مدرکِ «متفرقه»ِ بی‌ربط دست نخورد');

  console.log('\n۶) نصبِ مطب');
  r = await profile('clinic', []);
  assert.ok(r.status < 300, msg(r));
  r = await manual({ kind: undefined, service: 'ionm' });
  ok(r.status === 400 && /شرکتی/.test(msg(r)), 'مطب خدمتِ مراجعه نمی‌گیرد', `${r.status} ${msg(r)}`);
  r = await api(`/forms/${custom.id}`, { service: 'ionm' }, 'PATCH');
  ok(r.status === 400 && /شرکتی/.test(msg(r)), 'مطب خدمتِ فرم هم نمی‌گیرد', `${r.status} ${msg(r)}`);

  console.log(`\n${count} سنجه سبز`);
} finally {
  await db.$disconnect().catch(() => undefined);
}
