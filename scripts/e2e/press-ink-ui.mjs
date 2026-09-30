/**
 * متنِ دکمه‌های نئونِ شفاف (`src/ui/press.css`) با تم می‌چرخد — توکنِ `--press-ink`.
 * مرورگرِ واقعی، APIِ ساختگی (`lib/mock-ui.mjs`).
 *
 * زمینه: داخلِ این دکمه‌ها شفاف است (فقط رینگ و هالهٔ نور) و متنشان `#fff`ِ خام بود؛ در تمِ روشن —
 * پیش‌فرضِ مطب — «ادامه»ِ ثبت‌نامِ بیمار و «ارسال»ِ نظرسنجی سفید روی بنفشِ کم‌رنگ می‌نشستند.
 * دکمه‌هایی که صفحه‌شان پس‌زمینهٔ پُر می‌دهد (`.ia-ok`، `.df-save`، …) رنگِ خودشان را دارند و دست نخوردند.
 *
 *  باید بیفتد:
 *   - تمِ روشن: متنِ «ادامه» و «ارسال» تیره است
 *  نباید بیفتد:
 *   - تمِ تیره: همان سفید
 */
import { startVite, launch, mockContext } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const lum = (el) => el.evaluate((node) => {
  const [r, g, b] = getComputedStyle(node).color.match(/\d+(\.\d+)?/g).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
});

const vite = await startVite(5223);
const browser = await launch();
try {
  for (const theme of ['dark', 'light']) {
    console.log(`\nتمِ ${theme === 'light' ? 'روشن' : 'تیره'}`);
    const { context, errors } = await mockContext(browser, ({ path }) => {
      if (path === '/public/intake/link/tok') return { title: 'ثبت‌نام', amount: 0 };
      if (path === '/public/referral-sources') return [];
      if (path === '/public/intake/link/tok/captcha') return { challenge: 'c', image: PNG };
      if (path === '/public/survey/sv') return { title: 'نظرسنجی', fields: [{ key: 'q', label: 'نظرِ شما', type: 'text', required: false, options: [] }] };
      return undefined;
    });
    await context.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* about:blank */ } }, theme);
    const page = await context.newPage();
    page.setDefaultTimeout(8000);

    await page.goto(`${vite.base}/r/tok`, { waitUntil: 'networkidle' });
    const go = page.getByRole('button', { name: 'ادامه', exact: true });
    await go.waitFor();
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === theme, `تم روی <html> همان ${theme} است`);
    const a = await lum(go);
    ok(theme === 'light' ? a < 0.45 : a > 0.8, '«ادامه»ِ ثبت‌نام', `lum=${a.toFixed(2)}`);
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-${theme}-register.png`, fullPage: true });

    await page.goto(`${vite.base}/s/sv`, { waitUntil: 'networkidle' });
    const send = page.locator('.ik-submit');
    await send.waitFor();
    const b = await lum(send);
    ok(theme === 'light' ? b < 0.45 : b > 0.8, '«ارسال»ِ نظرسنجی', `lum=${b.toFixed(2)}`);
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-${theme}-survey.png`, fullPage: true });
    ok(errors.length === 0, 'بدونِ خطای JS', errors[0]);
    await context.close();
  }
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nقبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
