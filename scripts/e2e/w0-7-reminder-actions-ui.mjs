/**
 * W0.7 — دکمه‌های تک‌ردیفیِ دفترِ یادآوری‌ها (نیمهٔ رابط).
 * مرورگرِ واقعی + Vite واقعی + APIِ ساختگی.
 *
 *  باید بیفتد:
 *   - ردیفِ نرفته هر دو دکمه را داشته باشد و کلیک واقعاً به endpointِ درست برود
 *   - ردیفِ «در صف» فقط «لغو» داشته باشد (هنوز چیزی نرفته که دوباره برود)
 *  نباید بیفتد:
 *   - 🔴 ردیفِ **رفته** هیچ دکمه‌ای داشته باشد — رابط نباید کاری را پیشنهاد
 *     کند که سرور ۴۰۹ می‌دهد، و بدتر: پیامکِ دوم به بیمارِ واقعی
 *   - ردیفِ «در حال ارسال» دکمه بگیرد
 *   - صفحه اسکرولِ افقی یا خطای JS بدهد
 */
import assert from 'node:assert/strict';
import { startVite, launch, mockContext, hOverflow } from './lib/mock-ui.mjs';

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };

const ROWS = [
  { id: 1, kind: 'notice', status: 'failed', channel: 'sms', text: 'پیامِ نرفته', phone: '09120000001',
    dueAt: '2026-09-17T08:00:00.000Z', error: 'سرویس پیامک ارسال را نپذیرفت', patientName: 'الف' },
  { id: 2, kind: 'next_visit', status: 'sent', channel: 'sms', text: 'پیامِ رفته', phone: '09120000002',
    dueAt: '2026-09-16T08:00:00.000Z', sentAt: '2026-09-16T08:01:00.000Z', deliveryStatus: 'delivered', patientName: 'ب' },
  { id: 3, kind: 'appointment', status: 'pending', channel: 'sms', text: 'پیامِ در صف', phone: '09120000003',
    dueAt: '2026-09-19T08:00:00.000Z', patientName: 'ج' },
  { id: 4, kind: 'notice', status: 'sending', channel: 'sms', text: 'در حالِ رفتن', phone: '09120000004',
    dueAt: '2026-09-17T09:00:00.000Z', patientName: 'د' },
];

const vite = await startVite(5217);
const browser = await launch();

const openPage = async () => {
  const { context, writes, errors } = await mockContext(browser, ({ path, method }) => {
    if (path === '/reminders' && method === 'GET') return ROWS;
    if (/^\/reminders\/\d+\/(retry|cancel)$/.test(path)) return { id: 1, status: 'sent' };
    /* شکلِ پاسخ‌ها همان `orders-ai-ui.mjs` است — `Gate` روی `allowed` نگاه می‌کند. */
    if (path === '/auth/me') return { id: 1, firstName: 'مدیرِ', lastName: 'آزمون', level: 6, status: 'active' };
    if (path === '/config') return { vertical: 'clinic', brand: {} };
    if (path === '/features') return [{ key: 'dashboard', allowed: true }];
    if (method === 'GET') return {};
    return undefined;
  }, { viewport: { width: 900, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${vite.base}/app/reminders`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.rm-row').length > 0, null, { timeout: 15000 });
  return { page, writes, errors, context };
};

const actsOf = (page, id) => page.evaluate((rid) => {
  const rows = [...document.querySelectorAll('.rm-row')];
  const el = rows.find((r) => r.innerText.includes(rid));
  return el ? [...el.querySelectorAll('.rm-act')].map((b) => b.innerText.trim()) : null;
}, id);

try {
  const { page, writes, errors, context } = await openPage();
  ok(await page.locator('.rm-row').count() === ROWS.length, `هر ${ROWS.length} ردیف رندر شد`);

  console.log('\n۱) دکمه‌ها فقط جایی که سرور هم اجازه می‌دهد');
  const failed = await actsOf(page, 'پیامِ نرفته');
  ok(failed?.length === 2 && failed.some((t) => t.includes('دوباره')) && failed.some((t) => t.includes('لغو')),
    `ردیفِ نرفته هر دو دکمه را دارد (${failed?.join(' | ')})`);
  const queued = await actsOf(page, 'پیامِ در صف');
  ok(queued?.length === 1 && queued[0].includes('لغو'),
    'ردیفِ در صف فقط «لغو» دارد — هنوز چیزی نرفته که دوباره برود');
  ok((await actsOf(page, 'پیامِ رفته'))?.length === 0,
    '🔴 ردیفِ **رفته** هیچ دکمه‌ای ندارد — نه پیامکِ دوم، نه پیشنهادِ کاری که سرور رد می‌کند');
  ok((await actsOf(page, 'در حالِ رفتن'))?.length === 0,
    'ردیفِ «در حال ارسال» هم — همین حالا دستِ سرور است');

  console.log('\n۲) کلیک واقعاً به endpointِ درست می‌رود');
  await page.locator('.rm-row', { hasText: 'پیامِ نرفته' }).locator('.rm-act').first().click();
  await page.waitForFunction(() => document.querySelector('.rm-toast.on'), null, { timeout: 8000 });
  const hit = writes.find((w) => w.path.includes('/retry'));
  ok(hit?.path === '/reminders/1/retry' && hit.method === 'POST', `درخواستِ ارسالِ دوباره رفت (${hit?.path})`);

  /* لغو از بازبینیِ UX (clinic-daily-15) اول **می‌پرسد**: لمسِ اول فقط پرسش را باز می‌کند. */
  const queuedRow = page.locator('.rm-row', { hasText: 'پیامِ در صف' });
  await queuedRow.locator('.rm-act').first().click();
  await queuedRow.locator('.rm-ask').waitFor({ timeout: 8000 });
  ok(!writes.some((w) => w.path === '/reminders/3/cancel'), '🔴 **نباید بیفتد:** لمسِ اولِ «لغو» بی‌پرسش درخواست بفرستد');
  ok((await queuedRow.locator('.rm-ask').innerText()).includes('برگشت ندارد'), 'پرسش پیامد را می‌گوید');
  await queuedRow.locator('.rm-ask-yes').click();
  await page.waitForFunction(() => document.querySelector('.rm-toast.on'), null, { timeout: 8000 });
  ok(writes.some((w) => w.path === '/reminders/3/cancel' && w.method === 'POST'), 'و لغو هم روی شناسهٔ خودش');

  ok(await hOverflow(page) === 0, 'صفحه اسکرولِ افقی ندارد');
  ok(errors.length === 0, `هیچ خطای JS نداد${errors.length ? ` — ${errors[0]}` : ''}`);
  await page.screenshot({ path: 'scripts/e2e/.shots/w0-7-reminders.png', fullPage: true });
  await context.close();

  console.log(`\n✅ ${count}/${count}`);
} finally {
  await browser.close();
  vite.stop();
}
