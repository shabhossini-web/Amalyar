/**
 * صفحهٔ ثبت‌نام — پرسشِ امنیتی از **سرور** (تصویر + نشان)، نه دو عددی که مرورگر خودش می‌سازد.
 * مرورگرِ واقعی، APIِ ساختگی (`lib/mock-ui.mjs`). قراردادِ سرور را `intake-captcha.mjs` می‌سنجد.
 *
 *  باید بیفتد:
 *   - صفحه تصویرِ سرور را نشان می‌دهد و `{captchaToken, captchaAnswer}` می‌فرستد — نه `captchaA/B`
 *   - پاسخِ فارسی («۸») عدد می‌شود
 *   - ۴۲۲ (پاسخِ غلط/منقضی) ← پرسشِ تازه و پاسخِ پاک‌شده؛ «پرسشِ دیگر» هم همین
 *   - نیامدنِ پرسش (۴۲۹) دیده می‌شود و «ادامه» غیرفعال است تا پرسش بیاید
 *   - «ادامه» در تمِ روشن سفید روی زمینهٔ روشن نیست
 *  نباید بیفتد:
 *   - بعد از ثبت، بیمار به نشانیِ فرمِ خودش می‌رود
 *   - بی‌اسکرولِ افقی در عرضِ موبایل
 */
import { createRequire } from 'node:module';
import { startVite, launch, mockContext, hOverflow } from './lib/mock-ui.mjs';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { renderChallenge } = require('./dist/patients/intake-captcha.js');

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };
const image = (a, b) => `data:image/png;base64,${renderChallenge(a, b).toString('base64')}`;
/* `THEME=light` برای اسکرین‌شاتِ تمِ روشن (قانون ۲۳). */
const theme = (ctx) => process.env.THEME && ctx.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* about:blank */ } }, process.env.THEME);

const vite = await startVite(5222);
const browser = await launch();
try {
  let n = 0, registers = 0, capFails = 0;
  const { context, writes, errors } = await mockContext(browser, ({ path, method }) => {
    if (path === '/public/intake/link/tok') return { title: 'ثبت‌نامِ نورومانیتورینگ', amount: 0 };
    if (path === '/public/referral-sources') return [];
    if (path === '/public/intake/link/tok/captcha') {
      if (capFails > 0) { capFails--; return { status: 429, body: { message: 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید' } }; }
      n++;
      return { challenge: 'c' + n, image: image(n % 9 + 1, 3), expiresAt: '2026-09-23T10:00:00Z' };
    }
    if (path === '/public/intake/link/tok/register' && method === 'POST') {
      registers++;
      return registers === 1
        ? { status: 422, body: { message: 'پاسخِ پرسشِ امنیتی درست نیست — پرسشِ تازه را جواب دهید' } }
        : { token: 'ft' };
    }
    if (path === '/public/intake/form/ft') return { token: 'ft', status: 'pending_fill', statusLabel: 'در حالِ پر کردن', booking: { required: false }, data: {}, form: null };
    return undefined;
  });
  await theme(context);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`${vite.base}/r/tok`, { waitUntil: 'networkidle' });
  const img = page.locator('img.ik-cap-img');
  await img.waitFor();

  console.log('۱) پرسش از سرور');
  ok((await img.getAttribute('alt'))?.includes('پرسشِ امنیتی'), 'تصویرِ پرسش با متنِ جایگزین');
  const src1 = await img.getAttribute('src');
  ok(src1?.startsWith('data:image/png;base64,'), 'تصویر همان است که سرور داد');
  const answer = page.getByLabel(/حاصلِ جمعِ دو عددِ تصویر/);
  ok(await answer.count() === 1, 'کادرِ پاسخ برچسب دارد (برای صفحه‌خوان)');
  ok(await page.getByText(/\+.*= \?/).count() === 0, 'پرسش به‌شکلِ متن در صفحه نیست');
  if (process.env.SHOT) { await page.waitForTimeout(1200); await page.screenshot({ path: process.env.SHOT + '-register.png', fullPage: true }); }

  const fields = { 'نام *': 'مهسا', 'نامِ خانوادگی *': 'آزمون', 'کدِ ملی *': '0012345679', 'شمارهٔ موبایل *': '09120000000' };
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label, { exact: true }).fill(value);
  await answer.fill('۸');
  await page.getByRole('button', { name: 'ادامه', exact: true }).click();
  await page.waitForFunction((s) => document.querySelector('img.ik-cap-img')?.getAttribute('src') !== s, src1);
  const first = writes.find((w) => w.path === '/public/intake/link/tok/register');
  ok(first?.body?.captchaToken === 'c1' && first.body.captchaAnswer === 8, '**`{captchaToken, captchaAnswer}` رفت؛ «۸» عدد شد**', JSON.stringify(first?.body));
  ok(first && !('captchaA' in first.body) && !('captchaB' in first.body), '**عددهای مرورگر (`captchaA/B`) دیگر فرستاده نمی‌شوند**');

  console.log('\n۲) پاسخِ غلط ← پرسشِ تازه');
  ok((await page.locator('.ik-bad').innerText()).includes('درست نیست'), 'پیامِ سرور دیده می‌شود');
  ok(await answer.inputValue() === '', '**پاسخِ قبلی پاک شد** — مالِ پرسشِ قبلی بود');
  const src2 = await img.getAttribute('src');
  await page.getByRole('button', { name: 'پرسشِ دیگر' }).click();
  await page.waitForFunction((s) => document.querySelector('img.ik-cap-img')?.getAttribute('src') !== s, src2);
  ok(n === 3, '«پرسشِ دیگر» پرسشِ تازه می‌گیرد', String(n));
  await answer.fill('11');
  await page.getByRole('button', { name: 'ادامه', exact: true }).click();
  await page.waitForURL('**/f/ft');
  const second = writes.filter((w) => w.path === '/public/intake/link/tok/register').at(-1);
  ok(second?.body?.captchaToken === 'c3' && second.body.captchaAnswer === 11, 'ارسالِ دوم با نشانِ تازه', JSON.stringify(second?.body));
  ok(page.url().endsWith('/f/ft'), 'بعد از ثبت به فرمِ خودِ بیمار می‌رود');

  console.log('\n۳) پرسش نیامد');
  capFails = 1;
  await page.goto(`${vite.base}/r/tok`, { waitUntil: 'networkidle' });
  /* ⚠️ جای خالی اول «در حالِ بارگذاری…» است و بعد خطا — منتظرِ **خودِ خطا** بمان، وگرنه زیرِ بار
     متنِ بارگذاری خوانده می‌شود (یک‌بار در CIِ محلی فلیک شد). */
  const empty = page.locator('.ik-cap-empty', { hasText: 'تعداد درخواست‌ها' });
  await empty.waitFor();
  ok((await empty.innerText()).includes('تعداد درخواست‌ها زیاد است'), '۴۲۹ در جای تصویر دیده می‌شود');
  ok(await page.getByRole('button', { name: 'ادامه', exact: true }).isDisabled(), '**«ادامه» تا پرسش نیامده غیرفعال**');
  await page.getByRole('button', { name: 'پرسشِ دیگر' }).click();
  await img.waitFor();
  ok(!(await page.getByRole('button', { name: 'ادامه', exact: true }).isDisabled()), 'با «پرسشِ دیگر» پرسش آمد و «ادامه» فعال شد');
  ok(await hOverflow(page) <= 0, 'بی‌اسکرولِ افقی در عرضِ موبایل');
  ok(errors.length === 0, 'بدونِ خطای JS', errors[0]);
  await context.close();

  console.log('\n۴) تمِ روشن (پیش‌فرضِ مطب)');
  const light = await mockContext(browser, ({ path }) => (path === '/public/intake/link/tok' ? { title: 'ثبت‌نام', amount: 0 }
    : path === '/public/referral-sources' ? [] : path === '/public/intake/link/tok/captcha' ? { challenge: 'cl', image: image(4, 4) } : undefined));
  await light.context.addInitScript(() => { try { localStorage.setItem('amalyar_theme', 'light'); } catch { /* about:blank */ } });
  const lp = await light.context.newPage();
  await lp.goto(`${vite.base}/r/tok`, { waitUntil: 'networkidle' });
  await lp.locator('img.ik-cap-img').waitFor();
  const ink = await lp.getByRole('button', { name: 'ادامه', exact: true }).evaluate((el) => getComputedStyle(el).color.match(/\d+/g).slice(0, 3).map(Number));
  const lum = (0.2126 * ink[0] + 0.7152 * ink[1] + 0.0722 * ink[2]) / 255;
  ok(await lp.evaluate(() => document.documentElement.dataset.theme) === 'light' && lum < 0.45,
    '**«ادامه» در تمِ روشن سفید روی بنفشِ کم‌رنگ نیست** (دکمهٔ نئون داخلش شفاف است)', `rgb(${ink}) lum=${lum.toFixed(2)}`);
  await light.context.close();
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nقبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
