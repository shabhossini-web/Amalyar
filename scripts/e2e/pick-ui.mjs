/**
 * بازشوی انتخابِ اختصاصی (Pick) به‌جای selectِ بومی — گزارشِ کاربر: روی
 * ویندوز selectِ بومی کند و بدرنگ باز می‌شد. چک: در فرمِ ویزیت، فیلدهای
 * موجودیت (پزشک/تشخیص/موضوع) دکمهٔ Pick دارند، پنل وسطِ صفحه با گزینه‌های
 * خوانا باز می‌شود، جستجو کار می‌کند و انتخاب روی فیلد می‌نشیند.
 */
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

const BASE = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then((r) => r.json());

/* یک تشخیصِ آزمایشی تا فهرست خالی نباشد. */
const tag = 'pk' + randomBytes(3).toString('hex');
const diag = await send('/diagnoses', 'POST', { title: `کمردردِ ${tag}` });
const forms = await send('/forms', 'GET');
const visitKind = forms.find((f) => f.scope === 'visit' && f.active)?.visitKind;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await browserLogin(page, login.accessToken);
  await page.goto(BASE + '/app/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  /* تا گامِ ۳ فرمِ ویزیت. */
  await page.locator('.db-add').click();
  await page.waitForTimeout(700);
  /* گامِ ۱ از بازبینیِ UX (clinic-daily-22) یک جست‌وجوی واحد است؛ پروندهٔ تازه با «ساختِ پروندهٔ تازه». */
  await page.locator('.db-sheet [data-act="new-record"]').click();
  await page.locator('input[required]').first().fill('آزمونِ');
  await page.locator('input[required]').nth(1).fill('بازشو');
  await page.locator('.db-stepnav .db-submit').click();
  await page.waitForTimeout(600);
  await page.locator('.db-kindrow button').first().click();
  await page.locator('.db-stepnav .db-submit').click();
  await page.waitForTimeout(900);

  const picks = page.locator('.db-sheet .pk-btn');
  ok(await picks.count() >= 1, `فیلدهای موجودیت با Pick رندر شدند (${await picks.count()})`);
  ok(await page.locator('.db-sheet .db-selrow select').count() === 0, '**selectِ بومی در فیلدهای موجودیت نمانده**');

  /* بازکردنِ پنل — باید فوری و وسطِ صفحه با گزینه‌های خوانا باشد. */
  const diagPick = page.locator('.db-selrow', { has: page.locator('.pk-btn') }).filter({ hasText: '' });
  await picks.last().click();
  await page.waitForTimeout(500);
  ok(await page.locator('.pk-panel').count() === 1, '**پنلِ انتخاب وسطِ صفحه باز شد**');
  const itemCount = await page.locator('.pk-item').count();
  ok(itemCount >= 1, `گزینه‌ها دیده می‌شوند (${itemCount})`);
  const color = await page.locator('.pk-item').first().evaluate((el) => getComputedStyle(el).color);
  ok(color !== 'rgba(0, 0, 0, 0)' && color !== 'rgb(0, 0, 0)', `رنگِ متنِ گزینه‌ها خواناست (${color})`);
  await page.locator('.pk-x').click();
  await page.waitForTimeout(400);

  /* انتخاب باید روی فیلد بنشیند — روی اولین فیلدِ Pickِ همین فرم. */
  const firstPick = picks.first();
  const before = await firstPick.innerText();
  await firstPick.click();
  await page.waitForTimeout(500);
  const choice = page.locator('.pk-item:not(.pk-clear)').first();
  const choiceText = (await choice.innerText()).trim();
  await choice.click();
  await page.waitForTimeout(400);
  const after = (await firstPick.innerText()).trim();
  ok(after.includes(choiceText) && after !== before.trim(), `**انتخاب روی فیلد نشست («${choiceText}»)**`);
  ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
} finally {
  await browser.close();
  await fetch(API + `/diagnoses/${diag.id}`, { method: 'DELETE', headers: A }).catch(() => {});
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
