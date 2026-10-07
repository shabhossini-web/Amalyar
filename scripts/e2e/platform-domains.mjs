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

  console.log('\n۶) «تغییرِ نشانی»: پنجره، پیش‌نمایشِ زیردامنه، ثبت، راهنمای Coolify');
  const shots = process.env.E2E_SHOTS;
  let posted = null;
  await p.route('**/api/platform/tenants/t-solo/domains', async (r) => {
    posted = JSON.parse(r.request().postData() || '{}');
    const custom = !posted.hostname.endsWith('.amalyar.com');
    await json(r, {
      id: 't-solo', hostname: posted.hostname, shared: true,
      domains: [{ hostname: posted.hostname, primary: true }, { hostname: 'solo.amalyar.com', primary: false }],
      added: { hostname: posted.hostname, automatic: !custom },
    });
  });
  /* کارت حالا دو دکمهٔ `.pa-soft` دارد («دسترسی» و «تغییرِ نشانی»)؛ با نام پیدا می‌شود، نه با کلاس. */
  const addrBtn = (row) => row.getByRole('button', { name: 'تغییرِ نشانی' });
  ok(await addrBtn(solo).count() === 1, 'دکمهٔ «تغییرِ نشانی» روی کارتِ شرکت هست');
  if (shots) await p.screenshot({ path: `${shots}/platform-domain-list.png` });
  await addrBtn(solo).click();
  const dlg = p.locator('.pa-addr');
  await dlg.waitFor({ timeout: 5000 });
  ok(await dlg.locator('.pa-addr-list li').count() === 1, 'پنجره نشانیِ فعلی را نشان می‌دهد');
  await dlg.locator('#pa-addr-new').fill('DrNew');
  ok((await dlg.locator('.pa-addr-preview').innerText()).trim() === 'drnew.amalyar.com',
    'نامِ بی‌نقطه → زیردامنهٔ همان دامنه، با حروفِ کوچک');
  await dlg.locator('.pa-primary-btn').click();
  await dlg.locator('.pa-addr-next').waitFor({ timeout: 5000 });
  ok(posted?.hostname === 'drnew.amalyar.com', `نشانیِ کامل به سرور رفت (${posted?.hostname})`);
  const next = await dlg.locator('.pa-addr-next').innerText();
  ok(/همین حالا/.test(next) && !/Coolify/.test(next),
    'زیردامنهٔ amalyar.com: «همین حالا باز می‌شود»، بی‌کارِ دستیِ Coolify (wildcard)');
  ok(/دوباره وارد/.test(next), 'یادآوریِ ورودِ دوباره و ثبتِ دوبارهٔ اثرِ انگشت');
  ok((await dlg.locator('.pa-addr-list li.on a').innerText()).trim() === 'drnew.amalyar.com', 'در پنجره نشانیِ تازه اصلی است');
  if (shots) await p.screenshot({ path: `${shots}/platform-domain-dialog.png` });
  /* دامنهٔ خودِ مشتری: گواهی و مسیرِ wildcard آن را نمی‌پوشاند — راهنمای DNS و Coolify لازم است. */
  await dlg.locator('#pa-addr-new').fill('clinic-gorji.ir');
  await dlg.locator('.pa-primary-btn').click();
  await p.waitForFunction(() => /Coolify/.test(document.querySelector('.pa-addr-next')?.innerText ?? ''), null, { timeout: 5000 });
  const manual = await dlg.locator('.pa-addr-next').innerText();
  ok(manual.includes('https://clinic-gorji.ir/api') && /DNS/.test(manual), 'دامنهٔ خودِ مشتری: راهنمای DNS و Coolify با هر دو نشانی');
  /* نامِ بی‌نقطه حالا زیردامنهٔ **دامنهٔ اصلیِ تازه** می‌شود (clinic-gorji.ir)، نه amalyar.com. */
  await dlg.locator('#pa-addr-new').fill('drnew');
  const pv = (await dlg.locator('.pa-addr-preview').innerText()).trim();
  ok(pv === 'drnew.clinic-gorji.ir', `پیش‌نمایش از دامنهٔ اصلیِ فعلی پیروی می‌کند (${pv})`);
  /* برگرداندن به drnew.amalyar.com برای ادامهٔ سنجه‌ها — نشانیِ کامل */
  await dlg.locator('#pa-addr-new').fill('drnew.amalyar.com');
  await dlg.locator('.pa-primary-btn').click();
  await p.waitForFunction(() => /همین حالا/.test(document.querySelector('.pa-addr-next')?.innerText ?? ''), null, { timeout: 5000 });
  await dlg.locator('.pa-ghost').click();
  await p.waitForTimeout(500);
  const soloAfter = p.locator('.pa-row', { hasText: 'کلینیکِ تک‌دامنه' });
  ok((await soloAfter.locator('.pa-host.on').innerText()).trim() === 'drnew.amalyar.com', 'کارتِ شرکت بی‌بارگذاریِ دوباره تازه شد');
  ok(await soloAfter.locator('.pa-host').count() === 2, 'نشانیِ قبلی هم روی کارت ماند');

  console.log('\n۷) حذفِ نشانیِ فرعی دو قدم دارد و هشدار می‌دهد');
  let removed = null;
  await p.route('**/api/platform/tenants/t-solo/domains/remove', async (r) => {
    removed = JSON.parse(r.request().postData() || '{}');
    await json(r, { id: 't-solo', hostname: 'drnew.amalyar.com', shared: false, domains: [{ hostname: 'drnew.amalyar.com', primary: true }] });
  });
  await addrBtn(soloAfter).click();
  const dlg2 = p.locator('.pa-addr');
  await dlg2.waitFor({ timeout: 5000 });
  await dlg2.locator('.pa-addr-del').click();
  await p.waitForTimeout(300);
  ok(removed === null && await dlg2.locator('.pa-addr-warn').count() === 1, 'کلیکِ اول فقط هشدار می‌دهد، حذف نمی‌کند');
  await dlg2.locator('.pa-addr-del').click();
  await p.waitForTimeout(500);
  ok(removed?.hostname === 'solo.amalyar.com', 'کلیکِ دوم حذف کرد');
  ok(await dlg2.locator('.pa-addr-list li').count() === 1, 'فهرستِ پنجره تازه شد');
  await dlg2.locator('.pa-ghost').click();
  await p.waitForTimeout(400);

  console.log('\n۸) گوشی: پنجره در عرضِ ۳۹۰ جا می‌شود');
  await p.setViewportSize({ width: 390, height: 844 });
  await addrBtn(p.locator('.pa-row', { hasText: 'کلینیکِ دو‌دامنه' })).click();
  const dlg3 = p.locator('.pa-addr');
  await dlg3.waitFor({ timeout: 5000 });
  /* پنجره با محوشدن/بزرگ‌شدن باز می‌شود؛ اندازه و عکس بعد از پایانِ حرکت، نه وسطش. */
  const settled = () => p.waitForFunction(() => {
    const panel = document.querySelector('.pa-addr');
    const bg = document.querySelector('.pa-modal-bg');
    return panel && bg && getComputedStyle(panel).opacity === '1' && getComputedStyle(bg).opacity === '1'
      && !/matrix\(0\.9/.test(getComputedStyle(panel).transform);
  }, null, { timeout: 5000 });
  await settled();
  const box = await dlg3.boundingBox();
  ok(box && box.x >= 0 && box.x + box.width <= 390 + 1, `پنجره بیرون نمی‌زند (${Math.round(box?.x)}…${Math.round((box?.x ?? 0) + (box?.width ?? 0))})`);
  const scroll = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(scroll <= 391, `صفحه اسکرولِ افقی نمی‌گیرد (${scroll})`);
  if (shots) await p.screenshot({ path: `${shots}/platform-domain-mobile.png` });
  await dlg3.locator('.pa-ghost').click();
  await p.setViewportSize({ width: 1200, height: 900 });

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
