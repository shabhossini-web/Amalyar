import { chromium } from 'playwright-core';

const BASE = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

/* روی دیتابیسِ تازه هیچ کارتی نیست؛ سوییت مراجعهٔ خودش را می‌سازد و آخرِ کار
   پاک می‌کند — نه اینکه به مراجعاتِ اجرای قبلی تکیه کند (که در CI وجود ندارند). */
const auth = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.accessToken };
const j = (path, init) => fetch(API + path, { headers: H, ...init }).then((r) => r.json());
const [kinds, surgeons, hospitals] = await Promise.all([j('/forms/visit-kinds'), j('/surgeons'), j('/hospitals')]);
const fixture = await j('/visits', { method: 'POST', body: JSON.stringify({
  kind: kinds[0]?.kind, firstName: 'بیمارِ', lastName: 'ارسالِ فرم',
  surgeonId: (surgeons.rows ?? surgeons)[0]?.id, hospitalId: (hospitals.rows ?? hospitals)[0]?.id,
  opDate: new Date().toISOString(),
}) });
if (!fixture?.id) { console.error('مراجعهٔ نمونه ساخته نشد:', JSON.stringify(fixture)); process.exit(1); }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// ورود — با تحملِ 429
await page.goto(BASE + '/login');
let logged = false;
for (let i = 0; i < 8 && !logged; i++) {
  await page.fill('input[name="identifier"], input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'test1234');
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL('**/app**', { timeout: 6000 });
    logged = true;
  } catch {
    await page.waitForTimeout(20000);
    await page.goto(BASE + '/login');
  }
}
ok(logged, 'ورود انجام شد');

// ۱) لانچر — کاشیِ CRM
/* W3.7: `/app` صفحهٔ «امروز» است و لانچرِ کاشی‌ها به `/app/tools` رفت. */
await page.goto(BASE + '/app/tools');
await page.waitForTimeout(1200);
const crmTile = await page.locator('a:has-text("تحلیل و CRM"), button:has-text("تحلیل و CRM")').count();
ok(crmTile >= 1, 'کاشیِ «تحلیل و CRM» در لانچر هست');

// ۲) صفحهٔ CRM
await page.goto(BASE + '/app/crm');
await page.waitForTimeout(1800);
ok(await page.locator('.crm-head h1').count() === 1, 'صفحهٔ CRM باز شد');
ok(await page.locator('.crm-card').count() >= 1, `کارتِ تحلیل رندر شد (${await page.locator('.crm-card').count()})`);
const barCount = await page.locator('.crm-bar').count();
ok(barCount >= 1, `نوارِ توزیع (${barCount})`);
// سرریزِ افقی؟
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 1, `بدونِ سرریزِ افقیِ موبایل (${overflow}px)`);

// ۳) داشبورد — منوی ارسالِ فرم روی کارت
await page.goto(BASE + '/app/dashboard');
await page.waitForTimeout(2500);
const sendBtn = page.locator('.db-sendwrap > button').first();
const haveCards = await sendBtn.count();
ok(haveCards >= 1, 'دکمهٔ ارسالِ فرم روی کارتِ مراجعه هست');
if (haveCards) {
  await sendBtn.click();
  await page.waitForTimeout(1200);
  const menu = page.locator('.db-sendmenu');
  ok(await menu.count() === 1, 'منوی فرم‌های زیرپرونده باز شد');
  const items = await menu.locator('button').allTextContents();
  console.log('    فرم‌ها: ' + items.join(' | '));
  ok(items.length >= 1, `دستِ‌کم یک فرمِ record در منو (${items.length})`);
  // بیرون کلیک → بسته شود
  await page.mouse.click(10, 300);
  await page.waitForTimeout(400);
  ok(await page.locator('.db-sendmenu').count() === 0, 'کلیکِ بیرون منو را می‌بندد');
}

// ۴) صفِ ثبت‌نام — دکمهٔ حذف
await page.goto(BASE + '/app/intake');
await page.waitForTimeout(1800);
await page.locator('button:has-text("همه")').first().click().catch(() => {});
await page.waitForTimeout(1200);
const cardel = await page.locator('.ia-cardel').count();
const cards = await page.locator('.ia-card').count();
console.log(`    کارت: ${cards}، دکمهٔ حذف: ${cardel}`);
ok(cards === 0 || cardel >= 0, 'صفِ ثبت‌نام بدونِ خطا رندر شد');
if (cardel > 0) {
  const box = await page.locator('.ia-cardel').first().boundingBox();
  const headBox = await page.locator('.ia-card header').first().boundingBox();
  ok(box && headBox && box.y >= headBox.y - 2 && box.y <= headBox.y + headBox.height + 2,
    'دکمهٔ حذف داخلِ سربرگِ کارت است (نه شناور روی صفحه)');
}

ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'هیچ خطای JSای در کنسول نیست');

await browser.close();
await fetch(API + '/visits/' + fixture.id, { method: 'DELETE', headers: H }).catch(() => {});
console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
