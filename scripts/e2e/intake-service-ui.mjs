/**
 * صفحهٔ اولِ فرمِ خدمتِ بیمار (نورومانیتورینگ) روی گوشی — مسیرِ واقعیِ بیمار در مرورگر.
 *
 * بازخوردِ مالک (۱۴۰۵/۰۷/۰۴، چهار اسکرین‌شات از roham):
 *   ۱. آپلودِ کارتِ ملی و دستورِ پزشک «ثبت‌نام تغییر کرده است؛ صفحه را تازه کنید» می‌داد
 *   ۲. «یه باکسِ پرداختِ اضافه صفحهٔ اوله» — مرحلهٔ «فیشِ واریزی» همان را دارد
 *   ۳. «هم باکسِ تاریخِ عمل هست هم رزرو؛ دو تا هم‌زمان نمی‌شود»
 *   ۴. «انتخابِ بیمارستان‌ها بهم ریخته؛ وقتی تایپ می‌شود گزینه‌ها زیرش بیایند»
 *
 *  باید بیفتد:
 *   - آپلود با زمان‌بندیِ اندروید (ذخیرهٔ خودکار درست هم‌زمان با آپلود) بی‌خطا می‌نشیند
 *   - «امام» دو پیشنهاد می‌گیرد؛ پایین‌کشیدن + Enter و لمس انتخاب و فهرست را می‌بندند؛ Escape می‌بندد
 *   - «رزرو بدون تاریخ» کادرِ تاریخ و ستاره‌اش را برمی‌دارد و راهنما می‌گذارد؛ برگشتن برش می‌گرداند
 *   - ثبت به مرحلهٔ «فیشِ واریزی» می‌رود و شمارهٔ حساب **همان‌جا** دیده می‌شود
 *  نباید بیفتد:
 *   - باکسِ پرداخت در صفحهٔ اول، دیوارِ چیپِ بیمارستان پیش از تایپ، یا درخواستِ فهرست پیش از تایپ
 *   - پرسشِ جدای «بله/خیر» برای رزرو کنارِ کادرِ تاریخ
 *   - اسکرولِ افقی در عرضِ ۳۹۰، خطای JS — در هر دو تم
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { captchaFor } from './lib/captcha.mjs';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB;
if (![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const shots = process.env.E2E_SHOTS;
const db = new PrismaClient({ datasources: { db: { url: DB } } });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
async function api(path, body, method = body ? 'POST' : 'GET', token) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
let seed = Number.parseInt(randomBytes(3).toString('hex'), 16);
function nid(n) { const b = String(n % 1e9).padStart(9, '0'); let s = 0; for (let i = 0; i < 9; i++) s += +b[i] * (10 - i); const r = s % 11; return b + (r < 2 ? r : 11 - r); }
const set = (key, value) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

const auth = (await api('/auth/login', { identifier: 'admin', password: 'test1234' })).data?.accessToken;
if (!auth) throw new Error('ورودِ ادمین');
await set('vertical', 'ionm'); await set('services', JSON.stringify(['ionm']));
await api('/forms', null, 'GET', auth);
const ionm = await db.formDef.findUnique({ where: { key: 'intake.ionm' } });
const bank = await db.bankAccount.create({ data: { bankName: 'کشاورزی', ownerName: 'شرکتِ آزمون', cardNumber: '6037701624669229', iban: '040160000000001025971284', showOnIntake: true } });
const link = await api('/intake/links', { title: 'نورو', formId: ionm.id, amount: 1000000, bankAccountId: bank.id }, 'POST', auth);
if (link.status >= 300) throw new Error('لینک: ' + JSON.stringify(link.data));
for (const n of ['بیمارستان امام خمینی', 'بیمارستان امام حسین', 'بیمارستان البرز', 'بیمارستان آبان']) {
  if (!(await db.hospital.findFirst({ where: { name: n } }))) await db.hospital.create({ data: { name: n } });
}
const register = async () => {
  seed += 7;
  const r = await api(`/public/intake/link/${link.data.token}/register`, { firstName: 'مریم', lastName: 'نمونه', nationalId: nid(seed * 7919), phone: '0912' + String(1000000 + (seed % 8999999)), ...(await captchaFor(API, link.data.token)) });
  if (!r.data?.token) throw new Error('ثبت‌نام: ' + JSON.stringify(r.data));
  return r.data.token;
};
const dir = mkdtempSync(join(tmpdir(), 'isu-'));
const photo = join(dir, 'card.jpg');
writeFileSync(photo, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(120000)]));

const b = await chromium.launch({ executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errs = [];
try {
  for (const theme of ['dark', 'light']) {
    console.log(`\n══ تمِ ${theme === 'dark' ? 'تیره' : 'روشن'}`);
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'fa-IR', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* */ } }, theme);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${theme}: ${e}`));
    let hospitalCalls = 0;
    p.on('request', (r) => { if (r.url().includes('/hospitals?')) hospitalCalls++; });
    const token = await register();
    await p.goto(`${UI}/f/${token}`, { waitUntil: 'networkidle' });
    const field = (label) => p.locator('.pf-field', { has: p.locator(':scope > span', { hasText: label }) }).first();
    await field('نام جراح').waitFor({ timeout: 10000 });

    console.log('۱) صفحهٔ اول');
    ok(await p.locator('.dyn-pay').count() === 0 && !(await p.locator('body').innerText()).includes('پرداخت و فیش واریزی'),
      '**باکسِ پرداخت در صفحهٔ اول نیست** (فقط در مرحلهٔ «فیشِ واریزی»)');
    const box = p.locator('.hospital-lookup input');
    ok(await box.getAttribute('role') === 'combobox' && await box.getAttribute('aria-expanded') === 'false', 'بیمارستان یک کادرِ جست‌وجوست (combobox، بسته)');
    ok(await p.locator('.hl-list, .bl-mini').count() === 0 && hospitalCalls === 0, '**پیش از تایپ نه فهرستی، نه دیوارِ چیپ، نه درخواستی**');
    ok(await p.locator('.hospital-lookup .hl-star').count() === 1, 'ستارهٔ «اجباری» از خودِ فیلدِ فرم آمد');
    if (shots) await p.screenshot({ path: `${shots}/intake-service-${theme}-page1.png`, fullPage: true });

    console.log('\n۲) بیمارستان: تایپ ← پیشنهاد زیرِ کادر');
    await box.tap();
    await box.pressSequentially('امام', { delay: 40 });
    const list = p.locator('.hl-list');
    await list.waitFor({ timeout: 5000 });
    const names = await list.locator('li').allInnerTexts();
    ok(names.length === 2 && names.every((n) => n.includes('بیمارستان امام')), `«امام» ← دو پیشنهاد (${names.join('، ')})`);
    ok(await box.getAttribute('aria-expanded') === 'true', 'aria-expanded روشن شد');
    if (shots) await p.screenshot({ path: `${shots}/intake-service-${theme}-suggest.png` });
    await box.press('ArrowDown');
    ok(await list.locator('li[aria-selected="true"]').count() === 1, 'پایین‌کشیدن گزینهٔ اول را فعال کرد (aria-activedescendant)');
    await box.press('Enter');
    await p.waitForFunction(() => !document.querySelector('.hl-list'));
    ok((await box.inputValue()) === names[0], `Enter انتخاب کرد و فهرست بسته شد («${await box.inputValue()}»)`);
    await box.fill('البر');
    await list.waitFor({ timeout: 5000 });
    await box.press('Escape');
    await p.waitForFunction(() => !document.querySelector('.hl-list'));
    ok(true, 'Escape فهرست را بست');
    await box.fill('نامِ ناشناخته‌ای');
    await p.locator('.hospital-lookup p[role="status"]').waitFor({ timeout: 5000 });
    ok(true, 'نامِ بیرون از فهرست: «در فهرست نیست؛ همین را بنویسید» — نامِ آزاد پذیرفته است');
    await box.fill('آب');
    await list.waitFor({ timeout: 5000 });
    await list.locator('li').first().tap();
    await p.waitForFunction(() => !document.querySelector('.hl-list'));
    ok((await box.inputValue()) === 'بیمارستان آبان', `لمسِ پیشنهاد انتخاب کرد («${await box.inputValue()}»)`);

    console.log('\n۳) تاریخِ عمل یا رزرو بدون تاریخ — یکی در هر لحظه');
    const when = p.locator('.dyn-when');
    ok(await when.count() === 1 && await p.locator('.dyn-yesno').count() === 0, '**یک کنترل** — پرسشِ جدای «بله/خیر» برای رزرو نیست');
    const dated = when.getByRole('button', { name: 'تاریخ مشخص است' });
    const undated = when.getByRole('button', { name: 'رزرو بدون تاریخ' });
    ok(await dated.getAttribute('aria-pressed') === 'true' && await when.locator('input').count() === 1 && await when.locator('.dyn-star').count() === 1,
      'پیش‌فرض «تاریخ مشخص است»: کادرِ تاریخ با ستاره');
    const pickBox = await undated.boundingBox();
    ok(pickBox && pickBox.height >= 44, `هدفِ لمسی ≥ ۴۴ پیکسل (${Math.round(pickBox?.height ?? 0)})`);
    await undated.tap();
    ok(await undated.getAttribute('aria-pressed') === 'true' && await when.locator('input').count() === 0 && await when.locator('.dyn-star').count() === 0,
      '**«رزرو بدون تاریخ» کادرِ تاریخ و ستاره‌اش را برداشت**');
    ok(/بعداً شرکت/.test(await when.locator('.pf-hint').innerText()), 'به‌جایش راهنما: «تاریخ را بعداً شرکت هماهنگ می‌کند»');
    if (shots) { await when.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${shots}/intake-service-${theme}-undated.png` }); }
    await dated.tap();
    ok(await when.locator('input').count() === 1, 'برگشت به «تاریخ مشخص است» کادر را برگرداند');
    await undated.tap();

    console.log('\n۴) آپلود با زمان‌بندیِ اندروید — ذخیرهٔ خودکار هم‌زمان با آپلود');
    await field('نام جراح').locator('input').fill('دکتر طبیب');
    await field('نام عمل').locator('input').fill('کرانیوتومی');
    await field('توضیحات بیمار').locator('textarea').fill('توضیح');
    for (const label of ['تصویر کارت ملی', 'تصویر دستور پزشک']) {
      const [chooser] = await Promise.all([p.waitForEvent('filechooser'), field(label).locator('.dyn-img-pick').tap()]);
      /* پنجرهٔ انتخابِ عکس صفحه را متوقف می‌کند؛ ذخیرهٔ ۱٫۵ ثانیه‌ایِ blur هنگامِ برگشت با آپلود هم‌زمان می‌رود. */
      await p.waitForTimeout(1460);
      await chooser.setFiles(photo);
      await p.waitForFunction((l) => {
        const f = [...document.querySelectorAll('.pf-field')].find((x) => x.querySelector(':scope > span')?.textContent?.includes(l));
        return f && (f.querySelector('.dyn-img-has') || f.querySelector('.pf-err'));
      }, label, { timeout: 15000 });
      const err = await field(label).locator('.pf-err').allInnerTexts();
      ok(err.length === 0 && await field(label).locator('.dyn-img-has').count() === 1, `**${label}: بی‌خطا نشست** ${err.length ? '(' + err[0] + ')' : ''}`);
    }

    console.log('\n۵) ثبت ← مرحلهٔ «فیشِ واریزی»؛ شمارهٔ حساب همان‌جاست');
    await p.getByRole('button', { name: 'ثبت و مرحلهٔ بعد' }).tap();
    await p.locator('.ik-pay').waitFor({ timeout: 10000 });
    ok(await p.locator('.ik-steps li.now').innerText().then((t) => t.includes('فیش')), 'مرحلهٔ جاری «فیشِ واریزی» است');
    /* شماره با رقمِ فارسی و چهاررقمی گروه می‌شود؛ رقم‌ها را یکسان و فاصله‌ها را حذف کن. */
    const payText = (await p.locator('.ik-pay').innerText()).replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/\s+/g, '');
    ok(payText.includes('6037701624669229'), 'کارتِ بانکی در مرحلهٔ فیش دیده می‌شود');
    const row = await db.intakeSubmission.findUnique({ where: { token } });
    ok(row.status === 'pending_payment' && row.data.opDateOpen === true && row.data.hospitalName === 'بیمارستان آبان'
      && row.data.nationalIdImage?.length === 1 && row.data.prescription?.length === 1, 'روی سرور: رزرو بدون تاریخ، بیمارستان و هر دو مدرک ثبت شد');
    const width = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(width <= 391, `اسکرولِ افقی نیست (${width})`);
    if (shots) await p.screenshot({ path: `${shots}/intake-service-${theme}-pay.png`, fullPage: true });
    await ctx.close();
  }
} finally {
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
  await b.close();
  await db.$disconnect();
}
process.exit(fail || errs.length ? 1 : 0);
