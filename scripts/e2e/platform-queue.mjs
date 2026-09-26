/**
 * «صف عملیات»ِ پنلِ پلتفرم فقط کارِ باز نشان می‌دهد؛ فهرستِ مرکزیِ بیمارستان‌ها تاشوست.
 *
 * ⚠️ چرا (۱۴۰۵/۰۷/۰۴، پرسشِ مالک): «شرکتی که ساخته شده اسمش در شرکت‌های فعال هست،
 * چرا هنوز در صف است؟» باگِ داده نبود — `snapshot()` سی کارِ آخر را می‌داد و پنل همه را
 * زیرِ «صف» می‌کشید، با شمارِ همان سی‌تا. حالا تمام‌شده‌ها زیرِ «انجام‌شده‌ها»ی تاشو
 * می‌روند. و چون پنل حالا می‌گوید «کاری در صف نیست»، سرور هم نباید کارِ باز را فقط
 * به‌خاطرِ سی کارِ تازه‌تر از پاسخ بیندازد — وگرنه آن جمله دروغ می‌شد.
 *
 * باید بیفتد:
 *   - کارِ ناموفقِ قدیمی با ۳۱ ساختِ موفقِ تازه‌تر هنوز در `snapshot` هست (همین برای حذف)
 *   - صف فقط «در صف / در حال ساخت / ناموفق» را نشان می‌دهد و شمارش هم همان است
 *   - ساخت‌ها و حذف‌های تمام‌شده زیرِ «انجام‌شده‌ها» (بسته، با aria-expanded)
 *   - بخشِ «صف حذف» فقط وقتی حذفی باز است
 *   - فهرستِ بیمارستان‌ها بسته است و تا باز نشده **هیچ** درخواستی نمی‌زند؛ کلِ ردیفِ
 *     سربرگ کلیک می‌خورد؛ سرخط دوبار تکرار نمی‌شود
 *  نباید بیفتد:
 *   - شرکتِ ساخته‌شده در صف
 *   - اسکرولِ افقی در گوشی
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
require('reflect-metadata');
const { PlatformProvisioningService } = require('./dist/platform/platform.module');
const { PrismaClient: ControlClient } = require('./src/generated/control');

const CTRL = process.env.E2E_CTRL_DB;
if (!CTRL || !['localhost', '127.0.0.1'].includes(new URL(CTRL).hostname)) throw new Error('فقط دیتابیسِ کنترلِ محلی');
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const shots = process.env.E2E_SHOTS;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

/* ───────────── ۱) سرور: کارِ باز هرگز از پاسخ نمی‌افتد ───────────── */
const control = new ControlClient({ datasources: { db: { url: CTRL } } });
const svc = new PlatformProvisioningService(control);
const tag = 'pq' + randomBytes(3).toString('hex');
const HASH = 'h'.repeat(64);
const minutesAgo = (m) => new Date(Date.now() - m * 60000);

try {
  console.log('۱) کارِ ناموفقِ قدیمی با سی‌ویک ساختِ تازه‌تر هنوز در snapshot است');
  const old = await control.provisioningJob.create({ data: {
    slug: `${tag}-old`, name: 'ساختِ ناموفقِ قدیمی', hostname: `${tag}-old.example.com`,
    status: 'failed', errorCode: 'test', requestedByHash: HASH, createdAt: new Date('2020-01-01T00:00:00Z'),
  } });
  await control.provisioningJob.createMany({ data: Array.from({ length: 31 }, (_, i) => ({
    slug: `${tag}-ok${i}`, name: `ساختِ موفق ${i}`, hostname: `${tag}-ok${i}.example.com`,
    status: 'succeeded', requestedByHash: HASH, createdAt: minutesAgo(i + 1), finishedAt: minutesAgo(i),
  })) });
  const oldDel = await control.tenantDeletionJob.create({ data: {
    tenantId: `${tag}-t-old`, slug: `${tag}-dold`, name: 'حذفِ ناموفقِ قدیمی',
    status: 'failed', errorCode: 'test', requestedByHash: HASH, createdAt: new Date('2020-01-01T00:00:00Z'),
  } });
  await control.tenantDeletionJob.createMany({ data: Array.from({ length: 21 }, (_, i) => ({
    tenantId: `${tag}-t${i}`, slug: `${tag}-d${i}`, name: `حذفِ موفق ${i}`,
    status: 'succeeded', requestedByHash: HASH, createdAt: minutesAgo(i + 1), finishedAt: minutesAgo(i),
  })) });

  const snap = await svc.snapshot();
  ok(snap.jobs.some((j) => j.id === old.id), 'ساختِ ناموفقِ قدیمی در پاسخ هست (با `take: 30`ِ قبلی بیرون می‌افتاد)');
  const doneJobs = snap.jobs.filter((j) => j.status === 'succeeded');
  ok(doneJobs.length <= 30, `از ساخت‌های تمام‌شده فقط تازه‌ترین‌ها (${doneJobs.length} ≤ ۳۰)`);
  ok(doneJobs.some((j) => j.slug === `${tag}-ok0`) && !doneJobs.some((j) => j.slug === `${tag}-ok30`),
    'تازه‌ترین تمام‌شده هست و سی‌ویکمی (کهنه‌ترین) نیست');
  ok(snap.deletions.some((j) => j.id === oldDel.id), 'حذفِ ناموفقِ قدیمی هم با بیست‌ویک حذفِ تازه‌تر در پاسخ هست');
  ok(snap.deletions.filter((j) => j.status === 'succeeded').length <= 20, 'از حذف‌های تمام‌شده فقط تازه‌ترین‌ها (≤ ۲۰)');
  ok(!('databaseUrlEncrypted' in (snap.jobs[0] ?? {})) && !JSON.stringify(snap).includes('postgresql://'),
    'هیچ رشتهٔ اتصالی در پاسخ نیست');
} finally {
  await control.provisioningJob.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => {});
  await control.tenantDeletionJob.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => {});
  await control.$disconnect();
}

/* ───────────── ۲) پنل ───────────── */
const at = (m) => new Date(Date.UTC(2026, 8, 26, 8, m)).toISOString();
const job = (id, name, status, m) => ({
  id, slug: id, name, hostname: `${id}.amalyar.com`, status, tenantId: null, errorCode: status === 'failed' ? 'x' : null,
  attempts: 1, createdAt: at(m), updatedAt: at(m + 1), startedAt: at(m), finishedAt: status === 'succeeded' || status === 'failed' ? at(m + 1) : null,
});
const tenant = (id, name, status) => ({
  id, slug: id, name, status, hostname: `${id}.amalyar.com`,
  domains: [{ hostname: `${id}.amalyar.com`, primary: true }], shared: false, createdAt: at(0),
});
/* همان حالتِ اسکرین‌شاتِ مالک: شرکتی که ساخته شده و در «شرکت‌های فعال» است + یک ساختِ در جریان و یک ناموفق. */
const MIXED = {
  tenants: [tenant('dr-gorji', 'کلینیکِ ساخته‌شده', 'active'), tenant('building', 'کلینیکِ در حالِ ساخت', 'provisioning')],
  jobs: [job('building', 'کلینیکِ در حالِ ساخت', 'running', 30), job('broken', 'کلینیکِ ناموفق', 'failed', 20), job('dr-gorji', 'کلینیکِ ساخته‌شده', 'succeeded', 10)],
  deletions: [{ ...job('gone', 'کلینیکِ حذف‌شده', 'succeeded', 5), tenantId: 't-gone' }],
};
const CALM = {
  tenants: [tenant('dr-gorji', 'کلینیکِ ساخته‌شده', 'active')],
  jobs: [job('dr-gorji', 'کلینیکِ ساخته‌شده', 'succeeded', 10)],
  deletions: [{ ...job('leaving', 'کلینیکِ در حالِ حذف', 'running', 40), tenantId: 't-leaving' }],
};
const HOSPITALS = {
  rows: [{ id: 'h1', name: 'بیمارستانِ نمونه', province: 'تهران', city: 'تهران', address: 'خیابانِ نمونه', phone: '02100000000', sector: 'private', verified: true, active: true }],
  total: 1, page: 1, pages: 1, provinces: [{ name: 'تهران', count: 1 }], coverage: { total: 1, verified: 1 },
};

const b = await chromium.launch({
  executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const p = await (await b.newContext({ viewport: { width: 1200, height: 900 }, locale: 'fa-IR' })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
let hospitalCalls = 0;
p.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/platform/hospitals')) hospitalCalls++; });
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
let current = MIXED;

try {
  await p.route('**/api/platform/auth/me', (r) => json(r, { ok: true }));
  await p.route('**/api/platform/snapshot', (r) => json(r, current));
  await p.route('**/api/platform/hospitals**', (r) => json(r, HOSPITALS));
  await p.goto(UI + '/platform-admin', { waitUntil: 'networkidle' });
  const queue = p.locator('[data-section="queue"]');
  await queue.waitFor({ timeout: 8000 });
  await p.waitForTimeout(600);

  console.log('\n۲) صف فقط کارهای باز را نشان می‌دهد');
  const names = await queue.locator('.pa-job-grid').first().locator('.pa-job b').allInnerTexts();
  ok(names.includes('کلینیکِ در حالِ ساخت') && names.includes('کلینیکِ ناموفق'), `ساختِ در جریان و ناموفق در صف‌اند (${names.join('، ')})`);
  ok(!names.includes('کلینیکِ ساخته‌شده'), '**شرکتِ ساخته‌شده دیگر در صف نیست** — همان پرسشِ مالک');
  ok((await queue.locator('.pa-section-title > span').innerText()).trim() === '۲', 'شمارِ کنارِ «صف عملیات» فقط کارهای باز را می‌شمرد (۲)');
  ok(await queue.getByRole('button', { name: 'تلاش مجدد' }).count() === 1, '«تلاش مجدد» روی ساختِ ناموفق مانده است');
  ok(await p.locator('.pa-row', { hasText: 'کلینیکِ ساخته‌شده' }).count() === 1, 'و در «شرکت‌های فعال» هست');

  console.log('\n۳) تمام‌شده‌ها زیرِ «انجام‌شده‌ها»ی بسته');
  const hist = queue.locator('.pa-history-btn');
  ok(await hist.count() === 1 && /انجام‌شده‌ها/.test(await hist.innerText()) && /۲/.test(await hist.innerText()),
    `دکمهٔ «انجام‌شده‌ها» با شمار (${(await hist.innerText()).replace(/\s+/g, ' ').trim()})`);
  ok(await hist.getAttribute('aria-expanded') === 'false' && !(await p.locator('#pa-history-list').isVisible()), 'به‌طورِ پیش‌فرض بسته است');
  ok(await p.locator('[data-section="deletions"]').count() === 0, 'حذفِ تمام‌شده «صف حذف» نمی‌سازد');
  if (shots) await p.screenshot({ path: `${shots}/platform-queue-closed.png`, fullPage: true });
  await hist.click();
  const done = p.locator('#pa-history-list');
  await done.locator('.pa-job').first().waitFor({ timeout: 3000 });
  const doneText = await done.innerText();
  ok(await hist.getAttribute('aria-expanded') === 'true', 'با کلیک باز می‌شود (aria-expanded)');
  ok(/کلینیکِ ساخته‌شده/.test(doneText) && /ساخته شد/.test(doneText), 'ساختِ تمام‌شده با برچسبِ «ساخته شد»');
  ok(/کلینیکِ حذف‌شده/.test(doneText) && /حذف شد/.test(doneText), 'حذفِ تمام‌شده هم همان‌جا با «حذف شد»');
  ok(!/کلینیکِ ناموفق|کلینیکِ در حالِ ساخت/.test(doneText), 'کارِ باز در تاریخچه تکرار نمی‌شود');
  const order = await done.locator('.pa-job b').allInnerTexts();
  ok(order[0] === 'کلینیکِ ساخته‌شده', `تازه‌ترین تمام‌شده اول (${order.join('، ')})`);

  console.log('\n۴) فهرستِ مرکزیِ بیمارستان‌ها بسته است و تا باز نشده چیزی نمی‌خواند');
  const fold = p.locator('[data-section="hospitals"]');
  const foldBtn = fold.getByRole('button', { name: 'فهرست مرکزی بیمارستان‌ها', exact: true });
  ok(await foldBtn.getAttribute('aria-expanded') === 'false', 'بسته است (aria-expanded=false)');
  ok(hospitalCalls === 0, `هیچ درخواستی به فهرست نرفته (${hospitalCalls})`);
  const closedBox = await fold.boundingBox();
  ok(closedBox && closedBox.height < 140, `بسته فقط یک سربرگ است (${Math.round(closedBox?.height)}px)`);
  /* کلیک روی **مختصاتِ** متنِ زیرِ سرخط، نه خودِ سرخط: کلِ ردیف باید کلیک بخورد.
     (`locator.click` این‌جا عمداً رد می‌شود — لایهٔ دکمه رویِ متن است و همین هدف است.) */
  const tapSub = async () => {
    const sub = await p.locator('[data-section="hospitals"] .pa-fold-title p').boundingBox();
    await p.mouse.click(sub.x + sub.width / 2, sub.y + sub.height / 2);
  };
  await tapSub();
  await fold.locator('.df-directory-row').first().waitFor({ timeout: 5000 });
  ok(await foldBtn.getAttribute('aria-expanded') === 'true', 'کلیک روی هر جای ردیفِ سربرگ بازش می‌کند');
  ok(hospitalCalls >= 1, 'و تازه حالا فهرست را می‌خواند');
  ok(await fold.locator('h2').count() === 1, 'سرخط دوبار تکرار نمی‌شود (قاب و عنوان مالِ بخشِ تاشوست)');
  ok(await fold.getByRole('button', { name: 'افزودن بیمارستان مرکزی', exact: true }).count() === 1, 'ابزارهای فهرست همه سرِ جایشان‌اند');
  if (shots) await p.screenshot({ path: `${shots}/platform-queue-open.png`, fullPage: true });
  await foldBtn.focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  ok(await foldBtn.getAttribute('aria-expanded') === 'false' && await fold.locator('.df-directory-row').count() === 0,
    'با صفحه‌کلید هم بسته می‌شود و بدنه برداشته می‌شود');

  console.log('\n۵) صفِ خالی و حذفِ باز');
  current = CALM;
  await p.reload({ waitUntil: 'networkidle' });
  await queue.waitFor({ timeout: 8000 });
  await p.waitForTimeout(600);
  ok((await queue.locator('.pa-empty').innerText()).trim() === 'کاری در صف نیست.', '«کاری در صف نیست.» — نه فهرستِ شرکت‌های ساخته‌شده');
  ok((await queue.locator('.pa-section-title > span').innerText()).trim() === '۰', 'شمار: ۰');
  const del = p.locator('[data-section="deletions"]');
  ok(await del.count() === 1 && /کلینیکِ در حالِ حذف/.test(await del.innerText()), 'حذفِ در جریان «صف حذف» را نشان می‌دهد');
  ok(await p.locator('.pa-live').count() === 1, 'و نبضِ «در حال پردازش» روشن است');

  console.log('\n۶) گوشی');
  current = MIXED;
  await p.setViewportSize({ width: 390, height: 844 });
  await p.reload({ waitUntil: 'networkidle' });
  await queue.waitFor({ timeout: 8000 });
  await p.waitForTimeout(600);
  await p.locator('.pa-history-btn').click();
  await p.locator('[data-section="hospitals"]').scrollIntoViewIfNeeded();
  await tapSub();
  await p.locator('.df-directory-row').first().waitFor({ timeout: 5000 });
  const scroll = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(scroll <= 391, `صفحه اسکرولِ افقی نمی‌گیرد (${scroll})`);
  const caret = await p.locator('[data-section="hospitals"] .pa-fold-caret').boundingBox();
  ok(caret && caret.x >= 0 && caret.x + caret.width <= 390, 'فلشِ بخشِ تاشو داخلِ صفحه است');
  if (shots) {
    await p.locator('[data-section="queue"]').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${shots}/platform-queue-mobile.png` });
  }
} finally {
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
  await b.close();
}
process.exit(fail || errs.length ? 1 : 0);
