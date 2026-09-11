/** Mobile directory workflows against HTTP fixtures; no live mutations. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
const base = 'http://127.0.0.1:5210';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5210', '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 80; i++) { if (await fetch(base).then(r => r.ok).catch(() => false)) break; await delay(100); }
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fa-IR', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await ctx.addCookies([{ name: 'amalyar_csrf', value: 'fixture-tenant', url: base }, { name: 'amalyar_platform_csrf', value: 'fixture-platform', url: base }]);
  const writes = [], errors = [], searches = [];
  const row = { id: 'fixture-one', name: 'بیمارستان نمونه', province: 'تهران', city: 'تهران', address: 'خیابان نمونه', phone: '02112345678', sector: 'private', active: true, sourceUrl: 'https://example.org', sourceName: 'منبع تست', verified: true, candidates: [] };
  let linked = false;
  await ctx.route('**/api/**', async route => {
    const req = route.request(), u = new URL(req.url()), path = u.pathname.replace(/^\/api/, ''), method = req.method();
    const payload = method !== 'GET' && req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null;
    if (method !== 'GET') writes.push({ path, payload, csrf: req.headers()['x-csrf-token'] });
    let body = [];
    if (path === '/auth/me') body = { id: 1, level: 6, status: 'active', firstName: 'مدیر', lastName: 'تست' };
    else if (path === '/config') body = { vertical: 'ionm', brand: { name: 'شرکت تست' } };
    else if (path === '/features') body = [{ key: 'definitions', allowed: true }];
    else if (path === '/platform/auth/me') body = { ok: true };
    else if (path === '/platform/snapshot') body = { tenants: [], jobs: [], deletions: [] };
    else if (path === '/hospitals') body = linked ? [{ ...row, id: 12 }] : [];
    else if ((path === '/hospitals/directory' || path === '/platform/hospitals') && method === 'GET') {
      searches.push(u.search);
      const q = u.searchParams.get('q');
      if (q === 'قدیمی') await delay(900);
      body = { rows: [{ ...row, name: q === 'جدید' ? 'بیمارستان جدید' : row.name, localId: linked ? 12 : null }], total: 1, page: 1, pages: 1, provinces: [{ name: 'تهران', count: 1 }], coverage: { total: 1, verified: 1 } };
    } else if (path === '/hospitals/directory/import') { linked = true; body = { created: payload.fillMissing ? 0 : 1, linked: payload.fillMissing ? 1 : 0, pending: 0 }; }
    else if (path === '/platform/hospitals') body = { ...row, ...payload };
    await route.fulfill({ json: body });
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/app/definitions?section=hospitals`);
  await page.getByText('دریافت از فهرست مرکزی بیمارستان‌ها', { exact: true }).click();
  await page.getByLabel('فیلتر نوع بیمارستان', { exact: true }).selectOption('private');
  await delay(350); assert.ok(searches.some(q => q.includes('sector=private')));
  await page.getByRole('checkbox', { name: 'دریافت بیمارستان نمونه' }).check();
  await page.getByRole('button', { name: 'دریافت انتخاب‌شده‌ها (1)' }).click();
  await page.getByText('در تعاریف شرکت ثبت شده').waitFor();
  assert.deepEqual(writes.find(w => w.path === '/hospitals/directory/import').payload.ids, ['fixture-one']);
  assert.equal(writes[0].csrf, 'fixture-tenant');
  await page.getByRole('button', { name: 'تکمیل فیلدهای خالی بیمارستان نمونه' }).click();
  await delay(300); assert.equal(writes.filter(w => w.path === '/hospitals/directory/import').at(-1).payload.fillMissing, true);
  console.log('PASS: mobile tenant import and explicit fill-empty request, with CSRF');
  await page.getByLabel('نام یا نشانی', { exact: true }).fill('قدیمی'); await delay(350);
  await page.getByLabel('نام یا نشانی', { exact: true }).fill('جدید'); await delay(1250);
  assert.equal(await page.locator('.df-directory-row b').innerText(), 'بیمارستان جدید');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  console.log('PASS: older search cannot replace latest result; no mobile horizontal overflow');
  await page.goto(`${base}/platform-admin`);
  await page.getByRole('button', { name: 'افزودن بیمارستان مرکزی', exact: true }).click();
  await page.locator('.df-directory-form').getByLabel('نام', { exact: true }).fill('بیمارستان مرکزی تست');
  await page.locator('.df-directory-form').getByLabel('تلفن', { exact: true }).fill('02112345678');
  await page.getByRole('button', { name: 'ذخیره بیمارستان مرکزی', exact: true }).click();
  await page.getByText('اطلاعات مرکزی ذخیره شد؛ ویرایش‌های شرکت‌ها حفظ می‌شود.').waitFor();
  const saved = writes.find(w => w.path === '/platform/hospitals');
  assert.equal(saved.payload.name, 'بیمارستان مرکزی تست'); assert.equal(saved.csrf, 'fixture-platform');
  assert.deepEqual(errors, []);
  console.log('PASS: central operator creates hospital using platform CSRF; no React errors');
} finally { await browser?.close(); vite.kill('SIGTERM'); }
