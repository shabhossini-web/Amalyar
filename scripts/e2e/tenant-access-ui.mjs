/**
 * چرخهٔ عمرِ شرکت — آنچه کاربر می‌بیند (خواستهٔ مالک ۱۴۰۵/۰۷/۱۵):
 *   ۱) بنرِ «نسخهٔ آزمایشی · N روز مانده» زیرِ نوارِ پوسته (دسکتاپ، گوشی، هر دو تم)
 *   ۲) اشتراکِ منقضی: بنرِ قرمزِ فقط‌خواندنی و نوشتن از خودِ مرورگر ۴۰۳
 *   ۳) شرکتِ معلق: صفحهٔ ورود فقط علت را می‌گوید، نه فرم
 *   ۴) پنلِ پلتفرم (با snapshotِ ساختگی): بجِ هر وضعیت، شمارِ «فعال» بی‌معلق‌ها،
 *      دیالوگِ «دسترسی» با مهلتِ سریع و بدنهٔ درستِ درخواست، فرمِ ساخت با نوعِ حساب
 *
 * باید بیفتد:
 *   - بنر بدونِ `access` یا با اشتراکِ بی‌مهلت نشان داده شود
 *   - روزِ مانده در کلاینت شمرده شود (متن از سرور می‌آید و با `/config` یکی است)
 *   - معلق فرمِ ورود را نشان دهد
 *  نباید بیفتد:
 *   - اسکرولِ افقی روی گوشی با بنر
 *   - خطای کنسول در هیچ صفحه‌ای
 */
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { browserLogin } from './lib/browser-login.mjs';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { endOfDayTehran, tehranDatePlusDays } = require('./dist/tenant/tenant-access');
const { PrismaClient: ControlClient } = require('./src/generated/control');

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const CTRL = process.env.E2E_CTRL_DB;
if (!CTRL || !['localhost', '127.0.0.1'].includes(new URL(CTRL).hostname)) throw new Error('فقط دیتابیسِ کنترلِ محلی');
const SLUG = process.env.DEFAULT_TENANT_SLUG ?? 't1';
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.E2E_SHOTS ?? '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

const control = new ControlClient({ datasources: { db: { url: CTRL } } });
const setTenant = (data) => control.tenant.update({ where: { slug: SLUG }, data });
const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const me = (p) => fetch(API + p, { headers: { Authorization: 'Bearer ' + login.accessToken } }).then((r) => r.json());

let browser;
const errs = [];
const newPage = async (viewport) => {
  const ctx = await browser.newContext({ viewport, locale: 'fa-IR' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e)));
  return p;
};
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

try {
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  console.log('۱) دموی ۱۲ روزه → بنر زیرِ نوار، دسکتاپ و گوشی، هر دو تم');
  await setTenant({ plan: 'demo', accessUntil: endOfDayTehran(tehranDatePlusDays(12)), suspendedAt: null, accessNote: null });
  const cfg = await me('/config');
  ok(cfg?.access?.plan === 'demo' && cfg.access.daysLeft === 12, `/config: دمو، ${cfg?.access?.daysLeft} روز مانده`);

  const page = await newPage({ width: 1200, height: 900 });
  await browserLogin(page, login.accessToken, { ui: UI });
  await page.goto(UI + '/app', { waitUntil: 'networkidle' });
  const banner = page.locator('.sh-access[data-access]');
  await banner.waitFor({ timeout: 10000 });
  const text = (await banner.innerText()).replace(/\s+/g, ' ');
  ok(/نسخهٔ آزمایشی/.test(text) && text.includes(`${fa(12)} روز مانده`), `متنِ بنر: ${text}`);
  ok(await banner.getAttribute('data-access') === 'active' && await banner.evaluate((el) => el.classList.contains('warn')), 'رنگِ هشدار (کهربایی)');
  const below = await page.evaluate(() => {
    const bar = document.querySelector('.sh-bar')?.getBoundingClientRect();
    const b = document.querySelector('.sh-access')?.getBoundingClientRect();
    return bar && b && b.top >= bar.bottom - 1;
  });
  ok(below, 'بنر زیرِ نوارِ پوسته است، نه روی آن');
  ok(await page.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--access-h')) > 20), '`--access-h` برای صفحه‌های تمام‌قد ست شده');
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(150);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/tenant-access-banner-${theme}.png`, clip: { x: 0, y: 0, width: 1200, height: 220 } });
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const phone = await newPage({ width: 390, height: 844 });
  await browserLogin(phone, login.accessToken, { ui: UI });
  await phone.goto(UI + '/app', { waitUntil: 'networkidle' });
  await phone.locator('.sh-access[data-access]').waitFor({ timeout: 10000 });
  ok(await noHScroll(phone), 'گوشی: بی‌اسکرولِ افقی با بنر');
  if (SHOTS) await phone.screenshot({ path: `${SHOTS}/tenant-access-banner-phone.png`, clip: { x: 0, y: 0, width: 390, height: 260 } });

  console.log('\n۲) اشتراکِ منقضی → بنرِ قرمز، نوشتن از مرورگر ۴۰۳، خواندن آزاد');
  await setTenant({ plan: 'paid', accessUntil: new Date(Date.now() - 60_000) });
  await page.goto(UI + '/app', { waitUntil: 'networkidle' });
  const exp = page.locator('.sh-access[data-access="expired"]');
  await exp.waitFor({ timeout: 10000 });
  ok(/مهلت/.test(await exp.innerText()) && await exp.evaluate((el) => el.classList.contains('danger')), 'بنرِ منقضی قرمز است و از مهلت می‌گوید');
  /* همان کاری که خودِ اپ می‌کند: API روی پورتِ خودش با کوکیِ نشست (کوکی پورت نمی‌شناسد). */
  const codes = await page.evaluate(async (api) => {
    const w = await fetch(`${api}/patients`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
    const r = await fetch(`${api}/config`, { credentials: 'include' });
    return { write: w.status, writeBody: await w.json().catch(() => null), read: r.status };
  }, API);
  ok(codes.write === 403 && codes.writeBody?.code === 'tenant_read_only' && codes.read === 200, `نوشتن ${codes.write} (فقط‌خواندنی)، خواندن ${codes.read}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tenant-access-expired.png`, clip: { x: 0, y: 0, width: 1200, height: 220 } });

  console.log('\n۳) شرکتِ معلق → صفحهٔ ورود فقط علت را می‌گوید');
  await setTenant({ suspendedAt: new Date() });
  const guest = await newPage({ width: 390, height: 844 });
  await guest.goto(UI + '/login', { waitUntil: 'networkidle' });
  const blocked = guest.locator('[data-access="suspended"]');
  await blocked.waitFor({ timeout: 10000 });
  ok(/غیرفعال/.test(await blocked.innerText()) && await guest.locator('form').count() === 0, 'پیامِ «غیرفعال» بی‌فرمِ ورود');
  if (SHOTS) await guest.screenshot({ path: `${SHOTS}/tenant-access-suspended-phone.png` });
  await setTenant({ suspendedAt: null, accessUntil: null, plan: 'paid' });
  await page.goto(UI + '/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  ok(await page.locator('.sh-access').count() === 0, 'اشتراکِ بی‌مهلت: هیچ بنری نیست');

  console.log('\n۴) پنلِ پلتفرم: بج‌ها، شمارش، دیالوگِ دسترسی، فرمِ ساخت');
  const until = (days) => endOfDayTehran(tehranDatePlusDays(days)).toISOString();
  const T = (id, name, access, extra = {}) => ({
    id, slug: id, name, status: 'active', hostname: `${id}.amalyar.com`, domains: [{ hostname: `${id}.amalyar.com`, primary: true }],
    shared: false, createdAt: new Date().toISOString(), plan: access.plan, accessUntil: access.accessUntil, suspendedAt: access.suspended ? new Date().toISOString() : null,
    accessNote: extra.note ?? null, access, profile: extra.profile ?? null,
  });
  /* گزینه‌های فرمِ ساخت از سرور می‌آید (`profileOptions`) — همان چیزی که `snapshot()` می‌دهد. */
  const profileOptions = {
    kinds: [{ key: 'clinic', label: 'مطب / کلینیک' }, { key: 'company', label: 'شرکتی' }],
    services: [{ key: 'ionm', label: 'نورومانیتورینگ' }, { key: 'implant', label: 'ایمپلنت و تجهیزات' }],
  };
  const CLINIC = { kind: 'clinic', services: [], label: 'مطب / کلینیک' };
  const A = (state, plan, days, suspended = false) => ({
    state, plan, planLabel: plan === 'demo' ? 'نسخهٔ آزمایشی (دمو)' : 'اشتراک', accessUntil: days == null ? null : until(days),
    daysLeft: days ?? null, suspended, readOnly: state === 'expired', message: state === 'suspended' ? 'حسابِ این شرکت غیرفعال شده است.' : state === 'expired' ? 'مهلتِ اشتراک به پایان رسیده است.' : null,
  });
  let tenants = [
    T('demo-clinic', 'مطبِ دمو', A('active', 'demo', 12), { note: 'مشتریِ احتمالی', profile: CLINIC }),
    T('late-clinic', 'مطبِ منقضی', A('expired', 'paid', -2)),
    T('off-clinic', 'مطبِ معلق', A('suspended', 'paid', null, true)),
    T('paid-clinic', 'مطبِ اشتراکی', A('active', 'paid', null)),
  ];
  const pa = await newPage({ width: 1200, height: 900 });
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  let posted = null;
  await pa.route('**/api/platform/auth/me', (r) => json(r, { ok: true }));
  await pa.route('**/api/platform/snapshot', (r) => json(r, { tenants, jobs: [], deletions: [], profileOptions }));
  /* آمادگیِ سامانه (`/platform/health`) — همان شکلی که `platformHealth()` می‌دهد؛ برای هر حالت قابلِ عوض‌کردن. */
  let health = {
    storage: { verdict: 'ok', root: '/app/storage', writable: true, separateMount: true, mountPoint: '/app/storage', fsType: 'ext4', deploys: 3, firstSeenAt: '2026-10-01T08:00:00Z', lastDeployAt: '2026-10-07T08:00:00Z', message: 'فایل‌ها پس از دیپلوی ماندگارند (3 کانتینرِ متفاوت این پوشه را دیده‌اند)' },
    sms: { configured: true, shared: true, message: 'کلید و خطِ مشترکِ ملی‌پیامک تنظیم است؛ همهٔ شرکت‌ها از همین جفت می‌فرستند' },
    runtime: { bootedAt: '2026-10-07T08:00:00Z', commit: 'abc1234', environment: 'production' },
  };
  let healthStatus = 200;
  const healthRoute = (r) => (healthStatus === 200 ? json(r, health) : r.fulfill({ status: healthStatus, contentType: 'application/json', body: JSON.stringify({ message: 'خطای آزمایشی' }) }));
  await pa.route('**/api/platform/health', healthRoute);
  let created = null;
  await pa.route('**/api/platform/provisioning-jobs', async (r) => {
    created = JSON.parse(r.request().postData() || '{}');
    await json(r, { id: 'job1', slug: created.slug, name: created.name, hostname: created.hostname, status: 'queued', plan: created.plan, accessDays: created.accessDays, profile: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  });
  await pa.route('**/api/platform/hospitals**', (r) => json(r, { rows: [], total: 0, page: 1, pages: 1, provinces: [], coverage: { total: 0, verified: 0 } }));
  await pa.route('**/api/platform/tenants/*/access', async (r) => {
    posted = JSON.parse(r.request().postData() || '{}');
    const t = tenants[0];
    const next = { ...t, plan: posted.plan, accessUntil: posted.accessUntil ? until(30) : null, suspendedAt: posted.suspended ? new Date().toISOString() : null, accessNote: posted.note,
      access: A(posted.suspended ? 'suspended' : 'active', posted.plan, posted.accessUntil ? 30 : null, posted.suspended) };
    tenants = [next, ...tenants.slice(1)];
    await json(r, next);
  });
  await pa.goto(UI + '/platform-admin', { waitUntil: 'networkidle' });
  await pa.locator('.pa-row').first().waitFor({ timeout: 10000 });
  const badges = async () => Object.fromEntries(await Promise.all(tenants.map(async (t) => [t.id, (await pa.locator('.pa-row', { hasText: t.name }).locator('.pa-badge[data-access]').allInnerTexts()).join(' | ')])));
  const b = await badges();
  ok(b['demo-clinic'].includes('دمو') && b['demo-clinic'].includes(`${fa(12)} روز مانده`), `بجِ دمو: ${b['demo-clinic']}`);
  ok(/منقضی/.test(b['late-clinic']) && /فقط‌خواندنی/.test(b['late-clinic']), `بجِ منقضی: ${b['late-clinic']}`);
  ok(b['off-clinic'] === 'معلق', `بجِ معلق: ${b['off-clinic']}`);
  ok(b['paid-clinic'] === '', 'اشتراکِ بی‌مهلت بجِ اضافه ندارد');
  const activeStat = (await pa.locator('.pa-stat', { hasText: 'شرکتِ فعال' }).locator('b').innerText()).trim();
  ok(activeStat === fa(3), `«شرکتِ فعال» معلق را نمی‌شمرد (${activeStat})`);
  if (SHOTS) await pa.screenshot({ path: `${SHOTS}/tenant-access-panel.png`, fullPage: false });

  await pa.locator('.pa-row', { hasText: 'مطبِ دمو' }).getByRole('button', { name: 'دسترسی' }).click();
  const dlg = pa.locator('.pa-access');
  await dlg.waitFor({ timeout: 5000 });
  ok(await dlg.locator('#pa-access-plan').inputValue() === 'demo' && /\d{4}\/\d{2}\/\d{2}/.test(await dlg.locator('#pa-access-until').inputValue()), 'دیالوگ با وضعیتِ فعلی پر شده (دمو + تاریخِ شمسی)');
  ok(await dlg.locator('#pa-access-note').inputValue() === 'مشتریِ احتمالی', 'یادداشتِ اپراتور آمده');
  await dlg.getByRole('button', { name: 'یک ماه' }).click();
  const typed = await dlg.locator('#pa-access-until').inputValue();
  ok(/^\d{4}\/\d{2}\/\d{2}$/.test(typed), `چیپِ «یک ماه» تاریخِ شمسی گذاشت (${typed})`);
  await dlg.locator('#pa-access-plan').selectOption('paid');
  await dlg.locator('#pa-access-note').fill('پرداختِ یک‌ماهه');
  if (SHOTS) await pa.screenshot({ path: `${SHOTS}/tenant-access-dialog.png` });
  await dlg.getByRole('button', { name: 'ذخیره' }).click();
  await dlg.locator('.pa-access-sum').waitFor({ timeout: 5000 });
  ok(posted && posted.plan === 'paid' && posted.suspended === false && /^\d{4}-\d{2}-\d{2}$/.test(posted.accessUntil) && posted.note === 'پرداختِ یک‌ماهه',
    `بدنهٔ درخواست: ${JSON.stringify(posted)}`);
  ok(/ذخیره شد/.test(await dlg.locator('.pa-access-sum').innerText()) && /۳۰ روز مانده/.test(await dlg.locator('.pa-access-sum').innerText()), 'خلاصهٔ پس از ذخیره از پاسخِ سرور');
  await dlg.getByRole('button', { name: 'بستن' }).click();
  await dlg.waitFor({ state: 'detached', timeout: 5000 });
  const b2 = await badges();
  ok(/اشتراک تا/.test(b2['demo-clinic']) && /۳۰ روز/.test(b2['demo-clinic']), `کارت بی‌بارگذاریِ دوباره تازه شد: ${b2['demo-clinic']}`);

  await pa.locator('#pa-plan').selectOption('demo');
  ok(await pa.locator('#pa-days').inputValue() === '14', 'فرمِ ساخت: دمو → ۱۴ روزِ پیش‌فرض');
  await pa.locator('#pa-plan').selectOption('paid');
  ok(/بی‌مهلت/.test(await pa.locator('label[for="pa-days"]').innerText()), 'اشتراک → برچسبِ «خالی = بی‌مهلت»');

  console.log('\n   فرمِ ساخت: نوعِ نصب (مطب / شرکتی)');
  ok(await pa.locator('.pa-row', { hasText: 'مطبِ دمو' }).locator('.pa-profile').innerText() === 'مطب / کلینیک', 'کارتِ شرکت نوعِ فعلی‌اش را نشان می‌دهد');
  const kind = pa.locator('#pa-kind');
  ok(await kind.count() === 1 && (await kind.locator('option').allInnerTexts()).join('|') === '— انتخاب کنید —|مطب / کلینیک|شرکتی', 'گزینه‌ها از سرور: «مطب / کلینیک» و «شرکتی»');
  const createBtn = pa.locator('form.pa-create > button').last();
  await pa.locator('form.pa-create input').first().fill('مطبِ آزمون');
  await pa.locator('form.pa-create input').nth(1).fill('clinic-x');
  ok(await createBtn.isDisabled(), '**بدونِ انتخابِ نوع، «ساخت» غیرفعال است** (نوعِ پیش‌فرضِ پنهان نداریم)');
  await kind.selectOption('company');
  ok(await pa.locator('.pa-services input[type=checkbox]').count() === 2 && await pa.locator('.pa-services input:checked').count() === 1, 'شرکتی: دو خدمت، که نخستینش پیش‌فرض تیک خورده');
  await pa.locator('.pa-services .pa-check').first().locator('input').uncheck();
  ok(await createBtn.isDisabled(), 'شرکتیِ بی‌خدمت دکمه را غیرفعال می‌کند');
  const chk = await pa.locator('.pa-services .pa-check').first().boundingBox();
  ok(chk && chk.height >= 44, `هدفِ لمسِ تیک‌خور ≥ ۴۴ پیکسل (${Math.round(chk?.height)})`);
  await kind.selectOption('clinic');
  ok(await pa.locator('.pa-services').count() === 0 && await createBtn.isEnabled(), 'مطب: خدماتی نمی‌خواهد و «ساخت» فعال می‌شود');
  if (SHOTS) await pa.screenshot({ path: `${SHOTS}/platform-create-kind-clinic.png` });
  await kind.selectOption('company');
  await pa.locator('.pa-services .pa-check').nth(1).locator('input').check();
  if (SHOTS) await pa.screenshot({ path: `${SHOTS}/platform-create-kind-company.png` });
  await createBtn.click();
  await pa.waitForFunction(() => document.querySelector('.pa-notice')?.textContent?.includes('وارد صف شد'), null, { timeout: 5000 }).catch(() => {});
  ok(created && created.kind === 'company' && JSON.stringify(created.services.sort()) === '["implant","ionm"]', `بدنهٔ ساخت: ${JSON.stringify(created)}`);
  await pa.locator('#pa-kind').waitFor();
  await kind.selectOption('clinic');
  await pa.locator('form.pa-create input').first().fill('مطبِ دوم');
  await pa.locator('form.pa-create input').nth(1).fill('clinic-y');
  await createBtn.click();
  await pa.waitForFunction(() => document.querySelector('.pa-notice')?.textContent?.includes('clinic-y'), null, { timeout: 5000 }).catch(() => {});
  ok(created && created.kind === 'clinic' && Array.isArray(created.services) && created.services.length === 0, `مطب: ${JSON.stringify(created)}`);

  console.log('\n   آمادگیِ سامانه (نوارِ چیپ‌ها بالای صفحه)');
  const chips = async (page) => (await page.locator('.pa-health-chips .pa-badge').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  await pa.locator('.pa-health-chips .pa-badge').first().waitFor({ timeout: 5000 });
  let c = await chips(pa);
  ok(c.length === 4 && c[0] === 'فایل‌ها: ماندگار' && c[1] === 'پیامک: آماده' && c[2] === 'نسخه: abc1234' && c[3] === 'پشتیبان: خارج از برنامه', `چیپ‌ها: ${c.join(' | ')}`);
  ok(await pa.locator('.pa-health .pa-badge.ok').count() === 2, 'فایل‌ها و پیامک سبزند');
  ok(await pa.locator('.pa-health-notes').count() === 0, '**وقتی همه سالم است هیچ سطرِ علتی نیست** (نوار باریک می‌ماند)');
  ok((await pa.locator('.pa-health').boundingBox())?.height < 90, `نوارِ سالم کم‌جاست (${Math.round((await pa.locator('.pa-health').boundingBox())?.height)} پیکسل)`);
  ok(await pa.locator('.pa-health-chips li').nth(3).locator('.pa-badge').getAttribute('title').then((t) => /Coolify/.test(t) && /BACKUP-RESTORE/.test(t)), 'چیپِ پشتیبان صادقانه «خارج از برنامه» است و به راهنما اشاره می‌کند، نه سبزِ ساختگی');
  ok(!(await pa.locator('.pa-health .pa-badge.ok').allInnerTexts()).some((t) => /پشتیبان/.test(t)), 'پشتیبان هیچ‌وقت سبز نیست');
  const rb = await pa.locator('.pa-health .pa-refresh').boundingBox();
  ok(rb && rb.height >= 44, `هدفِ لمسِ «بازخوانی» ≥ ۴۴ پیکسل (${Math.round(rb?.height)})`);
  if (SHOTS) {
    for (const theme of ['dark', 'light']) {
      await pa.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await pa.waitForTimeout(150);
      await pa.locator('.pa-health').screenshot({ path: `${SHOTS}/platform-health-ok-${theme}.png` });
    }
    await pa.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  }

  health = {
    ...health,
    storage: { ...health.storage, verdict: 'ephemeral', deploys: 1, separateMount: false, message: 'پوشهٔ فایل‌ها روی volume نیست؛ با دیپلوی بعدی همهٔ فایل‌های آپلودی پاک می‌شود — در Coolify یک volume روی /app/storage سوار کنید' },
    sms: { configured: false, shared: true, message: 'کلید یا خطِ ملی‌پیامک (MELI_API_KEY / MELI_FROM) در سرور تنظیم نیست — هیچ شرکتی پیامک نمی‌فرستد' },
  };
  await pa.locator('.pa-health .pa-refresh').click();
  await pa.locator('.pa-health-notes li').first().waitFor({ timeout: 5000 });
  c = await chips(pa);
  ok(c[0] === 'فایل‌ها: روی volume نیست' && c[1] === 'پیامک: تنظیم نیست', `**حالتِ بد در چیپ‌ها: ${c.slice(0, 2).join(' | ')}**`);
  ok(await pa.locator('.pa-health .pa-badge.fail').count() === 2, 'هر دو قرمزند');
  const notes = await pa.locator('.pa-health-notes li').allInnerTexts();
  ok(notes.length === 2 && /\/app\/storage/.test(notes[0]) && /MELI_API_KEY/.test(notes[1]), `**علتِ فارسی و راهِ درمان زیرِ چیپ‌ها: ${notes.length} سطر**`);
  ok(await pa.locator('.pa-health-notes li.fail').count() === 2, 'سطرهای علت قرمزند');
  const ltr = await pa.locator('.pa-health-notes bdi[dir="ltr"]').allInnerTexts();
  ok(ltr.includes('/app/storage') && ltr.includes('MELI_API_KEY / MELI_FROM') && ltr.includes('Coolify'), `**مسیر و نامِ متغیر در متنِ فارسی ltr جداست: ${ltr.join(' | ')}** (بی‌این «/app/storage» برعکس دیده می‌شد)`);
  if (SHOTS) {
    for (const theme of ['dark', 'light']) {
      await pa.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await pa.waitForTimeout(150);
      await pa.locator('.pa-health').screenshot({ path: `${SHOTS}/platform-health-bad-${theme}.png` });
    }
    await pa.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  }
  health = { ...health, storage: { ...health.storage, verdict: 'unproven', separateMount: true, message: 'پوشهٔ فایل‌ها روی volume جداست؛ ماندگاری با دیپلوی بعدی اثبات می‌شود' }, sms: { ...health.sms, configured: true } };
  await pa.locator('.pa-health .pa-refresh').click();
  await pa.waitForFunction(() => document.querySelector('.pa-health-notes li.warn'), null, { timeout: 5000 });
  ok(await pa.locator('.pa-health-notes li.warn').count() === 1 && await pa.locator('.pa-health .pa-badge.fail').count() === 0, 'ثابت‌نشده = کهربایی (نه قرمز) و پیامکِ آماده سبز');
  healthStatus = 500;
  await pa.locator('.pa-health .pa-refresh').click();
  await pa.locator('.pa-health .pa-badge.fail').first().waitFor({ timeout: 5000 });
  ok(/خوانده نشد/.test(await pa.locator('.pa-health .pa-badge.fail').first().innerText()) && await pa.locator('.pa-health-chips').count() === 0, 'خطای سرور: «خوانده نشد» با علت، بی‌چیپِ دروغین');
  ok(await pa.locator('.pa-row').count() >= 1, 'خطای سلامت بقیهٔ پنل را نمی‌شکند');
  healthStatus = 200;

  const paPhone = await newPage({ width: 390, height: 844 });
  await paPhone.route('**/api/platform/auth/me', (r) => json(r, { ok: true }));
  await paPhone.route('**/api/platform/snapshot', (r) => json(r, { tenants, jobs: [], deletions: [], profileOptions }));
  await paPhone.route('**/api/platform/health', healthRoute);
  await paPhone.route('**/api/platform/hospitals**', (r) => json(r, { rows: [], total: 0, page: 1, pages: 1, provinces: [], coverage: { total: 0, verified: 0 } }));
  await paPhone.goto(UI + '/platform-admin', { waitUntil: 'networkidle' });
  await paPhone.locator('.pa-row').first().waitFor({ timeout: 10000 });
  ok(await noHScroll(paPhone), 'پنل روی گوشی بی‌اسکرولِ افقی');
  health = { ...health, storage: { ...health.storage, verdict: 'ephemeral', message: 'پوشهٔ فایل‌ها روی volume نیست؛ با دیپلوی بعدی همهٔ فایل‌های آپلودی پاک می‌شود — در Coolify یک volume روی /app/storage سوار کنید' }, sms: { ...health.sms, configured: false, message: 'کلید یا خطِ ملی‌پیامک (MELI_API_KEY / MELI_FROM) در سرور تنظیم نیست — هیچ شرکتی پیامک نمی‌فرستد' } };
  await paPhone.reload({ waitUntil: 'networkidle' });
  await paPhone.locator('.pa-health-notes li').first().waitFor({ timeout: 5000 });
  ok(await noHScroll(paPhone), 'گوشی: نوارِ آمادگی با علت‌های بلند اسکرولِ افقی نمی‌سازد');
  ok((await paPhone.locator('.pa-health .pa-refresh').boundingBox())?.height >= 44, 'گوشی: «بازخوانی» ≥ ۴۴ پیکسل');
  const ph = await paPhone.evaluate(() => {
    const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const chips = box('.pa-health-chips'); const title = box('.pa-health h2'); const total = box('.pa-health');
    return { chipsBelow: chips.top >= title.bottom - 1, total: total.height };
  });
  ok(ph.chipsBelow && ph.total < 380, `گوشی: چیپ‌ها زیرِ عنوان‌اند و نوار کم‌جاست (${Math.round(ph.total)} پیکسل)`);
  if (SHOTS) {
    await paPhone.locator('.pa-health').screenshot({ path: `${SHOTS}/platform-health-bad-phone.png` });
    await paPhone.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await paPhone.waitForTimeout(150);
    await paPhone.locator('.pa-health').screenshot({ path: `${SHOTS}/platform-health-bad-phone-light.png` });
    await paPhone.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  }
  await paPhone.locator('.pa-row', { hasText: 'مطبِ منقضی' }).getByRole('button', { name: 'دسترسی' }).click();
  await paPhone.locator('.pa-access').waitFor({ timeout: 5000 });
  if (SHOTS) await paPhone.screenshot({ path: `${SHOTS}/tenant-access-dialog-phone.png` });

  ok(errs.length === 0, errs.length ? `خطای کنسول: ${errs[0]}` : 'هیچ خطای کنسولی');
} finally {
  await control.tenant.update({ where: { slug: SLUG }, data: { plan: 'paid', accessUntil: null, suspendedAt: null, accessNote: null } }).catch(() => {});
  await control.$disconnect();
  await browser?.close();
}
console.log(`\n${pass} سبز · ${fail} قرمز`);
process.exit(fail ? 1 : 0);
