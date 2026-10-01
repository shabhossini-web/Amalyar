/**
 * شیت باید **واقعاً** بسته شود — نه فقط نامرئی.
 *
 * ⚠️ باگی که این آزمون نگهبانش است: `Tabs` قرصِ فعالش را با `layoutId`
 * جابه‌جا می‌کرد، یعنی هر بار که کاربر تبِ داخلِ شیت را عوض می‌کرد یک المانِ
 * shared-layout از DOM می‌رفت و یکی دیگر می‌آمد. حسابداریِ framer گیر می‌کرد
 * و `AnimatePresence` **هرگز** خروجِ شیت را تمام نمی‌کرد: یک `.db-overlay`ِ
 * نامرئی روی صفحه می‌ماند و همهٔ کلیک‌ها را می‌بلعید. کاربر می‌دید فرم بسته
 * شد ولی هیچ دکمه‌ای کار نمی‌کرد — و چون چیزی برای دیدن نبود، فقط با آزمونِ
 * مرورگر پیدا شد.
 *
 * پس ادعا روی **حالتِ دیده‌شده** است: بعد از بستن، چند overlay در DOM مانده
 * و آیا دکمهٔ «مراجعهٔ جدید» دوباره قابلِ کلیک است.
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
if (!login.accessToken) { console.error('ورود نشد — سرور را ری‌استارت کنید (سطلِ محدودیت در حافظه است)'); process.exit(1); }

const b = await chromium.launch({
  executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const p = await (await b.newContext({ viewport: { width: 420, height: 900 }, locale: 'fa-IR' })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(UI + '/', { waitUntil: 'domcontentloaded' });
await browserLogin(p, login.accessToken);
await p.goto(UI + '/app/dashboard', { waitUntil: 'networkidle' });
await p.waitForTimeout(1800);

const leftovers = () => p.evaluate(() => document.querySelectorAll('[class*="overlay"]').length);

/** هر سناریو شیت را باز می‌کند، کاری می‌کند، می‌بندد، و DOM را می‌سنجد. */
async function scenario(name, act) {
  await p.locator('.db-add').click({ timeout: 8000 });
  await p.waitForTimeout(800);
  await act();
  await p.waitForTimeout(1600);
  const n = await leftovers();
  ok(n === 0, `${name} → overlayِ باقی‌مانده: ${n}`);
  if (n) { await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500); }
}

/**
 * تا گامِ ۳ِ فرمِ عمل — جایی که شیت `Tabs` دارد («مشخصات | قبل | حین | بعد»). گامِ ۱ از بازبینیِ UX
 * (clinic-daily-22) یک جست‌وجوی واحد است و دیگر تبِ «بیمارِ جدید/موجود» ندارد؛ نگهبانِ همان باگ حالا
 * روی زبانه‌های فرمِ عمل است. نوعِ «عمل» اگر پرسیده نشود (شرکتِ تک‌فرمه) همان پیش‌فرض است.
 */
const toSurgeryTabs = async () => {
  await p.locator('.db-sheet [data-act="new-record"]').click();
  await p.locator('.db-sheet .db-grid2 input').nth(0).fill('آزمونِ');
  await p.locator('.db-sheet .db-grid2 input').nth(1).fill('شیت');
  await p.locator('.db-stepnav .db-submit').click();
  const sk = p.locator('.db-kindrow button[data-kind="surgery"]');
  await sk.first().waitFor({ timeout: 5000 }).catch(() => {});
  if (await sk.count()) await sk.first().click();
  /* فرمِ تک‌نوع در نصبِ تک‌خدمته گامِ «نوع» ندارد (company-24) — «بعدی»ِ دوم فقط اگر هنوز در گامِ ۲ایم. */
  if (await p.locator('.db-stepnav .db-submit').count()) await p.locator('.db-stepnav .db-submit').click();
  await p.locator('.db-sheet .db-phasetabs').waitFor({ timeout: 8000 });
};
/* نام‌ها تایپ شده‌اند، پس بستن اول می‌پرسد (clinic-daily-08) — «دور ریختن». */
const closeTyped = async () => {
  await p.locator('.db-x').click();
  await p.locator('[data-unsaved="discard"]').click({ timeout: 4000 });
};

console.log('۱) مسیرهای بستنِ شیتِ مراجعه');
await scenario('بستن با ضربدر، بدونِ دست‌زدن به تب', async () => {
  await p.locator('.db-x').click();
});

// ⚠️ همان سناریویی که باگ را داشت.
await scenario('عوض‌کردنِ تبِ داخلِ شیت و بعد بستن', async () => {
  await toSurgeryTabs();
  await p.locator('.db-phasetabs button').nth(1).click();
  await p.waitForTimeout(500);
  await p.locator('.db-phasetabs button').nth(0).click();
  await p.waitForTimeout(500);
  await closeTyped();
});

/* ⚠️ از بازبینیِ UX ۱۴۰۵/۰۷ (clinic-daily-08) لمسِ پس‌زمینه فرمِ بلندِ مراجعه را **نمی‌بندد** — بیشتر
   اشتباهِ انگشت بود تا خواستنِ بستن. سناریو همان می‌ماند (پس‌زمینه، بعد بستن) و می‌سنجد که لمس شیت را
   نگه داشت و بستنِ واقعی باز هم هیچ پوششی جا نگذاشت. */
await scenario('کلیک روی پس‌زمینه نمی‌بندد؛ بعد بستن با ضربدر', async () => {
  await p.locator('.db-overlay').click({ position: { x: 8, y: 8 } });
  await p.waitForTimeout(400);
  ok(await p.locator('.db-sheet').count() === 1, 'لمسِ پس‌زمینه شیتِ مراجعه را باز نگه داشت');
  await p.locator('.db-x').click();
});

console.log('\n۲) بعد از بستن، صفحه واقعاً کار می‌کند');
let usable = true;
try { await p.locator('.db-add').click({ timeout: 5000 }); await p.locator('.db-x').click(); }
catch { usable = false; }
ok(usable, 'دکمهٔ «مراجعهٔ جدید» دوباره قابلِ کلیک است');

console.log('\n۳) قرصِ تب دقیقاً روی دکمهٔ فعال می‌نشیند');
await p.locator('.db-add').click();
await p.waitForTimeout(800);
await toSurgeryTabs();
const geom = async () => p.evaluate(() => [...document.querySelectorAll('.db-sheet .ui-tabs')].map((nav) => {
  const pill = nav.querySelector('.ui-tab-pill');
  const on = nav.querySelector('button[aria-selected="true"]');
  if (!pill || !on) return null;
  const a = pill.getBoundingClientRect(), c = on.getBoundingClientRect();
  return Math.max(Math.abs(a.left - c.left), Math.abs(a.top - c.top), Math.abs(a.width - c.width), Math.abs(a.height - c.height));
}).filter((x) => x !== null));
const g0 = await geom();
ok(g0.length >= 1 && g0.every((d) => d <= 1), 'قبل از لغزش، انطباق زیرِ ۱ پیکسل');
await p.locator('.db-phasetabs button').nth(2).click();
await p.waitForTimeout(900);
const g1 = await geom();
ok(g1.length >= 1 && g1.every((d) => d <= 1), 'بعد از لغزش هم همان‌طور');
await closeTyped();
await p.waitForTimeout(1200);
ok(await leftovers() === 0, 'و باز هم overlayی نماند');

console.log('\n' + '─'.repeat(50));
console.log(`قبول: ${pass}   رد: ${fail}`);
console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
await b.close();
process.exit(fail || errs.length ? 1 : 0);
