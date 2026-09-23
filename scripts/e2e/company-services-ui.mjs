/**
 * صفِ ثبت‌نامِ شرکتِ دوخدمته — مرورگرِ واقعی، APIِ ساختگی. قراردادِ سرور را
 * `company-services.mjs` روی سرورِ واقعی می‌سنجد؛ این‌جا فقط «پنل چه نشان می‌دهد و چه می‌فرستد».
 *
 *  باید بیفتد:
 *   - در شرکتِ دوخدمته هر کارت خدمتِ خودش را نشان می‌دهد
 *   - فرمِ دلخواهِ مبهم انتخابگرِ خدمت دارد، پیش‌فرض خدمتِ اصلی؛ با «ایمپلنت» ویرایشگرِ
 *     اقلام ظاهر می‌شود و `service` همراهِ تأیید می‌رود
 *   - جراح و بیمارستان در شرکت «(الزامی)» اند (تصمیمِ مالک)
 *  نباید بیفتد:
 *   - ثبت‌نامِ ایمپلنتیِ غیرمبهم انتخابگر ندارد و `service` نمی‌فرستد
 *   - شرکتِ تک‌خدمته نشانِ خدمت روی کارت ندارد (اطلاعِ اضافه، نه تفکیک)
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:5214';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5214', '--strictPort'], { stdio: 'ignore' });
let browser, count = 0;
const pass = (v, name, detail = '') => { assert.ok(v, `${name}${detail ? ' — ' + detail : ''}`); console.log(`PASS ${++count}: ${name}`); };
const CATALOG = [{ key: 'ionm', label: 'نورومانیتورینگ' }, { key: 'implant', label: 'ایمپلنت و تجهیزات' }];
const row = (id, o) => ({
  id, token: 't' + id, patientId: id, amount: 0, payable: 0, status: 'pending_approval', statusLabel: 'در انتظارِ تأیید',
  makesVisit: true, workflow: 'ionm', approvalKind: 'surgery',
  data: { firstName: 'بیمار', lastName: String(id), surgeonName: 'دکتر آزمون', hospitalName: 'مرکز آزمون' }, createdAt: '2026-09-23T08:00:00Z', ...o,
});

async function run(services) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fa-IR', serviceWorkers: 'block' });
  const writes = [], errors = [];
  await ctx.route('**/api/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^\/api/, ''), method = req.method();
    const data = method !== 'GET' && req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null;
    if (method !== 'GET') writes.push({ path, data });
    let body = [];
    if (path === '/auth/me') body = { id: 1, level: 6, status: 'active', firstName: 'مدیر', lastName: 'تست' };
    else if (path === '/config') body = { vertical: 'ionm', kind: 'company', services, serviceCatalog: CATALOG, brand: {} };
    else if (path === '/features') body = ['dashboard', 'formgen', 'definitions'].map((key) => ({ key, allowed: true }));
    else if (path === '/intake/submissions') body = [
      row(1, { service: 'ionm', serviceLabel: 'نورومانیتورینگ', serviceAmbiguous: services.length > 1 }),
      row(2, { service: 'implant', serviceLabel: 'ایمپلنت و تجهیزات', serviceAmbiguous: false }),
    ];
    else if (path === '/intake/link-options') body = { forms: [] };
    else if (path.startsWith('/forms/visit.')) body = { fields: ['surgeonId', 'hospitalId', 'procedureTypeId', 'opDate'].map((key) => ({ key, active: true, builtin: true })) };
    else if (path === '/surgeons') body = [{ id: 1, name: 'جراح تست', active: true }];
    else if (path === '/hospitals') body = [{ id: 1, name: 'بیمارستان تست', active: true }];
    else if (path === '/procedure-types') body = [{ id: 1, name: 'عمل تست', active: true }];
    else if (path === '/items') body = [{ id: 9, name: 'پیچ آزمایشی', active: true }];
    else if (path.endsWith('/approve')) body = { ok: true, visitId: 1, visitCode: 'CS-1' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/app/intake`);
  await page.locator('.ia-card').first().waitFor();
  return { ctx, page, writes, errors };
}

try {
  for (let i = 0; i < 80; i++) { if (await fetch(base).then((r) => r.ok).catch(() => false)) break; await delay(100); }
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROME ?? '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  console.log('۱) شرکتِ دوخدمته');
  {
    const { ctx, page, writes, errors } = await run(['ionm', 'implant']);
    const chips = await page.locator('.ia-card .ia-svc').allInnerTexts();
    pass(chips.join('|') === 'نورومانیتورینگ|ایمپلنت و تجهیزات', '**هر کارت خدمتِ خودش را نشان می‌دهد**', chips.join('|'));

    await page.locator('.ia-card').nth(0).locator('.ia-ok').click();
    const sheet = page.locator('.ia-sheet'); await sheet.waitFor();
    const radios = sheet.getByRole('radio');
    pass(await radios.count() === 2, '**فرمِ مبهم انتخابگرِ خدمت دارد**');
    pass(await sheet.getByRole('radio', { name: 'نورومانیتورینگ' }).getAttribute('aria-checked') === 'true', 'پیش‌فرض خدمتِ اصلی (نورومانیتورینگ)');
    pass(await sheet.getByRole('button', { name: 'افزودن کالای موردنیاز' }).count() === 0, 'با نورومانیتورینگ ویرایشگرِ اقلام نیست');
    pass(await sheet.getByText('جراح (الزامی)').count() === 1 && await sheet.getByText('بیمارستان (الزامی)').count() === 1, '**جراح و بیمارستان در شرکت الزامی‌اند**');
    await sheet.getByRole('radio', { name: 'ایمپلنت و تجهیزات' }).click();
    await sheet.getByRole('button', { name: 'افزودن کالای موردنیاز' }).click();
    await sheet.getByLabel('کالا 1', { exact: true }).selectOption('9');
    await page.locator('#approve-surgeonId').selectOption('1');
    await page.locator('#approve-hospitalId').selectOption('1');
    await sheet.getByRole('button', { name: 'تأیید و ساختِ مراجعه', exact: true }).click();
    await sheet.waitFor({ state: 'detached' });
    const sent = writes.find((w) => w.path === '/intake/submissions/1/approve')?.data;
    pass(sent?.service === 'implant' && sent?.requiredItems?.[0]?.itemId === 9, '**تأیید `service: implant` و ردیفِ اقلام را می‌فرستد**', JSON.stringify(sent));

    await page.locator('.ia-card').nth(1).locator('.ia-ok').click(); await sheet.waitFor();
    pass(await sheet.getByRole('radio').count() === 0, 'ثبت‌نامِ ایمپلنتیِ غیرمبهم انتخابگر ندارد');
    pass(await sheet.getByRole('button', { name: 'افزودن کالای موردنیاز' }).count() === 1, 'و ویرایشگرِ اقلام دارد');
    await sheet.getByRole('button', { name: 'افزودن کالای موردنیاز' }).click();
    await sheet.getByLabel('کالا 1', { exact: true }).selectOption('9');
    await page.locator('#approve-surgeonId').selectOption('1');
    await page.locator('#approve-hospitalId').selectOption('1');
    await sheet.getByRole('button', { name: 'تأیید و ساختِ مراجعه', exact: true }).click();
    await sheet.waitFor({ state: 'detached' });
    const sent2 = writes.find((w) => w.path === '/intake/submissions/2/approve')?.data;
    pass(sent2 && !('service' in sent2) && sent2.requiredItems?.length === 1, 'و `service` نمی‌فرستد (خدمتش را فرمش می‌گوید)', JSON.stringify(sent2));
    pass(errors.length === 0, 'بدونِ خطای JS', errors[0]);
    await ctx.close();
  }

  console.log('\n۲) شرکتِ تک‌خدمته (نباید بیفتد)');
  {
    const { ctx, page, errors } = await run(['ionm']);
    pass(await page.locator('.ia-card .ia-svc').count() === 0, 'بی‌نشانِ خدمت روی کارت');
    await page.locator('.ia-card').nth(0).locator('.ia-ok').click();
    await page.locator('.ia-sheet').waitFor();
    pass(await page.locator('.ia-sheet').getByRole('radio').count() === 0, 'بی‌انتخابگرِ خدمت');
    pass(errors.length === 0, 'بدونِ خطای JS', errors[0]);
    await ctx.close();
  }
  console.log(`\n${count} سنجه سبز`);
} finally {
  await browser?.close();
  vite.kill();
}
