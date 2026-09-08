/** Real responsive UI; deterministic API fixtures. No real SMS, payments, or AI calls. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
const base = 'http://127.0.0.1:5201';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5201', '--strictPort'], { stdio: 'ignore' });
let browser, count = 0;
const check = (value, name) => { assert.ok(value, name); console.log(`PASS ${++count}: ${name}`); };
try {
  for (let i = 0; i < 80; i++) { if (await fetch(base).then((r) => r.ok).catch(() => false)) break; await delay(100); }
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROME ?? '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport, locale: 'fa-IR', serviceWorkers: 'block', permissions: ['microphone'] });
    await ctx.addInitScript(() => localStorage.setItem('amalyar_token', 'test-only'));
    const writes = [], errors = [];
    const hospitals = [{ id: 1, name: 'بیمارستان اول', active: true }];
    const banks = [{ id: 1, ownerName: 'شرکت رسمی', bankName: 'تست', classification: 'formal', active: true }];
    let form = { id: 1, key: 'visit.surgery', title: 'عمل', scope: 'visit', visitKind: 'surgery', color: 'violet', active: true, pages: 1, fields: [{ id: 11, key: 'sharedNote', label: 'شرح مشترک', type: 'textarea', role: 'doctor', roles: ['doctor'], roleLabel: 'پزشک', active: true, page: 1, sort: 10, options: [] }] };
    let visit = { id: 1, patientId: 1, firstName: 'تست', lastName: 'محلی', code: 'AM-001', seq: 1, kind: 'clinic', total: 30000000, paid: 30000000, due: 0, opDate: '2026-09-10', opReport: '', decisions: [] };
    let bill = { charges: [], payments: [], total: 0, paid: 0, due: 0, pricingModel: 'coded', tariffSector: 'public', invoiceType: null, invoiceBankAccount: null };
    let aiReply = { text: 'متن مرتب پیشنهادی' };
    await ctx.route('**/api/**', async (route) => {
      const req = route.request(), path = new URL(req.url()).pathname.replace(/^\/api/, ''), method = req.method();
      const payload = method !== 'GET' && req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null;
      if (method !== 'GET') writes.push({ path, body: payload });
      let body = [];
      if (path === '/auth/me') body = { id: 1, level: 6, firstName: 'تست', lastName: 'مدیر', status: 'active' };
      else if (path === '/config') body = { vertical: 'clinic', brand: {} };
      else if (path === '/features') body = ['dashboard', 'formgen', 'accounting', 'definitions'].map((key) => ({ key, allowed: true }));
      else if (path === '/intake/submissions') body = [{ id: 1, token: 'fixture', patientId: 1, amount: 30000000, payable: 30000000, status: 'pending_approval', makesVisit: true, data: { firstName: 'تست', lastName: 'پرداخت' } }];
      else if (path.endsWith('/approve')) body = { ok: true, visitId: 1, visitCode: 'AM-001-V1' };
      else if (path === '/hospitals') { if (method === 'POST') { body = { ...payload, id: 51, active: true }; hospitals.push(body); } else body = hospitals; }
      else if (path === '/bank-accounts') { if (method === 'POST') { body = { ...payload, id: 52, active: true }; banks.push(body); } else body = banks; }
      else if (path === '/partners') body = [{ id: 2, name: 'شریک تست', active: true }];
      else if (path === '/forms/fields/11') { form = { ...form, fields: [{ ...form.fields[0], ...payload, role: payload.roles?.[0] ?? null }] }; body = form; }
      else if (path === '/forms') body = [form];
      else if (path === '/forms/visit-kinds') body = [{ key: 'clinic', kind: 'clinic', title: 'ویزیت' }, { key: 'surgery', kind: 'surgery', title: 'عمل' }];
      else if (path.startsWith('/forms/visit.')) body = { fields: [
        { key: 'amount', builtin: true, active: true, required: true, type: 'money', label: 'مبلغ (تومان)' },
        { key: 'opDate', builtin: true, active: true, required: true, type: 'date', label: 'تاریخ عمل' },
        { key: 'notes', builtin: true, active: true, required: true, label: 'یادداشت' },
      ] };
      else if (path === '/ai/status') body = { enabled: true, stt: true };
      else if (path === '/ai/text-draft') { await delay(150); body = aiReply; }
      else if (path === '/ai/transcribe') body = { text: 'متن دیکته آزمایشی' };
      else if (path === '/visits/1/billing') body = bill;
      else if (path === '/visits/1/invoices') body = { year: '1405', hours: null, documents: [] };
      else if (path === '/visits/1/billing/invoice-account') { bill = { ...bill, invoiceType: payload.invoiceType, invoiceBankAccount: banks.find((b) => b.id === payload.bankAccountId) }; body = bill; }
      else if (path === '/settings/letterhead') return route.fulfill({ status: 404, body: '' });
      else if (path === '/visits/1') { if (method === 'PATCH') visit = { ...visit, ...payload }; body = visit; }
      else if (path === '/visits') body = { rows: [visit], total: 1, pages: 1, stats: { total: 1, kinds: [] } };
      else if (path === '/care-plan/timing') body = {};
      else if (path === '/reports/financial') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"داده گزارش در این آزمون لازم نیست"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/app/intake`);
    await page.locator('.ia-card .ia-ok').click();
    const approval = page.locator('.ia-sheet'); await approval.waitFor();
    await page.locator('#approve-hospitalId').selectOption('1');
    await approval.locator('.ia-pay select').selectOption('1');
    check(await approval.getByRole('button', { name: 'افزودن کارشناس', exact: true }).count() === 1, 'superadmin can add technician inside approval');
    await approval.getByRole('button', { name: 'افزودن بیمارستان', exact: true }).click();
    const quick = page.locator('.df-quick-overlay'); await quick.waitFor(); await delay(450);
    const box = await quick.locator('.df-sheet').boundingBox();
    check(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `quick definition fits viewport ${viewport.width}`);
    await quick.getByLabel('نام مرکز', { exact: false }).fill('بیمارستان جدید');
    await quick.getByLabel('نوع بیمارستان / تعرفه').selectOption('charity');
    await quick.getByRole('button', { name: 'ذخیره', exact: true }).click();
    await quick.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('#approve-hospitalId')?.value === '51');
    check(await approval.locator('.ia-pay select').inputValue() === '1', 'quick add preserves selected payment bank');
    check(await page.locator('#approve-hospitalId').inputValue() === '51', 'new definition selected without leaving approval');
    check(writes.some((w) => w.path === '/hospitals' && w.body.sector === 'charity'), 'hospital sector sent to canonical definition endpoint');
    const shortcut = approval.locator('a[href*="section=hospitals"]');
    check(await shortcut.getAttribute('target') === '_blank', 'definition shortcut preserves approval page');
    await approval.getByRole('button', { name: 'تأیید و ساختِ مراجعه', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.ia-sheet'));
    check(writes.some((w) => w.path.endsWith('/approve') && w.body.registerPayment && w.body.bankAccountId === 1 && w.body.hospitalId === 51), 'approval transmits payment and new hospital selection');
    await page.goto(`${base}/app/forms`);
    await page.locator('.fb-role-choices').getByLabel('منشی', { exact: true }).check();
    await page.locator('.fb-role-choices').getByLabel('کارشناس', { exact: true }).check();
    check(form.fields[0].roles.includes('doctor') && form.fields[0].roles.includes('secretary') && form.fields[0].roles.includes('technician'), 'form builder preserves three simultaneously selected roles');
    check(await page.getByRole('button', { name: 'آماده‌سازی فرم پیگیری خودکار' }).count() === 1, 'follow-up preset discoverable from form builder');
    await page.goto(`${base}/app/dashboard?patient=1`);
    const editor = page.locator('.db-sheet .assisted-text').first(); await editor.waitFor();
    const source = editor.locator(':scope > textarea'); await source.fill('متن اصلی پزشک');
    await editor.getByRole('button', { name: 'اصلاح و ساختاربندی', exact: true }).click();
    await editor.locator('.assisted-proposal').waitFor();
    check(await source.inputValue() === 'متن اصلی پزشک', 'AI suggestion never automatically overwrites source');
    await editor.getByLabel('پیشنهاد قابل ویرایش دستیار').fill('پیشنهاد اصلاح‌شده دستی');
    await editor.getByRole('button', { name: 'اعمال پیشنهاد', exact: true }).click();
    check(await source.inputValue() === 'پیشنهاد اصلاح‌شده دستی', 'reviewed AI text applies explicitly');
    aiReply = { text: 'ادامه متن' };
    await editor.getByRole('button', { name: 'ادامه با AI', exact: true }).click();
    await editor.locator('.assisted-proposal').waitFor();
    check((await editor.getByLabel('پیشنهاد قابل ویرایش دستیار').inputValue()).startsWith('پیشنهاد اصلاح‌شده دستی\n'), 'continuation preserves existing text prefix');
    await source.fill('ویرایش در زمان انتظار');
    check(await editor.getByRole('button', { name: 'اعمال پیشنهاد', exact: true }).isDisabled(), 'stale AI cannot replace newly edited source');
    await editor.getByRole('button', { name: 'کنار گذاشتن', exact: true }).click();
    aiReply = { text: '' };
    await editor.getByRole('button', { name: 'اصلاح و ساختاربندی', exact: true }).click();
    await editor.getByRole('alert').waitFor();
    check(await source.inputValue() === 'ویرایش در زمان انتظار', 'empty response preserves manual content');
    await editor.getByRole('button', { name: 'دیکته با میکروفون', exact: true }).click();
    await editor.getByRole('button', { name: 'پایانِ ضبط', exact: true }).waitFor(); await delay(800);
    await editor.getByRole('button', { name: 'پایانِ ضبط', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.db-sheet .assisted-text > textarea')?.value.includes('متن دیکته آزمایشی'));
    check((await source.inputValue()).startsWith('ویرایش در زمان انتظار\n'), 'voice appends to current text without losing edits');
    await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.db-sheet'));
    check(writes.some((w) => w.path === '/visits/1' && w.body.notes?.includes('متن دیکته آزمایشی')), 'paid visit edit saves when amount is required but managed by billing');
    for (const state of [
      { kind: 'surgery', total: 30000000, paid: 30000000, due: 0 },
      { kind: 'clinic', total: 25000000, paid: 10000000, due: 15000000 },
      { kind: 'surgery', total: 40000000, paid: 10000000, due: 30000000, pricingModel: 'global', globalAmount: 40000000 },
      { kind: 'clinic', total: 0, paid: 0, due: 0 },
    ]) {
      visit = { ...visit, ...state };
      const beforeWrites = writes.length;
      await page.goto(`${base}/app/dashboard?patient=1`);
      const sheet = page.locator('.db-sheet');
      await sheet.getByLabel('وضعیت مالی ثبت‌شده').waitFor();
      check((await sheet.getByLabel('وضعیت مالی ثبت‌شده').innerText()).includes(state.total.toLocaleString('fa-IR')), `edit shows server invoice total ${state.total}`);
      const date = sheet.locator('.db-builtins .jd-row input').first();
      await date.fill('۱۴۰۵/۰۶/۲۰'); await date.blur();
      await sheet.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
      await sheet.waitFor({ state: 'detached' });
      assert.equal(visit.opDate, '2026-09-11');
      const saved = writes.slice(beforeWrites).find((w) => w.path === '/visits/1');
      assert.ok(saved); assert.equal(Object.hasOwn(saved.body, 'amount'), false);
      assert.equal(writes.slice(beforeWrites).filter((w) => /payment|charge|billing/.test(w.path)).length, 0);
      check(true, `date edit persists without financial writes (${state.kind}, ${state.total})`);
      await page.goto(`${base}/app/dashboard?patient=1`);
      await sheet.getByLabel('وضعیت مالی ثبت‌شده').waitFor();
      check(await sheet.locator('.db-builtins .jd-row input').first().inputValue() === '1405/06/20', 'saved date survives reopening');
    }
    const noteField = page.locator('.db-sheet .assisted-text > textarea').first();
    await noteField.fill('');
    const writesBeforeRequired = writes.length;
    await page.getByRole('button', { name: 'ذخیرهٔ تغییرات', exact: true }).click();
    await page.getByText('«یادداشت» را کامل کنید', { exact: true }).waitFor();
    check(!writes.slice(writesBeforeRequired).some((w) => w.path === '/visits/1'), 'required clinical fields still block empty edits');
    await page.goto(`${base}/app/dashboard`);
    await page.getByTitle('صورت‌حساب', { exact: true }).click();
    const billingPanel = page.locator('.bl-sheet'); await billingPanel.waitFor();
    await billingPanel.getByRole('tab', { name: 'صدور فاکتور', exact: true }).click();
    await billingPanel.getByLabel('نوع فاکتور', { exact: true }).selectOption('formal');
    await billingPanel.getByLabel('حساب فاکتور', { exact: true }).selectOption('1');
    await billingPanel.getByRole('button', { name: 'ثبت اتصال حساب', exact: true }).click();
    await billingPanel.getByText('حساب ثبت‌شده:', { exact: false }).waitFor();
    check(await billingPanel.getByRole('button', { name: 'صدور و چاپ فاکتور غیررسمی', exact: true }).count() === 0, 'formal invoice cannot be issued using informal action');
    check(await billingPanel.getByRole('button', { name: 'صدور و چاپ فاکتور رسمی', exact: true }).isDisabled(), 'empty invoice cannot be issued; print content tested by neuromonitoring-invoice-ui');
    await billingPanel.getByRole('tab', { name: /پرداخت‌ها/ }).click();
    check(await billingPanel.locator('select').filter({ has: page.locator('option[value="1"]') }).last().inputValue() === '1', 'linked invoice bank preselected for receipt');
    await page.goto(`${base}/app/accounting`);
    await page.getByRole('tab', { name: 'حساب‌های بانکی', exact: true }).click();
    await page.getByLabel('صاحبِ حساب *', { exact: true }).fill('حساب شریک تست');
    await page.getByLabel(/مالک حساب: شرکت یا شریک/).selectOption('2');
    await page.getByLabel(/نوع حساب برای فاکتور/).selectOption('informal');
    await page.getByRole('button', { name: 'افزودنِ حساب', exact: true }).click();
    await page.waitForFunction(() => document.body.textContent.includes('حساب اضافه شد'));
    check(writes.some((w) => w.path === '/bank-accounts' && w.body.partnerId === 2 && w.body.classification === 'informal'), 'bank creation combines partner ownership and invoice classification');
    check(errors.length === 0, `no React runtime errors (${viewport.width}): ${errors.join('; ')}`);
    await ctx.close();
  }
  console.log(`${count} browser scenarios passed`);
} finally { await browser?.close(); vite.kill(); }
