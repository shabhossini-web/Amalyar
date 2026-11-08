/**
 * «ست بساز» — ست جعبه‌ای از موجودیِ خودمان است (مالک، ۱۴۰۵/۰۸/۱۷) — سرورِ زنده + مرورگر.
 *
 *  باید بیفتد:
 *   - سوزن (یک‌بارمصرف) ۱۰۰۰ تا و کابل (چندبارمصرف) ۵ تا موجود است؛ «ست بساز» با ۲۰ سوزن و ۲ کابل →
 *     کل ۱۰۰۰ می‌ماند: ۹۸۰ انبار + ۲۰ در ست؛ شمارهٔ خودکار SE-NN؛ نوعِ ست و استانداردش پشتِ صحنه ساخته می‌شود
 *   - کاتالوگ زیرِ هر کالا «در ست‌ها: SE-NN ۲۰» نشان می‌دهد و کلیکش به همان ست می‌برد
 *   - خرابیِ سوزنِ داخلِ ست از کل کم می‌شود (۹۹۹)، نه «خرابی‌ها»؛ خرابیِ کابل به «خرابی‌ها» می‌رود
 *   - «یکی دیگر مثلِ همین» ستِ دوم را با همان محتویات و شمارهٔ بعدی می‌سازد، همان نوعِ ست
 *   - در «موجودی»، ردیفِ خودِ ست «محتویاتِ ست» دارد نه «شمارش/خرابی» کلِ جعبه
 *  نباید بیفتد:
 *   - انبارِ کم → هیچ ستی ساخته نشود (نه جعبهٔ نیمه‌پر)؛ ست داخلِ ست؛ هیچ خطای کنسول
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
const tag = 'sb' + randomBytes(3).toString('hex');
const trash = { items: [], features: [] };
let browser;

try {
  console.log('۰) آماده‌سازی: سوزن ۱۰۰۰ (یک‌بارمصرف)، کابل ۵ (چندبارمصرف)');
  const feats = (await send('/features')).json ?? [];
  if (feats.find((f) => f.key === 'inventory')?.enabled === false) { sql(`UPDATE features SET enabled=true WHERE key='inventory'`); trash.features.push('inventory'); }
  const needle = (await send('/stock/items', 'POST', { name: `سوزن زیرپوستی ${tag}` })).json;
  const cable = (await send('/stock/items', 'POST', { name: `کابل رابط ${tag}`, usageMode: 'multi' })).json;
  trash.items.push(needle.id, cable.id);
  const ln = await send('/stock/lots', 'POST', { itemId: needle.id, lotNo: `N-${tag}`, quantity: 1000 });
  const lc = await send('/stock/lots', 'POST', { itemId: cable.id, lotNo: `C-${tag}`, quantity: 5 });
  ok(ln.status === 201 && lc.status === 201, 'موجودیِ اولیه ثبت شد');
  const total = (id) => num(`SELECT coalesce(sum(m.quantity),0) FROM stock_movements m JOIN stock_lots l ON l.id=m.lot_id WHERE l.item_id=${id} AND m.location <> 'خرابی‌ها'`);
  const at = (id, loc) => num(`SELECT coalesce(sum(m.quantity),0) FROM stock_movements m JOIN stock_lots l ON l.id=m.lot_id WHERE l.item_id=${id} AND m.location='${loc}'`);
  const home = sql(`SELECT location FROM stock_lots WHERE lot_no='N-${tag}'`);

  console.log('\n۱) API — نگهبان‌ها');
  const tooMany = await send('/stock/sets/build', 'POST', { name: `ست کم ${tag}`, lines: [{ partId: cable.id, quantity: 9 }] });
  ok(tooMany.status === 400 && /کم دارد/.test(tooMany.json?.message ?? ''), `انبارِ کم → ۴۰۰ با پیامِ فارسی (${tooMany.status})`);
  ok(num(`SELECT count(*) FROM items WHERE name='ست کم ${tag}'`) === 0, '… و هیچ نوعِ ستی ساخته نشد');
  const next = (await send('/stock/sets/next-serial')).json?.serialNo ?? '';
  ok(/^SE-\d{2,}$/.test(next), `شمارهٔ پیشنهادی (${next})`);

  console.log('\n۲) مرورگر — «ست بساز» با ۲۰ سوزن و ۲ کابل');
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/sets/build')) errors.push(`http ${r.status()} ${r.url()}`); });
  await browserLogin(page, login.accessToken, { ui: UI });
  await page.goto(UI + '/app/inventory?tab=sets', { waitUntil: 'networkidle' });
  await page.locator('.iv-add', { hasText: 'ست بساز' }).click();
  await page.waitForSelector('.iv-sheet', { timeout: 5000 });
  await page.waitForFunction(() => /^SE-\d+/.test(document.querySelector('.iv-sheet input[placeholder="SE-01"]')?.value ?? ''), null, { timeout: 8000 });
  const serial1 = await page.locator('.iv-sheet input[placeholder="SE-01"]').inputValue();
  ok(serial1 === next, `شمارهٔ ست خودکار پر شد (${serial1})`);
  await page.locator('.iv-sheet input[list="iv-set-types"]').fill(`ست کامل ${tag}`);
  const search = page.locator('.iv-sheet input[aria-label="جستجوی قلم برای ست"]');
  for (const [nm, q] of [[`سوزن زیرپوستی ${tag}`, '20'], [`کابل رابط ${tag}`, '2']]) {
    await search.fill(nm);
    await page.locator('.iv-sheet .iv-hits button', { hasText: nm }).click();
    await page.locator('.iv-sheet .iv-parts article', { hasText: nm }).locator('input').fill(q);
  }
  ok((await page.locator('.iv-sheet .iv-parts article', { hasText: 'سوزن' }).innerText()).includes('۱٬۰۰۰'), 'کنارِ قلم «۱٬۰۰۰ آماده در انبار» دیده می‌شود');
  await page.locator('.iv-sheet .iv-save', { hasText: 'ساختِ ست' }).click();
  await page.waitForFunction(() => /ساخته شد/.test(document.querySelector('.iv-toast')?.textContent ?? ''), null, { timeout: 10000 });
  const setLot1 = num(`SELECT id FROM stock_lots WHERE serial_no='${serial1}'`);
  const typeId = num(`SELECT item_id FROM stock_lots WHERE id=${setLot1}`);
  trash.items.push(typeId);
  ok(sql(`SELECT asset_kind || '/' || name FROM items WHERE id=${typeId}`) === `set/ست کامل ${tag}`, 'نوعِ ست پشتِ صحنه با همین نام ساخته شد');
  ok(num(`SELECT count(*) FROM item_components WHERE set_id=${typeId}`) === 2, 'استانداردِ ست = همان دو قلم');
  ok(total(needle.id) === 1000 && at(needle.id, home) === 980 && at(needle.id, `ست ${serial1}`) === 20, '**کل ۱۰۰۰ = ۹۸۰ انبار + ۲۰ در ست**');
  const card = page.locator('article.iv-set', { hasText: serial1 });
  await card.waitFor({ timeout: 8000 });
  ok((await card.locator('.iv-tag').innerText()).trim() === 'کامل', 'کارتِ ست «کامل» است');

  console.log('\n۳) خرابی داخلِ ست: سوزن از کل کم می‌شود، کابل به «خرابی‌ها»');
  for (const [nm, expectRe] of [['سوزن', /کلِ موجودی کم شد/], ['کابل', /خرابی‌ها/]]) {
    await card.locator('.iv-setrow', { hasText: nm }).locator('button', { hasText: 'خرابی' }).click();
    await page.waitForSelector('.iv-sheet', { timeout: 5000 });
    await page.locator('.iv-sheet input[inputmode=numeric]').fill('1');
    await page.locator('.iv-sheet .iv-save').click();
    await page.waitForFunction((re) => new RegExp(re).test(document.querySelector('.iv-toast')?.textContent ?? ''), expectRe.source, { timeout: 8000 });
    await page.waitForSelector('.iv-sheet', { state: 'detached', timeout: 8000 });
  }
  ok(total(needle.id) === 999 && at(needle.id, `ست ${serial1}`) === 19 && at(needle.id, 'خرابی‌ها') === 0, '**سوزنِ خراب: ست ۱۹، کل ۹۹۹، چیزی در «خرابی‌ها» نیست**');
  ok(at(cable.id, `ست ${serial1}`) === 1 && at(cable.id, 'خرابی‌ها') === 1, 'کابلِ خراب: ست ۱، «خرابی‌ها» ۱');

  console.log('\n۴) «یکی دیگر مثلِ همین»');
  await card.locator('button', { hasText: 'یکی دیگر مثلِ همین' }).click();
  await page.waitForSelector('.iv-sheet', { timeout: 5000 });
  await page.waitForFunction(() => /^SE-\d+/.test(document.querySelector('.iv-sheet input[placeholder="SE-01"]')?.value ?? ''), null, { timeout: 8000 });
  const serial2 = await page.locator('.iv-sheet input[placeholder="SE-01"]').inputValue();
  ok(serial2 !== serial1 && (await page.locator('.iv-sheet .iv-parts article').count()) === 2, `محتویات از ستِ اول پر شد، شمارهٔ بعدی ${serial2}`);
  await page.locator('.iv-sheet .iv-save', { hasText: 'ساختِ ست' }).click();
  await page.waitForFunction(() => /ساخته شد/.test(document.querySelector('.iv-toast')?.textContent ?? ''), null, { timeout: 10000 });
  ok(num(`SELECT item_id FROM stock_lots WHERE serial_no='${serial2}'`) === typeId, 'ستِ دوم همان نوعِ ست است');
  ok(at(needle.id, `ست ${serial2}`) === 20 && at(needle.id, home) === 960 && total(needle.id) === 999, 'ستِ دوم: ۲۰ سوزن، انبار ۹۶۰، کل ۹۹۹');

  console.log('\n۵) کاتالوگ و موجودی');
  await page.goto(UI + '/app/inventory?tab=items', { waitUntil: 'networkidle' });
  const row = page.locator('article.iv-item', { hasText: `سوزن زیرپوستی ${tag}` });
  await row.waitFor({ timeout: 10000 });
  const chips = await row.locator('.iv-insets button').allInnerTexts();
  ok(chips.length === 2 && chips.some((c) => c.includes(serial1) && c.includes('۱۹')), `کاتالوگ: «در ست‌ها» با هر دو ست (${chips.join(' | ')})`);
  ok((await row.locator('.iv-qty b').innerText()).trim() === '۹۶۰', 'عددِ بزرگِ کاتالوگ «آماده در انبار» است (۹۶۰)');
  await row.locator('.iv-insets button', { hasText: serial1 }).click();
  await page.locator('article.iv-set', { hasText: serial1 }).waitFor({ timeout: 8000 });
  ok(await page.locator('[role=tab][aria-selected="true"]', { hasText: 'ست‌ها' }).count() === 1, 'کلیک روی چیپ → تبِ «ست‌ها» با همان ست');
  await page.locator('[role=tab]', { hasText: 'موجودی' }).click();
  await page.locator('.iv-search').fill(serial1);
  const setRow = page.locator('article.iv-row', { hasText: new RegExp(`سریال\\s*${serial1}`) });
  await setRow.waitFor({ timeout: 10000 });
  ok(await setRow.locator('button', { hasText: 'محتویاتِ ست' }).count() === 1 && await setRow.locator('button', { hasText: 'شمارش' }).count() === 0,
    'ردیفِ ست در «موجودی»: «محتویاتِ ست»، بی «شمارش/خرابی»ِ کلِ جعبه');

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    for (const [name, vp] of [['phone', { width: 390, height: 844 }], ['desk', { width: 1200, height: 900 }]]) {
      const view = await browser.newContext({ viewport: vp, deviceScaleFactor: name === 'phone' ? 2 : 1 });
      const shot = await view.newPage();
      await browserLogin(shot, login.accessToken, { ui: UI });
      for (const theme of ['dark', 'light']) {
        await shot.goto(UI + '/app/inventory?tab=sets', { waitUntil: 'networkidle' });
        await shot.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
        await shot.locator('.iv-add', { hasText: 'ست بساز' }).click();
        await shot.locator('.iv-sheet input[list="iv-set-types"]').fill(`ست کامل ${tag}`);
        await shot.locator('.iv-sheet .iv-parts article').first().waitFor({ timeout: 8000 });
        await shot.waitForTimeout(450);
        await shot.screenshot({ path: `${SHOTS}/set-build-${name}-${theme}.png` });
        await shot.keyboard.press('Escape');
        await shot.goto(UI + '/app/inventory?tab=items', { waitUntil: 'networkidle' });
        await shot.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
        await shot.locator('.iv-search').fill(tag);
        await shot.locator('.iv-insets').first().waitFor({ timeout: 8000 });
        await shot.waitForTimeout(450);
        await shot.screenshot({ path: `${SHOTS}/set-catalog-${name}-${theme}.png` });
      }
      await view.close();
    }
  }

  ok(errors.length === 0, `بدونِ خطای جاوااسکریپت/کنسول/HTTP (${errors.length})${errors.length ? ' — ' + errors.slice(0, 3).join(' | ').slice(0, 300) : ''}`);
} catch (e) {
  fail++;
  console.log('  ✘ اجرا قطع شد: ' + String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
} finally {
  await browser?.close().catch(() => {});
  const q = (s) => { try { sql(s); } catch (e) { console.log('  (پاک‌سازی) ' + String(e.stderr ?? e.message).trim().split('\n').pop().slice(0, 200)); } };
  if (trash.items.length) {
    const ids = trash.items.join(',');
    q(`DELETE FROM stock_movements WHERE lot_id IN (SELECT id FROM stock_lots WHERE item_id IN (${ids}))`);
    q(`DELETE FROM audit_events WHERE entity_type='stock_lot' AND entity_id::text IN (SELECT id::text FROM stock_lots WHERE item_id IN (${ids}))`);
    q(`DELETE FROM stock_lots WHERE item_id IN (${ids})`);
    q(`DELETE FROM item_components WHERE set_id IN (${ids}) OR part_id IN (${ids})`);
    q(`DELETE FROM items WHERE id IN (${ids})`);
  }
  for (const k of trash.features) q(`UPDATE features SET enabled=false WHERE key='${k}'`);
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
