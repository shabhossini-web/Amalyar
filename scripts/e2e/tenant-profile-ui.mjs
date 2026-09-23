/**
 * تنظیماتِ شرکت — نوعِ نصب و بستهٔ خدمات. مرورگرِ واقعی، APIِ ساختگی؛ قراردادِ سرور را
 * `tenant-profile-write.mjs` می‌سنجد.
 *
 *  باید بیفتد:
 *   - هیچ نوشتنی پیش از «تأیید و ذخیره» (اول پیش‌نمایش، بعد ذخیره)
 *   - شرکتِ بی‌خدمت دکمهٔ بررسی را نمی‌گیرد و پیام می‌دهد
 *   - مطب بستهٔ خدمات ندارد و بدنه‌اش `services: []` است
 *  نباید بیفتد:
 *   - دو گزینهٔ نوع (نگهبانِ `settings-config.mjs` روی `.st-verticals button` ≥ ۲)
 *   - پیش‌نمایش ماژول‌های عوض‌شونده و هشدارِ لینک‌های زنده را نشان می‌دهد
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:5215';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5215', '--strictPort'], { stdio: 'ignore' });
let browser, count = 0;
const pass = (v, name, detail = '') => { assert.ok(v, `${name}${detail ? ' — ' + detail : ''}`); console.log(`PASS ${++count}: ${name}`); };
const KINDS = [{ key: 'clinic', label: 'مطب / کلینیک' }, { key: 'company', label: 'شرکتی' }];
const CATALOG = [{ key: 'ionm', label: 'نورومانیتورینگ' }, { key: 'implant', label: 'ایمپلنت و تجهیزات' }];

try {
  for (let i = 0; i < 80; i++) { if (await fetch(base).then((r) => r.ok).catch(() => false)) break; await delay(100); }
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROME ?? '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fa-IR', serviceWorkers: 'block' });
  const writes = [], errors = [];
  let profile = { kind: 'company', services: ['ionm'] };
  await ctx.route('**/api/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^\/api/, ''), method = req.method();
    const data = method !== 'GET' && req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null;
    if (method !== 'GET') writes.push({ path, method, data });
    let body = [];
    if (path === '/auth/me') body = { id: 1, level: 6, status: 'active', firstName: 'مدیر', lastName: 'تست' };
    else if (path === '/config') body = { vertical: profile.kind === 'clinic' ? 'clinic' : profile.services[0], ...profile, kinds: KINDS, serviceCatalog: CATALOG, brand: {} };
    else if (path === '/features') body = [{ key: 'dashboard', allowed: true }];
    else if (path === '/service-codes/status') body = { total: 0, version: null };
    else if (path === '/config/profile/preview') body = {
      same: false, vocabularyChanges: false,
      before: { label: 'شرکتی — نورومانیتورینگ' }, after: { kind: data.kind, services: data.services, label: 'شرکتی — نورومانیتورینگ و ایمپلنت و تجهیزات' },
      changes: [{ key: 'inventory', action: 'relevel', label: 'انبار' }],
      removed: [{ service: 'ionm', label: 'نورومانیتورینگ', links: 2, open: 1 }],
    };
    else if (path === '/config/profile' && method === 'PATCH') { profile = { kind: data.kind, services: data.services }; body = { ok: true }; }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/app/settings`);
  await page.locator('.st-verticals button').first().waitFor();

  pass(await page.locator('.st-verticals button').count() === 2, 'دو گزینهٔ نوع: مطب/کلینیک و شرکتی');
  pass(await page.getByRole('radio', { name: /شرکتی/ }).getAttribute('aria-checked') === 'true', 'شرکتی انتخاب‌شده است');
  const box = (name) => page.getByRole('checkbox', { name: new RegExp(name) });
  pass(await box('نورومانیتورینگ').getAttribute('aria-checked') === 'true' && await box('ایمپلنت').getAttribute('aria-checked') === 'false', 'بستهٔ فعلی: فقط نورومانیتورینگ');

  await box('ایمپلنت').click();
  await page.getByRole('button', { name: 'بررسیِ تغییرات' }).click();
  const region = page.getByRole('region', { name: /پیش‌نمایش/ });
  await region.waitFor();
  pass(writes.every((w) => w.path !== '/config/profile'), '**پیش از تأیید هیچ PATCHی نرفت**', JSON.stringify(writes.map((w) => w.path)));
  pass(/انبار/.test(await region.innerText()) && /۲ لینکِ فعال/.test(await region.innerText()), 'پیش‌نمایش ماژول و لینک‌های زنده را می‌گوید', await region.innerText());
  await region.getByRole('button', { name: 'تأیید و ذخیره' }).click();
  await page.waitForFunction(() => !document.querySelector('.st-preview'));
  const saved = writes.find((w) => w.path === '/config/profile');
  pass(saved?.method === 'PATCH' && JSON.stringify(saved.data) === '{"kind":"company","services":["ionm","implant"]}', '**ذخیره همان بسته را می‌فرستد**', JSON.stringify(saved?.data));

  await box('نورومانیتورینگ').click(); await box('ایمپلنت').click();
  pass(await page.getByText('دست‌کم یک خدمت انتخاب کنید.').count() === 1, '**شرکتِ بی‌خدمت پیام می‌گیرد**');
  pass(await page.getByRole('button', { name: 'بررسیِ تغییرات' }).isDisabled(), 'و دکمهٔ بررسی غیرفعال است');

  await page.getByRole('radio', { name: /مطب/ }).click();
  pass(await page.getByRole('checkbox').count() === 0, 'مطب بستهٔ خدمات ندارد');
  await page.getByRole('button', { name: 'بررسیِ تغییرات' }).click();
  await region.waitFor();
  const prev = writes.filter((w) => w.path === '/config/profile/preview').at(-1);
  pass(JSON.stringify(prev?.data) === '{"kind":"clinic","services":[]}', 'بدنهٔ مطب `services: []`', JSON.stringify(prev?.data));
  pass(errors.length === 0, 'بدونِ خطای JS', errors[0]);
  console.log(`\n${count} سنجه سبز`);
} finally {
  await browser?.close();
  vite.kill();
}
