/** Mobile user journeys with HTTP fixtures. No production accounts or messages. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
const base = 'http://127.0.0.1:5208';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5208', '--strictPort'], { stdio: 'ignore' });
let browser, count = 0;
const pass = text => console.log(`PASS ${++count}: ${text}`);
try {
  for (let i = 0; i < 80; i++) { if (await fetch(base).then(r => r.ok).catch(() => false)) break; await delay(100); }
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fa-IR', reducedMotion: 'reduce', serviceWorkers: 'block' });
  let user = { id: 1, level: 6, status: 'active', firstName: 'مدیر', lastName: 'تست', username: 'manager', phone: '09120000001' };
  const writes = [], errors = [];
  /* ⚠️ `selectOption` منتظرِ درخواستی که `onChange` می‌فرستد نمی‌ماند؛ خواندنِ
     بی‌درنگِ `writes` یک مسابقه بود (تقریباً یک از سه ران، رانِ محلیِ بستهٔ ۶
     گرفتش). جاهای دیگر پیش از خواندن منتظرِ پیامِ موفقیتِ روی صفحه‌اند؛ این‌جا
     پیامی نیست، پس خودِ درخواست منتظر می‌ماند. */
  const waitWrite = async (path, ms = 5000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) {
      const hit = writes.find(w => w.path === path);
      if (hit) return hit;
    }
    throw new Error(`درخواستِ ${path} نرسید`);
  };
  let testingEnabled = false;
  const hospital = { id: 1, name: 'بیمارستان تست', active: true };
  const technician = { id: 2, displayName: 'کارشناس تست', active: true };
  await ctx.route('**/api/**', async route => {
    const req = route.request(), u = new URL(req.url()), path = u.pathname.replace(/^\/api/, ''), method = req.method();
    const payload = method !== 'GET' && req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null;
    if (method !== 'GET') writes.push({ path, payload });
    let body = [];
    if (path === '/auth/me') body = user;
    else if (path === '/config') body = { vertical: 'ionm', brand: { name: 'شرکت تست' } };
    else if (path === '/features') body = ['users', 'surgeon', 'dashboard', 'dispatch', 'inventory', 'calendar'].map(key => ({ key, allowed: true }));
    else if (path === '/accounts/testing-mode') { if (method === 'POST') testingEnabled = payload.enabled; body = { enabled: testingEnabled, disabled: 2 }; }
    else if (path === '/accounts/temporary') body = { account: { ...user, username: payload?.username || 'temporary-fixture', isTestAccount: !!payload?.testAccount, verificationDueAt: '2026-09-18T00:00:00Z' }, temporaryPassword: 'ONE-TIME-FIXTURE' };
    else if (path === '/auth/phone/request-otp') body = { ok: true };
    else if (path === '/auth/phone/verify-otp') { user = { ...user, phoneVerifiedAt: new Date().toISOString() }; body = user; }
    else if (path === '/surgeon/visits') body = { rows: [], page: 1, pages: 1, total: 0, workflow: 'ionm' };
    else if (path === '/surgeon/finances') body = { surgeon: 'جراح تست', earned: 3000000, paid: 1000000, balance: 2000000, rows: [{ id: 1, patient: 'بیمار تست', code: 'TEST-V1', date: '2026-09-12', hospital: hospital.name, finalized: true, earned: 3000000, paid: 1000000, balance: 2000000, payments: [] }], page: 1, pages: 1 };
    else if (path === '/surgeons') body = [{ id: 1, name: 'جراح تست', active: true }];
    else if (path === '/hospitals') body = [hospital];
    else if (path === '/techs') body = [technician];
    else if (path === '/dispatch/month') body = { days: [] };
    else if (path === '/dispatch/day') body = { visits: [] };
    else if (path === '/dispatch/staff') body = [{ id: 1, name: 'راننده تست', roleLabel: 'راننده' }];
    else if (path === '/dispatch/roster') body = { hospitals: [{ hospitalId: 1, name: hospital.name, duties: [{ id: 1, techId: 2, name: technician.displayName, arriveTime: '08:00', active: true }], visits: [{ id: 1, name: 'بیمار تست', code: 'TEST-V1', techId: null, opStartTime: '09:00' }] }] };
    else if (path === '/dispatch/roster/preview') body = { programs: [{ techId: 2, name: technician.displayName, text: 'برنامه تست؛ بیمار احتمالی' }] };
    else if (path === '/routes/day') body = { runs: [] };
    else if (path === '/stock/lots') body = [{ id: 3, itemId: 4, itemName: 'دستگاه تست', quantity: 1, available: 1, serialNo: 'SERIAL-1' }];
    else if (path === '/stock/transfers') body = { id: 1, code: 'HV-TEST', status: 'planned' };
    await route.fulfill({ json: body });
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/app/users`);
  /* دکمه دیگر «+ ساخت حساب موقت»ِ سبزِ تمام‌عرض نیست — «ساختِ حسابِ موقت» کنارِ زبانه‌ها (بازبینیِ UX، shell-18). */
  await page.getByRole('button', { name: 'ساختِ حسابِ موقت', exact: true }).click();
  await page.getByLabel('نام *', { exact: true }).fill('فرد');
  await page.getByLabel('نام خانوادگی *', { exact: true }).fill('آزمایشی');
  await page.getByLabel('موبایل', { exact: true }).fill('۰۹۱۲۰۰۰۰۰۰۹');
  await page.getByRole('button', { name: 'ساخت حساب', exact: true }).click();
  await page.getByText('ONE-TIME-FIXTURE').waitFor();
  const created = writes.find(w => w.path === '/accounts/temporary');
  assert.equal(created.payload.phone, '09120000009'); assert.equal(created.payload.level, 2);
  pass('manager creates provisional account on mobile and sees one-time credentials');
  await page.goto(`${base}/app/users`);
  /* ابزارِ آزمایشیِ نقش‌ها تاشوی پایینِ صفحه است — اول باز می‌شود (shell-18). */
  await page.locator('.us-testing summary').click();
  await page.getByRole('button', { name: 'فعال‌کردن ساخت حساب آزمایشی', exact: true }).click();
  await page.getByRole('button', { name: 'ساختِ حسابِ موقت', exact: true }).click();
  await page.getByRole('checkbox', { name: 'حساب آزمایشی با شماره مشترک' }).check();
  await page.getByLabel('نام کاربری (الزامی)', { exact: true }).fill('test-doctor');
  await page.getByLabel('نام *', { exact: true }).fill('پزشک');
  await page.getByLabel('نام خانوادگی *', { exact: true }).fill('آزمایشی');
  await page.getByLabel('موبایل', { exact: true }).fill(user.phone);
  await page.getByLabel(/نقش شغلی/).selectOption('doctor');
  await page.getByRole('button', { name: 'ساخت حساب', exact: true }).click();
  await page.getByText('test-doctor', { exact: true }).waitFor();
  const testWrite = writes.filter(w => w.path === '/accounts/temporary').at(-1).payload;
  assert.equal(testWrite.testAccount, true); assert.equal(testWrite.phone, user.phone); assert.equal(testWrite.username, 'test-doctor');
  await page.goto(`${base}/app/users`);
  /* بارگذاریِ دوباره تاشو را بسته برمی‌گرداند — دکمهٔ «پایان تست» هم داخلِ همان است. */
  await page.locator('.us-testing summary').click();
  await page.getByRole('button', { name: 'پایان تست و غیرفعال‌کردن حساب‌های آزمایشی' }).click();
  await page.getByRole('button', { name: 'فعال‌کردن ساخت حساب آزمایشی' }).waitFor();
  assert.equal(writes.filter(w => w.path === '/accounts/testing-mode').at(-1).payload.enabled, false);
  pass('mobile admin enables shared-phone tests, creates independent username and ends testing');
  user = { ...user, level: 2, verificationDueAt: '2026-09-18', phoneVerifiedAt: null };
  await page.goto(`${base}/app/profile`);
  await page.getByRole('button', { name: 'دریافت کد پیامکی' }).click();
  await page.getByLabel('کد تأیید', { exact: true }).fill('۱۲۳۴۵۶');
  await page.getByRole('button', { name: 'تأیید شماره', exact: true }).click();
  await page.getByText('شماره تأیید شد؛ مشخصات و رمز خود را هم تکمیل کنید').waitFor();
  assert.equal(writes.find(w => w.path === '/auth/phone/verify-otp').payload.code, '123456');
  pass('account owner confirms own phone with Persian digits and completes profile');
  await page.goto(`${base}/app/surgeon`);
  await page.getByRole('tab', { name: 'بیلان مالی من' }).click();
  await page.getByText('بیمار تست', { exact: true }).waitFor();
  assert.ok(await page.getByText(/سهم نهایی:/).count());
  pass('surgeon discovers personal financial statement in a separate tab');
  user = { ...user, level: 6 };
  await page.goto(`${base}/app/dispatch`);
  await page.getByLabel('کارشناس بیمار تست').selectOption('2');
  assert.equal((await waitWrite('/dispatch/roster/visits/1')).payload.techId, 2);
  /* company-02: دکمهٔ اصلیِ درشتِ پایینِ روز — «ابلاغِ برنامهٔ روز» (اول پیش‌نمایش، بعد ارسال). */
  await page.getByRole('button', { name: 'ابلاغِ برنامهٔ روز' }).click();
  await page.getByText('برنامه تست؛ بیمار احتمالی').waitFor();
  pass('hospital roster assigns a patient and previews technician notification');
  await page.getByRole('tab', { name: /حمل/ }).click();
  await page.getByRole('button', { name: 'انتخاب تجهیزات برای بیمارستان' }).click();
  await page.getByLabel('بیمارستان', { exact: true }).selectOption('1');
  await page.getByRole('checkbox', { name: /دستگاه تست/ }).check();
  await page.getByRole('button', { name: 'ثبت حواله برنامه‌ریزی‌شده' }).click();
  await page.getByText(/حواله HV-TEST برنامه‌ریزی شد/).waitFor();
  const plan = writes.find(w => w.path === '/stock/transfers').payload;
  assert.equal(plan.planOnly, true); assert.deepEqual(plan.lines, [{ lotId: 3, quantity: 1 }]);
  pass('transport equipment selection creates a planned transfer without recording shipment');
  assert.deepEqual(errors, []); pass('mobile journeys have no uncaught browser errors');
  await ctx.close(); console.log(`${count} company operations UI scenarios passed`);
} finally { if (browser) await browser.close(); vite.kill(); }
