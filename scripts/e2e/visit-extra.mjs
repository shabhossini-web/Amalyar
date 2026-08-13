/**
 * ویرایشِ مراجعه باید **فیلدهای فرمِ سفارشی** را هم ذخیره کند.
 *
 * ⚠️ باگی که این آزمون نگهبانش است، و چرا فقط بعضی نصب‌ها می‌دیدندش:
 * `createVisit` مقدارِ `extra` را می‌نوشت ولی `updateVisit` اصلاً به آن دست
 * نمی‌زد. پس هر ویرایشِ فیلدِ سفارشی بی‌صدا دور ریخته می‌شد — با پیامِ
 * «ویزیت ویرایش شد ✓» روی صفحه.
 *
 * نصبِ نورومانیتورینگ چیزی نمی‌دید: فرمش تقریباً همه‌اش فیلدِ هسته‌ای است
 * (جراح، بیمارستان، تاریخ، مبلغ) که ستون‌اند و درست ذخیره می‌شدند. نصبِ مطب
 * کلِ فرمش سفارشی است — «شکایتِ اصلی»، «شرحِ معاینه»، «تصمیم» — پس آن‌جا
 * **هیچ‌چیز** ذخیره نمی‌شد. یک باگ، دو ظاهر.
 *
 * پس ادعا روی خواندنِ **بعد از** نوشتن است، نه روی پاسخِ خودِ PATCH.
 */
import { chromium } from 'playwright-core';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — سرور را ری‌استارت کنید'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());
const send = (p, method, body) => fetch(API + p, { method, headers: A, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

/* کلیدِ تصادفی — `FormDef.key` سراسری یکتاست و فرمِ حذف‌شده فقط soft-delete
   می‌شود، پس pid بارِ دوم می‌تواند برخورد کند. */
const tag = 'vx' + Math.random().toString(36).slice(2, 7);

await get('/forms'); // گرم‌کردنِ seedِ تنبل

console.log('۱) نوعِ مراجعه با دو فیلدِ سفارشی — مثلِ فرمِ مطب');
const form = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ مطب (آزمون)', scope: 'visit' })).json;
if (!form?.id) { console.error('فرم ساخته نشد:', JSON.stringify(form)); process.exit(1); }
await send(`/forms/${form.id}/fields`, 'POST', { key: 'chiefComplaint', label: 'شکایتِ اصلی', type: 'textarea' });
await send(`/forms/${form.id}/fields`, 'POST', { key: 'examNote', label: 'شرحِ معاینه', type: 'textarea' });
const def = await get(`/forms/visit.${tag}`);
const custom = (def.fields ?? []).filter((f) => !f.builtin).map((f) => f.key);
ok(custom.includes('chiefComplaint') && custom.includes('examNote'), `دو فیلدِ سفارشی ساخته شد (${custom.join('، ')})`);

console.log('\n۲) ثبتِ مراجعه با مقدارِ سفارشی');
const created = (await send('/visits', 'POST', {
  kind: tag, firstName: 'فرمِ', lastName: 'سفارشی',
  opDate: new Date().toISOString(),
  extra: { chiefComplaint: 'کمردردِ اولیه', examNote: 'معاینهٔ اولیه' },
})).json;
if (!created?.id) { console.error('مراجعه ساخته نشد:', JSON.stringify(created)); process.exit(1); }
let fresh = await get(`/visits/${created.id}`);
ok(fresh.extra?.chiefComplaint === 'کمردردِ اولیه', `مقدارِ اولیه ذخیره شد («${fresh.extra?.chiefComplaint}»)`);

console.log('\n۳) ویرایش — همان جایی که بی‌صدا دور ریخته می‌شد');
const patched = await send(`/visits/${created.id}`, 'PATCH', {
  extra: { chiefComplaint: 'کمردردِ تشدیدشده', examNote: 'لاسگِ راست مثبت' },
});
ok(patched.status === 200, `PATCH پذیرفته شد (${patched.status})`);
/* ⚠️ ادعا روی **خواندنِ دوباره** است، نه پاسخِ PATCH: باگِ اصلی این بود که
   پاسخ درست به‌نظر می‌رسید ولی چیزی نوشته نشده بود. */
fresh = await get(`/visits/${created.id}`);
ok(fresh.extra?.chiefComplaint === 'کمردردِ تشدیدشده',
  `**شکایتِ اصلی بعد از ویرایش واقعاً عوض شد** («${fresh.extra?.chiefComplaint}»)`);
ok(fresh.extra?.examNote === 'لاسگِ راست مثبت',
  `شرحِ معاینه هم ذخیره شد («${fresh.extra?.examNote}»)`);

console.log('\n۴) ویرایشِ جزئی پاسخ‌های دیگر را پاک نمی‌کند');
await send(`/visits/${created.id}`, 'PATCH', { extra: { examNote: 'بهبودِ نسبی' } });
fresh = await get(`/visits/${created.id}`);
ok(fresh.extra?.examNote === 'بهبودِ نسبی', 'فیلدِ ویرایش‌شده تازه است');
ok(fresh.extra?.chiefComplaint === 'کمردردِ تشدیدشده',
  'و فیلدی که در PATCH نبود دست‌نخورده ماند — ادغام، نه جایگزینی');

console.log('\n۵) خالی‌کردنِ یک فیلد ممکن است (پاک‌کردن ≠ نادیده‌گرفتن)');
await send(`/visits/${created.id}`, 'PATCH', { extra: { examNote: '' } });
fresh = await get(`/visits/${created.id}`);
ok(fresh.extra?.examNote === '', 'مقدارِ خالی هم نوشته می‌شود');

console.log('\n۶) ویرایشِ فیلدهای هسته‌ای هنوز کار می‌کند و extra را نمی‌پراند');
await send(`/visits/${created.id}`, 'PATCH', { notes: 'یادداشتِ داخلی' });
fresh = await get(`/visits/${created.id}`);
ok(fresh.notes === 'یادداشتِ داخلی', 'یادداشتِ هسته‌ای ذخیره شد');
ok(fresh.extra?.chiefComplaint === 'کمردردِ تشدیدشده',
  'و PATCHِ بدونِ extra پاسخ‌های سفارشی را پاک نکرد');

console.log('\n۷) پاسخ‌های فرم در **پروندهٔ بیمار** دیده می‌شوند');
/* ⚠️ گزارشِ بعدیِ کاربر: «الان ادیت می‌مونه ولی شرح تو پرونده نمی‌ره».
   ذخیره‌شدن کافی نیست: «شرحِ معاینه»‌ای که فقط داخلِ فرمِ خودِ مراجعه بماند و
   در پرونده خوانده نشود، عملاً نوشته نشده. پرونده باید پاسخ‌ها را با
   **برچسبِ خودشان** نشان بدهد. */
await send(`/visits/${created.id}`, 'PATCH', { extra: { examNote: 'لاسگِ راست مثبت', chiefComplaint: 'کمردردِ تشدیدشده' } });
const rec = await get(`/patients/${created.patientId}/record`);
const visit = (rec.visits ?? []).find((x) => x.id === created.id);
ok(!!visit, 'مراجعه در پرونده هست');
const ans = visit?.answers ?? [];
ok(ans.length >= 2, `پاسخ‌ها در پرونده آمده‌اند (${ans.length})`);
const exam = ans.find((a) => a.key === 'examNote');
ok(exam?.value === 'لاسگِ راست مثبت', `**شرحِ معاینه در پرونده دیده می‌شود** («${exam?.value}»)`);
ok(exam?.label === 'شرحِ معاینه', `و برچسبِ خودش را دارد، نه کلیدِ خام («${exam?.label}»)`);
ok(ans[0].key === 'chiefComplaint', `ترتیب همان ترتیبِ فرم است (${ans.map((a) => a.key).join('، ')})`);

console.log('\n۸) فیلدِ بی‌پاسخ ردیفِ خالی نمی‌سازد');
await send(`/visits/${created.id}`, 'PATCH', { extra: { examNote: '' } });
const rec2 = await get(`/patients/${created.patientId}/record`);
const ans2 = (rec2.visits ?? []).find((x) => x.id === created.id)?.answers ?? [];
ok(!ans2.some((a) => a.key === 'examNote'), 'فیلدِ خالی از پرونده حذف شد');
ok(ans2.some((a) => a.key === 'chiefComplaint'), 'و بقیه سرِ جایشان‌اند');

console.log('\n۹) و روی صفحهٔ پرونده واقعاً کشیده می‌شوند');
/* ⚠️ «API برمی‌گرداند» با «پزشک می‌بیند» یکی نیست — همین تفاوت باعث شد
   باگِ هدفِ کلیکِ کارت از زیرِ یک آزمونِ سبز رد شود. پس ادعا روی متنِ روی
   صفحه است. */
await send(`/visits/${created.id}`, 'PATCH', { extra: { examNote: 'لاسگِ راست مثبت' } });
const b = await chromium.launch({
  executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const p = await (await b.newContext({ viewport: { width: 420, height: 900 }, locale: 'fa-IR' })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
try {
  await p.goto(UI + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => localStorage.setItem('amalyar_token', t), login.accessToken);
  await p.goto(UI + `/app/patients/${created.patientId}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.locator('.ui-tabs button', { hasText: 'مراجعات' }).click();
  await p.waitForTimeout(800);
  const txt = await p.locator('.df-list').innerText();
  ok(/شرحِ معاینه/.test(txt), 'برچسبِ «شرحِ معاینه» روی صفحهٔ پرونده هست');
  ok(/لاسگِ راست مثبت/.test(txt), '**و متنی که پزشک نوشته، دیده می‌شود**');
  ok(await p.locator('.rc-answers dt').count() >= 2, 'هر پاسخ ردیفِ خودش را دارد');
} finally {
  await b.close();
}

console.log('\n' + '─'.repeat(50));
console.log(`قبول: ${pass}   رد: ${fail}`);
console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
await fetch(API + `/visits/${created.id}`, { method: 'DELETE', headers: A });
await fetch(API + `/forms/${form.id}`, { method: 'DELETE', headers: A });
process.exit(fail || errs.length ? 1 : 0);
