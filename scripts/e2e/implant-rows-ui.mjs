/**
 * ردیف‌های ایمپلنت در رابط — موجودی در پاپ‌آپِ تأیید، «طبقِ نسخه» در پرتالِ جراح (مالک، ۱۴۰۵/۰۷/۰۱).
 * مرورگرِ واقعی، APIِ ساختگی (`lib/mock-ui.mjs`). قاعدهٔ سرور را `implant-rows.mjs` می‌سنجد.
 *
 *  باید بیفتد:
 *   - موجودیِ کالای انتخاب‌شده کنارِ تعداد؛ تعدادِ بیش از موجودی هشدار می‌گیرد (و «رزرو نمی‌کند» می‌گوید)
 *   - بی‌مجوزِ انبار (۴۰۳) چیزی از موجودی نشان داده نمی‌شود و خطایی هم نیست
 *   - ردیفِ نسخه‌دار در پرتالِ جراح «طبقِ نسخه» را نشان می‌دهد و دکمهٔ حذف ندارد
 *  نباید بیفتد:
 *   - پاپ‌آپ می‌گوید این تعداد نسخه است و با تأیید قفل می‌شود
 *   - تأیید `prescribedQuantity` نمی‌فرستد — نسخه را سرور می‌گذارد، نه کلاینت
 *   - ردیفِ بی‌نسخه در پرتالِ جراح همچنان حذف‌شدنی است
 */
import { startVite, launch, mockContext } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };
const ITEMS = [{ id: 9, name: 'پیچ پدیکولار', active: true }, { id: 10, name: 'کیج', active: true }];
const row = {
  id: 1, token: 't1', status: 'pending_approval', statusLabel: 'در انتظارِ تأیید', makesVisit: true, workflow: 'implant', approvalKind: 'surgery',
  profileKind: 'company', service: 'implant', serviceLabel: 'ایمپلنت و تجهیزات', serviceAmbiguous: false,
  amount: 0, payable: 0, discountAmount: 0, createdAt: '2026-09-23T08:00:00Z', receipts: [], documents: [],
  patient: { id: 11, code: 'AM-0011', firstName: 'بیمار', lastName: 'ایمپلنت', phone: '09120000011', nationalId: '0012345678' },
  data: { firstName: 'بیمار', lastName: 'ایمپلنت', procedure: 'فیوژن' },
};
const handler = (stock) => ({ path, method }) => {
  if (path === '/auth/me') return { id: 1, level: 6, status: 'active', firstName: 'مدیر', lastName: 'تست' };
  if (path === '/config') return { vertical: 'implant', kind: 'company', services: ['implant'], serviceCatalog: [{ key: 'implant', label: 'ایمپلنت و تجهیزات' }], brand: {} };
  if (path === '/features') return ['dashboard', 'formgen', 'definitions', 'surgeon'].map((key) => ({ key, allowed: true }));
  if (path === '/intake/submissions') return [row];
  if (path === '/intake/links') return [];
  if (/^\/intake\/submissions\/\d+\/refs$/.test(path)) return {};
  if (path === '/forms/types') return [];
  if (path.startsWith('/forms/visit.')) return { fields: ['surgeonId', 'hospitalId', 'opDate'].map((key) => ({ key, active: true, builtin: true })) };
  if (path === '/surgeons') return [{ id: 1, name: 'جراح تست', active: true }];
  if (path === '/hospitals') return [{ id: 1, name: 'بیمارستان تست', active: true }];
  if (['/techs', '/procedure-types', '/bank-accounts'].includes(path)) return [];
  if (path === '/items' || path === '/surgeon/items') return ITEMS;
  if (path === '/stock/availability') return stock;
  if (path.endsWith('/approve')) return { ok: true, visitId: 5, visitCode: 'AM-0011-V1' };
  if (path === '/surgeon/visits') return { workflow: 'implant', page: 1, pages: 1, total: 1, rows: [{
    id: 1, fullName: 'بیمار ایمپلنت', code: 'AM-0011-V1', opDate: '2026-10-01', hospital: 'مرکز تست', procedure: 'فیوژن', opStatus: 'pending',
    instructions: '', documents: [], implant: true,
    requiredItems: [{ itemId: 9, name: 'پیچ پدیکولار', quantity: 5, prescribedQuantity: 4, notes: '' }, { itemId: 10, name: 'کیج', quantity: 1, prescribedQuantity: null, notes: '' }] }] };
  return undefined;
};

const vite = await startVite(5220);
const browser = await launch();
try {
  console.log('۱) پاپ‌آپِ تأیید — موجودی کنارِ تعداد');
  {
    const { context, writes, errors } = await mockContext(browser, handler([{ itemId: 9, available: 3 }]));
    const page = await context.newPage(); page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(30000);
    await page.goto(`${vite.base}/app/intake`, { waitUntil: 'networkidle' });
    await page.locator('.ia-card').first().locator('.ia-ok').click();
    const sheet = page.locator('.ia-sheet'); await sheet.waitFor();
    await sheet.getByRole('button', { name: 'افزودن کالای موردنیاز' }).click();
    ok(await sheet.getByText('طبقِ دستورِ پزشک — با تأیید قفل می‌شود').count() === 1, 'پاپ‌آپ می‌گوید این تعداد نسخه است و قفل می‌شود');
    await sheet.getByLabel('کالا 1', { exact: true }).selectOption('9');
    const stock = sheet.locator('.ri-stock');
    await stock.waitFor();
    ok((await stock.innerText()).includes('موجود در انبار: ۳') && !(await stock.getAttribute('class')).includes('warn'), '**موجودیِ کالای انتخاب‌شده کنارِ تعداد**', await stock.innerText());
    await sheet.getByLabel('تعداد 1', { exact: true }).fill('5');
    ok((await stock.getAttribute('class')).includes('warn') && (await stock.innerText()).includes('رزرو نمی‌کند'), '**تعدادِ بیش از موجودی هشدار می‌گیرد** — و می‌گوید رزرو نمی‌کند', await stock.innerText());
    await page.locator('#approve-surgeonId').selectOption('1');
    await page.locator('#approve-hospitalId').selectOption('1');
    await sheet.getByRole('button', { name: 'تأیید و ساختِ مراجعه', exact: true }).click();
    await sheet.waitFor({ state: 'detached' });
    const sent = writes.find((w) => w.path === '/intake/submissions/1/approve')?.body;
    ok(sent?.requiredItems?.[0]?.quantity === 5 && !('prescribedQuantity' in sent.requiredItems[0]), 'تأیید `prescribedQuantity` نمی‌فرستد — نسخه را سرور می‌گذارد', JSON.stringify(sent?.requiredItems));
    ok(errors.length === 0, 'بدونِ خطای JS', errors[0]);
    await context.close();
  }

  console.log('\n۲) بی‌مجوزِ انبار');
  {
    const { context, errors } = await mockContext(browser, handler({ status: 403, body: { message: 'اجازه ندارید' } }));
    const page = await context.newPage(); page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(30000);
    await page.goto(`${vite.base}/app/intake`, { waitUntil: 'networkidle' });
    await page.locator('.ia-card').first().locator('.ia-ok').click();
    const sheet = page.locator('.ia-sheet'); await sheet.waitFor();
    await sheet.getByRole('button', { name: 'افزودن کالای موردنیاز' }).click();
    await sheet.getByLabel('کالا 1', { exact: true }).selectOption('9');
    await page.waitForTimeout(600);
    ok(await sheet.locator('.ri-stock').count() === 0 && await sheet.locator('[role="alert"]').count() === 0, '**۴۰۳ ← هیچ نشانی از موجودی، بی‌خطا**');
    ok(errors.length === 0, 'بدونِ خطای JS', errors[0]);
    await context.close();
  }

  console.log('\n۳) پرتالِ جراح — «طبقِ نسخه»');
  {
    const { context, errors } = await mockContext(browser, handler([]));
    const page = await context.newPage(); page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(30000);
    await page.goto(`${vite.base}/app/surgeon`, { waitUntil: 'networkidle' });
    await page.locator('.sp-list .sp-card').waitFor();
    await page.getByText('دستور جراح و آماده‌سازی بیمار', { exact: true }).click();
    const rx = page.locator('.ri-rx');
    await rx.first().waitFor();
    ok(await rx.count() === 1 && (await rx.innerText()).includes('طبقِ نسخه: ۴'), '**ردیفِ نسخه‌دار «طبقِ نسخه» را نشان می‌دهد**', await rx.innerText());
    ok(await page.getByRole('button', { name: 'حذف کالای موردنیاز 1', exact: true }).count() === 0, '**ردیفِ نسخه‌دار دکمهٔ حذف ندارد**');
    ok(await page.getByRole('button', { name: 'حذف کالای موردنیاز 2', exact: true }).count() === 1, 'ردیفِ بی‌نسخه حذف‌شدنی است');
    ok(errors.length === 0, 'بدونِ خطای JS', errors[0]);
    await context.close();
  }
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nقبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
