/**
 * بستهٔ ب — کالاها در انبار، ست به‌عنوانِ بستهٔ موجودی، خرابی‌ها (مالک، ۱۴۰۵/۰۷/۱۱) — سرورِ زنده + مرورگر.
 *
 *  باید بیفتد:
 *   - انباردارِ سطح ۳ در کاشیِ «انبار» تبِ «کالاها» را اول می‌بیند، کالا می‌سازد (با دو تیک) و محتویاتِ ست را
 *     تعریف می‌کند — بی‌دسترسیِ مدیریتی (مجوزِ inventory.items)
 *   - تبِ «ست‌ها»: استاندارد از قالب، داخلِ ست از دفتر، کسری حساب‌شده؛ «تکمیل از انبار» ست را پر می‌کند و انبار کم می‌شود
 *   - «خرابی» قلم را به «خرابی‌ها» می‌برد؛ «تعمیر و برگشت» به انبار و «اسقاط» خروجِ قطعی
 *   - تعاریفِ پایه ← کالاها فقط پیوند به انبار است
 *  نباید بیفتد:
 *   - کارشناسِ سطح ۲ کالا نسازد (۴۰۳)؛ هیچ خطای کنسول/HTTP
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { browserLogin } from './lib/browser-login.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.E2E_SHOTS ?? '';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));
const loginAs = (identifier, password) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
}).then((r) => r.json());
const call = (token) => (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const login = await loginAs(process.env.E2E_USER ?? 'admin', process.env.E2E_PASS ?? 'test1234');
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = call(login.accessToken);
const tag = 'ws' + randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const trash = { accounts: [], items: [], lots: [], features: [] };
let browser;

try {
  console.log('۰) آماده‌سازی: انباردارِ سطح ۳، کارشناسِ سطح ۲، ماژولِ انبار روشن');
  const feats = (await send('/features')).json ?? [];
  for (const k of ['inventory']) {
    if (feats.find((f) => f.key === k)?.enabled === false) { sql(`UPDATE features SET enabled=true WHERE key='${k}'`); trash.features.push(k); }
  }
  const mkAccount = async (user, first, last, level, jobRole) => {
    const made = (await send('/accounts/temporary', 'POST', { firstName: first, lastName: `${last}${tag}`, phone: phone(), level, jobRole, username: `${user}${tag}` })).json;
    if (!made?.account?.id) throw new Error('حساب ساخته نشد: ' + JSON.stringify(made).slice(0, 160));
    trash.accounts.push(made.account.id);
    return { id: made.account.id, username: `${user}${tag}`, password: made.temporaryPassword };
  };
  const keeper = await mkAccount('wk', 'انباردارِ', 'سه', 3, 'technician');
  const tech = await mkAccount('wt', 'کارشناسِ', 'دو', 2, 'technician');
  const sessK = await loginAs(keeper.username, keeper.password);
  const sessT = await loginAs(tech.username, tech.password);
  ok(!!(sessK.accessToken && sessT.accessToken), 'انباردار و کارشناس وارد شدند');
  const asK = call(sessK.accessToken), asT = call(sessT.accessToken);

  console.log('\n۱) مجوز: کالا با سطح ۳ ساخته می‌شود، با سطح ۲ نه');
  const setMade = await asK('/stock/items', 'POST', { name: `ست SDN ${tag}`, assetKind: 'set' });
  ok(setMade.status === 201 && setMade.json?.id, `انباردارِ سطح ۳ ست را تعریف کرد (${setMade.status})`);
  ok(setMade.json?.usageMode === 'multi', 'ست خودکار چندبارمصرف شد');
  const setItem = setMade.json; trash.items.push(setItem.id);
  const denied = await asT('/stock/items', 'POST', { name: `کالای ممنوع ${tag}` });
  ok(denied.status === 403, `کارشناسِ سطح ۲ کالا نمی‌سازد (${denied.status})`);
  const defsDenied = await asK('/items', 'POST', { name: `کالا از تعاریف ${tag}` });
  ok(defsDenied.status === 403, `مسیرِ قدیمیِ تعاریفِ پایه برای سطح ۳ همچنان بسته است (${defsDenied.status}) — درِ تازه فقط در انبار`);

  console.log('\n۲) مرورگر — انباردار کالا می‌سازد (دو تیک) و محتویاتِ ست را می‌چیند');
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`[${who}] ${e}`));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`[${who} http ${r.status()}] ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${who} console] ${m.text()}`); });
  };
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'keeper');
  await browserLogin(page, sessK.accessToken, { ui: UI });
  await page.goto(UI + '/app/inventory', { waitUntil: 'networkidle' });
  await page.waitForSelector('.iv-list', { timeout: 15000 });
  ok((await page.locator('[role=tab][aria-selected="true"]').first().innerText()).includes('کالاها'), 'تبِ اول و فعالِ انبار «کالاها» است');
  await page.locator('.iv-add', { hasText: 'کالای جدید' }).click();
  await page.waitForSelector('.iv-sheet', { timeout: 5000 });
  await page.locator('.iv-sheet .iv-field input').first().fill(`الکترود SDN ${tag}`);
  const switches = page.locator('.iv-sheet .iv-switch input[type=checkbox]');
  ok(await switches.count() === 2, 'دو تیک: نمایش در پنلِ کارشناسی، چندبارمصرف');
  // the real input is 1px and transparent (us-switch); the user flips the visible track
  const tracks = page.locator('.iv-sheet .iv-switch .us-track');
  await tracks.nth(0).click();
  await tracks.nth(1).click();
  ok((await switches.nth(0).isChecked()) && (await switches.nth(1).isChecked()), 'هر دو کلید با کلیک روی خودِ کلید روشن شدند');
  await page.locator('.iv-sheet .iv-save').click();
  await page.waitForFunction(() => /کالا تعریف شد/.test(document.querySelector('.iv-toast')?.textContent ?? ''), null, { timeout: 8000 });
  await page.waitForSelector('.iv-sheet', { state: 'detached', timeout: 8000 });
  const elId = num(`SELECT id FROM items WHERE name='الکترود SDN ${tag}'`);
  ok(elId > 0 && sql(`SELECT usage_mode || '/' || show_in_tech_panel FROM items WHERE id=${elId}`) === 'multi/true', 'کالا با هر دو تیک در دیتابیس نشست');
  trash.items.push(elId);
  const rowEl = page.locator('article.iv-item', { hasText: `الکترود SDN ${tag}` });
  await rowEl.waitFor({ timeout: 8000 });
  ok((await rowEl.locator('.iv-chip').allInnerTexts()).join('|').includes('چندبارمصرف') && (await rowEl.locator('.iv-chip').allInnerTexts()).join('|').includes('در پنلِ کارشناسی'), 'ردیفِ کالا هر دو چیپ را نشان می‌دهد');

  const rowSet = page.locator('article.iv-item', { hasText: `ست SDN ${tag}` });
  await rowSet.locator('button', { hasText: 'محتویات' }).click();
  await page.waitForSelector('.iv-sheet select', { timeout: 5000 });
  await page.locator('.iv-sheet select').selectOption(String(elId));
  await page.locator('.iv-sheet input[inputmode=numeric]').fill('20');
  await page.locator('.iv-sheet .iv-save', { hasText: 'افزودنِ قلم' }).click();
  await page.waitForSelector(`.iv-sheet .iv-parts article:has-text("الکترود SDN ${tag}")`, { timeout: 8000 });
  ok(num(`SELECT count(*) FROM item_components WHERE set_id=${setItem.id} AND part_id=${elId} AND quantity=20`) === 1, 'قالبِ ست: ۲۰ الکترود، به کالای تعریف‌شده وصل (ردیابی‌شده)');
  await page.locator('.iv-sheet .iv-x').click();

  console.log('\n۳) لات‌ها از API (مجوزِ انبار سطح ۳): ۱۰۰ الکترود، یک ستِ سریالی');
  const l1 = await asK('/stock/lots', 'POST', { itemId: elId, lotNo: `E-${tag}`, quantity: 100 });
  const l2 = await asK('/stock/lots', 'POST', { itemId: setItem.id, serialNo: `SE-${tag}`, quantity: 1 });
  ok(l1.status === 201 && l2.status === 201, `لات‌ها ساخته شدند (${l1.status}, ${l2.status})`);
  const elLot = num(`SELECT id FROM stock_lots WHERE lot_no='E-${tag}'`), setLot = num(`SELECT id FROM stock_lots WHERE serial_no='SE-${tag}'`);
  trash.lots.push(elLot, setLot);
  const home = sql(`SELECT location FROM stock_lots WHERE id=${elLot}`);
  const atLoc = (lot, loc) => num(`SELECT coalesce(sum(quantity),0) FROM stock_movements WHERE lot_id=${lot} AND location='${loc}'`);

  console.log('\n۴) مرورگر — تبِ ست‌ها: کسری، تکمیل، خرابی، تعمیر، اسقاط');
  await page.goto(UI + '/app/inventory?tab=sets', { waitUntil: 'networkidle' });
  const card = page.locator('article.iv-set', { hasText: `SE-${tag}` });
  await card.waitFor({ timeout: 15000 });
  ok((await card.locator('.iv-tag').innerText()).trim() === '۲۰ کسری', 'ستِ تازه: «۲۰ کسری»');
  const rowSdn = card.locator('.iv-setrow', { hasText: 'الکترود SDN' });
  ok((await rowSdn.locator('span').nth(1).innerText()).trim() === '۲۰' && (await rowSdn.locator('span').nth(2).innerText()).trim() === '۰', 'استاندارد ۲۰، داخلِ ست ۰');
  await card.locator('button', { hasText: 'تکمیل از انبار' }).click();
  await page.waitForFunction(() => /تکمیل شد/.test(document.querySelector('.iv-toast')?.textContent ?? ''), null, { timeout: 8000 });
  // plain DOM here — `:text-is()` is a Playwright-only selector and throws inside the page
  await page.waitForFunction((t) => {
    const card = [...document.querySelectorAll('article.iv-set')].find((a) => [...a.querySelectorAll('bdi')].some((b) => b.textContent.trim() === `SE-${t}`));
    return /کامل/.test(card?.querySelector('.iv-tag')?.textContent ?? '');
  }, tag, { timeout: 8000 }).catch(() => {});
  ok((await card.locator('.iv-tag').innerText()).trim() === 'کامل', 'پس از تکمیل: «کامل»');
  ok(atLoc(elLot, `ست SE-${tag}`) === 20 && atLoc(elLot, home) === 80, 'دفتر: ۲۰ در ست، ۸۰ در انبار');

  await card.locator('.iv-setrow', { hasText: 'الکترود SDN' }).locator('button', { hasText: 'خرابی' }).click();
  await page.waitForSelector('.iv-sheet', { timeout: 5000 });
  await page.locator('.iv-sheet input[inputmode=numeric]').fill('2');
  await page.locator('.iv-sheet input[placeholder]').last().fill(`کابل پاره ${tag}`);
  await page.locator('.iv-sheet .iv-save').click();
  await page.waitForFunction(() => /خرابی‌ها/.test(document.querySelector('.iv-toast')?.textContent ?? ''), null, { timeout: 8000 });
  await page.waitForSelector('.iv-sheet', { state: 'detached', timeout: 8000 }); // the old sheet lingers through its exit animation
  ok(atLoc(elLot, `ست SE-${tag}`) === 18 && atLoc(elLot, 'خرابی‌ها') === 2, 'خرابی: ۱۸ در ست، ۲ در «خرابی‌ها»');
  const dmgRow = page.locator('.iv-dmg article.iv-row', { hasText: `الکترود SDN ${tag}` });
  await dmgRow.waitFor({ timeout: 8000 });
  ok((await dmgRow.locator('.iv-qty b').innerText()).trim() === '۲' && (await dmgRow.innerText()).includes(`کابل پاره ${tag}`), 'بخشِ «خرابی‌ها» قلم را با دلیل نشان می‌دهد');
  await dmgRow.locator('button', { hasText: 'تعمیر و برگشت' }).click();
  await page.waitForSelector('.iv-sheet', { timeout: 5000 });
  await page.locator('.iv-sheet input[inputmode=numeric]').fill('1');
  await page.locator('.iv-sheet .iv-save').click();
  await page.waitForFunction(() => /به انبار برگشت/.test(document.querySelector('.iv-toast')?.textContent ?? ''), null, { timeout: 8000 });
  await page.waitForSelector('.iv-sheet', { state: 'detached', timeout: 8000 });
  ok(atLoc(elLot, home) === 81 && atLoc(elLot, 'خرابی‌ها') === 1, 'تعمیر: یکی به انبار برگشت');
  await dmgRow.locator('button', { hasText: 'اسقاط' }).click();
  await page.waitForSelector('.iv-sheet', { timeout: 5000 });
  await page.locator('.iv-sheet input[inputmode=numeric]').fill('1');
  await page.locator('.iv-sheet .iv-save').click();
  await page.waitForFunction(() => /اسقاط ثبت شد/.test(document.querySelector('.iv-toast')?.textContent ?? ''), null, { timeout: 8000 });
  await page.waitForSelector('.iv-sheet', { state: 'detached', timeout: 8000 });
  ok(atLoc(elLot, 'خرابی‌ها') === 0 && num(`SELECT count(*) FROM stock_movements WHERE lot_id=${elLot} AND kind='out' AND location='خرابی‌ها' AND reason LIKE '%اسقاط%'`) === 1, 'اسقاط: خروجِ قطعی با دلیل در دفتر');
  await page.waitForFunction(() => !document.querySelector('.iv-dmg article.iv-row'), null, { timeout: 8000 }).catch(() => {});
  ok(await page.locator('.iv-dmg article.iv-row').count() === 0, '«خرابی‌ها» خالی شد');
  await card.locator('button', { hasText: 'تکمیل از انبار' }).click();
  await page.waitForFunction(() => /تکمیل شد/.test(document.querySelector('.iv-toast')?.textContent ?? ''), null, { timeout: 8000 });
  ok(atLoc(elLot, `ست SE-${tag}`) === 20 && atLoc(elLot, home) === 79, 'تکمیلِ دوباره: ست ۲۰، انبار ۷۹ (۱۰۰ − ۲۰ − ۱ اسقاط)');
  await page.locator('.iv-ghost', { hasText: 'گزارشِ کسری' }).click();
  await page.waitForSelector('.iv-sheet .iv-stats', { timeout: 8000 });
  ok(await page.locator('.iv-sheet .iv-filters button').count() === 3, 'گزارشِ کسری با سه بازه باز شد');
  await page.locator('.iv-sheet .iv-x').click();

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    // گوشی و دسکتاپ، هر دو تم — معیارِ تأیید عکس است نه بیلدِ سبز (قانونِ ۲۸).
    for (const [name, vp] of [['phone', { width: 390, height: 844 }], ['desk', { width: 1200, height: 900 }]]) {
      const view = await browser.newContext({ viewport: vp, deviceScaleFactor: name === 'phone' ? 2 : 1 });
      const shot = await view.newPage();
      watch(shot, 'shots');
      await browserLogin(shot, sessK.accessToken, { ui: UI });
      const settle = () => shot.waitForTimeout(450); // only for the entry animation of the sheet — never a pass/fail criterion
      for (const theme of ['dark', 'light']) {
        await shot.goto(UI + '/app/inventory?tab=items', { waitUntil: 'networkidle' });
        await shot.waitForSelector('article.iv-item', { timeout: 15000 });
        await shot.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
        await settle();
        await shot.screenshot({ path: `${SHOTS}/sets-items-${name}-${theme}.png`, fullPage: true });
        await shot.locator('article.iv-item', { hasText: `الکترود SDN ${tag}` }).locator('button[aria-label^="ویرایش"]').click();
        await shot.waitForSelector('.iv-sheet .iv-switch', { timeout: 8000 });
        await settle();
        await shot.screenshot({ path: `${SHOTS}/sets-item-form-${name}-${theme}.png` });
        await shot.locator('.iv-sheet .iv-x').click();
        await shot.goto(UI + '/app/inventory?tab=sets', { waitUntil: 'networkidle' });
        await shot.waitForSelector('article.iv-set', { timeout: 15000 });
        await shot.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
        await settle();
        await shot.screenshot({ path: `${SHOTS}/sets-tab-${name}-${theme}.png`, fullPage: true });
      }
      await view.close();
    }
    console.log(`  (عکس‌ها در ${SHOTS})`);
  }

  console.log('\n۵) تعاریفِ پایه ← کالاها فقط پیوند است');
  const pageA = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  watch(pageA, 'admin');
  await browserLogin(pageA, login.accessToken, { ui: UI });
  await pageA.goto(UI + '/app/definitions?section=items', { waitUntil: 'networkidle' });
  await pageA.waitForSelector('.df-moved', { timeout: 15000 });
  ok((await pageA.locator('.df-moved').innerText()).includes('انبار') && (await pageA.locator('.df-moved a').getAttribute('href')).includes('/app/inventory'), 'تعاریفِ پایه می‌گوید کالاها به انبار رفت و پیوند می‌دهد');
  ok(await pageA.locator('.df-list article').count() === 0, '… و دیگر فهرست و دکمهٔ افزودن ندارد');

  console.log('\n۶) سلامتِ صفحه');
  const real = errors.filter((e) => !/http 403\]/.test(e));
  ok(real.length === 0, `بدونِ خطای جاوااسکریپت/کنسول/HTTP (${real.length})${real.length ? ' — ' + real.slice(0, 3).join(' | ').slice(0, 300) : ''}`);
} catch (e) {
  fail++;
  console.log('  ✘ اجرا قطع شد: ' + String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
} finally {
  await browser?.close().catch(() => {});
  const q = (s) => { try { sql(s); } catch (e) { console.log('  (پاک‌سازی) ' + String(e.message).split('\n')[0].slice(0, 160)); } };
  if (trash.lots.length) { q(`DELETE FROM stock_movements WHERE lot_id IN (${trash.lots.join(',')})`); q(`DELETE FROM stock_lots WHERE id IN (${trash.lots.join(',')})`); }
  if (trash.items.length) { q(`DELETE FROM item_components WHERE set_id IN (${trash.items.join(',')}) OR part_id IN (${trash.items.join(',')})`); q(`DELETE FROM items WHERE id IN (${trash.items.join(',')})`); }
  for (const id of trash.accounts) q(`DELETE FROM people WHERE id=(SELECT person_id FROM accounts WHERE id=${id})`);
  for (const k of trash.features) q(`UPDATE features SET enabled=false WHERE key='${k}'`);
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
