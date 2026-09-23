/**
 * W0.1 — استپر و پیام‌های فرمِ عمومی از `makesVisit/payable` (D10a, B4).
 *
 * مرورگرِ واقعی، API ساختگی (`lib/mock-ui.mjs`). قراردادِ سرور را `free-form.mjs` و
 * `record-direct.mjs` روی سرورِ زنده می‌سنجند؛ این‌جا فقط «صفحه چه نشان می‌دهد».
 *
 *  باید بیفتد:
 *   - فرمِ مراجعه‌سازِ رایگان دیگر مرحلهٔ «فیش» ندارد
 *   - فرمِ زیرپروندهٔ رایگان فقط «تکمیلِ فرم ← ثبت شد» است و دکمه‌اش «ثبتِ پاسخ»
 *   - «فیشِ شما دریافت شد» فقط وقتی فیشی رفته (کلیدِ چندتایی یا تکیِ قدیمی)
 *   - «بررسیِ ما» و هیچ کلیدِ خامِ وضعیت روی صفحه نیست
 *  نباید بیفتد:
 *   - فرمِ پولی همچنان سه مرحله دارد و در مرحلهٔ فیش کادرِ فیش می‌آید
 *   - فرمِ مراجعه‌سازِ **رایگان** همان «ذخیرهٔ اطلاعات» می‌ماند (links-box.mjs رویش کلیک می‌کند)
 *
 *  قراردادِ عوض‌شده (مالک، ۱۴۰۵/۰۷/۰۱): دکمهٔ فرمِ **پولی** «ثبت و مرحلهٔ بعد» است —
 *  بیمار باید بداند بعدش صفحهٔ واریز می‌آید؛ «ذخیرهٔ اطلاعات» یعنی کار تمام شد.
 *   - فرمِ زیرپرونده با کادرِ پرداخت (خطای پیکربندی) مثلِ سرور فیش می‌خواهد
 */
import { startVite, launch, mockContext, hOverflow } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const field = (o = {}) => ({ key: 'q1', label: 'نظرِ شما', type: 'text', required: false, options: [], hint: null, placeholder: null, page: 1, docCategory: null, ...o });
const form = (fields = [field()]) => ({ id: 1, key: 'f', title: 'فرم', pages: 1, hint: '', fields });
const view = (o = {}) => ({
  payTo: [], token: 'tok', status: 'pending_fill', booking: { required: false, appointment: null }, statusLabel: '',
  makesVisit: true, amount: 0, discountCode: null, discountAmount: 0, payable: 0,
  data: { firstName: 'بیمار', lastName: 'آزمایشی' }, reviewNote: null, expiresAt: null, form: form(),
  ...o,
});
const PAID = {
  amount: 2_000_000, payable: 2_000_000,
  payTo: [{ id: 1, ownerName: 'شرکت', bankName: 'بانک', accountNumber: '1234', cardNumber: '6037000000000000', iban: 'IR000000000000000000000000' }],
};
const RAW = ['pending_fill', 'pending_payment', 'pending_approval', 'approved', 'rejected', 'expired', 'makesVisit', 'payable'];

const vite = await startVite(5197);
const browser = await launch();
const seen = [];
try {
  let current = view();
  const { context, errors } = await mockContext(browser, ({ path, method }) => {
    if (path === '/public/intake/form/tok' && method === 'GET') return current;
    return undefined;
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);

  const open = async (v) => {
    current = v;
    await page.goto(`${vite.base}/f/tok`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.ik-card .ik-steps, .ik-card .ik-bad');
    seen.push(await page.locator('.ik-card').innerText());
  };
  /* برچسبِ خالصِ هر مرحله = گره‌های متنیِ <li> (نه شمارهٔ داخلِ <i>) + کلاسِ وضعیت. */
  const steps = () => page.locator('.ik-steps li').evaluateAll((els) => els.map((el) => ({
    label: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(),
    cls: el.className,
  })));
  const labels = (s) => s.map((x) => x.label);
  const button = (name) => page.getByRole('button', { name, exact: true }).count();

  console.log('۱) فرمِ پولی — سه مرحله (نباید بیفتد)');
  await open(view(PAID));
  let s = await steps();
  ok(same(labels(s), ['اطلاعاتِ مراجعه', 'فیشِ واریزی', 'بررسیِ تیمِ درمان']), `مرحله‌ها: ${labels(s).join(' ← ')}`);
  ok(s[0].cls === 'now' && s[1].cls === '' && s[2].cls === '', 'مرحلهٔ اول جاری است');
  ok((await button('ثبت و مرحلهٔ بعد')) === 1 && (await button('ذخیرهٔ اطلاعات')) === 0,
    '**دکمهٔ فرمِ پولی «ثبت و مرحلهٔ بعد» است** — نه «ذخیرهٔ اطلاعات»');

  console.log('\n۲) در مرحلهٔ فیش');
  await open(view({ ...PAID, status: 'pending_payment' }));
  s = await steps();
  ok(s[0].cls === 'ok' && s[1].cls === 'now', 'اطلاعات ✓ و فیش جاری');
  ok((await page.locator('.ik-pay').count()) === 1, 'کادرِ مبلغ و فیش هست');

  console.log('\n۳) فرمِ مراجعه‌سازِ رایگان — بدونِ «فیش»');
  await open(view());
  s = await steps();
  ok(same(labels(s), ['اطلاعاتِ مراجعه', 'بررسیِ تیمِ درمان']), `مرحله‌ها: ${labels(s).join(' ← ')}`);
  ok((await page.locator('.ik-pay').count()) === 0, 'کادرِ فیش نیست');
  ok((await button('ذخیرهٔ اطلاعات')) === 1 && (await button('ثبت و مرحلهٔ بعد')) === 0,
    'فرمِ رایگان «ذخیرهٔ اطلاعات» می‌ماند — مرحلهٔ بعدی ندارد (نباید بیفتد)');

  console.log('\n۴) فرمِ زیرپروندهٔ رایگان — فقط «تکمیل ← ثبت شد»');
  await open(view({ makesVisit: false }));
  s = await steps();
  ok(same(labels(s), ['تکمیلِ فرم', 'ثبت شد']), `مرحله‌ها: ${labels(s).join(' ← ')}`);
  ok((await button('ثبتِ پاسخ')) === 1 && (await button('ذخیرهٔ اطلاعات')) === 0, 'دکمه «ثبتِ پاسخ» است، نه «ذخیرهٔ اطلاعات»');

  console.log('\n۵) فرمِ زیرپرونده با کادرِ پرداخت — مثلِ سرور فیش می‌خواهد (نباید بیفتد)');
  await open(view({ makesVisit: false, form: form([field(), field({ key: 'pay', label: 'پرداخت', type: 'payment' })]) }));
  s = await steps();
  ok(labels(s).includes('فیشِ واریزی') && labels(s).includes('بررسیِ تیمِ درمان'), `مرحله‌ها: ${labels(s).join(' ← ')}`);

  console.log('\n۶) در انتظارِ بررسی — پیام از وجودِ فیش، نه از نوعِ فرم');
  const note = () => page.locator('.ik-note').first().innerText();
  await open(view({ status: 'pending_approval' }));
  let n = await note();
  ok(n.includes('اطلاعاتِ شما ثبت شد') && n.includes('تیمِ درمان') && !n.includes('فیش'), 'بدونِ فیش: «اطلاعاتِ شما ثبت شد؛ تیمِ درمان بررسی می‌کند»');
  s = await steps();
  ok(s.length === 2 && s[0].cls === 'ok' && s[1].cls === 'now', 'مرحلهٔ بررسی جاری است');
  await open(view({ ...PAID, status: 'pending_approval', data: { firstName: 'بیمار', lastName: 'آزمایشی', receiptDocumentIds: [5] } }));
  n = await note();
  ok(n.includes('فیشِ شما دریافت شد'), 'با فیش (کلیدِ چندتایی): «فیشِ شما دریافت شد»');
  await open(view({ ...PAID, status: 'pending_approval', data: { firstName: 'بیمار', lastName: 'آزمایشی', receiptDocumentId: 5 } }));
  ok((await note()).includes('فیشِ شما دریافت شد'), 'کلیدِ تکیِ قدیمی هم فیش شمرده می‌شود');

  console.log('\n۷) تأییدشده — پیام و نوارِ کامل');
  await open(view({ status: 'approved', makesVisit: false }));
  ok((await page.locator('.ik-good').innerText()).includes('پاسخِ شما ثبت شد'), 'فرمِ زیرپرونده: «پاسخِ شما ثبت شد»');
  s = await steps();
  ok(s.length === 2 && s.every((x) => x.cls === 'ok'), 'هر دو مرحله ✓');
  await open(view({ ...PAID, status: 'approved' }));
  ok((await page.locator('.ik-good').innerText()).includes('ثبت‌نامِ شما تأیید شد'), 'فرمِ مراجعه‌ساز: «ثبت‌نامِ شما تأیید شد»');
  s = await steps();
  ok(s.length === 3 && s.every((x) => x.cls === 'ok'), 'هر سه مرحله ✓');

  console.log('\n۸) رد و منقضی — پیام از واژه‌نامه، بدونِ نوار');
  await open(view({ status: 'rejected' }));
  ok((await page.locator('.ik-bad').innerText()).includes('تأیید نشد') && (await page.locator('.ik-steps').count()) === 0, 'ردشده');
  await open(view({ status: 'rejected', reviewNote: 'فیش ناخوانا بود' }));
  ok((await page.locator('.ik-bad').innerText()).includes('فیش ناخوانا بود'), 'یادداشتِ ردِ ادمین جای پیامِ عام را می‌گیرد');
  await open(view({ status: 'expired' }));
  ok((await page.locator('.ik-bad').innerText()).includes('مهلتِ این فرم تمام شده'), 'منقضی');

  console.log('\n۹) هیچ کلیدِ خام، هیچ «بررسیِ ما»، بدونِ خطای JS و سرریز');
  const leaked = seen.flatMap((t) => RAW.filter((k) => t.includes(k)));
  ok(leaked.length === 0, leaked.length ? 'کلیدِ خام: ' + [...new Set(leaked)].join('، ') : 'هیچ کلیدِ خامی روی صفحه نیست');
  ok(!seen.some((t) => t.includes('بررسیِ ما') || t.includes('اطلاعاتِ عمل')), 'زبانِ سامانه («بررسیِ ما»، «اطلاعاتِ عمل») روی صفحه نیست');
  ok((await hOverflow(page)) <= 1, 'بدونِ سرریزِ افقی روی موبایل');
  ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  await context.close();
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
