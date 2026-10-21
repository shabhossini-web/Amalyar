/**
 * «متن حاوی کلمه فیلتر شده است» در دفترِ یادآوری‌ها — راهنمای «کدام کلمه؟» زیرِ علت (dr-gorji، ۱۴۰۵/۰۷/۲۸).
 * مرورگرِ واقعی + Vite واقعی + APIِ ساختگی؛ عکس در هر دو تم و گوشی (قانونِ ۲۸).
 *
 *  باید بیفتد:
 *   - ردیفِ فیلترشده زیرِ علت، کلمهٔ احتمالی و راهِ اصلاح را نشان دهد (`filterHint` از سرور)
 *   - بی‌کلمه (`words: []`) فقط راهِ اصلاح بیاید، نه برچسبِ خالیِ «کلمهٔ احتمالی:»
 *  نباید بیفتد:
 *   - ردیفِ بی‌`filterHint` (رفته، یا نرفتهٔ دیگر) جعبهٔ راهنما بگیرد
 *   - اسکرولِ افقی روی گوشی، یا خطای JS
 */
import assert from 'node:assert/strict';
import { startVite, launch, mockContext, hOverflow } from './lib/mock-ui.mjs';

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const SHOTS = process.env.E2E_SHOTS;

const HOW = 'آن کلمه را در متنِ مراقبتِ همین عمل (فرمِ عمل) عوض و ذخیره کنید — متنِ تازه خودکار می‌رود و این ردیف کنار می‌رود.';
const ROWS = [
  { id: 1, kind: 'post_op_care', kindFa: 'مراقبتِ بعد از عمل', status: 'failed', statusFa: 'ارسالِ ناموفق', channel: 'sms',
    text: 'دکتر نمونه\nسارا مرادی عزیز، از مصرفِ الکل و دخانیات تا دو هفته پرهیز کنید و پانسمان را خشک نگه دارید.',
    phone: '09120000001', dueAt: '2026-10-20T06:30:00.000Z', patientName: 'سارا مرادی', visitCode: 'AM-0008-V1',
    error: 'ملی‌پیامک پیام را نپذیرفت: متن حاوی کلمه فیلتر شده است — همین متن دوباره هم نمی‌رود؛ کلمه را عوض کنید',
    filterHint: { words: ['الکل', 'دخانیات'], how: HOW } },
  { id: 2, kind: 'post_op_care', kindFa: 'مراقبتِ بعد از عمل', status: 'failed', statusFa: 'ارسالِ ناموفق', channel: 'sms',
    text: 'دکتر نمونه\nامیدواریم جراحیِ خوبی را پشتِ سر گذاشته باشید.', phone: '09120000002', dueAt: '2026-10-01T06:30:00.000Z',
    patientName: 'رضا اکبری', visitCode: 'AM-0010-V1',
    error: 'ملی‌پیامک پیام را نپذیرفت: متن حاوی کلمه فیلتر شده است — همین متن دوباره هم نمی‌رود؛ کلمه را عوض کنید',
    filterHint: { words: [], how: HOW } },
  { id: 3, kind: 'notice', kindFa: 'اطلاع‌رسانی', status: 'failed', statusFa: 'ارسالِ ناموفق', channel: 'sms', text: 'پیامِ دیگری که نرفت',
    phone: '09120000003', dueAt: '2026-10-19T06:30:00.000Z', patientName: 'لیلا یوسفی', error: 'شمارهٔ موبایلِ گیرنده معتبر نیست', filterHint: null },
  { id: 4, kind: 'next_visit', kindFa: 'یادآوریِ ویزیت', status: 'sent', statusFa: 'ارسال‌شده', channel: 'sms', text: 'پیامِ رفته',
    phone: '09120000004', dueAt: '2026-10-18T06:30:00.000Z', sentAt: '2026-10-18T06:31:00.000Z', deliveryStatus: 'delivered',
    patientName: 'حسن کریمی', filterHint: null },
];

const vite = await startVite(5231);
const browser = await launch();
try {
  for (const [theme, viewport, tag] of [
    ['dark', { width: 1100, height: 900 }, 'desk-dark'],
    ['light', { width: 1100, height: 900 }, 'desk-light'],
    ['light', { width: 390, height: 844 }, 'phone-light'],
    ['dark', { width: 390, height: 844 }, 'phone-dark'],
  ]) {
    const { context, errors } = await mockContext(browser, ({ path, method }) => {
      if (path === '/reminders' && method === 'GET') return ROWS;
      if (path === '/auth/me') return { id: 1, firstName: 'مدیرِ', lastName: 'آزمون', level: 6, status: 'active' };
      if (path === '/config') return { vertical: 'clinic', brand: {} };
      if (path === '/features') return [{ key: 'dashboard', allowed: true }];
      if (method === 'GET') return {};
      return undefined;
    }, { viewport });
    await context.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* */ } }, theme);
    const page = await context.newPage();
    await page.goto(`${vite.base}/app/reminders`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('.rm-row').length > 0, null, { timeout: 15000 });
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === theme, `${tag}: تمِ ${theme}`);
    const hints = page.locator('.rm-filter');
    ok(await hints.count() === 2, `${tag}: فقط دو ردیفِ فیلترشده راهنما دارند`);
    const first = await hints.nth(0).innerText();
    ok(first.includes('«الکل»') && first.includes('«دخانیات»') && first.includes('فرمِ عمل') && first.includes('حدس است'),
      `${tag}: کلمه‌های احتمالی و راهِ اصلاح`);
    const second = await hints.nth(1).innerText();
    ok(!second.includes('کلمهٔ احتمالی') && second.includes('فرمِ عمل'), `${tag}: بی‌کلمه، فقط راهِ اصلاح`);
    ok(await hOverflow(page) <= 1, `${tag}: اسکرولِ افقی ندارد`);
    ok(errors.length === 0, `${tag}: خطای JS ندارد ${errors.join(' | ')}`);
    if (SHOTS) {
      await hints.nth(0).scrollIntoViewIfNeeded();
      await page.locator('.rm-row').nth(0).screenshot({ path: `${SHOTS}/sms-filter-${tag}.png` });
      if (tag === 'phone-light') await page.screenshot({ path: `${SHOTS}/sms-filter-page-${tag}.png` });
    }
    await context.close();
  }
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nسبز: ${count}`);
