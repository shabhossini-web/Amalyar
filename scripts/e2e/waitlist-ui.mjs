/**
 * **بستهٔ ۹ در رابط** — فهرستِ انتظارِ عمل، برنامهٔ عملِ بی‌تاریخ، فرمِ تکمیلیِ موضوع.
 *
 *  باید بیفتد:
 *   - کاشیِ «فهرستِ انتظارِ عمل» = عنوانِ صفحه (قانونِ ۲۴) (U1)
 *   - «برنامهٔ عمل» فرمِ عمل را در حالتِ «هنوز تاریخ ندارد» باز می‌کند و ذخیره ردیف را «بی‌تاریخ» می‌کند (U2)
 *   - موضوعِ فرم‌دار فرمش را داخلِ فرمِ مراجعه می‌آورد و پاسخ ذخیره می‌شود (U3)
 *  نباید بیفتد:
 *   - سرریزِ افقی روی ۳۹۰ (M1)، خطای JS
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';
const SHOTS = process.env.E2E_SHOTS ?? null;
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken }, body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const tag = randomBytes(3).toString('hex');
const day = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const trash = { visits: [], forms: [], topics: [] };
const restore = [];
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const errors = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`${who}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${who} [console.error] ${m.text()}`); });
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/p9-${name}.png`, fullPage: true }).catch(() => {}); };

try {
  ok('سوییچ به مطب', (await send('/config/vertical', 'PATCH', { vertical: 'clinic' })).status === 200);
  /* DBِ تازهٔ CI فرمِ ویزیتِ مطب ندارد — مثلِ بقیهٔ سوییت‌ها، اگر نیست ساخته می‌شود. */
  if (Number(sql(`SELECT count(*) FROM form_defs WHERE scope='visit' AND active=TRUE AND visit_kind='clinic'`)) === 0)
    await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  const surgeon = (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `رابط${tag}` })).json;
  const proc = (await send('/procedure-types', 'POST', { name: `عملِ رابط ${tag}` })).json;
  const D = (await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'فهرستِ', lastName: `انتظار${tag}`, opDate: day(-15), surgeonId: surgeon.id, chiefComplaint: 'درد', decisions: ['surgery'],
  })).json;
  trash.visits.push(D.id);
  const F = (await send('/forms', 'POST', { key: `u${tag}`, title: `پرسش‌نامهٔ زیبایی ${tag}`, scope: 'record' })).json;
  trash.forms.push(F.id);
  await send(`/forms/${F.id}/fields`, 'POST', { key: 'goal', label: 'هدفِ بیمار', type: 'text', required: true });
  const T = (await send('/visit-topics', 'POST', { name: `زیبایی ${tag}`, formId: F.id })).json;
  trash.topics.push(T?.id);

  console.log('۱) کاشی و صفحه');
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  watch(page, 'desktop');
  await browserLogin(page, login.accessToken, { ui: UI });
  await page.goto(UI + '/app/tools', { waitUntil: 'networkidle' });
  await page.locator('.lx-tile').first().waitFor({ timeout: 8000 }).catch(() => {});
  const tile = page.locator('.lx-tile', { hasText: 'فهرستِ انتظارِ عمل' });
  ok('U1 کاشیِ «فهرستِ انتظارِ عمل» در لانچر', await tile.count() >= 1);
  await page.goto(UI + '/app/waitlist', { waitUntil: 'networkidle' });
  ok('U1 عنوانِ صفحه = نامِ کاشی', (await page.locator('.wl-head h1').innerText()).includes('فهرستِ انتظارِ عمل') && (await page.title()).startsWith('فهرستِ انتظارِ عمل'));
  const row = page.locator(`[data-wl-row="awaiting:${D.id}"]`);
  await row.waitFor({ timeout: 8000 });
  ok('U1 ردیفِ «منتظرِ برنامه» با ۱۵ روز انتظار', /۱۵ روز انتظار/.test(await row.innerText()), await row.innerText());
  await shot(page, 'waitlist');

  console.log('\n۲) برنامهٔ عمل ← بی‌تاریخ');
  await row.locator('[data-act="plan"]').click();
  const sheet = page.locator('.db-sheet');
  await sheet.waitFor({ timeout: 8000 });
  await sheet.locator('[data-undated]').waitFor({ timeout: 8000 }).catch(() => {});
  ok('U2 فرمِ عمل در حالتِ «هنوز تاریخ ندارد» باز شد', await sheet.locator('[data-undated][aria-pressed="true"]').count() === 1);
  /* نوعِ عمل (ستاره‌دار) — از کشوییِ Pick، همان مسیرِ کاربر. */
  await sheet.locator('.db-builtins .db-field', { hasText: 'نوعِ عمل' }).first().locator('button').first().click();
  await page.locator('[role="option"]', { hasText: proc.name }).first().click();
  const saves = [];
  page.on('request', (rq) => { if (rq.method() === 'POST' && /\/api\/visits$/.test(rq.url())) saves.push(rq.postDataJSON()); });
  await sheet.locator('.db-submit').click();
  await page.waitForTimeout(1800);
  ok('U2 ذخیره با opDateOpen و بی‌تاریخ', saves[0]?.opDateOpen === true && !saves[0]?.opDate && saves[0]?.decidedInVisitId === D.id,
    JSON.stringify(saves[0] ?? {}).slice(0, 200) + ' toast=' + await page.locator('.wl-toast').innerText().catch(() => ''));
  await shot(page, 'plan-after-save');
  const sid = Number(sql(`SELECT coalesce(max(id),0) FROM visits WHERE decided_in_visit_id=${D.id}`));
  if (sid) trash.visits.push(sid);
  await page.locator(`[data-wl-row="surgery:${sid}"]`).waitFor({ timeout: 8000 }).catch(() => {});
  ok('U2 ردیف «بی‌تاریخ» شد', /بی‌تاریخ/.test(await page.locator(`[data-wl-row="surgery:${sid}"]`).innerText().catch(() => '')));

  console.log('\n۳) فرمِ تکمیلیِ موضوع');
  /* فیلدِ «موضوعِ ویزیت» در فرمِ ویزیت پیش‌فرض خاموش است (کاتالوگ) — مثلِ visit-topic روشنش می‌کنیم. */
  const topicRow = ((await send('/forms/visit.clinic')).json?.fields ?? []).find((f) => f.key === 'topicId');
  if (topicRow && !topicRow.active) { await send(`/forms/fields/${topicRow.id}`, 'PATCH', { active: true }); restore.push(() => send(`/forms/fields/${topicRow.id}`, 'PATCH', { active: false })); }
  await page.goto(`${UI}/app/dashboard?patient=${D.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.db-sheet', { timeout: 10000 });
  await page.locator('.db-sheet .db-builtins .db-field', { hasText: 'موضوعِ ویزیت' }).first().locator('button').first().click();
  await page.locator('[role="option"]', { hasText: T.name }).first().click();
  const supp = page.locator(`[data-supplement="${F.id}"]`);
  await supp.waitFor({ timeout: 8000 }).catch(() => {});
  ok('U3 فرمِ تکمیلیِ موضوع داخلِ فرم آمد', await supp.count() === 1 && (await supp.innerText()).includes(F.title));
  await supp.locator('input, textarea').first().fill('صاف‌شدنِ بینی');
  await page.locator('.db-sheet .db-submit').click();
  await page.waitForTimeout(1800);
  ok('U3 پاسخ ذخیره شد', sql(`SELECT data->>'goal' FROM visit_supplements WHERE visit_id=${D.id} AND form_id=${F.id}`) === 'صاف‌شدنِ بینی');
  await shot(page, 'supplement');
  await page.close();

  console.log('\n۴) موبایل ۳۹۰');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  watch(m, 'mobile');
  await browserLogin(m, login.accessToken, { ui: UI });
  await m.goto(UI + '/app/waitlist', { waitUntil: 'networkidle' });
  await m.locator('.wl-row').first().waitFor({ timeout: 8000 }).catch(() => {});
  const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`M1 بی‌سرریزِ افقی (${over}px)`, over <= 1);
  await shot(m, 'mobile');
  await ctx.close();
  ok('بدونِ خطای جاوااسکریپت', errors.length === 0, errors[0]?.slice(0, 200));
} catch (e) {
  ok(`اجرا متوقف شد: ${e?.message ?? e}`, false);
} finally {
  await browser.close().catch(() => {});
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  ok('برگشت به حوزهٔ قبلی', back.status === 200, String(back.status));
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const f of restore) await f().catch(() => {});
  for (const id of trash.topics) if (id) await send(`/visit-topics/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) if (id) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}
console.log(`\n${pass} سبز · ${fails.length} قرمز`);
if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
