/**
 * شمارهٔ موبایلِ چسبانده‌شده یا خودکارپرشده — «+98 912 526 8654» باید «09125268654» شود.
 *
 * گزارشِ مالک (۱۴۰۵/۰۷/۱۵، با عکس): کیبوردِ اندروید شمارهٔ ذخیره‌شده را به‌شکلِ «+98 912 526 8654» زیرِ
 * کادرِ موبایل پیشنهاد می‌دهد و همان‌طور می‌نشست؛ اعتبارسنجیِ `^09\d{9}$` آن را رد می‌کرد. مالک گفت: «موقعِ
 * پیست، همهٔ فاصله‌ها را حذف کن و +98 اولِ شماره را با 0 عوض کن.»
 *
 *  باید بیفتد:
 *   - تابعِ فرانت و سرور روی هر ورودی **یک خروجی** می‌دهند (آینهٔ هم‌اند)
 *   - فرمِ عمومیِ ثبت‌نام: پیست/خودکارپرکن/تایپِ دستیِ «+98…» همه به «09…» می‌رسند
 *   - فیلدِ «موبایل»ِ فرمِ ساخته‌شده (DynForm) همین کار را می‌کند
 *   - صفحهٔ ورود (ثبت‌نام) و فرمِ «ادامه با موبایل» همین کار را می‌کنند
 *   - سرور هم «+98…» را می‌پذیرد و **به‌شکلِ محلی ذخیره** می‌کند (ثبت‌نامِ عمومی + ثبتِ مراجعه)
 *  نباید بیفتد:
 *   - ورودیِ سالم (فقط رقم) را بازنویسی کند — بازنویسیِ بی‌دلیل مکان‌نمای Gboard را می‌پراند
 *   - نامِ کاربریِ تمام‌رقم در «نامِ کاربری یا موبایل» دست بخورد
 *   - کدِ ملی (۱۰ رقم) با قاعدهٔ «۱۰رقمیِ ۹…» اشتباه شود (فیلدش از این تابع رد نمی‌شود)
 */
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { normalizeMobile, normalizeIdentifier } from '../../src/lib/identity.js';
import { captchaFor } from './lib/captcha.mjs';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const serverIdentity = require('./dist/common/identity.js');

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];

console.log('۱) تابعِ فرانت و سرور آینهٔ هم‌اند و جدولِ مثال‌ها درست است');
const CASES = [
  ['+98 912 526 8654', '09125268654'], ['+989125268654', '09125268654'], ['+98-912-526-8654', '09125268654'],
  ['(+98) 912 526 8654', '09125268654'], ['‎+98 912 526 8654', '09125268654'], ['0098 912 526 8654', '09125268654'],
  ['989125268654', '09125268654'], ['+98 0912 526 8654', '09125268654'], ['۰۹۱۲ ۵۲۶ ۸۶۵۴', '09125268654'],
  ['+۹۸ ۹۱۲ ۵۲۶ ۸۶۵۴', '09125268654'], ['0912 526 8654', '09125268654'], ['0912-526-8654', '09125268654'],
  ['09125268654', '09125268654'], ['9125268654', '09125268654'], ['', ''],
  /* نیمه‌کار (حینِ تایپ) — «+» گم نمی‌شود و «۹۸»ِ اولِ شماره قاطی نمی‌شود. */
  ['0', '0'], ['0912', '0912'], ['+', '+'], ['+9', '+9'], ['+98', '+98'], ['+98912', '+98912'], ['98', '98'], ['98912526865', '98912526865'],
  /* تلفنِ ثابت فقط از فاصله پاک می‌شود. */
  ['021 8826 7459', '02188267459'], ['+98 21 8826 7459', '02188267459'],
];
let mism = 0;
for (const [i, want] of CASES) {
  const f = normalizeMobile(i); const s = serverIdentity.normalizeMobile(i);
  if (f !== want || s !== want) { mism++; console.log(`    ${JSON.stringify(i)} → فرانت ${f} · سرور ${s} · انتظار ${want}`); }
}
ok(`همهٔ ${CASES.length} مثال در فرانت و سرور یکی و درست است`, mism === 0, `${mism} ناهمخوان`);
/* تایپِ دستیِ «+98…» نویسه‌به‌نویسه از همان تابع می‌گذرد و در پایان «09…» است؛ تایپِ بی‌صفر هم. */
const typed = (text) => { let v = ''; for (const ch of text) v = normalizeMobile(v + ch); return v; };
ok('تایپِ دستیِ «+989125268654» نویسه‌به‌نویسه به «09125268654» می‌رسد', typed('+989125268654') === '09125268654', typed('+989125268654'));
ok('تایپِ بی‌صفرِ «9125268654» هم', typed('9125268654') === '09125268654', typed('9125268654'));
ok('و تایپِ عادیِ «09125268654» بی‌تغییر', typed('09125268654') === '09125268654');
ok('**نباید بیفتد:** ورودیِ سالم همان رشته برمی‌گردد', ['0912', '09125268654', '091'].every((x) => normalizeMobile(x) === x));
ok('نامِ کاربری (حتی تمام‌رقم و فارسی) در «نامِ کاربری یا موبایل» دست نمی‌خورد',
  normalizeIdentifier('user.1') === 'user.1' && normalizeIdentifier('۰۹۱۲') === '۰۹۱۲' && normalizeIdentifier('+98 912 526 8654') === '09125268654');
ok('`mobileOf` سرور «+98…» را معتبر می‌داند', serverIdentity.mobileOf('+98 912 526 8654') === '09125268654' && serverIdentity.mobileOf('+98 912') === null);

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, method = 'GET', body, auth = true) => fetch(API + p, {
  method, headers: auth ? A : { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const nid = (n) => {
  const base = String(n).padStart(9, '0').slice(-9);
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(base[i]) * (10 - i);
  const r = s % 11;
  return base + String(r < 2 ? r : 11 - r);
};
const tag = Math.random().toString(36).slice(2, 7);
let seed = Math.floor(Math.random() * 800000) + 100000;

console.log('\n۲) سرور: «+98…» پذیرفته و محلی ذخیره می‌شود');
const form = (await send('/forms', 'POST', { key: `ph${tag}`, title: 'ویزیتِ شماره', scope: 'visit' })).json;
await send(`/forms/${form.id}/fields`, 'POST', { key: 'altPhone', label: 'تلفنِ همراهِ دوم', type: 'phone' });
const link = (await send('/intake/links', 'POST', { title: `[e2e] شماره ${tag}`, formId: form.id })).json;
{
  const id = nid(seed++);
  const reg = await send(`/public/intake/link/${link.token}/register`, 'POST', {
    firstName: 'شمارهٔ', lastName: `پیست ${tag}`, nationalId: id, phone: '+98 912 526 8654', ...(await captchaFor(API, link.token)),
  }, false);
  ok('ثبت‌نامِ عمومی با «+98 912 526 8654» پذیرفته شد', reg.status < 300 && !!reg.json?.token, `${reg.status} ${JSON.stringify(reg.json).slice(0, 120)}`);
  const stored = sql(`SELECT coalesce(p.phone,'-') FROM patients p WHERE p.national_id='${id}' LIMIT 1`)
    || sql(`SELECT coalesce(data->>'phone','-') FROM intake_submissions WHERE token='${reg.json?.token}' LIMIT 1`);
  ok('و در پایگاه «09125268654» ذخیره شد، نه «+98…»', stored === '09125268654', stored);
  const v = await send('/visits', 'POST', { kind: 'clinic', firstName: 'شمارهٔ', lastName: `ثبتِ دستی ${tag}`, phone: '+98 912 526 8655', opDate: new Date().toISOString() });
  ok('ثبتِ دستیِ مراجعه با «+98 912 526 8655» (DTO)', v.status < 300 && !!v.json?.id, `${v.status} ${JSON.stringify(v.json).slice(0, 140)}`);
  const pid = v.json?.patientId;
  ok('و به‌صورتِ «09125268655» ذخیره شد', pid && sql(`SELECT phone FROM patients WHERE id=${pid}`) === '09125268655', pid ? sql(`SELECT phone FROM patients WHERE id=${pid}`) : '-');
  const bad = await send('/visits', 'POST', { kind: 'clinic', firstName: 'شمارهٔ', lastName: `بد ${tag}`, phone: '+98 912', opDate: new Date().toISOString() });
  ok('**نباید بیفتد:** «+98 912»ِ ناقص هنوز رد می‌شود', bad.status === 400, String(bad.status));
}

console.log('\n۳) مرورگر — فرمِ عمومیِ ثبت‌نام (اندروید ۳۹۰)');
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fa-IR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 160)); });
  await page.goto(`${UI}/r/${link.token}`, { waitUntil: 'networkidle' });
  const phone = page.locator('#ik-phone');
  await phone.waitFor({ timeout: 15000 });
  /* ۱) خودکارپرکنِ کیبورد: یک رویدادِ input با کلِ متن. */
  await phone.fill('+98 912 526 8654');
  ok('خودکارپرکن: «+98 912 526 8654» ← «09125268654»', (await phone.inputValue()) === '09125268654', await phone.inputValue());
  /* ۲) پیستِ واقعی: insertText روی کادرِ فوکوس‌دار. */
  await phone.fill('');
  await phone.focus();
  await page.evaluate((t) => document.execCommand('insertText', false, t), '+98 912 526 8654');
  ok('پیست (insertText) هم همان', (await phone.inputValue()) === '09125268654', await phone.inputValue());
  /* ۳) پیستِ ارقامِ فارسی با فاصله. */
  await phone.fill('۰۹۱۲ ۵۲۶ ۸۶۵۴');
  ok('ارقامِ فارسیِ فاصله‌دار ← لاتینِ پیوسته', (await phone.inputValue()) === '09125268654', await phone.inputValue());
  /* ۴) تایپِ دستیِ نویسه‌به‌نویسه (کیبوردِ عددیِ اندروید «+» دارد). */
  await phone.fill('');
  await phone.pressSequentially('+989125268654', { delay: 15 });
  ok('تایپِ دستیِ «+989125268654» نویسه‌به‌نویسه ← «09125268654»', (await phone.inputValue()) === '09125268654', await phone.inputValue());
  await phone.fill('');
  await phone.pressSequentially('09125268654', { delay: 15 });
  ok('**نباید بیفتد:** تایپِ عادیِ «09125268654» بی‌تغییر و کامل', (await phone.inputValue()) === '09125268654', await phone.inputValue());
  /* ۵) کدِ ملی از این تابع رد نمی‌شود: ۱۰ رقمِ «9…» دست نمی‌خورد. */
  const nidBox = page.locator('#ik-nid');
  await nidBox.fill('9012345678');
  ok('**نباید بیفتد:** کدِ ملیِ ۱۰رقمیِ «9…» صفر نمی‌گیرد', (await nidBox.inputValue()) === '9012345678', await nidBox.inputValue());

  /* ادامه با موبایل (فرمِ «قبلاً ثبت‌نام کرده‌اید؟») */
  await page.locator('.ik-resume-toggle').tap();
  const rphone = page.locator('.ik-resume-form input[type=tel]');
  await rphone.waitFor({ timeout: 5000 });
  await rphone.fill('+98 912 526 8654');
  ok('«ادامه با موبایل»: همان نرمال‌سازی', (await rphone.inputValue()) === '09125268654', await rphone.inputValue());
  ok('و دکمهٔ «ارسالِ کد» با «+98…» فعال است (۱۱ رقمِ معتبر)', await page.locator('.ik-resume-form .ik-go').isEnabled());

  console.log('\n۴) مرورگر — فیلدِ «موبایل»ِ فرمِ ساخته‌شده (DynForm)');
  const id2 = nid(seed++);
  const reg2 = (await send(`/public/intake/link/${link.token}/register`, 'POST', {
    firstName: 'شمارهٔ', lastName: `دوم ${tag}`, nationalId: id2, phone: '09120000093', ...(await captchaFor(API, link.token)),
  }, false)).json;
  await page.goto(`${UI}/f/${reg2.token}`, { waitUntil: 'networkidle' });
  const alt = page.locator('.dyn input[type=tel], input[type=tel]').first();
  await alt.waitFor({ timeout: 15000 });
  await alt.fill('+98 912 526 8654');
  ok('فیلدِ موبایلِ فرمِ ساخته‌شده: «+98…» ← «09125268654»', (await alt.inputValue()) === '09125268654', await alt.inputValue());

  console.log('\n۵) مرورگر — صفحهٔ ورود');
  await page.goto(`${UI}/login`, { waitUntil: 'networkidle' });
  const ident = page.locator('input[autocomplete=username]').first();
  await ident.waitFor({ timeout: 10000 });
  await ident.fill('+98 912 526 8654');
  ok('«نامِ کاربری یا موبایل»: «+98…» ← «09125268654»', (await ident.inputValue()) === '09125268654', await ident.inputValue());
  await ident.fill('user.name1');
  ok('**نباید بیفتد:** نامِ کاربری دست‌نخورده می‌ماند', (await ident.inputValue()) === 'user.name1', await ident.inputValue());
  await ident.fill('09125268654');
  ok('**نباید بیفتد:** شمارهٔ عادی دست‌نخورده می‌ماند', (await ident.inputValue()) === '09125268654');
  await page.locator('.lg-tabs [role=tab]').nth(1).tap();
  const sphone = page.locator('input[type=tel]').first();
  await sphone.waitFor({ timeout: 5000 });
  await sphone.fill('+98 912 526 8654');
  ok('ثبت‌نام: موبایل «+98…» ← «09125268654»', (await sphone.inputValue()) === '09125268654', await sphone.inputValue());

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('بدونِ سرریزِ افقی', overflow <= 1, overflow + 'px');
  ok('هیچ خطای JS/کنسول', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} finally {
  await browser.close();
}

console.log(`\nقبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
