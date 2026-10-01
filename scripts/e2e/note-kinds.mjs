/**
 * «سیرِ بیماری» باید در پرونده **دیده** شود، نه اینکه لای یک `<select>` بماند.
 *
 * ⚠️ شکایتِ کاربر این بود که «سیرِ بیماری از پرونده حذف شده». حذف نشده بود —
 * یکی از پنج نوعِ `ClinicalNote` بود که تنها جای دیده‌شدنش داخلِ یک dropdownِ
 * بسته بود. چیزی که برای دیدنش باید کلیک کنی، برای کاربر وجود ندارد.
 *
 * پس ادعا روی **حالتِ دیده‌شده** است: نامِ هر پنج نوع باید بدونِ هیچ کلیکی
 * روی صفحه باشد، نوعِ بی‌شرح هم چیپِ «۰» بگیرد، و کلیک روی چیپ هم فهرست را
 * فیلتر کند و هم نوعِ شرحِ تازه را تعیین کند.
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

const KINDS = { visit: 'شرحِ ویزیت', op: 'شرحِ عمل', progress: 'سیرِ بیماری', discharge: 'وضعیتِ هنگامِ ترخیص', consult: 'مشاوره' };

/* فیکسچرِ اختصاصی — «اولین بیمارِ فهرست» می‌تواند ساختهٔ اجرای قبلی باشد و
   آن‌وقت بارِ دوم چیزِ دیگری سنجیده می‌شود. */
const [kinds, sur, hos] = await Promise.all([
  fetch(API + '/forms/visit-kinds', { headers: A }).then((r) => r.json()),
  fetch(API + '/surgeons', { headers: A }).then((r) => r.json()),
  fetch(API + '/hospitals', { headers: A }).then((r) => r.json()),
]);
const made = await fetch(API + '/visits', {
  method: 'POST', headers: A,
  body: JSON.stringify({
    kind: kinds[0]?.kind, firstName: 'سیرِ', lastName: 'بیماری',
    surgeonId: (sur.rows ?? sur)[0]?.id, hospitalId: (hos.rows ?? hos)[0]?.id,
    opDate: new Date().toISOString(),
  }),
}).then((r) => r.json());
if (!made.id) { console.error('فیکسچر ساخته نشد:', JSON.stringify(made)); process.exit(1); }
const pid = made.patientId;

console.log('۱) سرور شمارشِ هر پنج نوع را می‌دهد — حتی صفرها');
let rec = await fetch(API + `/patients/${pid}/record`, { headers: A }).then((r) => r.json());
const byKind = rec.counts?.notesByKind ?? {};
ok(Object.keys(KINDS).every((k) => typeof byKind[k] === 'number'),
  `هر پنج کلید عدد دارند (${JSON.stringify(byKind)})`);
ok(Object.values(byKind).every((n) => n === 0), 'پروندهٔ تازه همه صفر است — کلیدِ صفر حذف نشده');

console.log('\n۲) یک «سیرِ بیماری» ثبت می‌شود و فقط همان شمارنده بالا می‌رود');
await fetch(API + `/patients/${pid}/notes`, {
  method: 'POST', headers: A,
  body: JSON.stringify({ kind: 'progress', body: 'درد کاهش یافته؛ راه‌رفتن بدونِ کمک.' }),
});
rec = await fetch(API + `/patients/${pid}/record`, { headers: A }).then((r) => r.json());
ok(rec.counts.notesByKind.progress === 1, `سیرِ بیماری = ۱ (${rec.counts.notesByKind.progress})`);
ok(rec.counts.notesByKind.visit === 0 && rec.counts.notesByKind.op === 0, 'بقیه دست‌نخورده صفر ماندند');

console.log('\n۳) مرورگر: نامِ هر پنج نوع بدونِ هیچ کلیکی روی صفحه است');
const b = await chromium.launch({
  executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const p = await (await b.newContext({ viewport: { width: 480, height: 1000 }, locale: 'fa-IR' })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
try {
  await p.goto(UI + '/', { waitUntil: 'domcontentloaded' });
  await browserLogin(p, login.accessToken);
  await p.goto(UI + `/app/patients/${pid}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.locator('.ui-tabs button', { hasText: 'شرح‌ها' }).click();
  await p.waitForTimeout(900);

  const chipText = (await p.locator('.rc-kindrow button').allInnerTexts()).join(' | ');
  for (const [, label] of Object.entries(KINDS)) {
    ok(chipText.includes(label), `«${label}» روی صفحه دیده می‌شود`);
  }
  ok(await p.locator('select').filter({ hasText: 'سیرِ بیماری' }).count() === 0,
    'و دیگر داخلِ هیچ dropdownی پنهان نیست');

  console.log('\n۴) چیپ هم فیلتر می‌کند هم نوعِ شرحِ تازه را می‌گذارد');
  await p.locator('.rc-kindrow button', { hasText: 'سیرِ بیماری' }).click();
  await p.waitForTimeout(600);
  ok(await p.locator('.rc-note-body').count() === 1, 'فهرست فقط سیرِ بیماری را نشان می‌دهد');
  const btn = await p.locator('.rc-save').innerText();
  ok(/سیرِ بیماری/.test(btn), `دکمهٔ ثبت نوعِ فعال را می‌گوید («${btn.trim()}»)`);

  await p.locator('.rc-kindrow button', { hasText: 'مشاوره' }).click();
  await p.waitForTimeout(600);
  ok(await p.locator('.rc-note-body').count() === 0, 'روی «مشاوره» فهرست خالی است');
  ok(/هنوز «مشاوره»ی ثبت نشده/.test(await p.locator('.df-empty').innerText()),
    'و پیامِ خالی نوعِ فعال را نام می‌برد');

  /* نوشتن روی چیپِ فعال باید همان نوع را بسازد — همان ناهماهنگی‌ای که یک
     کنترلِ جدا می‌ساخت: «سیرِ بیماری» را فیلتر کنی و «ویزیت» ثبت شود. */
  await p.locator('.rc-upload textarea').fill('مشاورهٔ ارتوپدی درخواست شد.');
  await p.locator('.rc-save').click();
  await p.waitForTimeout(1500);
  const after = await fetch(API + `/patients/${pid}/record`, { headers: A }).then((r) => r.json());
  ok(after.counts.notesByKind.consult === 1, `شرحِ تازه «مشاوره» ثبت شد (${after.counts.notesByKind.consult})`);
  ok(after.counts.notesByKind.progress === 1, 'و سیرِ بیماری دست‌نخورده ماند');

  console.log('\n۵) شکستِ ثبت باید دیده شود — نه یک چشمکِ هم‌شکلِ موفقیت');
  /* ⚠️ این بند از یک گزارشِ واقعی آمد: «شرح‌ها سیو نمی‌شوند». مسیرِ ذخیره
     سالم بود، ولی اگر درخواست شکست می‌خورد کاربر همان قابِ بنفشِ ۲ثانیه‌ایِ
     موفقیت را می‌دید و بعد هیچ — نه رنگی که بگوید خطاست، نه متنی که بشود
     گزارشش کرد. شکستی که پیام نداشته باشد، از «کار نکردن» قابلِ تشخیص
     نیست. پس پاسخِ سرور به ۴۰۳ی که خودش می‌دهد قلاب می‌شود. */
  await p.route('**/api/patients/*/notes', (route) => (route.request().method() === 'POST'
    ? route.fulfill({
      status: 403, contentType: 'application/json',
      body: JSON.stringify({ message: 'اجازهٔ ثبتِ شرحِ بالینی را ندارید' }),
    })
    : route.continue()));
  await p.locator('.rc-upload textarea').fill('این نباید بی‌صدا گم شود.');
  await p.locator('.rc-save').click();
  await p.waitForTimeout(1200);

  const t = p.locator('.df-toast');
  ok((await t.getAttribute('class') ?? '').includes('bad'), 'قابِ خطا از موفقیت جدا است (کلاسِ bad)');
  ok(/اجازهٔ ثبتِ شرحِ بالینی/.test(await t.innerText()), 'متنِ خودِ سرور را نشان می‌دهد');
  await p.waitForTimeout(5000);
  ok(await t.count() === 1, 'بعد از ۵ ثانیه هنوز روی صفحه است — خودش نمی‌رود');
  ok(!!(await p.locator('.rc-upload textarea').inputValue()), 'و نوشتهٔ کاربر پاک نشده');
  await t.click();
  await p.waitForTimeout(500);
  ok(await p.locator('.df-toast').count() === 0, 'با کلیک بسته می‌شود');

  console.log('\n۶) «شرح ثبت شد» فقط وقتی گفته می‌شود که شرح واقعاً در پرونده باشد');
  /* ⚠️ گزارشِ دومِ کاربر: «سیو شد هم می‌ده ولی تو لیست نشون نمی‌ده». یعنی
     پیامِ موفقیت روی یک شکست نشسته بود، چون «ثبت شد» فقط یعنی «POST دو‌ایکس
     داد». این‌جا سرور ۲۰۰ می‌دهد با شناسه‌ای که هرگز نوشته نشده؛ پروندهٔ
     بازخوانی‌شده **واقعی** است و آن شناسه را ندارد. ادعا: کاربر باید پیامِ
     شکست ببیند، نه تیکِ سبز. */
  const GHOST_ID = 999999;
  await p.route('**/api/patients/*/notes', (route) => (route.request().method() === 'POST'
    ? route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({ id: GHOST_ID, kind: 'consult', body: 'شرحی که هرگز نوشته نشد' }),
    })
    : route.continue()));
  await p.locator('.rc-upload textarea').fill('این باید شکست را نشان بدهد.');
  await p.locator('.rc-save').click();
  await p.waitForTimeout(1800);

  const t6 = p.locator('.df-toast');
  ok((await t6.getAttribute('class') ?? '').includes('bad'), 'پیام قرمز است، نه تیکِ موفقیت');
  const txt6 = await t6.innerText();
  ok(/برنگرداند/.test(txt6), `می‌گوید پرونده آن را برنگرداند («${txt6.trim().slice(0, 60)}…»)`);
  ok(/۹۹۹۹۹۹/.test(txt6), 'شناسهٔ برگشتیِ سرور را نام می‌برد تا گزارش دقیق باشد');
  /* پیامِ موفقیت دیگر «✓» ندارد (قانونِ ۷؛ بازبینیِ خصمانه R15) — سنجه روی خودِ جمله است. */
  ok(!/شرح ثبت شد/.test(txt6), '**و هرگز «شرح ثبت شد» نمی‌گوید**');
  ok(await p.locator('.rc-upload textarea').inputValue() === 'این باید شکست را نشان بدهد.',
    'نوشتهٔ پزشک دست‌نخورده می‌ماند — کارِ ازدست‌رفته بدترین بخشِ این باگ بود');

  console.log('\n۷) و مسیرِ سالم همچنان تیکِ موفقیت می‌گیرد');
  await p.unroute('**/api/patients/*/notes');
  await p.locator('.rc-upload textarea').fill('این یکی واقعاً ثبت می‌شود.');
  await p.locator('.rc-save').click();
  await p.waitForTimeout(1800);
  const t7 = await p.locator('.df-toast').innerText().catch(() => '');
  ok(/شرح ثبت شد/.test(t7), `ثبتِ واقعی پیامِ موفقیت می‌گیرد («${t7.trim()}»)`);
  ok(await p.locator('.rc-upload textarea').inputValue() === '', 'و کادر بعد از موفقیت خالی می‌شود');
} finally {
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
  await b.close();
  await fetch(API + `/visits/${made.id}`, { method: 'DELETE', headers: A });
}
process.exit(fail || errs.length ? 1 : 0);
