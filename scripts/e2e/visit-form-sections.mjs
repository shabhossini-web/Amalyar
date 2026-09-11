/**
 * تفکیک‌بندیِ فرمِ ثبتِ مراجعه — گزارشِ کاربر: «فرم پیچیده شده».
 * - هر گام سرصفحه + یک خط توضیح دارد
 * - ردیفِ انتخابِ نوع در جعبهٔ خنثیِ خط‌چین است (db-kindbox)
 * - خودِ فرم در کارتِ جدا با لبهٔ رنگیِ همان فرم است (db-formcard) و
 *   عنوانش نامِ فرمِ انتخاب‌شده را می‌گوید
 */
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

const BASE = 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await browserLogin(page, login.accessToken);
  await page.goto(BASE + '/app/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  await page.locator('.db-add').click();
  await page.waitForTimeout(700);

  console.log('۱) گامِ ۱ — پرونده');
  ok(await page.locator('.db-sheet .db-sect').count() === 1, 'سرصفحهٔ بخش با توضیح هست');
  ok((await page.locator('.db-sect small').first().innerText()).includes('پرونده'),
    '**توضیح می‌گوید این بخش چه کاری می‌کند**');

  await page.locator('input[required]').first().fill('آزمونِ');
  await page.locator('input[required]').nth(1).fill('تفکیک');
  await page.locator('.db-stepnav .db-submit').click();
  await page.waitForTimeout(600);

  console.log('\n۲) گامِ ۲ — نوعِ فرم در جعبهٔ خنثی');
  ok(await page.locator('.db-kindbox .db-kindrow button').count() >= 1, '**ردیفِ نوع‌ها داخلِ جعبهٔ خط‌چین است**');
  ok((await page.locator('.db-sect small').last().innerText()).includes('فرم‌ساز'),
    'توضیحِ بالای انتخابگر هست');
  const boxBorder = await page.locator('.db-kindbox').evaluate((el) => getComputedStyle(el).borderTopStyle);
  ok(boxBorder === 'dashed', 'جعبهٔ نوع‌ها خط‌چین است (خنثی)');
  const kindBtn = page.locator('.db-kindbox .db-kindrow button').first();
  const kindTitle = (await kindBtn.innerText()).trim();
  await kindBtn.click();
  await page.locator('.db-stepnav .db-submit').click();
  await page.waitForTimeout(900);

  console.log('\n۳) گامِ ۳ — کارتِ رنگیِ خودِ فرم');
  ok(await page.locator('.db-formcard').count() === 1, '**فیلدهای فرم داخلِ کارتِ جدا هستند**');
  const head = (await page.locator('.db-sect b').last().innerText()).replace(/\s+/g, ' ').trim();
  ok(head.includes(kindTitle) && !/فرمِ\s*فرم/.test(head),
    `عنوانِ بخش نامِ فرم را بدونِ دوباره‌گویی می‌گوید («${head}»)`);
  const borderColor = await page.locator('.db-formcard').evaluate((el) => getComputedStyle(el).borderInlineStartColor ?? getComputedStyle(el).borderRightColor);
  ok(!!borderColor && borderColor !== 'rgba(0, 0, 0, 0)', `لبهٔ کارتِ فرم رنگی است (${borderColor})`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `بدونِ سرریزِ افقی (${overflow}px)`);
  ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
} finally {
  await browser.close();
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
