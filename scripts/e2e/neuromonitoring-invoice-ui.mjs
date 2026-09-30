/** Actual mobile/desktop billing UI and paginated print, with isolated HTTP fixtures. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
const base = 'http://127.0.0.1:5203';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5203', '--strictPort'], { stdio: 'ignore' });
let browser, count = 0;
const check = (v, name) => { assert.ok(v, name); console.log(`PASS ${++count}: ${name}`); };
const hasTool = (bin) => { try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; } catch { return false; } };
try {
  for (let i = 0; i < 80; i++) { if (await fetch(base).then(r => r.ok).catch(() => false)) break; await delay(100); }
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce', locale: 'fa-IR', serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      const open = window.open.bind(window);
      window.open = (...args) => { const w = open(...args); if (w) w.print = () => { w.__printed = true; }; return w; };
    });
    const errors = [], writes = [];
    const bank = { id: 1, ownerName: 'شرکت دریافت‌کننده', bankName: 'بانک تست', classification: 'formal', active: true, accountNumber: '123456' };
    const visit = { id: 1, patientId: 1, kind: 'surgery', code: 'AM-LOCAL-V1', firstName: 'بیمار', lastName: 'آزمایشی', fullName: 'بیمار آزمایشی', opDate: '2026-09-08', surgeonName: 'جراح تست', hospitalName: 'مرکز دولتی', total: 30001000, paid: 30000000, due: 1000 };
    let bill = { charges: [{ id: 1, title: 'خدمت اولیه', kind: 'service', quantity: 1, unitPrice: 30000000, amount: 30000000 }, { id: 2, title: 'قلم اضافه', kind: 'service', quantity: 1, unitPrice: 1000, amount: 1000 }], payments: [{ id: 1, paidAt: '2026-09-08', method: 'transfer', amount: 30000000 }], total: 30001000, paid: 30000000, due: 1000, pricingModel: 'coded', invoiceType: 'formal', invoiceBankAccount: bank, tariffSector: 'public' };
    // کاتالوگِ ملک‌طب: چهار خدمتِ پیش‌فرض (EMG-901290، MEP، SEP، Monitoring) + یک مصرفیِ پرتکرار.
    const catalog = {
      hours: 3, year: '1405', sector: 'public', deviceOwner: 'company', documents: [],
      services: [
        { id: '901275:EMG', code: '901275', label: 'EMG', title: 'الکترومیوگرافی', defaultOn: false },
        { id: '901290:EMG', code: '901290', label: 'EMG', title: 'الکترومیوگرافی ۲', defaultOn: true },
        { id: '901325:MEP', code: '901325', label: 'MEP', title: 'پتانسیل حرکتی', defaultOn: true },
        { id: '901320:SEP', code: '901320', label: 'SEP', title: 'پتانسیل حسی', defaultOn: true },
        { id: '901320:VEP', code: '901320', label: 'VEP', title: 'پتانسیل حسی', defaultOn: false },
        { id: '901365:EEG', code: '901365', label: 'EEG', title: 'الکتروانسفالوگرافی', defaultOn: false },
        { id: '901385:MAPPING', code: '901385', label: 'MAPPING', title: 'نقشه‌برداری', defaultOn: false },
        { id: '901300:Monitoring', code: '901300', label: 'Monitoring', title: 'مانیتورینگ', defaultOn: true },
      ],
      consumables: [{ name: 'Electrode', irc: '9449874222229990', qty: 40 }],
    };
    /* company-14 / DF2 / DF3: قلمِ مبلغِ کلِ مراجعه (همان «خدمت اولیه»ِ ثبت‌نام) و پرچم‌های سرور — از حالِ `bill`. */
    const LUMP = { id: 1, title: 'خدمت اولیه', kind: 'service', quantity: 1, unitPrice: 30000000, amount: 30000000 };
    const lumpInfo = () => {
      const lump = bill.charges.filter(c => c.id === LUMP.id), neuro = bill.charges.some(c => c.neuroDetail && !c.neuroDetail.consumable);
      return { lumpLines: lump.map(c => ({ id: c.id, title: c.title, amount: c.amount })), lumpBesideNeuro: lump.length > 0 && neuro, lumpKept: false, lumpDefault: lump.length ? (bill.paid > 0 ? null : 'replace') : null };
    };
    const priceOf = (id, hours) => ({ professional: 1515 * hours, technical: 1482 * hours, total: 2997 * hours });
    /* شکلِ `withPayState(summarize())`ِ سرور — ساختگیِ آزمون، نه فرمولِ کلاینت. */
    const sum = (charges) => { const total = charges.reduce((a, c) => a + c.amount, 0), due = total - bill.paid; return { total, itemsTotal: total, paid: bill.paid, due, payState: due > 0 ? 'due' : due < 0 ? 'overpaid' : 'settled', payStateFa: due > 0 ? 'مانده' : due < 0 ? 'اضافه‌پرداخت' : 'تسویه', overpaid: due < 0 ? -due : 0 }; };
    const quoteFor = (p) => {
      const items = p.items.map(id => { const s = catalog.services.find(x => x.id === id); return { id, code: s.code, label: s.label, title: s.title, hours: p.hours, deviceOwner: p.deviceOwner, coefficients: { professional: 15, technical: 7.3 }, factors: { professional: 101, technical: 203 }, ...priceOf(id, p.hours), tariff: { year: p.year, sector: 'public', sectorLabel: 'دولتی' } }; });
      const after = (replace) => sum([...bill.charges.filter(c => !c.neuroDetail && !replace.includes(c.id)), ...items.map(it => ({ amount: it.total }))]);
      const lump = lumpInfo().lumpLines.map(c => c.id);
      return { items, total: items.reduce((a, b) => a + b.total, 0), billing: { before: sum(bill.charges), after: after(p.replace ?? []), ...(lump.length ? { options: { replace: after(lump), keep: after([]) } } : {}) } };
    };
    let doc = null;
    await ctx.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname.replace(/^\/api/, ''), method = req.method();
      const payload = method !== 'GET' && req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null;
      if (method !== 'GET') writes.push({ path, method, payload });
      let body = [];
      if (path === '/auth/me') body = { id: 1, level: 6, status: 'active', firstName: 'مدیر', lastName: 'تست' };
      else if (path === '/auth/accounts') body = [];
      else if (path === '/config') body = { vertical: 'ionm', brand: { name: 'عملیار' } };
      else if (path === '/features') body = ['dashboard', 'formgen', 'accounting', 'definitions'].map(key => ({ key, allowed: true }));
      else if (path === '/forms/visit-kinds') body = [{ key: 'surgery', kind: 'surgery', title: 'عمل' }];
      else if (path === '/visits') body = { rows: [visit], total: 1, pages: 1, stats: { total: 1, kinds: [] } };
      else if (path === '/visits/1') body = visit;
      else if (path === '/visits/1/billing') body = bill;
      else if (path === '/bank-accounts') body = [bank];
      else if (path === '/ai/status') body = { enabled: false };
      else if (path === '/visits/charges/2' && method === 'DELETE') { bill = { ...bill, charges: bill.charges.filter(c => c.id !== 2), total: 30000000, due: 0 }; body = { ok: true }; }
      else if (path === '/visits/1/billing/invoice-account') { bill = { ...bill, invoiceType: payload.invoiceType, invoiceBankAccount: payload.bankAccountId === bank.id ? bank : null }; body = bill; }
      else if (path === '/visits/1/invoices/neuro-catalog') body = { ...catalog, ...lumpInfo() };
      else if (path === '/visits/1/invoices/neuro-quote') body = quoteFor(payload);
      else if (path === '/visits/1/invoices/neuro-apply') {
        const q = quoteFor(payload);
        const rows = q.items.map((it, i) => ({ id: 10 + i, kind: 'service', title: `${it.label} — ${it.title}`, serviceCode: it.code, quantity: 1, unitPrice: it.total, amount: it.total, neuroDetail: it }));
        const cons = (payload.consumables ?? []).map((c, i) => ({ id: 50 + i, kind: 'item', title: c.name, quantity: c.qty, unitPrice: 0, amount: 0, notes: c.irc, neuroDetail: { consumable: true, irc: c.irc, qty: c.qty } }));
        const kept = bill.charges.filter(c => !c.neuroDetail && !(payload.replace ?? []).includes(c.id));
        const total = kept.reduce((a, c) => a + c.amount, 0) + q.total;
        bill = { ...bill, charges: [...kept, ...rows, ...cons], total, due: total - bill.paid };
        body = { applied: rows.length, consumables: cons.length, total: q.total, billing: bill };
      }
      else if (path === '/visits/1/invoices') {
        if (method === 'POST') { doc ??= { id: 1, number: 'NM-F-000001', variant: 'formal', createdAt: '2026-09-08', snapshot: { visit, billing: structuredClone(bill), template: { title: 'صورتحساب نورومانیتورینگ', brand: { legalName: 'شرکت نورومانیتورینگ تست', registration: '98765' }, notes: 'توضیحات اختصاصی شرکت', signatures: ['تنظیم‌کننده', 'مهر شرکت'], showPayments: true } } }; body = doc; }
        else body = { hours: 3, year: '1405', sector: 'public', documents: doc ? [doc] : [], ...lumpInfo() };
      }
      else if (path === '/visits/1/invoices/1') body = doc;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/app/dashboard`); await page.getByTitle('صورت‌حساب', { exact: true }).click();
    const sheet = page.locator('.bl-sheet'); await sheet.waitFor();
    // ⚠️ شیت پیش از رسیدنِ داده رندر می‌شود؛ بدونِ این انتظار شمارشِ دکمه‌ها گاهی صفر بود (flake).
    await sheet.locator('.bl-charge-list').waitFor();
    const del = sheet.getByRole('button', { name: 'حذف قلم قلم اضافه', exact: true });
    check(await del.count() === 1, `explicit charge deletion action exists (${viewport.width})`);
    check(await sheet.locator('.bl-charge-list').evaluate(el => !!(el.compareDocumentPosition(document.querySelector('.bl-add')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'registered items precede the add form');
    await del.scrollIntoViewIfNeeded(); const box = await del.boundingBox(); check(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= viewport.width, 'delete target is visible and touch-sized');
    await del.click(); await del.waitFor({ state: 'detached' });
    check(bill.paid === 30000000 && bill.due === 0, 'deleting an extra charge retains the recorded payment');

    // ── پاپ‌آپِ یک‌جا (الگوی ملک‌طب) ──────────────────────────────────────
    await sheet.getByRole('tab', { name: 'صدور فاکتور', exact: true }).click();
    await sheet.getByRole('button', { name: 'انتخابِ خدمات و مصرفی‌ها', exact: true }).click();
    const dlg = page.locator('.nv-sheet'); await dlg.waitFor();
    await dlg.locator('.nv-svc').first().waitFor();
    check(await dlg.locator('.nv-svc input:checked').count() === 4, 'company defaults (EMG, MEP, SEP, Monitoring) are pre-ticked');
    check(await dlg.locator('.nv-svc').count() === 8, 'all eight neuromonitoring services are selectable at once');
    check(await dlg.getByLabel('مدت قابل صورتحساب').inputValue() === '3', 'visit duration prefills the hours');
    await dlg.locator('.nv-total b').filter({ hasText: 'تومان' }).waitFor();
    /* DF2: قلمِ ثبت‌نامِ پرداخت‌شده — هیچ راهی پیش‌انتخاب نیست؛ پیامدِ هر دو راه پیش از انتخاب دیده می‌شود. */
    const saveBtn = dlg.getByRole('button', { name: 'ثبتِ خدمات روی صورت‌حساب', exact: true });
    await dlg.locator('.nv-opts').waitFor();
    check(await saveBtn.isDisabled() && await dlg.locator('[role="radio"][aria-checked="true"]').filter({ hasText: /جایگزین|کنارش/ }).count() === 0, 'DF2: a paid registration line is not replaced by default — saving waits for an explicit choice');
    check((await dlg.locator('.nv-opts').innerText()).includes('اضافه‌پرداخت'), 'DF2: each choice shows the resulting bill before choosing (replacing leaves an overpayment)');
    await dlg.getByRole('radio', { name: 'جایگزینِ همین قلم شود', exact: true }).click();
    await dlg.locator('.nv-after').filter({ hasText: 'اضافه‌پرداخت' }).waitFor();
    check(!(await saveBtn.isDisabled()), 'DF2: after choosing, the footer previews the bill after saving and saving is enabled');
    const before = await dlg.locator('.nv-total b').innerText();
    await dlg.getByLabel('SEP 901320').uncheck();
    await page.waitForFunction((prev) => document.querySelector('.nv-total b')?.innerText !== prev && document.querySelector('.nv-total b')?.innerText.includes('تومان'), before);
    check(true, 'untick refreshes the live total from the server quote');
    check((await dlg.locator('.nv-con').first().innerText()).includes('Electrode'), 'frequent consumable is listed with its IRC');
    await dlg.getByLabel('بیشتر Electrode').click();
    check(await dlg.getByLabel('تعداد Electrode').inputValue() === '41', 'consumable quantity steps up without typing');
    await dlg.getByRole('button', { name: 'ثبتِ خدمات روی صورت‌حساب', exact: true }).click();
    await dlg.waitFor({ state: 'detached' });
    const sent = writes.find(w => w.path.endsWith('neuro-apply')).payload;
    assert.deepEqual(Object.keys(sent).sort(), ['consumables', 'deviceOwner', 'hours', 'items', 'keep', 'replace', 'returnUnusedStock', 'year']);
    /* company-14 / DF2: «جایگزینِ همین قلم» که کاربر صریحاً زد — فقط شناسه می‌رود، نه مبلغ. */
    assert.deepEqual(sent.replace, [1]); assert.deepEqual(sent.keep, []);
    check(!bill.charges.some(c => c.id === 1), 'the registration lump line is replaced, not counted twice beside the neuro services');
    assert.deepEqual(sent.items, ['901290:EMG', '901325:MEP', '901300:Monitoring']);
    assert.deepEqual(sent.consumables, [{ name: 'Electrode', irc: '9449874222229990', qty: 41 }]);
    check(true, 'browser submits selection, duration and consumables — never financial totals');
    check(!writes.some(w => w.path.endsWith('neuro-service')), 'one bulk request instead of one call per service');
    await sheet.getByText('EMG · MEP · Monitoring', { exact: false }).waitFor();
    check(true, 'panel summarises what is on the invoice after applying');
    await page.screenshot({ path: `../invoice-builder-${viewport.width}.png`, fullPage: true, animations: 'disabled', timeout: 30000 });

    const popupWait = page.waitForEvent('popup');
    await sheet.getByRole('button', { name: 'صدور و چاپ فاکتور رسمی', exact: true }).click();
    const popup = await popupWait;
    await popup.getByText('شرکت نورومانیتورینگ تست', { exact: true }).waitFor();
    const text = await popup.locator('body').innerText();
    check(text.includes('NM-F-000001') && text.includes('شرکت دریافت‌کننده') && text.includes('حرفه‌ای') && text.includes('فنی'), 'issued print includes serial, bank and separate tariff shares');
    check(text.includes('اقلام استفاده‌شده') && text.includes('Electrode') && text.includes('9449874222229990'), 'consumables print in their own table with IRC, like the reference invoice');
    check(!/عملیار|عمل‌یار/.test(text), 'invoice has no platform branding');
    check(text.includes('توضیحات اختصاصی شرکت') && text.includes('مهر شرکت') && text.includes('به حروف'), 'company template notes, signatures and words are printed');
    await popup.waitForFunction(() => document.fonts.check('10px InvoiceFa', 'فاکتور'), null, { timeout: 10000 });
    check(true, 'local Persian font is ready');
    await popup.screenshot({ path: `../invoice-print-${viewport.width}.png`, fullPage: true, animations: 'disabled', timeout: 30000 });
    if (hasTool('pdfinfo') && hasTool('pdftotext')) {
      const longDoc = structuredClone(doc); longDoc.snapshot.billing.charges = Array.from({ length: 90 }, (_, i) => ({ ...bill.charges[0], title: `خدمت ردیف ${i + 1}` }));
      longDoc.snapshot.template.notes = 'END-OF-INVOICE';
      const longHtml = await page.evaluate(async d => { const { issuedInvoiceHtml, loadInvoiceFonts } = await import('/src/app/invoice-print.js'); return issuedInvoiceHtml(d, null, await loadInvoiceFonts()); }, longDoc);
      await popup.setContent(longHtml); await popup.evaluate(() => document.fonts.ready);
      const pdf = `../invoice-long-${viewport.width}.pdf`;
      await popup.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
      const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
      check(Number(info.match(/Pages:\s+(\d+)/)[1]) > 1, 'long invoice paginates instead of clipping');
      check(execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' }).includes('END-OF-INVOICE'), 'last content survives PDF pagination');
    } else console.log('  ⚠ pdfinfo/pdftotext نیست — سنجهٔ صفحه‌بندیِ PDF رد نشد، اجرا نشد');
    await popup.close();
    await sheet.getByRole('button', { name: 'چاپ نسخه', exact: true }).waitFor();
    const reprintWait = page.waitForEvent('popup'); await sheet.getByRole('button', { name: 'چاپ نسخه', exact: true }).click();
    const reprint = await reprintWait; await reprint.getByText('شرکت نورومانیتورینگ تست', { exact: true }).waitFor();
    check(writes.filter(w => w.path === '/visits/1/invoices').length === 1, 'history reprint does not issue another document'); await reprint.close();

    // ── DF3: قلمِ ثبت‌نام کنارِ خدماتِ ریزشده، بی‌انتخابِ صریح — پنل هشدار می‌دهد و راهِ «جایگزینی» دارد ──
    bill = { ...bill, charges: [LUMP, ...bill.charges] };
    await sheet.getByRole('tab', { name: /^اقلام/ }).click();
    await sheet.getByRole('tab', { name: 'صدور فاکتور', exact: true }).click();
    const warn = sheet.locator('.nv-double'); await warn.waitFor();
    check((await warn.innerText()).includes('دوبار شمرده'), 'DF3: a registration line beside itemised services is flagged as a likely double count');
    await warn.getByRole('button', { name: 'جایگزینیِ قلمِ ثبت‌نام', exact: true }).click();
    await dlg.waitFor(); await dlg.locator('.nv-lump').waitFor();
    check(await dlg.getByRole('radio', { name: 'جایگزینِ همین قلم شود', exact: true }).getAttribute('aria-checked') === 'true', 'DF3: the warning opens the services dialog with "replace" chosen, preview first');
    await dlg.getByRole('button', { name: 'بستن', exact: true }).click(); await dlg.waitFor({ state: 'detached' });

    // ── DF1: مراجعهٔ ایمپلنت در شرکتِ دوخدمته پنجرهٔ خدماتِ نورو (و «جایگزین») را نمی‌گیرد ──
    visit.service = 'implant';
    /* DF9 (همین بارگذاری): حسابِ فاکتور هنوز ثبت نشده و پرداخت به حسابِ رسمیِ ۱ رفته — پیشنهادِ پیش‌فرض. */
    bill = { ...bill, invoiceType: null, invoiceBankAccount: null, payments: bill.payments.map(p => ({ ...p, bankAccountId: bank.id })) };
    await page.goto(`${base}/app/dashboard`); await page.getByTitle('صورت‌حساب', { exact: true }).click();
    await sheet.waitFor(); await sheet.getByRole('tab', { name: 'صدور فاکتور', exact: true }).click();
    await sheet.getByRole('heading', { name: 'فاکتور شرکت', exact: true }).waitFor();
    check(await sheet.getByRole('button', { name: /انتخابِ خدمات و مصرفی‌ها|ویرایشِ خدمات و مصرفی‌ها/ }).count() === 0 && await sheet.locator('.nv-double').count() === 0, 'DF1: an implant visit gets no neuro services dialog — its lump line cannot be replaced');

    // ── DF9: ثبتِ حسابِ پیشنهادی (از حسابِ پرداخت) کشویی‌ها را خالی نمی‌کند ──
    const acctType = sheet.getByLabel('نوع فاکتور', { exact: true }), acctBank = sheet.getByLabel('حساب فاکتور', { exact: true });
    check(await acctType.inputValue() === 'formal' && await acctBank.inputValue() === String(bank.id), 'DF9: the payment account is suggested as the invoice account');
    await sheet.getByRole('button', { name: 'ثبت اتصال حساب', exact: true }).click();
    await sheet.getByText('حساب ثبت‌شده:', { exact: false }).waitFor();
    check(await acctType.inputValue() === 'formal' && await acctBank.inputValue() === String(bank.id), 'DF9: after saving, both selects keep the saved type and account');
    check(!errors.length, `no runtime errors: ${errors.join('; ')}`);
    await ctx.close();
  }
  console.log(`${count} invoice UI/print checks passed`);
} finally { if (browser) await browser.close(); vite.kill('SIGTERM'); }
