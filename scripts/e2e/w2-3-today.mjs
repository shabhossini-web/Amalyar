/**
 * W2.3 — صفحهٔ «امروز» در مرورگرِ واقعی:
 * - `/app` دیگر لانچر نیست: سلام + چیپ‌های خلاصه می‌آید و شبکهٔ کاشی‌ها نه
 *   («نباید بیفتد»: `.lx-tools` روی `/app`) — و `/app/tools` هنوز لانچر است
 * - خلاصه و فهرست‌ها از `GET /work/today` می‌آیند: عملِ امروز و نوبتِ امروز با نامِ بیمار
 * - کارِ من: ردیف می‌آید، «انجام شد» می‌بندد و چیپِ «کارِ باز» یکی پایین می‌آید
 * - کشوی «همهٔ ابزارها»: باز می‌شود، کاشی می‌برد، Escape می‌بندد **بدونِ** ناوبری
 * - گیتِ بخش‌ها سمتِ سرور: کارشناسِ سطح ۲ نوبت‌ها را نمی‌گیرد (`sections.appointments=false`)
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { browserLogin } from './lib/browser-login.mjs';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'td' + randomBytes(3).toString('hex');
const trash = { visits: [], forms: [], appts: [], accounts: [] };
const today = new Date().toISOString().slice(0, 10);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[console.${m.type()}] ${m.text()}`); });

try {
  await browserLogin(page, login.accessToken, { ui: UI });
  const form = (await send('/forms', 'POST', { key: tag, title: `ویزیتِ ${tag}`, scope: 'visit' })).json;
  trash.forms.push(form.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بهارِ', lastName: `امروز${tag}`, phone: '09120000914',
    opDate: new Date().toISOString(), opStartTime: '08:30',
  })).json;
  if (!visit?.id) { console.error('مراجعه ساخته نشد', visit); process.exit(1); }
  trash.visits.push(visit.id);
  const pid = Number(sql(`SELECT patient_id FROM visits WHERE id=${visit.id}`));
  const apptId = Number(sql(`INSERT INTO appointments(patient_id, date, start_min, status) VALUES (${pid}, '${today}', 630, 'confirmed') RETURNING id`));
  trash.appts.push(apptId);
  const work = (await send('/work', 'POST', { title: `تماس با بهار ${tag}`, priority: 2, dueAt: new Date(Date.now() - 3600e3).toISOString() })).json;

  console.log('۱) `/app` صفحهٔ «امروز» است، نه لانچر');
  await page.goto(UI + '/app', { waitUntil: 'networkidle' });
  await page.waitForSelector('.td-hello', { timeout: 15000 });
  ok(await page.locator('.td-hello').count() === 1, 'سلامِ صفحهٔ «امروز» رندر شد');
  ok(await page.locator('.td-chips li').count() >= 2, 'چیپ‌های خلاصه آمدند');
  ok(await page.locator('.lx-tools').count() === 0, '**نباید بیفتد:** شبکهٔ کاشی‌های لانچر روی `/app` نیست');
  ok(await page.locator('.sh-bar').count() === 1 && await page.locator('.pm-chip').count() === 1, 'نوارِ پوسته و منوی پروفایل دقیقاً یک‌بار');

  console.log('\n۲) امروزِ من از سرور');
  const chips = (await page.locator('.td-chips').innerText()).replace(/\s+/g, ' ');
  ok(/عملِ امروز/.test(chips) && /نوبتِ امروز/.test(chips), 'چیپِ عمل و نوبت برای ادمین هست');
  const visitRow = page.locator('.td-sec', { hasText: 'عمل‌های امروز' }).locator('.td-item', { hasText: `امروز${tag}` });
  ok(await visitRow.count() === 1, 'عملِ امروز با نامِ بیمار در فهرست است');
  ok((await visitRow.innerText()).includes('08:30'), '… با ساعتِ شروع');
  const apptRow = page.locator('.td-sec', { hasText: 'نوبت‌های امروز' }).locator('.td-item', { hasText: `امروز${tag}` });
  ok(await apptRow.count() === 1 && (await apptRow.innerText()).includes('10:30'), 'نوبتِ امروز با ساعتِ درست (۶۳۰ دقیقه → 10:30)');

  console.log('\n۳) کارهای من روی همین صفحه');
  const row = page.locator(`.wk-row[data-work-id="${work.id}"]`);
  ok(await row.count() === 1, 'کارِ تازه در بخشِ «کارهای من» است');
  /* عددِ چیپ از خودِ <b> خوانده می‌شود؛ متنِ کامل «۳ کارِ باز (۱ عقب‌افتاده)» دو عدد دارد. */
  const faToEn = (t) => t.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[^0-9]/g, '');
  const openChip = () => page.locator('.td-chips li').first().locator('b').innerText().then(faToEn).then(Number);
  const openBefore = await openChip();
  await row.locator('button.primary').click();
  await page.waitForSelector(`.wk-row[data-work-id="${work.id}"]`, { state: 'detached', timeout: 8000 });
  ok(true, '«انجام شد» ردیف را برداشت');
  ok(sql(`SELECT state FROM work_items WHERE id=${work.id}`) === 'done', '… و در سرور بسته شد');
  const openAfter = await openChip();
  ok(openAfter === Math.max(0, openBefore - 1), `چیپِ «کارِ باز» یکی پایین آمد (${openBefore} → ${openAfter})`);

  console.log('\n۴) کشوی «همهٔ ابزارها»');
  await page.locator('.td-tools-btn').click();
  await page.waitForSelector('.td-drawer', { timeout: 5000 });
  ok(await page.locator('.td-tile').count() > 3, 'کشو باز شد و کاشی‌ها آمدند');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.td-drawer', { state: 'detached', timeout: 5000 });
  ok(new URL(page.url()).pathname === '/app', '**نباید بیفتد:** Escape می‌بندد ولی صفحه را عوض نمی‌کند');
  await page.locator('.td-tools-btn').click();
  await page.waitForSelector('.td-drawer', { timeout: 5000 });
  await page.locator('.td-tile', { hasText: 'بیماران' }).click();
  await page.waitForURL('**/app/dashboard', { timeout: 8000 });
  ok(new URL(page.url()).pathname === '/app/dashboard', 'کاشیِ کشو به همان صفحه می‌برد');

  console.log('\n۵) لانچر روی `/app/tools` سرِ جایش است');
  await page.goto(UI + '/app/tools', { waitUntil: 'networkidle' });
  await page.waitForSelector('.lx-tile', { timeout: 10000 });
  ok(await page.locator('.lx-tile').count() > 3, 'نمای کاملِ ابزارها هنوز هست');
  ok(await page.locator('.pm-chip').count() === 1, '… و منوی پروفایل باز هم یک‌بار (پوسته آن را تکرار نمی‌کند)');

  console.log('\n۶) گیتِ بخش‌ها — کارشناسِ سطح ۲');
  const made = (await send('/accounts/temporary', 'POST', {
    firstName: 'کارشناسِ', lastName: `آزمون ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
    level: 2, jobRole: 'technician', username: `t${tag}`,
  })).json;
  if (made?.account?.id) {
    trash.accounts.push(made.account.id);
    const tl = await fetch(API + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: `t${tag}`, password: made.temporaryPassword }),
    }).then((r) => r.json());
    const mine = await fetch(API + '/work/today', { headers: { Authorization: 'Bearer ' + tl.accessToken } }).then((r) => r.json());
    ok(mine?.sections?.visits === true, 'کارشناس عمل‌های خودش را می‌بیند');
    ok(mine?.sections?.appointments === false && Array.isArray(mine.appointments) && mine.appointments.length === 0,
      '**نباید بیفتد:** تقویم برای سطح ۲ باز نیست، پس نوبت‌ها نه بخش دارند نه داده');
    ok(mine?.visits?.every((v) => v.id !== visit.id) !== false, '… و عملِ کارشناسِ دیگر در فهرستش نیست');
  } else {
    ok(false, `حسابِ آزمایشی ساخته نشد: ${JSON.stringify(made).slice(0, 120)}`);
  }

  console.log('\n۷) سلامتِ صفحه');
  ok(errors.length === 0, `بدونِ خطای جاوااسکریپت (${errors.length})${errors.length ? ' — ' + errors[0].slice(0, 160) : ''}`);
} finally {
  await browser.close().catch(() => {});
  sql(`DELETE FROM appointments WHERE id IN (${trash.appts.join(',') || -1})`);
  for (const v of trash.visits) await send(`/visits/${v}`, 'DELETE').catch(() => {});
  for (const f of trash.forms) await send(`/forms/${f}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM work_items WHERE title LIKE '%${tag}%'`);
  for (const id of trash.accounts) {
    sql(`DELETE FROM account_sessions WHERE account_id=${id}`);
    sql(`DELETE FROM accounts WHERE id=${id}`);
  }
}
console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
