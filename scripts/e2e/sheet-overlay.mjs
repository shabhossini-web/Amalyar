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
await p.evaluate((t) => localStorage.setItem('amalyar_token', t), login.accessToken);
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

console.log('۱) مسیرهای بستنِ شیتِ مراجعه');
await scenario('بستن با ضربدر، بدونِ دست‌زدن به تب', async () => {
  await p.locator('.db-x').click();
});

// ⚠️ همان سناریویی که باگ را داشت.
await scenario('عوض‌کردنِ تبِ داخلِ شیت و بعد بستن', async () => {
  await p.locator('.db-modetabs button:has-text("بیمارِ موجود")').click();
  await p.waitForTimeout(500);
  await p.locator('.db-modetabs button:has-text("بیمارِ جدید")').click();
  await p.waitForTimeout(500);
  await p.locator('.db-x').click();
});

await scenario('بستن با کلیک روی پس‌زمینه', async () => {
  await p.locator('.db-overlay').click({ position: { x: 8, y: 8 } });
});

console.log('\n۲) بعد از بستن، صفحه واقعاً کار می‌کند');
let usable = true;
try { await p.locator('.db-add').click({ timeout: 5000 }); await p.locator('.db-x').click(); }
catch { usable = false; }
ok(usable, 'دکمهٔ «مراجعهٔ جدید» دوباره قابلِ کلیک است');

console.log('\n۳) قرصِ تب دقیقاً روی دکمهٔ فعال می‌نشیند');
await p.locator('.db-add').click();
await p.waitForTimeout(800);
const geom = async () => p.evaluate(() => [...document.querySelectorAll('.ui-tabs')].map((nav) => {
  const pill = nav.querySelector('.ui-tab-pill');
  const on = nav.querySelector('button[aria-selected="true"]');
  if (!pill || !on) return null;
  const a = pill.getBoundingClientRect(), c = on.getBoundingClientRect();
  return Math.max(Math.abs(a.left - c.left), Math.abs(a.top - c.top), Math.abs(a.width - c.width), Math.abs(a.height - c.height));
}).filter((x) => x !== null));
ok((await geom()).every((d) => d <= 1), 'قبل از لغزش، انطباق زیرِ ۱ پیکسل');
await p.locator('.db-modetabs button:has-text("بیمارِ موجود")').click();
await p.waitForTimeout(900);
ok((await geom()).every((d) => d <= 1), 'بعد از لغزش هم همان‌طور');
await p.locator('.db-x').click();
await p.waitForTimeout(1200);
ok(await leftovers() === 0, 'و باز هم overlayی نماند');

console.log('\n' + '─'.repeat(50));
console.log(`قبول: ${pass}   رد: ${fail}`);
console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
await b.close();
process.exit(fail || errs.length ? 1 : 0);
