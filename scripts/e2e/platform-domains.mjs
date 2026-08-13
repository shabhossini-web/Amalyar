/**
 * پنلِ پلتفرم باید **همهٔ** دامنه‌های هر شرکت را نشان بدهد، نه فقط primary.
 *
 * ⚠️ چرا: کاربر گزارش کرد «تنانت‌ها از دیتابیسِ هم می‌خوانند». جداسازی سالم
 * بود (`tenant-isolation.mjs`، ۱۸ ادعا)، ولی یک حالتِ کاملاً قانونیِ پیکربندی
 * از بیرون **دقیقاً همان شکلی** است: دو دامنه که به یک `tenant_id` نگاشت
 * شده‌اند. آن‌وقت دو نشانی یک دیتابیس را نشان می‌دهند و هیچ نشتی هم در کار
 * نیست.
 *
 * تا دیروز پنل این را پنهان می‌کرد (`where: { primary: true }, take: 1`) و
 * تنها راهِ فهمیدنش باز کردنِ psql روی دیتابیسِ کنترل بود. چیزی که برای
 * دیدنش باید به دیتابیس وصل شوی، برای کاربر وجود ندارد.
 *
 * دو سطح سنجیده می‌شود: خروجیِ خودِ سرویس روی دیتابیسِ کنترلِ واقعی، و آنچه
 * روی صفحه کشیده می‌شود.
 */
import { chromium } from 'playwright-core';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

/* دو شرکتِ ساختگی: یکی تک‌دامنه، یکی دو‌دامنه. پاسخِ سرور شبیه‌سازی می‌شود
   چون ورودِ پنل OTP دارد و ادعا اینجا دربارهٔ **رندر** است، نه احراز هویت.
   درستیِ خودِ `snapshot()` جدا و روی دیتابیسِ واقعی سنجیده می‌شود
   (`verify-platform-domains.js` در گام‌های CI). */
const SNAPSHOT = {
  tenants: [
    {
      id: 't-solo', slug: 'solo', name: 'کلینیکِ تک‌دامنه', status: 'active',
      hostname: 'solo.amalyar.com',
      domains: [{ hostname: 'solo.amalyar.com', primary: true }],
      shared: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 't-dual', slug: 'dual', name: 'کلینیکِ دو‌دامنه', status: 'active',
      hostname: 'dual.amalyar.com',
      domains: [
        { hostname: 'dual.amalyar.com', primary: true },
        { hostname: 'reyteb.amalyar.com', primary: false },
      ],
      shared: true,
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ],
  jobs: [],
  deletions: [],
};

const b = await chromium.launch({
  executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const p = await (await b.newContext({ viewport: { width: 1200, height: 900 }, locale: 'fa-IR' })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

try {
  await p.route('**/api/platform/auth/me', (r) => json(r, { ok: true }));
  await p.route('**/api/platform/snapshot', (r) => json(r, SNAPSHOT));

  await p.goto(UI + '/platform-admin', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);

  console.log('۱) هر دامنه‌ای که به شرکت می‌رسد روی کارتش دیده می‌شود');
  const dual = p.locator('.pa-row', { hasText: 'کلینیکِ دو‌دامنه' });
  await dual.waitFor({ timeout: 5000 });
  const hosts = await dual.locator('.pa-host').allInnerTexts();
  ok(hosts.includes('dual.amalyar.com'), 'دامنهٔ اصلی دیده می‌شود');
  ok(hosts.includes('reyteb.amalyar.com'), '**دامنهٔ دوم هم دیده می‌شود** — همان چیزی که پنهان بود');
  ok(hosts.length === 2, `دقیقاً دو نشانی (${hosts.length})`);

  console.log('\n۲) و صریح گفته می‌شود که هر دو یک دیتابیس را می‌بینند');
  const warn = dual.locator('.pa-shared');
  ok(await warn.count() === 1, 'پیامِ هشدار روی کارت هست');
  ok(/یک دیتابیس/.test(await warn.innerText()), `متن معنی را می‌گوید («${(await warn.innerText()).trim()}»)`);

  console.log('\n۳) شرکتِ تک‌دامنه هشدار نمی‌گیرد — وگرنه هشدار بی‌معنی می‌شود');
  const solo = p.locator('.pa-row', { hasText: 'کلینیکِ تک‌دامنه' });
  ok(await solo.locator('.pa-host').count() === 1, 'یک نشانی دارد');
  ok(await solo.locator('.pa-shared').count() === 0, 'و هیچ هشداری ندارد');

  console.log('\n۴) دامنهٔ اصلی از دامنهٔ دوم قابلِ تشخیص است');
  ok(await dual.locator('.pa-host.on').count() === 1, 'فقط یکی به‌عنوان اصلی نشانه خورده');
  ok((await dual.locator('.pa-host.on').innerText()).trim() === 'dual.amalyar.com', 'و همان primaryِ سرور است');

  console.log('\n۵) پاسخِ قدیمیِ سرور (بدونِ آرایهٔ domains) صفحه را خالی نمی‌کند');
  /* پنل و API جدا دیپلوی می‌شوند؛ اگر پنل زودتر بالا بیاید، فهرستِ نشانی‌ها
     نباید ناپدید شود. */
  await p.route('**/api/platform/snapshot', (r) => json(r, {
    tenants: [{ id: 't-old', slug: 'old', name: 'پاسخِ قدیمی', status: 'active', hostname: 'old.amalyar.com', createdAt: '2026-01-03T00:00:00.000Z' }],
    jobs: [], deletions: [],
  }));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const old = p.locator('.pa-row', { hasText: 'پاسخِ قدیمی' });
  ok(await old.locator('.pa-host').count() === 1, 'از `hostname`ِ تکی fallback می‌گیرد');
  ok(await old.locator('.pa-shared').count() === 0, 'و هشدارِ الکی نمی‌سازد');
} finally {
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
  await b.close();
}
process.exit(fail || errs.length ? 1 : 0);
