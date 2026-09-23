/**
 * چندعکسی‌شدنِ کادرهای عکسِ فرم و فیشِ واریزی (#66):
 *
 * - کادرِ عکسِ فرم چند فایل نگه می‌دارد؛ هر آپلود **اضافه** می‌شود نه
 *   جایگزین (تا دیروز عکسِ دوم اولی را می‌خورد).
 * - برداشتنِ یک عکس فقط همان را می‌برد و بقیه سرِ جایشان‌اند.
 * - **سازگاریِ عقب‌رو**: رکوردِ قدیمی که شیءِ تکی دارد، هم «پر» شمرده
 *   می‌شود و هم با آپلودِ بعدی به آرایه تبدیل می‌گردد — بدونِ مهاجرت.
 * - فیشِ واریزی هم چندتایی است؛ `receiptDocumentId` (تکی) برای همهٔ
 *   خواننده‌های قدیمی می‌ماند و برداشتنِ آخرین فیش، فرم را به «در انتظارِ
 *   فیش» برمی‌گرداند.
 * - نمای پرونده به‌جای «[object Object]» تعدادِ فایل‌ها را می‌نویسد.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { captchaFor } from './lib/captcha.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'mi' + randomBytes(3).toString('hex');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** کدِ ملیِ معتبر با رقمِ کنترلی — سرور اعتبارش را می‌سنجد. */
const nid = (n) => {
  const base = String(100000000 + (n % 800000000)).padStart(9, '0');
  const sum = base.split('').reduce((a, d, i) => a + Number(d) * (10 - i), 0);
  const r = sum % 11;
  return base + String(r < 2 ? r : 11 - r);
};

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const pub = (p, m, b) => fetch(API + p, {
  method: m ?? 'GET', headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const upl = async (p, name) => {
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), name);
  const r = await fetch(API + p, { method: 'POST', body: fd });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const trash = { forms: [], links: [] };
const PHONE = '09120000969';

try {
  console.log('۱) چیدمان: فرمِ ثبت‌نام با کادرِ عکس');
  const form = (await send('/forms', 'POST', { key: tag, title: `[mi] فرمِ ${tag}`, scope: 'intake' })).json;
  trash.forms.push(form.id);
  await send(`/forms/${form.id}/fields`, 'POST', { key: 'idcard', label: 'کارتِ شناسایی', type: 'image', page: 1 });
  await send(`/forms/${form.id}/fields`, 'POST', { key: 'pay', label: 'پرداخت', type: 'payment', page: 1 });
  let bank = (await send('/intake/link-options', 'GET')).json?.banks?.[0];
  if (!bank) {
    bank = (await send('/bank-accounts', 'POST', {
      ownerName: '[mi] حساب', bankName: 'ملت', accountNumber: '11112222',
      cardNumber: '6104333344445555', iban: '820120000000001111222233', showOnIntake: true,
    })).json;
  }
  const link = (await send('/intake/links', 'POST', {
    title: `[mi] لینکِ ${tag}`, amount: 300000, formId: form.id, bankAccountId: bank.id,
  })).json;
  trash.links.push(link.id);
  const reg = await pub(`/public/intake/link/${link.token}/register`, 'POST', {
    firstName: 'بیمارِ', lastName: 'چندعکسی', nationalId: nid(Date.now() % 800000000),
    phone: PHONE, ...(await captchaFor(API, link.token)),
  });
  ok(reg.status < 300, `بیمار ثبت‌نام کرد (${reg.status})`);
  const token = reg.json?.token;

  console.log('\n۲) کادرِ عکس: آپلودِ دوم جایگزین نمی‌شود، اضافه می‌شود');
  const u1 = await upl(`/public/intake/form/${token}/image/idcard`, `${tag}-1.png`);
  ok(u1.status < 300 && Array.isArray(u1.json?.data?.idcard) && u1.json.data.idcard.length === 1,
    `**اولین عکس به‌شکلِ آرایه نشست** (${JSON.stringify(u1.json?.data?.idcard)?.slice(0, 60)})`);
  const u2 = await upl(`/public/intake/form/${token}/image/idcard`, `${tag}-2.png`);
  ok(u2.json?.data?.idcard?.length === 2, `**عکسِ دوم اضافه شد، اولی را نخورد** (${u2.json?.data?.idcard?.length})`);
  const u3 = await upl(`/public/intake/form/${token}/image/idcard`, `${tag}-3.png`);
  ok(u3.json?.data?.idcard?.length === 3, 'سومی هم اضافه شد');
  const names = (u3.json.data.idcard ?? []).map((x) => x.name);
  ok(names.includes(`${tag}-1.png`) && names.includes(`${tag}-3.png`), 'نامِ هر سه فایل نگه داشته شد');

  console.log('\n۳) برداشتنِ یک عکس');
  const midId = u3.json.data.idcard[1].id;
  const del = await pub(`/public/intake/form/${token}/image/idcard/${midId}`, 'DELETE');
  ok(del.status < 300 && del.json?.data?.idcard?.length === 2, `**فقط همان یکی رفت** (${del.json?.data?.idcard?.length})`);
  ok(!del.json.data.idcard.some((x) => x.id === midId), 'و دقیقاً همان شناسه رفته');
  ok(Number(sql(`SELECT count(*) FROM documents WHERE id=${midId}`)) === 1,
    '**خودِ فایل در پرونده ماند (فقط ارجاعش از فرم برداشته شد)**');

  console.log('\n۴) سازگاریِ عقب‌رو با رکوردهای تک‌عکسیِ قدیمی');
  const subId = Number(sql(`SELECT id FROM intake_submissions WHERE token='${token}'`));
  const keep = del.json.data.idcard[0];
  sql(`UPDATE intake_submissions SET data = jsonb_set(data::jsonb, '{idcard}', '{"id": ${keep.id}, "name": "old.png"}'::jsonb) WHERE id=${subId}`);
  const legacy = await pub(`/public/intake/form/${token}`);
  ok(!Array.isArray(legacy.json?.data?.idcard) && legacy.json?.data?.idcard?.id === keep.id,
    'رکوردِ قدیمی شیءِ تکی است (شبیه‌سازیِ نصبِ موجود)');
  const u4 = await upl(`/public/intake/form/${token}/image/idcard`, `${tag}-4.png`);
  ok(Array.isArray(u4.json?.data?.idcard) && u4.json.data.idcard.length === 2,
    '**آپلودِ بعدی خودش به آرایه تبدیلش کرد و عکسِ قدیمی حفظ شد**');
  ok(u4.json.data.idcard[0].name === 'old.png', 'ترتیب حفظ شد: قدیمی اول');

  console.log('\n۵) فیشِ واریزی — چندتایی با سازگاریِ عقب‌رو');
  const fill = await pub(`/public/intake/form/${token}/fill`, 'POST', { values: {} });
  ok(fill.status < 300, `فرم پر شد و به مرحلهٔ فیش رفت (${fill.json?.status})`);
  const r1 = await upl(`/public/intake/form/${token}/receipt`, `${tag}-r1.png`);
  ok(r1.status < 300 && r1.json?.status === 'pending_approval', 'فیشِ اول رفت و فرم به صفِ تأیید رسید');
  ok(Array.isArray(r1.json?.data?.receiptDocumentIds) && r1.json.data.receiptDocumentIds.length === 1
    && r1.json.data.receiptDocumentId === r1.json.data.receiptDocumentIds[0],
    '**فیلدِ تکیِ قدیمی هم پر است (خواننده‌های موجود نمی‌شکنند)**');
  const r2 = await upl(`/public/intake/form/${token}/receipt`, `${tag}-r2.png`);
  ok(r2.json?.data?.receiptDocumentIds?.length === 2, `**فیشِ دوم اضافه شد** (${r2.json?.data?.receiptDocumentIds?.length})`);
  ok(r2.json.data.receiptDocumentId === r1.json.data.receiptDocumentIds[0], 'فیلدِ تکی همان فیشِ اول ماند');

  const rd = await pub(`/public/intake/form/${token}/receipt/${r2.json.data.receiptDocumentIds[1]}`, 'DELETE');
  ok(rd.json?.data?.receiptDocumentIds?.length === 1 && rd.json?.status === 'pending_approval',
    'برداشتنِ فیشِ دوم فرم را از صفِ تأیید بیرون نمی‌اندازد');
  const rd2 = await pub(`/public/intake/form/${token}/receipt/${rd.json.data.receiptDocumentIds[0]}`, 'DELETE');
  ok(rd2.json?.status === 'pending_payment' && !rd2.json?.data?.receiptDocumentId,
    '**با رفتنِ آخرین فیش، فرم به «در انتظارِ فیش» برمی‌گردد**');

  console.log('\n۶) نمای پرونده — به‌جای [object Object]');
  const pid = Number(sql(`SELECT patient_id FROM intake_submissions WHERE token='${token}'`));
  const rec = (await send(`/patients/${pid}/record`, 'GET')).json;
  const flat = JSON.stringify(rec ?? {});
  ok(!flat.includes('[object Object]'), '**هیچ «[object Object]» ای در پرونده نیست**');
} finally {
  sql(`DELETE FROM documents WHERE patient_id IN (SELECT id FROM patients WHERE phone='${PHONE}')`);
  sql(`DELETE FROM intake_submissions WHERE patient_id IN (SELECT id FROM patients WHERE phone='${PHONE}')`);
  for (const id of trash.links) await send(`/intake/links/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM patients WHERE phone='${PHONE}' AND id NOT IN (SELECT patient_id FROM visits)`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
