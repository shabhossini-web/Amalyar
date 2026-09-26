/**
 * فرمِ خدمتِ بیمار (نورومانیتورینگ) — برخوردِ ذخیرهٔ خودکار با آپلود، باکسِ پرداختِ تکراری،
 * و جست‌وجوی بیمارستان. Real HTTP + Nest + Prisma؛ فقط روی دیتابیسِ محلیِ جدا.
 *
 * زمینه (مالک، ۱۴۰۵/۰۷/۰۴، با اسکرین‌شات): روی گوشی آپلودِ کارتِ ملی و دستورِ پزشک هر بار
 * «ثبت‌نام تغییر کرده است؛ صفحه را تازه کنید» می‌گرفت. علت: دکمهٔ «انتخابِ عکس» فوکوس را
 * می‌گیرد و ذخیرهٔ خودکار ۱٫۵ ثانیه بعد زمان‌بندی می‌شود؛ اندروید تا پنجرهٔ انتخابِ عکس باز
 * است صفحه را متوقف می‌کند، پس ذخیره درست هم‌زمان با آپلود می‌رسد و قفلِ نسخه آپلود را رد
 * می‌کرد. پیش از اصلاح، ۸ جفت از ۹ جفتِ هم‌زمانِ «ذخیره + آپلود» همین ۴۰۹ را می‌گرفتند.
 *
 *  باید بیفتد:
 *   - جفت‌های هم‌زمانِ «ذخیرهٔ خودکار + آپلودِ عکس/فیش» همه پذیرفته، هیچ عکسی گم نمی‌شود
 *   - پیش‌نویسِ دیررس (نسخهٔ کوچک‌تر) روی پیش‌نویسِ تازه‌تر و روی ثبتِ نهایی نمی‌نشیند
 *   - باکسِ پرداختِ پیش‌فرضِ دست‌نخورده یک‌بار از فرمِ نصب‌شده برداشته می‌شود
 *   - «امام»، «الب»، «بیمارستان ام» پیشنهاد می‌گیرند؛ غلطِ تایپی هم با تطبیقِ فازی
 *  نباید بیفتد:
 *   - نوشتنِ بیمار بعد از تأیید (برخوردِ واقعی) — تکرار قفل را دور نمی‌زند
 *   - باکسِ پرداختِ دست‌خوردهٔ مدیر، یا فرمی که لینکِ بی‌مبلغ دارد، دست نمی‌خورد
 *   - کلاینتِ قدیمیِ بی‌نسخه همان رفتارِ قبلی را دارد (ذخیره کار می‌کند)
 *   - اعمالِ کدِ تخفیف هم‌زمان با ذخیره ۵۰۰ نمی‌دهد
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { captchaFor } from './lib/captcha.mjs';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const API = process.env.E2E_API, DB = process.env.E2E_DB;
if (![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'ic' + randomBytes(3).toString('hex');
let count = 0, fail = 0, auth, seed = Number.parseInt(randomBytes(3).toString('hex'), 16);
const ok = (v, label, detail = '') => {
  if (v) { count++; console.log('  ✔ ' + label); } else { fail++; console.log('  ✘ ' + label + (detail ? ' — ' + detail : '')); }
};
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
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000)]);
async function send(path) {
  const form = new FormData(); form.append('file', new Blob([JPEG], { type: 'image/jpeg' }), 'x.jpg');
  const r = await fetch(API + path, { method: 'POST', body: form });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const upload = (t, field) => send(`/public/intake/form/${t}/image/${field}`);
const setSetting = (key, value) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
async function register(linkToken) {
  const r = await pub(`/public/intake/link/${linkToken}/register`, {
    firstName: 'بیمارِ', lastName: 'هم‌زمان', nationalId: nid(++seed * 7919), phone: '0912' + String(1000000 + (seed % 8999999)), ...(await captchaFor(API, linkToken)),
  });
  assert.ok(r.status < 300 && r.data?.token, msg(r));
  return r.data.token;
}
const row = (t) => db.intakeSubmission.findUnique({ where: { token: t } });
const PAY_LABEL = 'پرداخت و فیش واریزی';

try {
  auth = (await api('/auth/login', { identifier: 'admin', password: 'test1234' })).data.accessToken;
  assert.ok(auth, 'ورود');
  await setSetting('vertical', 'ionm');
  await setSetting('services', JSON.stringify(['ionm']));
  await api('/forms');
  const ionm = await db.formDef.findUnique({ where: { key: 'intake.ionm' } });
  assert.ok(ionm, 'پیش‌شرط: فرمِ ثبت‌نامِ نورو نصب شد');

  console.log('۱) باکسِ پرداختِ تکراری — نصبِ تازه ندارد، نصبِ قدیمی یک‌بار از دستش می‌دهد');
  const liveBox = () => db.formField.findFirst({ where: { formId: ionm.id, type: 'payment', deletedAt: null } });
  ok(!(await liveBox()), '**نصبِ تازه باکسِ پرداخت ندارد** (مرحلهٔ «فیشِ واریزی» شماره‌ها را نشان می‌دهد)');
  /* نصبِ دیروز: همان باکسِ قالب، دست‌نخورده، و پرچمِ ارتقا هنوز نیست. */
  await db.formField.create({ data: { formId: ionm.id, key: 'pay', label: PAY_LABEL, type: 'payment', sort: 999 } });
  await db.setting.deleteMany({ where: { key: 'registration_ionm_no_payment_box' } });
  await api('/forms');
  const gone = await db.formField.findFirst({ where: { formId: ionm.id, key: 'pay' } });
  ok(gone?.deletedAt && gone.active === false, '**باکسِ پیش‌فرضِ نصبِ قدیمی برداشته شد** (همان مسیرِ حذفِ فرم‌ساز)', JSON.stringify(gone));
  /* مدیر بعد از ارتقا دوباره می‌سازدش: مالِ اوست و برنمی‌گردد. */
  await db.formField.create({ data: { formId: ionm.id, key: 'pay2', label: PAY_LABEL, type: 'payment', sort: 1000 } });
  await api('/forms');
  ok(!!(await liveBox()), '**یک‌باره است** — باکسی که مدیر بعداً ساخت دست نمی‌خورد');
  await db.formField.updateMany({ where: { formId: ionm.id, type: 'payment' }, data: { deletedAt: new Date(), active: false } });
  /* برچسبِ دست‌خورده مالِ مدیر است. */
  await db.formField.create({ data: { formId: ionm.id, key: 'pay3', label: 'واریز به حسابِ شرکت', type: 'payment', sort: 1001 } });
  await db.setting.deleteMany({ where: { key: 'registration_ionm_no_payment_box' } });
  await api('/forms');
  ok((await liveBox())?.label === 'واریز به حسابِ شرکت', '**باکسِ دست‌خورده (برچسبِ مدیر) دست نخورد**');
  await db.formField.updateMany({ where: { formId: ionm.id, type: 'payment' }, data: { deletedAt: new Date(), active: false } });
  /* لینکِ بی‌مبلغ: همین باکس مرحلهٔ فیش را می‌ساخت. */
  const free = await api('/intake/links', { title: 'رایگان ' + tag, formId: ionm.id, amount: 0 });
  assert.ok(free.status < 300, msg(free));
  await db.formField.create({ data: { formId: ionm.id, key: 'pay4', label: PAY_LABEL, type: 'payment', sort: 1002 } });
  await db.setting.deleteMany({ where: { key: 'registration_ionm_no_payment_box' } });
  await api('/forms');
  ok(!!(await liveBox()), '**فرمی که لینکِ بی‌مبلغ دارد باکسش را نگه می‌دارد** (وگرنه بیمار بی‌فیش به صفِ تأیید می‌رفت)');
  await db.formField.updateMany({ where: { formId: ionm.id, type: 'payment' }, data: { deletedAt: new Date(), active: false } });
  await db.intakeLink.delete({ where: { id: free.data.id } });

  const link = await api('/intake/links', { title: 'نورو ' + tag, formId: ionm.id, amount: 1000000 });
  assert.ok(link.status < 300, msg(link));

  console.log('\n۲) ذخیرهٔ خودکار + آپلودِ عکس هم‌زمان (بازگشت از پنجرهٔ انتخابِ عکس روی اندروید)');
  let t = await register(link.data.token);
  const pairs = [];
  /* هر آپلود با چند ذخیرهٔ هم‌زمان: پنجرهٔ «خواندن تا نوشتن» پس از اصلاح باریک است و یک
     ذخیره به‌ندرت درست وسطش می‌افتد — سنجه باید نبودِ **تکرار** را هم بگیرد، نه فقط کدِ قدیمی را. */
  for (let i = 0; i < 9; i++) {
    const rev = Date.now() * 10 + i * 4;
    const [u, ...ds] = await Promise.all([
      upload(t, 'prescription'),
      ...[0, 1, 2, 3].map((k) => pub(`/public/intake/form/${t}/draft`, { values: { surgeonName: 'دکتر ' + i }, rev: rev + k })),
    ]);
    pairs.push(`${u.status}/${ds.map((x) => x.status).join('+')}`);
  }
  ok(pairs.every((p) => p === '201/201+201+201+201'), '**هیچ آپلود و هیچ ذخیره‌ای ۴۰۹ نگرفت** (پیش از اصلاح ۸ جفت از ۹)', pairs.join(' '));
  let r = await row(t);
  ok(r.data.prescription?.length === 9, '**هر ۹ عکس در کادر ماند** — هیچ ارجاعی گم نشد', String(r.data.prescription?.length));
  ok(r.data.surgeonName === 'دکتر 8', 'و پاسخِ آخرین پیش‌نویس هم ذخیره شد', r.data.surgeonName);

  console.log('\n۳) نسخهٔ ذخیره — پیش‌نویسِ دیررس روی تازه‌تر نمی‌نشیند');
  t = await register(link.data.token);
  let d = await pub(`/public/intake/form/${t}/draft`, { values: { procedure: 'فیوژن' }, rev: 2000 });
  ok(d.status === 201, 'پیش‌نویسِ تازه (نسخهٔ ۲۰۰۰) ذخیره شد', `${d.status} ${msg(d)}`);
  d = await pub(`/public/intake/form/${t}/draft`, { values: { procedure: 'قدیمی' }, rev: 1000 });
  r = await row(t);
  ok(d.status === 201 && r.data.procedure === 'فیوژن', '**پیش‌نویسِ دیررس (۱۰۰۰) نوشته نشد** و خطا هم نداد', `${d.status} ${r.data.procedure}`);
  d = await pub(`/public/intake/form/${t}/draft`, { values: { procedure: 'بی‌نسخه' } });
  r = await row(t);
  ok(d.status === 201 && r.data.procedure === 'بی‌نسخه', 'کلاینتِ قدیمیِ بی‌نسخه همان رفتارِ قبلی: ذخیره می‌شود', `${d.status} ${r.data.procedure}`);
  ok((await upload(t, 'nationalIdImage')).status === 201 && (await upload(t, 'prescription')).status === 201, 'مدارک آپلود شد');
  const fill = await pub(`/public/intake/form/${t}/fill`, {
    values: { surgeonName: 'دکتر ثبت', hospitalName: 'بیمارستان آزمون', procedure: 'فیوژن کمری', opDateOpen: true }, rev: 5000,
  });
  ok(fill.status < 300 && fill.data?.status === 'pending_payment', 'ثبتِ نهایی (نسخهٔ ۵۰۰۰) پذیرفته شد', `${fill.status} ${msg(fill)}`);
  d = await pub(`/public/intake/form/${t}/draft`, { values: { surgeonName: 'دکتر دیررس' }, rev: 4000 });
  r = await row(t);
  ok(d.status === 201 && r.data.surgeonName === 'دکتر ثبت', '**پیش‌نویسی که پیش از ثبت ساخته شده و دیر رسید، ثبت را برنگرداند**', `${d.status} ${r.data.surgeonName}`);

  console.log('\n۴) فیشِ واریزی هم‌زمان با ذخیره — همه می‌مانند');
  const rpairs = [];
  for (let i = 0; i < 4; i++) {
    const [u, dd] = await Promise.all([
      send(`/public/intake/form/${t}/receipt`),
      pub(`/public/intake/form/${t}/draft`, { values: { procedure: 'فیوژن ' + i }, rev: 6000 + i }),
    ]);
    rpairs.push(`${u.status}/${dd.status}`);
  }
  r = await row(t);
  ok(rpairs.every((p) => p.startsWith('201/')) && r.data.receiptDocumentIds?.length === 4 && r.status === 'pending_approval',
    '**هر ۴ فیش پذیرفته و ثبت شد**؛ ثبت‌نام به صفِ تأیید رفت', `${rpairs.join(' ')} · ${r.data.receiptDocumentIds?.length} · ${r.status}`);
  /* پس از اولین فیش ثبت‌نام در صفِ تأیید است و پیش‌نویس درست رد می‌شود (۴۰۰) — ولی هرگز ۴۰۹ یا ۵۰۰. */
  ok(rpairs.every((p) => /\/(201|400)$/.test(p)), 'ذخیرهٔ هم‌زمان یا نشست یا (بعد از فیش) با ۴۰۰ رد شد — نه ۴۰۹ و نه ۵۰۰', rpairs.join(' '));

  console.log('\n۵) برخوردِ واقعی سرِ جایش است — بعد از تأیید، نوشتنِ بیمار رد می‌شود');
  const t2 = await register(link.data.token);
  await db.intakeSubmission.update({ where: { token: t2 }, data: { status: 'approved' } });
  const late = await upload(t2, 'prescription');
  const lateDraft = await pub(`/public/intake/form/${t2}/draft`, { values: { procedure: 'دیر' }, rev: 9000 });
  ok(late.status === 400 && /دیگر قابلِ ویرایش نیست/.test(msg(late)), '**آپلود بعد از تأیید ← ۴۰۰** (تکرار قفل را دور نزد)', `${late.status} ${msg(late)}`);
  ok(lateDraft.status === 400, 'پیش‌نویس بعد از تأیید ← ۴۰۰', `${lateDraft.status}`);
  const ghost = await row(t2);
  ok(!ghost.data.prescription?.length && ghost.data.procedure !== 'دیر', 'و هیچ‌چیز روی ثبت‌نامِ تأییدشده ننشست');

  console.log('\n۶) کدِ تخفیف هم‌زمان با ذخیره — ۵۰۰ نمی‌دهد');
  await db.discountCode.create({ data: { code: 'OFF' + tag.toUpperCase(), kind: 'percent', value: 10, active: true } });
  const t3 = await register(link.data.token);
  const [disc, dr] = await Promise.all([
    pub(`/public/intake/form/${t3}/discount`, { code: 'OFF' + tag.toUpperCase() }),
    pub(`/public/intake/form/${t3}/draft`, { values: { procedure: 'هم‌زمان' }, rev: 100 }),
  ]);
  const t3row = await row(t3);
  ok(disc.status < 300 && dr.status === 201 && t3row.discountAmount === 100000, '**تخفیف و ذخیره هر دو نشستند**', `${disc.status}/${dr.status} ${t3row.discountAmount}`);

  console.log('\n۷) جست‌وجوی بیمارستان — بخشی از نام کافی است');
  for (const n of ['بیمارستان امام خمینی', 'بیمارستان امام حسین', 'بیمارستان البرز', 'بیمارستان آبان', 'مرکز قلب تهران']) {
    if (!(await db.hospital.findFirst({ where: { name: n } }))) await db.hospital.create({ data: { name: n } });
  }
  const find = async (q) => (await pub(`/public/intake/form/${t3}/hospitals?q=${encodeURIComponent(q)}`)).data?.map((h) => h.name) ?? [];
  let names = await find('امام');
  ok(names.includes('بیمارستان امام خمینی') && names.includes('بیمارستان امام حسین') && !names.includes('بیمارستان البرز'),
    '**«امام» هر دو امام را پیشنهاد می‌دهد** (پیش‌تر هیچ — «امام» از کلیدِ تطبیق حذف می‌شود)', names.join('، '));
  names = await find('الب');
  ok(names[0] === 'بیمارستان البرز', '«الب» ← البرز اول', names.join('، '));
  names = await find('بیمارستان ام');
  ok(names.length >= 2 && names.slice(0, 2).every((x) => x.startsWith('بیمارستان امام')), '«بیمارستان ام» ← نام‌هایی که با همین شروع می‌شوند، اول', names.join('، '));
  names = await find('آب');
  ok(names.includes('بیمارستان آبان'), '«آب» ← آبان (یکسان‌سازیِ آ/ا)', names.join('، '));
  names = await find('البرذ');
  ok(names.includes('بیمارستان البرز'), 'غلطِ تایپی («البرذ») با تطبیقِ فازی', names.join('، '));
  names = await find('قلب');
  ok(names.includes('مرکز قلب تهران'), 'واژهٔ وسطِ نام هم پیدا می‌شود', names.join('، '));
  ok((await find('')).length > 0, 'کادرِ خالی (کلاینتِ قدیمی) همان فهرستِ پیش‌فرض را می‌گیرد');
} finally {
  await db.$disconnect();
}
console.log(`\nسبز: ${count}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
