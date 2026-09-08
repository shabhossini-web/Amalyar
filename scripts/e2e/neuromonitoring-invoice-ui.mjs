/** Actual mobile/desktop billing UI and paginated print, with isolated HTTP fixtures. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
const base = 'http://127.0.0.1:5203';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5203', '--strictPort'], { stdio: 'ignore' });
let browser, count = 0;
const check = (v, name) => { assert.ok(v, name); console.log(`PASS ${++count}: ${name}`); };
try {
  for (let i = 0; i < 80; i++) { if (await fetch(base).then(r => r.ok).catch(() => false)) break; await delay(100); }
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport, locale: 'fa-IR', serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      localStorage.setItem('amalyar_token', 'test-only');
      const open = window.open.bind(window);
      window.open = (...args) => { const w = open(...args); if (w) w.print = () => { w.__printed = true; }; return w; };
    });
    const errors = [], writes = [];
    const bank = { id: 1, ownerName: 'شرکت دریافت‌کننده', bankName: 'بانک تست', classification: 'formal', active: true, accountNumber: '123456' };
    const visit = { id: 1, patientId: 1, kind: 'surgery', code: 'AM-LOCAL-V1', firstName: 'بیمار', lastName: 'آزمایشی', fullName: 'بیمار آزمایشی', opDate: '2026-09-08', surgeonName: 'جراح تست', hospitalName: 'مرکز دولتی', total: 30001000, paid: 30000000, due: 1000 };
    let bill = { charges: [{ id: 1, title: 'خدمت اولیه', kind: 'service', quantity: 1, unitPrice: 30000000, amount: 30000000 }, { id: 2, title: 'قلم اضافه', kind: 'service', quantity: 1, unitPrice: 1000, amount: 1000 }], payments: [{ id: 1, paidAt: '2026-09-08', method: 'transfer', amount: 30000000 }], total: 30001000, paid: 30000000, due: 1000, pricingModel: 'coded', invoiceType: 'formal', invoiceBankAccount: bank, tariffSector: 'public' };
    const detail = { code: '901300', title: 'مانیتورینگ', hours: 3, coefficients: { professional: 15, technical: 7.3 }, factors: { professional: 101, technical: 203 }, professional: 4545, technical: 4446, total: 8991, tariff: { year: '1405', sector: 'public', sectorLabel: 'دولتی' }, deviceOwner: 'company' };
    let doc = null;
    await ctx.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname.replace(/^\/api/, ''), method = req.method();
      const payload = method !== 'GET' && req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null;
      if (method !== 'GET') writes.push({ path, method, payload });
      let body = [];
      if (path === '/auth/me') body = { id: 1, level: 6, status: 'active', firstName: 'مدیر', lastName: 'تست' };
      else if (path === '/config') body = { vertical: 'ionm', brand: { name: 'عملیار' } };
      else if (path === '/features') body = ['dashboard', 'formgen', 'accounting', 'definitions'].map(key => ({ key, allowed: true }));
      else if (path === '/forms/visit-kinds') body = [{ key: 'surgery', kind: 'surgery', title: 'عمل' }];
      else if (path === '/visits') body = { rows: [visit], total: 1, pages: 1, stats: { total: 1, kinds: [] } };
      else if (path === '/visits/1') body = visit;
      else if (path === '/visits/1/billing') body = bill;
      else if (path === '/bank-accounts') body = [bank];
      else if (path === '/ai/status') body = { enabled: false };
      else if (path === '/service-codes') body = [{ code: '901300', title: 'مانیتورینگ' }];
      else if (path === '/visits/charges/2' && method === 'DELETE') { bill = { ...bill, charges: bill.charges.filter(c => c.id !== 2), total: 30000000, due: 0 }; body = { ok: true }; }
      else if (path === '/visits/1/invoices/neuro-preview') body = detail;
      else if (path === '/visits/1/invoices/neuro-service') { const row = { id: 3, kind: 'service', title: detail.title, serviceCode: detail.code, quantity: 1, unitPrice: detail.total, amount: detail.total, neuroDetail: detail }; bill = { ...bill, charges: [...bill.charges, row], total: 30008991, due: 8991 }; body = row; }
      else if (path === '/visits/1/invoices') {
        if (method === 'POST') { doc ??= { id: 1, number: 'NM-F-000001', variant: 'formal', createdAt: '2026-09-08', snapshot: { visit, billing: structuredClone(bill), template: { title: 'صورتحساب نورومانیتورینگ', brand: { legalName: 'شرکت نورومانیتورینگ تست', registration: '98765' }, notes: 'توضیحات اختصاصی شرکت', signatures: ['تنظیم‌کننده', 'مهر شرکت'], showPayments: true } } }; body = doc; }
        else body = { hours: 3, year: '1405', sector: 'public', documents: doc ? [doc] : [] };
      }
      else if (path === '/visits/1/invoices/1') body = doc;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/app/dashboard`); await page.getByTitle('صورت‌حساب', { exact: true }).click();
    const sheet = page.locator('.bl-sheet'); await sheet.waitFor();
    const del = sheet.getByRole('button', { name: 'حذف قلم قلم اضافه', exact: true });
    check(await del.count() === 1, `explicit charge deletion action exists (${viewport.width})`);
    check(await sheet.locator('.bl-charge-list').evaluate(el => !!(el.compareDocumentPosition(document.querySelector('.bl-add')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'registered items precede the add form');
    await del.scrollIntoViewIfNeeded(); const box = await del.boundingBox(); check(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= viewport.width, 'delete target is visible and touch-sized');
    await del.click(); await del.waitFor({ state: 'detached' });
    check(bill.paid === 30000000 && bill.due === 0, 'deleting an extra charge retains the recorded payment');
    await sheet.getByRole('tab', { name: 'صدور فاکتور', exact: true }).click();
    await sheet.getByLabel('مدت قابل صورتحساب (ساعت)').waitFor();
    await page.waitForFunction(() => document.querySelector('.bl-invoice-panel input[inputmode="numeric"]')?.value === '3');
    check(await sheet.getByLabel('سال تعرفه (شمسی)').inputValue() === '1405', 'visit year and duration prefill the builder');
    await sheet.getByLabel('جستجوی خدمت (نام یا کد)').fill('901300');
    await sheet.getByRole('button', { name: '901300 · مانیتورینگ', exact: true }).click();
    await sheet.getByRole('button', { name: 'محاسبه تعرفه', exact: true }).click();
    await sheet.locator('.bl-neuro-preview').waitFor();
    check((await sheet.locator('.bl-neuro-preview').innerText()).includes('حرفه‌ای'), 'professional and technical amounts visible before saving');
    await sheet.getByRole('button', { name: 'افزودن خدمت محاسبه‌شده', exact: true }).click();
    await sheet.locator('.bl-neuro-preview').waitFor({ state: 'detached' });
    const sent = writes.find(w => w.path.endsWith('neuro-service')).payload;
    assert.deepEqual(Object.keys(sent).sort(), ['code', 'deviceOwner', 'hours', 'year']);
    check(true, 'browser submits code and duration, never financial totals');
    await page.screenshot({ path: `../invoice-builder-${viewport.width}.png`, fullPage: true });
    const popupWait = page.waitForEvent('popup');
    await sheet.getByRole('button', { name: 'صدور و چاپ فاکتور رسمی', exact: true }).click();
    const popup = await popupWait;
    await popup.getByText('شرکت نورومانیتورینگ تست', { exact: true }).waitFor();
    const text = await popup.locator('body').innerText();
    check(text.includes('NM-F-000001') && text.includes('شرکت دریافت‌کننده') && text.includes('حرفه‌ای') && text.includes('فنی'), 'issued print includes serial, bank and separate tariff shares');
    check(!/عملیار|عمل‌یار/.test(text), 'invoice has no platform branding');
    check(text.includes('توضیحات اختصاصی شرکت') && text.includes('مهر شرکت') && text.includes('به حروف'), 'company template notes, signatures and words are printed');
    await popup.waitForFunction(() => document.fonts.check('10px InvoiceFa', 'فاکتور'), null, { timeout: 10000 });
    check(true, 'local Persian font is ready');
    await popup.screenshot({ path: `../invoice-print-${viewport.width}.png`, fullPage: true });
    const longDoc = structuredClone(doc); longDoc.snapshot.billing.charges = Array.from({ length: 90 }, (_, i) => ({ ...bill.charges[1], title: `خدمت ردیف ${i + 1}` }));
    longDoc.snapshot.template.notes = 'END-OF-INVOICE';
    const longHtml = await page.evaluate(async d => { const { issuedInvoiceHtml, loadInvoiceFonts } = await import('/src/app/invoice-print.js'); return issuedInvoiceHtml(d, null, await loadInvoiceFonts()); }, longDoc);
    await popup.setContent(longHtml); await popup.evaluate(() => document.fonts.ready);
    const pdf = `../invoice-long-${viewport.width}.pdf`;
    await popup.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
    const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
    check(Number(info.match(/Pages:\s+(\d+)/)[1]) > 1, 'long invoice paginates instead of clipping');
    check(execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' }).includes('END-OF-INVOICE'), 'last content survives PDF pagination');
    await popup.close();
    await sheet.getByRole('button', { name: 'چاپ نسخه', exact: true }).waitFor();
    const reprintWait = page.waitForEvent('popup'); await sheet.getByRole('button', { name: 'چاپ نسخه', exact: true }).click();
    const reprint = await reprintWait; await reprint.getByText('شرکت نورومانیتورینگ تست', { exact: true }).waitFor();
    check(writes.filter(w => w.path === '/visits/1/invoices').length === 1, 'history reprint does not issue another document'); await reprint.close();
    check(!errors.length, `no runtime errors: ${errors.join('; ')}`);
    await ctx.close();
  }
  console.log(`${count} invoice UI/print checks passed`);
} finally { if (browser) await browser.close(); vite.kill('SIGTERM'); }
