/** Real browser and application with isolated API fixtures for each business model. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
const base = 'http://127.0.0.1:5205';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5205', '--strictPort'], { stdio: 'ignore' });
let browser, count = 0;
const pass = (v, name) => { assert.ok(v, name); console.log(`PASS ${++count}: ${name}`); };
try {
  for (let i = 0; i < 80; i++) { if (await fetch(base).then(r => r.ok).catch(() => false)) break; await delay(100); }
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROME ?? '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) for (const profile of ['ionm', 'implant', 'clinic']) {
    const ctx = await browser.newContext({ viewport, locale: 'fa-IR', serviceWorkers: 'block' });
    await ctx.addInitScript(() => localStorage.setItem('amalyar_token', 'test-only'));
    const writes = [], errors = [];
    const kind = profile === 'clinic' ? 'clinic' : 'surgery';
    const fields = (profile === 'clinic' ? ['surgeonId', 'opDate'] : ['surgeonId', 'hospitalId', 'techId', 'procedureTypeId', 'opDate']).map(key => ({ key, active: true, builtin: true }));
    fields.push({ key: 'caseNote', label: 'توضیح تکمیلی پذیرش', type: 'textarea', active: true, required: true, builtin: false });
    const item = { id: 9, name: 'پیچ آزمایشی', active: true };
    let instructions = '', requirements = [{ itemId: 9, name: item.name, quantity: 4, notes: '' }];
    await ctx.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname.replace(/^\/api/, ''), method = req.method();
      const data = method !== 'GET' && req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null;
      if (method !== 'GET') writes.push({ path, data });
      let body = [];
      if (path === '/auth/me') body = { id: 1, level: 6, status: 'active', firstName: 'مدیر', lastName: 'تست' };
      else if (path === '/config') body = { vertical: profile, brand: {} };
      else if (path === '/features') body = ['dashboard', 'formgen', 'surgeon', 'definitions'].map(key => ({ key, allowed: key !== 'surgeon' || profile !== 'clinic' }));
      else if (path === '/intake/submissions') body = [{ id: 1, token: 'test', patientId: 1, amount: 0, payable: 0, status: 'pending_approval', makesVisit: true, workflow: profile, approvalKind: kind, data: { firstName: 'بیمار', lastName: 'تست', caseNote: 'شرح ارسالی بیمار', ...(profile === 'implant' ? { prescription: { id: 55, name: 'order.pdf' } } : {}) } }];
      else if (path === '/intake/link-options') body = { forms: [{ id: 8, title: `ثبت نام ${profile}`, scope: 'intake', visitKind: kind, recommended: true, hasPayment: profile !== 'clinic', makesVisit: true }, { id: 2, title: 'فرم بالینی', scope: 'visit', visitKind: kind }], banks: [] };
      else if (path.startsWith('/forms/visit.')) body = { fields };
      else if (path === '/surgeons') body = [{ id: 1, name: 'جراح تست', active: true }];
      else if (path === '/hospitals') body = [{ id: 1, name: 'بیمارستان تست', active: true }];
      // One denied list must not erase the other selectors.
      else if (path === '/techs') return route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"اجازه ندارید"}' });
      else if (path === '/procedure-types') body = [{ id: 1, name: 'عمل تست', active: true }];
      else if (path === '/procedure-types/1/needs') body = requirements;
      else if (path === '/items' || path === '/surgeon/items') body = [item];
      else if (path === '/patients/documents/55/file') return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-fixture' });
      else if (path.endsWith('/approve')) body = { ok: true, visitId: 1, visitCode: 'WF-1' };
      else if (path === '/surgeon/visits') body = { workflow: profile, page: 1, pages: 1, total: 1, rows: [{ id: 1, fullName: 'بیمار تست', code: 'WF-1', opDate: '2026-09-10', hospital: 'مرکز تست', procedure: 'عمل تست', opStatus: 'pending', report: 'گزارش عمل ثبت شده', instructions, requiredItems: requirements, documents: [] }] };
      else if (path === '/surgeon/visits/1/instructions') { instructions = data.instructions; requirements = data.requiredItems ?? requirements; body = { ok: true }; }
      else if (path === '/surgeon/accounts/1') body = { existing: false, level: 2, status: 'active' };
      else if (path === '/ai/status') body = { enabled: true, stt: true };
      else if (path === '/ai/text-draft') body = { text: 'دستور مرتب شده' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/app/intake`);
    await page.locator('.ia-add').click();
    const sheet = page.locator('.ia-sheet'); await sheet.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.ia-sheet select')].some(s => s.value === '8'));
    pass(await sheet.locator('select').first().inputValue() === '8', `${profile}: new link preselects model registration ${viewport.width}`);
    await sheet.getByRole('button', { name: 'بستن', exact: true }).click(); await sheet.waitFor({ state: 'detached' });
    await page.locator('.ia-card .ia-ok').click(); await sheet.waitFor();
    await page.locator('#approve-surgeonId').selectOption('1');
    pass(await page.locator('#approve-surgeonId').inputValue() === '1', 'denied technician endpoint preserves surgeon list');
    await sheet.getByLabel('توضیح تکمیلی پذیرش', { exact: false }).fill('تکمیل پذیرش');
    pass(await sheet.locator('.ia-pay').count() === 0, 'zero amount does not ask for payment account');
    if (profile === 'clinic') pass(await page.locator('#approve-hospitalId, #approve-techId, #approve-procedureTypeId').count() === 0, 'clinic approval follows its visible definitions');
    else await page.locator('#approve-hospitalId').selectOption('1');
    if (profile === 'implant') {
      pass(await sheet.getByRole('link', { name: 'بازکردن دستور جراح (PDF)' }).count() === 1, 'prescription is visible during approval');
      await page.locator('#approve-procedureTypeId').selectOption('1');
      await sheet.getByLabel('تعداد 1', { exact: true }).fill('7');
      pass(await sheet.getByLabel('کالا 1', { exact: true }).inputValue() === '9', 'procedure default chooses canonical item');
      await sheet.getByRole('button', { name: 'افزودن کالای موردنیاز' }).click();
      await sheet.getByRole('button', { name: 'حذف کالای موردنیاز 2', exact: true }).click();
    }
    await sheet.getByRole('button', { name: 'تأیید و ساختِ مراجعه', exact: true }).click(); await sheet.waitFor({ state: 'detached' });
    const approved = writes.find(w => w.path.endsWith('/approve'));
    pass(approved?.data.extra.caseNote === 'تکمیل پذیرش', 'approval submits editable custom definition field');
    if (profile === 'implant') pass(approved.data.requiredItems[0].quantity === 7 && approved.data.requiredItems.length === 1, 'approval submits chosen requirement quantities');
    if (profile !== 'clinic') {
      await page.goto(`${base}/app/surgeon`); await page.locator('.sp-list .sp-card').waitFor();
      await page.getByText('دستور جراح و آماده‌سازی بیمار', { exact: true }).click();
      const editor = page.locator('.sp-list .assisted-text');
      await editor.locator(':scope > textarea').fill('دستور اصلی');
      await editor.getByRole('button', { name: 'اصلاح و ساختاربندی', exact: true }).click(); await editor.locator('.assisted-proposal').waitFor();
      pass(await editor.locator(':scope > textarea').inputValue() === 'دستور اصلی', 'surgeon AI proposal preserves source until accepted');
      await editor.getByRole('button', { name: 'اعمال پیشنهاد', exact: true }).click();
      pass(await editor.getByRole('button', { name: 'دیکته با میکروفون', exact: true }).count() === 1, 'surgeon voice entry available');
      await page.getByRole('button', { name: 'ثبت دستور', exact: true }).click();
      await page.getByText('دستور و نیازهای بیمار ثبت شد و در آماده‌سازی تیم دیده می‌شود', { exact: true }).waitFor();
      pass(instructions === 'دستور مرتب شده', 'reviewed instructions persist');
      assert.equal(Object.hasOwn(writes.find(w => w.path.endsWith('/instructions')).data, 'requiredItems'), false, 'text-only editing preserves inherited item defaults');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      pass(!overflow, `surgeon portal fits viewport ${viewport.width}`);
    }
    pass(errors.length === 0, `${profile}: no React errors: ${errors.join(', ')}`);
    await ctx.close();
  }
  console.log(`${count} profile browser scenarios passed`);
} finally { await browser?.close(); vite.kill('SIGTERM'); }
