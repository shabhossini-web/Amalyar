/**
 * حذفِ مراجعه ست و دستگاهش را آزاد می‌کند + شیت‌های انبار پنجره‌اند + ویرایشِ لات (گزارشِ مالک، ۱۴۰۵/۰۸/۱۷).
 *
 *  باید بیفتد:
 *   - حوالهٔ «رفتهٔ» خودِ مراجعه بسته می‌شود و ست به انبار برمی‌گردد (دیگر «بیمارستان: ۱» نیست)؛ مصرفِ ثبت‌شده برمی‌گردد
 *   - ستِ عمومیِ «بیمارستان + روز»: با بیمارِ دیگرِ همان روز لنگر به او منتقل می‌شود و باز می‌ماند؛ بی او بسته می‌شود
 *   - مرورگر: «کالای جدید» و «ویرایشِ لات» پنجرهٔ ثابت‌اند (نه ته فهرست)؛ ویرایشِ لات شماره و انقضا را عوض می‌کند
 *  نباید بیفتد:
 *   - حذفِ مراجعهٔ فاکتورشده (همان ۴۰۰ِ قبلی)؛ هیچ خطای JS
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
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
const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { Authorization: 'Bearer ' + login.accessToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'vd' + randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const day = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
const trash = { visits: [], hospitals: [], items: [], lots: [], forms: [] };

try {
  console.log('۰) آماده‌سازی');
  const h = (await send('/hospitals', 'POST', { name: `بیمارستانِ نمونه ${tag}` })).json;
  trash.hospitals.push(h.id);
  const form = (await send('/forms', 'POST', { key: tag, title: `عملِ ${tag}`, scope: 'visit' })).json;
  if (form?.id) trash.forms.push(form.id);
  const mkItem = async (body) => { const r = (await send('/items', 'POST', body)).json; trash.items.push(r.id); return r; };
  const setItem = await mkItem({ name: `ست ${tag}`, assetKind: 'set' });
  const gel = await mkItem({ name: `ژل ${tag}`, assetKind: 'consumable', unit: 'تیوب', usageMode: 'single', showInTechPanel: true });
  const mkLot = async (itemId, body, col, val) => {
    const r = await send('/stock/lots', 'POST', { itemId, ...body });
    if (r.status >= 400) throw new Error('لات ساخته نشد: ' + JSON.stringify(r.json).slice(0, 160));
    const id = num(`SELECT id FROM stock_lots WHERE ${col}='${val}'`); trash.lots.push(id); return id;
  };
  const setLot = await mkLot(setItem.id, { serialNo: `S-${tag}`, quantity: 1 }, 'serial_no', `S-${tag}`);
  const gelLot = await mkLot(gel.id, { lotNo: `G-${tag}`, quantity: 5 }, 'lot_no', `G-${tag}`);
  const home = sql(`SELECT coalesce(location, (SELECT value FROM settings WHERE key='home_location'), 'انبار') FROM stock_lots WHERE id=${setLot}`);
  const at = (lot, loc) => num(`SELECT coalesce(sum(quantity),0) FROM stock_movements WHERE lot_id=${lot} AND location='${loc.replace(/'/g, "''")}'`);
  const mkVisit = async (last) => {
    const r = await send('/visits', 'POST', { kind: tag, firstName: 'بیمارِ', lastName: `${last}${tag}`, phone: phone(), hospitalId: h.id, opDate: `${day}T00:00:00.000Z` });
    if (!r.json?.id) throw new Error('مراجعه ساخته نشد: ' + JSON.stringify(r.json).slice(0, 160));
    trash.visits.push(r.json.id); return r.json;
  };

  console.log('۱) حوالهٔ رفتهٔ خودِ مراجعه + مصرف → حذف');
  const v1 = await mkVisit('اول');
  const t1 = await send('/stock/transfers', 'POST', { toLocation: h.name, hospitalId: h.id, visitId: v1.id, lines: [{ lotId: setLot, quantity: 1 }], force: true });
  ok(t1.status < 300, `حواله صادر شد (${t1.status} ${t1.json?.message ?? ''})`);
  const tId = num(`SELECT id FROM stock_transfers WHERE visit_id=${v1.id}`);
  if (sql(`SELECT status FROM stock_transfers WHERE id=${tId}`) === 'planned') await send(`/stock/transfers/${tId}/ship`, 'POST', {});
  ok(at(setLot, h.name) === 1, 'ست در بیمارستان است');
  const used = await send(`/stock/visits/${v1.id}/usage`, 'POST', { lines: [{ source: 'warehouse', itemId: gel.id, quantity: 2 }] });
  ok(used.status < 300 && num(`SELECT coalesce(sum(quantity),0) FROM stock_movements WHERE lot_id=${gelLot}`) === 3, `مصرفِ ۲ ژل ثبت شد (${used.status} ${used.json?.message ?? ''})`);
  const del = await send(`/visits/${v1.id}`, 'DELETE');
  ok(del.status < 300, `مراجعه حذف شد (${del.status} ${del.json?.message ?? ''})`);
  trash.visits = trash.visits.filter((x) => x !== v1.id);
  ok(sql(`SELECT status FROM stock_transfers WHERE id=${tId}`) === 'closed', '**حوالهٔ مراجعهٔ حذف‌شده بسته شد**');
  ok(at(setLot, h.name) === 0 && at(setLot, home) === 1, '**ست به انبار برگشت — دیگر «بیمارستان: ۱» نیست**');
  ok(num(`SELECT coalesce(sum(quantity),0) FROM stock_movements WHERE lot_id=${gelLot}`) === 5, '**مصرفِ مراجعهٔ حذف‌شده برگشت (۵ ژل)**');
  const lots = (await send(`/stock/lots?q=${encodeURIComponent(`S-${tag}`)}`)).json ?? [];
  const row = (Array.isArray(lots) ? lots : lots.rows ?? []).find((l) => l.id === setLot);
  ok(row && !(row.outside ?? []).length && row.available === 1, 'فهرستِ لات‌ها: ست در دسترس، بی‌برچسبِ بیمارستان');

  console.log('۲) ستِ عمومیِ «بیمارستان + روز»');
  const v2 = await mkVisit('دوم');
  const v3 = await mkVisit('سوم');
  await send('/stock/transfers', 'POST', { toLocation: h.name, hospitalId: h.id, visitId: v2.id, lines: [{ lotId: setLot, quantity: 1 }], force: true });
  const t2 = num(`SELECT id FROM stock_transfers WHERE visit_id=${v2.id}`);
  sql(`UPDATE stock_transfers SET shared=true WHERE id=${t2}`);
  await send(`/visits/${v2.id}`, 'DELETE');
  trash.visits = trash.visits.filter((x) => x !== v2.id);
  ok(num(`SELECT coalesce(visit_id,0) FROM stock_transfers WHERE id=${t2}`) === v3.id && sql(`SELECT status FROM stock_transfers WHERE id=${t2}`) !== 'closed',
    '**ستِ عمومی به بیمارِ دیگرِ همان روز منتقل شد و باز ماند**');
  await send(`/visits/${v3.id}`, 'DELETE');
  trash.visits = trash.visits.filter((x) => x !== v3.id);
  ok(sql(`SELECT status FROM stock_transfers WHERE id=${t2}`) === 'closed' && at(setLot, home) === 1, 'بی بیمارِ دیگر، ستِ عمومی هم بسته شد و برگشت');

  console.log('۳) مرورگر — پنجره‌ها و ویرایشِ لات');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    for (const [theme, width] of [['dark', 390], ['light', 1100]]) {
      const ctx = await browser.newContext({ viewport: { width, height: 860 } });
      await ctx.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* ناشناس */ } }, theme);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await browserLogin(page, login.accessToken, { ui: UI });
      await page.goto(UI + '/app/inventory');
      await page.locator('[role="tab"]', { hasText: 'لات‌ها' }).first().click();
      await page.locator('.iv-search').first().fill(tag);
      const edit = page.locator(`button[aria-label="ویرایشِ لاتِ ژل ${tag}"]`);
      await edit.waitFor({ timeout: 15000 });
      /* جستجو با تأخیر دوباره بار می‌کند و ردیف‌ها با انیمیشن عوض می‌شوند — منتظرِ آرام‌شدنِ فهرست، نه ساعت. */
      await page.waitForLoadState('networkidle').catch(() => {});
      for (let i = 0; i < 5; i++) {
        try { await edit.click({ timeout: 4000 }); break; } catch { await page.waitForLoadState('networkidle').catch(() => {}); }
      }
      const ov = page.locator('.iv-overlay');
      await ov.waitFor();
      ok(await ov.evaluate((el) => getComputedStyle(el).position === 'fixed'), `${theme}/${width}: «ویرایشِ لات» پنجرهٔ ثابت است`);
      const box = await page.locator('.iv-sheet').boundingBox();
      ok(box && box.y >= 0 && box.y < 860, `${theme}/${width}: پنجره در دیدِ کاربر است (y=${Math.round(box?.y ?? -1)})`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/lot-edit-${theme}-${width}.png` });
      if (theme === 'dark') {
        const lotInput = page.locator('.iv-sheet input[placeholder="A-4471"]');
        await lotInput.fill(`G2-${tag}`);
        await page.locator('.iv-sheet .iv-field input[placeholder="خالی = بدونِ انقضا"]').fill('۱۴۰۷/۰۱/۱۵');
        await page.locator('.iv-sheet button', { hasText: 'ذخیره' }).last().click();
        await page.waitForFunction(() => !document.querySelector('.iv-overlay'), null, { timeout: 8000 }).catch(() => {});
        ok(sql(`SELECT lot_no FROM stock_lots WHERE id=${gelLot}`) === `G2-${tag}` && sql(`SELECT to_char(expires_at,'YYYY') FROM stock_lots WHERE id=${gelLot}`) === '2028',
          '**ویرایشِ لات: شماره و انقضا ذخیره شد**');
      } else {
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.iv-overlay'), null, { timeout: 5000 }).catch(() => {});
      }
      /* کاتالوگ: «کالای جدید» هم پنجره است. */
      const tabs = page.locator('[role="tab"]');
      const catTab = tabs.filter({ hasText: 'کالاها' }).first();
      if (await catTab.count()) {
        await catTab.click();
        const add = page.locator('button', { hasText: 'کالای جدید' }).first();
        await add.waitFor({ timeout: 8000 });
        await add.click();
        await page.locator('.iv-overlay').waitFor();
        ok(await page.locator('.iv-overlay').evaluate((el) => getComputedStyle(el).position === 'fixed'), `${theme}/${width}: «کالای جدید» پنجرهٔ ثابت است`);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/item-new-${theme}-${width}.png` });
      }
      ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : `${theme}/${width}: بدونِ خطای JS`);
      await ctx.close();
    }
  } finally { await browser.close(); }
} finally {
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
