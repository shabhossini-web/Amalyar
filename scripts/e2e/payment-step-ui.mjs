/**
 * صفحهٔ پرداختِ بیمار — کارتِ بانکی، کپیِ شماره‌ها و توضیحِ شرکت (مالک، ۱۴۰۵/۰۷/۰۱).
 * مرورگرِ واقعی، APIِ ساختگی (`lib/mock-ui.mjs`). قراردادِ سرور را `approval-cards.mjs` می‌سنجد.
 *
 *  باید بیفتد:
 *   - کارتِ بانکی شمارهٔ کارت را چهاررقمی و چپ‌به‌راست نشان می‌دهد
 *   - کپیِ کارت و شبا **بی‌فاصله و لاتین** به کلیپ‌بورد می‌رود — اپِ بانک نه فاصله می‌پذیرد نه رقمِ فارسی
 *   - شبا برای خواندن چهارتایی گروه می‌شود (تا دیروز ۲۶ نویسهٔ پیوسته بود)
 *   - حسابِ بی‌کارت شکلِ کارت نمی‌گیرد، ولی ردیف‌های کپی‌اش هست
 *   - شکلِ کارت برای صفحه‌خوان پنهان است (همان اطلاعات در ردیف‌های کپی — یک‌بار خوانده شود)
 *   - توضیحِ شرکت بالای کارت‌هاست
 *  نباید بیفتد:
 *   - ترتیبِ ردیف‌ها: کارت، شبا، حساب
 *   - بی‌سرریزِ افقی روی ۳۹۰px، بی‌خطای JS
 */
import { startVite, launch, mockContext, hOverflow } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };
const NOTE = 'واریز فقط از کارتِ به نامِ خودِ بیمار؛ فیش را همین‌جا بگذارید.';
const view = {
  token: 'tok', status: 'pending_payment', statusLabel: 'در انتظارِ واریز', booking: { required: false, appointment: null },
  makesVisit: true, amount: 2_000_000, discountCode: null, discountAmount: 0, payable: 2_000_000,
  data: { firstName: 'بیمار', lastName: 'آزمایشی' }, reviewNote: null, expiresAt: null, form: null,
  paymentNote: NOTE,
  payTo: [
    { id: 1, ownerName: 'شرکتِ آزمون', bankName: 'ملی', cardNumber: '6037991234567890', iban: 'IR062960000000100324200001', accountNumber: '0105-1234-5678' },
    { id: 2, ownerName: 'شرکتِ آزمون', bankName: 'ملت', cardNumber: null, iban: 'IR820120000000001234567890', accountNumber: '9876543210' },
  ],
};

const vite = await startVite(5218);
const browser = await launch();
try {
  const { context, errors } = await mockContext(browser, ({ path, method }) => {
    if (path === '/public/intake/form/tok' && method === 'GET') return view;
    return undefined;
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: vite.base });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`${vite.base}/f/tok`, { waitUntil: 'networkidle' });
  await page.locator('.ik-pay').waitFor();

  console.log('۱) توضیح و کارت');
  ok((await page.locator('.ik-pay-note').innerText()).includes(NOTE), 'توضیحِ شرکت بالای کارت‌هاست');
  const noteFirst = await page.evaluate(() => {
    const n = document.querySelector('.ik-pay-note'), b = document.querySelector('.ik-bank');
    return !!(n && b && (n.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  ok(noteFirst, 'توضیح پیش از کارت می‌آید');
  ok(await page.locator('.ik-bank').count() === 2 && await page.locator('.ik-bank-face').count() === 1,
    '**حسابِ بی‌کارت شکلِ کارت نمی‌گیرد** (دو حساب، یک کارت)');
  const num = page.locator('.ik-bank-num');
  ok((await num.innerText()).trim() === '۶۰۳۷ ۹۹۱۲ ۳۴۵۶ ۷۸۹۰' && await num.getAttribute('dir') === 'ltr',
    '**شمارهٔ کارت چهاررقمی و چپ‌به‌راست**', await num.innerText());
  ok(await page.locator('.ik-bank-face').getAttribute('aria-hidden') === 'true', 'شکلِ کارت برای صفحه‌خوان پنهان است');
  ok((await page.locator('.ik-bank-face').innerText()).includes('ملی'), 'نامِ بانک روی کارت');

  console.log('\n۲) ردیف‌های کپی');
  const first = page.locator('.ik-bank').nth(0);
  const labels = await first.locator('.ik-copy > span').allInnerTexts();
  ok(labels.join('|') === 'شمارهٔ کارت|شبا|شمارهٔ حساب', 'ترتیب: کارت، شبا، حساب', labels.join('|'));
  const sheba = first.locator('.ik-copy', { hasText: 'شبا' });
  ok((await sheba.locator('b').innerText()).trim() === 'IR۰۶ ۲۹۶۰ ۰۰۰۰ ۰۰۱۰ ۰۳۲۴ ۲۰۰۰ ۰۱', '**شبا برای خواندن چهارتایی گروه می‌شود**', await sheba.locator('b').innerText());
  await first.locator('.ik-copy', { hasText: 'شمارهٔ کارت' }).click();
  ok(await page.evaluate(() => navigator.clipboard.readText()) === '6037991234567890', '**کپیِ کارت: لاتین و بی‌فاصله**');
  ok(await first.locator('.ik-copy.ok', { hasText: 'شمارهٔ کارت' }).count() === 1, 'و «کپی شد» نشان داده می‌شود');
  await sheba.click();
  ok(await page.evaluate(() => navigator.clipboard.readText()) === 'IR062960000000100324200001', '**کپیِ شبا: بی‌فاصله، با IR**');
  const second = await page.locator('.ik-bank').nth(1).locator('.ik-copy > span').allInnerTexts();
  ok(second.join('|') === 'شبا|شمارهٔ حساب', 'حسابِ بی‌کارت: شبا و حساب', second.join('|'));

  ok(await hOverflow(page) === 0, 'بی‌سرریزِ افقی روی ۳۹۰px');
  ok(errors.length === 0, 'بدونِ خطای JS', errors[0]);
  await context.close();
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nقبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
