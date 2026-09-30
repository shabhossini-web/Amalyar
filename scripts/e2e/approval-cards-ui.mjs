/**
 * پاپ‌آپِ تأیید — سه کارتِ هویت / خدمت / پرداخت، همهٔ فیش‌ها، بازشدن از خودِ ردیف (مالک، ۱۴۰۵/۰۷/۰۱).
 * مرورگرِ واقعی، APIِ ساختگی (`lib/mock-ui.mjs`). قراردادِ سرور را `approval-cards.mjs` می‌سنجد.
 *
 *  باید بیفتد:
 *   - کلیک روی خودِ ردیف (نه فقط دکمه) پاپ‌آپ را باز می‌کند؛ صفحه‌کلید از دکمهٔ نام
 *   - کلیک روی فیشِ کارت بزرگ‌نمایی است، نه پاپ‌آپ
 *   - هر دو فیش روی کارت و در کارتِ پرداخت؛ PDF لینک است نه عکسِ شکسته
 *   - کارتِ ملی و دستورِ پزشک با برچسبِ کادرشان در کارتِ خدمت
 *   - ثبت‌نامِ رایگان «فیشی آپلود نشده» نمی‌گیرد
 *   - اصلاحِ هویت فقط فیلدِ عوض‌شده را می‌فرستد؛ بی‌تغییر چیزی نمی‌فرستد؛ کدِ ملی ورودی ندارد
 *  نباید بیفتد:
 *   - ترتیبِ کارت‌ها: هویت، خدمت، پرداخت
 *   - نامِ اصلاح‌شده در سربرگِ پاپ‌آپ دیده می‌شود
 */
import { startVite, launch, mockContext } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };
const row = (id, o = {}) => ({
  id, token: 't' + id, status: 'pending_approval', statusLabel: 'در انتظارِ تأیید', makesVisit: true, workflow: 'ionm', approvalKind: 'surgery',
  profileKind: 'company', service: 'ionm', serviceLabel: 'نورومانیتورینگ', serviceAmbiguous: false,
  amount: 2_000_000, payable: 2_000_000, discountAmount: 0, createdAt: '2026-09-23T08:00:00Z',
  data: { firstName: 'بیمار', lastName: String(id), surgeonName: 'دکتر آزمون', hospitalName: 'مرکز آزمون', procedure: 'فیوژن' },
  receipts: [], documents: [], ...o,
});
const ROWS = [
  row(1, {
    patient: { id: 11, code: 'AM-0011', firstName: 'بیمار', lastName: 'یک', phone: '09120000011', nationalId: '0012345678', birthDate: '1990-03-21T00:00:00.000Z' },
    receipts: [{ id: 101, name: 'r1.jpg', pdf: false }, { id: 102, name: 'r2.pdf', pdf: true }],
    documents: [
      { id: 201, name: 'id.jpg', pdf: false, field: 'nationalIdImage', label: 'تصویر کارت ملی' },
      { id: 202, name: 'rx.jpg', pdf: false, field: 'prescription', label: 'تصویر دستور پزشک' },
    ],
  }),
  row(2, { amount: 0, payable: 0, patient: { id: 12, code: 'AM-0012', firstName: 'رایگان', lastName: 'دو', phone: '09120000012', nationalId: '0012345679' } }),
];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const vite = await startVite(5219);
const browser = await launch();
try {
  const { context, writes, errors } = await mockContext(browser, ({ path, method }) => {
    if (path === '/auth/me') return { id: 1, level: 6, status: 'active', firstName: 'مدیر', lastName: 'تست' };
    if (path === '/config') return { vertical: 'ionm', kind: 'company', services: ['ionm'], serviceCatalog: [{ key: 'ionm', label: 'نورومانیتورینگ' }], brand: {} };
    if (path === '/features') return ['dashboard', 'formgen', 'definitions'].map((key) => ({ key, allowed: true }));
    if (path === '/intake/submissions') return ROWS;
    if (path === '/intake/links') return [];
    if (/^\/intake\/submissions\/\d+\/refs$/.test(path)) return {};
    if (path === '/forms/types') return [];
    if (path.startsWith('/forms/visit.')) return { fields: ['surgeonId', 'hospitalId', 'opDate'].map((key) => ({ key, active: true, builtin: true })) };
    if (['/surgeons', '/hospitals', '/techs', '/procedure-types', '/bank-accounts'].includes(path)) return [];
    if (path === '/patients/11' && method === 'PATCH') return { ok: true };
    return undefined;
  });
  /* فایلِ مدرک blob است نه JSON — عکسِ یک‌پیکسلی، تا `<img>` واقعاً بار شود. */
  await context.route('**/api/patients/documents/*/file', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64') }));
  const page = await context.newPage();
  page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(30000);
  await page.goto(`${vite.base}/app/intake`, { waitUntil: 'networkidle' });
  await page.locator('.ia-card').first().waitFor();
  const card = page.locator('.ia-card').nth(0);
  const sheet = page.locator('.ia-sheet');

  console.log('۱) کارتِ صف');
  await card.locator('.ia-receipt').first().waitFor();
  ok(await card.locator('.ia-receipt').count() === 1 && await card.locator('a.bl-mini', { hasText: 'فیشِ ۲' }).count() === 1,
    '**هر دو فیش روی کارت** — عکس و PDF (PDF لینک است، نه عکسِ شکسته)');
  ok(await card.locator('.ia-receipt', { hasText: 'فیشِ ۱' }).count() === 1, 'برچسبِ شماره‌دار برای چند فیش');
  ok(await page.locator('.ia-card').nth(1).getByText('فیشی آپلود نشده است').count() === 0, '**ثبت‌نامِ رایگان «فیشی آپلود نشده» نمی‌گیرد**');

  await card.locator('.ia-receipt').first().click();
  await page.locator('.ia-zoom').waitFor();
  ok(await sheet.count() === 0, '**کلیک روی فیش بزرگ‌نمایی است، نه پاپ‌آپ**');
  await page.locator('.ia-zoom .ia-x').click();
  await page.locator('.ia-zoom').waitFor({ state: 'detached' });

  await card.locator('.ia-facts').click();
  await sheet.waitFor();
  ok(await sheet.count() === 1, '**کلیک روی خودِ ردیف پاپ‌آپ را باز می‌کند**');

  console.log('\n۲) سه کارت');
  const heads = (await sheet.locator('.ia-block > h3').allInnerTexts()).map((t) => t.trim().split(/\s+/)[0]);
  ok(heads.join('|') === 'هویت|خدمت|پرداخت', 'ترتیب: هویت، خدمت، پرداخت', heads.join('|'));
  const idCard = sheet.locator('.ia-block').nth(0);
  ok((await idCard.locator('dd[dir="ltr"]').first().innerText()).trim() === '۰۰۱۲۳۴۵۶۷۸', 'کدِ ملی از پرونده، چپ‌به‌راست');
  ok((await idCard.innerText()).includes('AM-0011'), 'شمارهٔ پرونده');
  const svcCard = sheet.locator('.ia-block').nth(1);
  ok(await svcCard.locator('.ia-receipt', { hasText: 'تصویر کارت ملی' }).count() === 1
    && await svcCard.locator('.ia-receipt', { hasText: 'تصویر دستور پزشک' }).count() === 1, '**کارتِ ملی و دستورِ پزشک با برچسبِ کادرشان در کارتِ خدمت**');
  const payCard = sheet.locator('.ia-block').nth(2);
  ok(await payCard.locator('.ia-receipt').count() === 1 && await payCard.locator('a.bl-mini').count() === 1, 'هر دو فیش در کارتِ پرداخت');

  console.log('\n۳) اصلاحِ هویت');
  await idCard.getByRole('button', { name: /اصلاح/ }).click();
  ok(await idCard.locator('input').count() === 3, 'نام، نام خانوادگی، موبایل — کدِ ملی ورودی ندارد');
  await idCard.getByRole('button', { name: 'ذخیرهٔ هویت' }).click();
  await idCard.getByRole('button', { name: /اصلاح/ }).waitFor();
  ok(!writes.some((w) => w.path === '/patients/11'), '**ذخیرهٔ بی‌تغییر چیزی نمی‌فرستد**');
  await idCard.getByRole('button', { name: /اصلاح/ }).click();
  await idCard.getByLabel('نام', { exact: true }).fill('بیمارِ نو');
  await idCard.getByRole('button', { name: 'ذخیرهٔ هویت' }).click();
  await idCard.getByRole('button', { name: /اصلاح/ }).waitFor();
  const patch = writes.find((w) => w.path === '/patients/11');
  ok(patch?.method === 'PATCH' && JSON.stringify(patch.body) === '{"firstName":"بیمارِ نو"}', '**فقط فیلدِ عوض‌شده می‌رود**', JSON.stringify(patch?.body));
  ok((await sheet.locator('.ia-sheet-head b').innerText()).includes('بیمارِ نو یک'), 'نامِ اصلاح‌شده در سربرگِ پاپ‌آپ');

  console.log('\n۴) صفحه‌کلید');
  await sheet.locator('.ia-x').first().click();
  await sheet.waitFor({ state: 'detached' });
  await page.locator('.ia-card').nth(1).locator('.ia-open').focus();
  await page.keyboard.press('Enter');
  await sheet.waitFor();
  ok((await sheet.locator('.ia-sheet-head b').innerText()).includes('رایگان'), 'دکمهٔ نام با Enter پاپ‌آپِ همان ردیف را باز می‌کند');
  ok(errors.length === 0, 'بدونِ خطای JS', errors[0]);
  await context.close();
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nقبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
