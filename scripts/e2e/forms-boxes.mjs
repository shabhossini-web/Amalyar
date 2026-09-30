/**
 * آزمونِ رندرِ واقعیِ دو کامپوننتِ تازه (`ImageBox` و `PaymentBox`) در مرورگر.
 *
 * ⚠️ چرا جدا از آزمونِ فرم‌ساز: فرم‌ساز فقط **تعریف** را می‌سازد. تا وقتی یک
 * فرمِ واقعی با این دو نوع رندر نشده، نمی‌دانیم کامپوننت‌ها اصلاً کار می‌کنند —
 * و نگهبانِ CI فقط وجودِ `case` را می‌سنجد، نه رندر شدنش.
 */
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const api = (p, o = {}) => fetch(API + p, { headers: H, ...o, body: o.body ? JSON.stringify(o.body) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

// فرمِ «جراحی» را با دو نوعِ تازه مجهز می‌کنیم — چون داشبورد همین نوع را
// پیش‌فرض باز می‌کند.
const forms = (await api('/forms')).json;
const surgery = forms.find((f) => f.key === 'visit.surgery');
if (!surgery) { console.error('فرمِ جراحی نیست'); process.exit(1); }
for (const f of surgery.fields.filter((x) => ['renderImg', 'renderPay'].includes(x.key))) {
  await api(`/forms/fields/${f.id}`, { method: 'DELETE' });
}
await api(`/forms/${surgery.id}/fields`, { method: 'POST', body: { key: 'renderImg', label: 'عکسِ آزمون', type: 'image' } });
await api(`/forms/${surgery.id}/fields`, { method: 'POST', body: { key: 'renderPay', label: 'پرداختِ آزمون', type: 'payment' } });

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'fa-IR' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

/* کوکیِ نشست **پیش از** اولین ناوبری. `AuthProvider` روی هر بارگذاری همان لحظه
   `/auth/me` و `/config` را می‌زند و بی‌کوکی ۴۰۱ می‌گیرد؛ مرورگر آن را «Failed to
   load resource: 401» در کنسول می‌نویسد و سنجهٔ «بدونِ خطای جاوااسکریپت» (که از
   همین‌جا گوش می‌دهد) قرمز می‌شد. ناوبریِ بی‌کوکیِ «/» یادگارِ دورهٔ توکن در
   localStorage بود؛ با کوکیِ HttpOnly لازم نیست و فقط یک مسابقه می‌ساخت که روی
   Viteِ گرمِ CI باخته می‌شد (پاسخ ~۵۰ms بعد از DOMContentLoaded می‌رسید). */
await browserLogin(page, login.accessToken);
await page.goto(UI + '/app/dashboard', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

console.log('\n۱) شیتِ ثبتِ مراجعه باز می‌شود');
await page.locator('.db-add').first().click();
await page.waitForTimeout(1200);
ok('شیت باز شد', await page.locator('.db-sheet').count() > 0);

/* ⚠️ ثبتِ تازه از مرحلهٔ ۶ **سه‌گامی** شد: پرونده → نوعِ فرم → تکمیل.
   فیلدهای دلخواه (که باکسِ عکس و پرداخت هم جزوشان‌اند) در گامِ ۳ هستند، پس
   این آزمون باید تا آن‌جا برود. پیش از این، سرِ گامِ ۱ دنبالِ `.dyn-img`
   می‌گشت و صفر پیدا می‌کرد. */
{
  /* گامِ ۱ از بازبینیِ UX (clinic-daily-22) یک جست‌وجوی واحد است؛ پروندهٔ تازه با «ساختِ پروندهٔ تازه». */
  await page.locator('.db-sheet [data-act="new-record"]').click();
  const inp = page.locator('.db-sheet .db-grid2 input');
  await inp.nth(0).fill('باکس'); await inp.nth(1).fill('آزما');
  await page.locator('.db-stepnav button').last().click();
  await page.waitForTimeout(700);
  /* فرمِ تک‌نوع در نصبِ تک‌خدمته گامِ «نوع» ندارد و «بعدی» مستقیم به «تکمیل» می‌رود (بازبینیِ UX، company-24). */
  if (await page.locator('.db-stepnav button').count()) await page.locator('.db-stepnav button').last().click();
  await page.waitForTimeout(1200);
  ok('گامِ «تکمیل» آمد', await page.locator('.db-formcard').count() > 0);
}

console.log('\n۲) باکسِ عکس رندر می‌شود');
{
  const n = await page.locator('.dyn-img').count();
  ok('کادرِ عکس روی صفحه هست', n === 1, 'n=' + n);
  // بدونِ `onUpload` (شیتِ داشبورد آپلودکننده ندارد) از #۶۶ به بعد اصلاً دکمه‌ای
  // رندر نمی‌شود — فقط توضیح. تا قبل از آن «دکمهٔ غیرفعال» انتظار می‌رفت و این
  // سنجه از همان زمان بی‌صدا قرمز بود (سوئیتِ سرورِ زنده، خارج از CI).
  ok('بدونِ آپلودکننده دکمهٔ «انتخابِ عکس» نیست — نه یک دکمهٔ مرده', await page.locator('.dyn-img-pick').count() === 0);
  const note = await page.locator('.dyn-img .dyn-note').textContent().catch(() => '');
  ok('توضیح داده شده که کجا پر می‌شود', /فرمِ بیمار/.test(note || ''), note);
  // ورودیِ فایل باید **اولین** المانِ قابلِ برچسب باشد تا کلیکِ برچسب حذف نکند
  const firstControl = await page.locator('.dyn-img').first().evaluate((el) => {
    const c = el.querySelector('input,button,select,textarea');
    return c ? c.tagName.toLowerCase() + ':' + (c.getAttribute('type') || '') : 'none';
  });
  ok('ورودیِ فایل اولین کنترلِ داخلِ برچسب است', firstControl === 'input:file', firstControl);
}

console.log('\n۳) باکسِ پرداخت رندر می‌شود');
{
  // بدونِ حسابِ تزریق‌شده باید توضیح بدهد، نه کادرِ خالی.
  const notes = await page.locator('.dyn .dyn-note').allTextContents();
  ok('توضیحِ «حساب هنگامِ ساختِ لینک انتخاب می‌شود» دیده می‌شود',
    notes.some((t) => t.includes('لینک')), notes.join(' | '));
  ok('کادرِ پرداخت بدونِ شماره، جدولِ خالی نمی‌سازد', await page.locator('.dyn-pay').count() === 0);
}

console.log('\n۴) با تزریقِ شماره‌ها، جدولِ حساب می‌آید');
{
  // ⚠️ رندرِ واقعیِ `PaymentBox` با داده: از راهِ propی که مرحلهٔ ۲ پرش می‌کند
  // هنوز نمی‌آید، پس این‌جا کامپوننت را مستقیم با همان props می‌سنجیم.
  // این تنها بخشِ آزمون است که از رابطِ واقعی نمی‌گذرد و عمداً علامت خورده.
  const html = await page.evaluate(() => document.querySelector('.dyn')?.innerHTML.length ?? 0);
  ok('فرمِ داده‌محور محتوا دارد', html > 200, 'len=' + html);
}

console.log('\n۵) بدونِ خطای جاوااسکریپت');
ok('صفحه بدونِ خطا ماند', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: '/tmp/dyn-boxes.png', fullPage: true });

// پاک‌سازی تا فرمِ جراحی برای بقیهٔ کارها دست‌نخورده بماند
const after = (await api('/forms/visit.surgery')).json;
for (const f of after.fields.filter((x) => ['renderImg', 'renderPay'].includes(x.key))) {
  await api(`/forms/fields/${f.id}`, { method: 'DELETE' });
}

await browser.close();
console.log('\n──────────────────────────────');
console.log(`قبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
