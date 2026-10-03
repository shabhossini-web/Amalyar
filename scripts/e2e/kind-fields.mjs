/**
 * فرمِ هر نوعِ مراجعه فقط فیلدهای **خودش** را نشان می‌دهد.
 *
 * ⚠️ باگی که این آزمون نگهبانش است: نوعی که سوپرادمین در فرم‌ساز می‌ساخت فقط
 * `opDate` در تعریفش داشت و کلاینت هر فیلدِ «غایب از تعریف» را روشن حساب
 * می‌کرد — پس فرمِ «ویزیت» با جراح، بیمارستان و ساعتِ عمل رندر می‌شد و چون
 * فیلدِ غایب در فرم‌ساز ردیفی ندارد، **هیچ راهی برای برداشتنشان نبود**.
 *
 * حالا: کاتالوگِ کامل روی هر فرمِ مراجعه (createForm + backfill) و
 * «غایب = خاموش» در کلاینت. این‌جا هر دو لایه سنجیده می‌شود — تعریفِ سرور و
 * فرمی که واقعاً در مرورگر رندر شد.
 */
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

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

/* کلید از pid تا بارِ دوم به فرمِ اجرای قبلی نخورد؛ فرمِ بی‌استفاده در پایان
   حذفِ سخت می‌شود، پس بارِ دوم هم تمیز شروع می‌کنیم. */
const tag = 'kf' + String(process.pid).slice(-5);
/* کاتالوگ از **خودِ سرور** (بیلدِ dist)، نه یک نسخهٔ دوم: نسخهٔ دستی یک‌بار
   با `techArriveTime` (که W3.8 از فرمِ مراجعه برداشت) و بی `topicId`/`nextVisitDate`
   بیات شد و سوییت — که در CI نبود — ماه‌ها قرمز ماند. */
import { createRequire } from 'node:module';
const { VISIT_BUILTIN_CATALOG } = createRequire(import.meta.url)('../../server/dist/patients/form-presets.js');
const CATALOG = VISIT_BUILTIN_CATALOG.map((f) => f.key);

/* گرم‌کردن: seedِ قالب‌ها تنبل است و با اولین **خواندن** اجرا می‌شود. اگر
   اولین تماسِ یک دیتابیسِ بکر POST باشد، جدول دیگر خالی نیست و قالب‌ها هرگز
   نمی‌آیند — در نصبِ واقعی صفحه‌ها اول می‌خوانند، این‌جا هم همان را می‌کنیم. */
await fetch(API + '/forms', { headers: A });

console.log('۱) نوعِ تازه: کاتالوگِ کامل، پیش‌فرضِ کمینه');
const made = await fetch(API + '/forms', {
  method: 'POST', headers: A,
  body: JSON.stringify({ key: tag, title: 'ویزیتِ آزمون', scope: 'visit' }),
}).then((r) => r.json());
if (!made.id) { console.error('فرم ساخته نشد:', JSON.stringify(made)); process.exit(1); }
const def = await fetch(API + `/forms/visit.${tag}`, { headers: A }).then((r) => r.json());
const rows = new Map(def.fields.filter((x) => x.builtin).map((x) => [x.key, x]));
ok(CATALOG.every((k) => rows.has(k)), `همهٔ ${CATALOG.length} فیلدِ کاتالوگ ردیف دارند (${rows.size})`);
const on = CATALOG.filter((k) => rows.get(k)?.active !== false);
ok(on.sort().join(',') === ['amount', 'notes', 'opDate'].sort().join(','),
  `فقط تاریخ/مبلغ/یادداشت روشن‌اند (${on.join('، ')})`);
ok(rows.get('opDate')?.required === true, 'تاریخ اجباری است');

console.log('\n۲) فرمِ عملِ موجود بعد از backfill دست‌نخورده کار می‌کند');
const surg = await fetch(API + '/forms/visit.surgery', { headers: A }).then((r) => r.json());
const srows = new Map((surg.fields ?? []).filter((x) => x.builtin).map((x) => [x.key, x]));
ok(CATALOG.every((k) => srows.has(k)), 'کاتالوگِ فرمِ عمل هم کامل شد');
ok(srows.get('surgeonId')?.active !== false, 'جراحِ فرمِ عمل روشن ماند');
/* حضورِ کارشناس در قالب نبود و همیشه-روشن رندر می‌شد؛ backfill باید با
   دیدنِ کارشناسِ فعال روشنش کرده باشد، وگرنه یک regression روی نصبِ زنده است. */
ok(srows.get('techArriveTime')?.active !== false, 'حضورِ کارشناس (backfill با کارشناسِ فعال) روشن ماند');
ok(srows.get('opReport')?.active !== false, 'شرحِ عمل (backfill با ساعتِ فعال) روشن ماند');

console.log('\n۳) مرورگر: فرمِ نوعِ تازه فیلدِ جراحی ندارد');
const b = await chromium.launch({
  executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const p = await (await b.newContext({ viewport: { width: 480, height: 1000 }, locale: 'fa-IR' })).newPage();
/* ⚠️ زیرِ بارِ CI (دو شارد + جابِ build هم‌زمان) یک کلیک با مهلتِ پیش‌فرضِ ۳۰ ثانیه یک‌بار افتاد
   (رانِ ۶۴۳ روی main؛ همان کد در رانِ بعدی سبز). مهلتِ سخاوتمندتر، و پایین‌تر هر گام منتظرِ
   **خودِ نتیجه** (شیت، ردیفِ نوع، فیلدها) می‌ماند نه ساعت — قاعدهٔ CI محلی در CLAUDE.md. */
p.setDefaultTimeout(60_000);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
try {
  await p.goto(UI + '/', { waitUntil: 'domcontentloaded' });
  await browserLogin(p, login.accessToken);
  await p.goto(UI + '/app/dashboard', { waitUntil: 'networkidle' });
  await p.locator('.db-add').waitFor();
  await p.waitForTimeout(1800);

  /** تا گامِ ۳ با نوعِ داده‌شده؛ متنِ برچسب‌های دیده‌شده را برمی‌گرداند. */
  /* ⚠️ دکمهٔ نوع با کلیدش (`data-kind`)، نه متن: برچسب از واژهٔ حوزه است نه عنوانِ فرم (clinic-daily-04). */
  const stepThreeLabels = async (kindKey) => {
    await p.locator('.db-add').click();
    /* گامِ ۱ از بازبینیِ UX (clinic-daily-22) یک جست‌وجوی واحد است؛ پروندهٔ تازه با «ساختِ پروندهٔ تازه». */
    const newRecord = p.locator('.db-sheet [data-act="new-record"]');
    await newRecord.waitFor();
    await p.waitForTimeout(300);
    await newRecord.click();
    await p.locator('input[required]').first().fill('آزمونِ');
    await p.locator('input[required]').nth(1).fill('فرمِ نوع');
    await p.locator('.db-stepnav .db-submit').click();
    /* ردیفِ نوع تا فهرستِ فرم‌ها نیامده اسکلتِ `db-kindrow-loading` است؛ دکمهٔ خودِ نوع ملاک است. */
    const kindBtn = p.locator(`.db-kindrow button[data-kind="${kindKey}"]`);
    await kindBtn.waitFor();
    await p.waitForTimeout(300);
    await kindBtn.click();
    await p.locator('.db-stepnav .db-submit').click();
    const fields = p.locator('.db-sheet .db-field > span, .db-sheet .df-label, .db-sheet label span');
    /* برچسبِ گام‌های قبلی پنهان در DOM می‌ماند؛ ملاک اولین برچسبِ **دیدنی**ِ گامِ ۳ است، نه اولینِ DOM. */
    await fields.filter({ visible: true }).first().waitFor();
    await p.waitForTimeout(900);
    const collect = () => fields.allInnerTexts();
    let labels = await collect();
    /* فرمِ عمل زبانه‌های «مشخصات | قبل | حین | بعد» را زیرِ سربرگ دارد (بستهٔ ۴؛ بازبینیِ UX،
       surgery-10) و فقط زبانهٔ فعالِ مرحله رندر می‌شود (ثبتِ تازه روی «مشخصات» باز می‌شود)؛
       برچسب‌های همهٔ زبانه‌ها جمع می‌شوند تا «شرحِ عمل» (زبانهٔ حین) هم دیده شود. فرمِ ویزیت
       زبانه ندارد و همان یک‌بار کافی است. */
    const phaseTabs = p.locator('.db-sheet .db-phasetabs button');
    for (let i = 0, n = await phaseTabs.count(); i < n; i++) {
      await phaseTabs.nth(i).click();
      await p.waitForTimeout(200);
      labels = labels.concat(await collect());
    }
    const text = labels.join(' | ');
    await p.locator('.db-x').click();
    /* نام‌های گامِ ۱ تایپ شده‌اند و بستنِ فرمِ دست‌خورده اول می‌پرسد (بازبینیِ UX، clinic-daily-08). */
    await p.locator('[data-unsaved="discard"]').click({ timeout: 15_000 });
    /* شیت با انیمیشن بسته می‌شود؛ تا نرفته، `.db-add`ِ بعدی زیرِ پرده است. */
    await p.locator('.db-sheet').first().waitFor({ state: 'hidden' });
    await p.waitForTimeout(400);
    return text;
  };

  const vLabels = await stepThreeLabels(tag);
  ok(!/جراح|بیمارستان|ساعتِ شروع|ساعتِ پایان|حضورِ/.test(vLabels), 'ویزیتِ آزمون: بدونِ جراح/بیمارستان/ساعت‌ها');
  ok(/تاریخ/.test(vLabels) && /مبلغ/.test(vLabels) && /یادداشت/.test(vLabels), `ویزیتِ آزمون: تاریخ + مبلغ + یادداشت (${vLabels.slice(0, 80)}…)`);
  ok(!/شرحِ عمل/.test(vLabels), 'ویزیتِ آزمون: بدونِ «شرحِ عمل»');

  const sLabels = await stepThreeLabels('surgery');
  ok(/جراح/.test(sLabels) && /بیمارستان/.test(sLabels), 'فرمِ عمل: جراح و بیمارستان سرِ جایشان');
  ok(/شرحِ عمل/.test(sLabels), 'فرمِ عمل: شرحِ عمل سرِ جایش');

  console.log('\n۴) روشن‌کردنِ یک فیلد در فرم‌ساز بلافاصله در فرم می‌نشیند');
  const hosp = def.fields.find((x) => x.key === 'hospitalId');
  await fetch(API + `/forms/fields/${hosp.id}`, { method: 'PATCH', headers: A, body: JSON.stringify({ active: true, label: 'مرکزِ ویزیت' }) });
  await p.reload({ waitUntil: 'networkidle' });
  await p.locator('.db-add').waitFor();
  await p.waitForTimeout(1500);
  const v2 = await stepThreeLabels(tag);
  ok(/مرکزِ ویزیت/.test(v2), 'بیمارستان با برچسبِ سفارشی ظاهر شد');
} finally {
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
  await b.close();
  await fetch(API + `/forms/${made.id}`, { method: 'DELETE', headers: A });
}
process.exit(fail || errs.length ? 1 : 0);
