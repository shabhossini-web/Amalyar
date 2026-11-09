/**
 * بخشِ «ب» (مالک، ۱۴۰۵/۰۸/۱۸) — مصرفیِ هر بیمار: پیش‌فرضِ شرکت، کاربرِ شرکت، تأییدِ نهایی، قفلِ فاکتور.
 *
 *  باید بیفتد:
 *   - تعاریفِ پایه ← «مصرفیِ پیش‌فرض»: قلم از کاتالوگ با تعداد، ذخیره در همان تنظیمِ شرکت
 *   - برگهٔ کارشناس برای بیمارِ بی‌ثبت با همان عدد پر است (حتی قلمِ بی‌تیکِ پنل) و بنرِ «از پیش‌فرض» دارد؛
 *     **تا «ثبت» زده نشده هیچ ردیف/حرکتی نیست**؛ اصلاح ۴ → ۳ و ثبت = ۳ از انبار
 *   - سوپروایزر (کاربرِ شرکت) برگهٔ بیمارِ دیگری را می‌بیند و «تأییدِ نهایی» می‌زند؛ کارشناس بعدش فقط می‌بیند (۴۰۳ فارسی)
 *   - فاکتورِ صادرشده = قفل برای همه (۴۰۰ فارسی)
 *   - بی‌پیش‌فرض: برگه خالی باز می‌شود
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
const loginAs = (identifier, password) => fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) }).then((r) => r.json());
const call = (token) => (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const login = await loginAs(process.env.E2E_USER ?? 'admin', process.env.E2E_PASS ?? 'test1234');
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = call(login.accessToken);
const tag = 'vu' + randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const clinicToday = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.CLINIC_TZ || 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const trash = { visits: [], hospitals: [], accounts: [], items: [], features: [], forms: [] };
const prevDefaults = sql(`SELECT coalesce((SELECT value FROM settings WHERE key='invoice_neuro_consumables'), '__none__')`);
let browser;

try {
  console.log('۰) آماده‌سازی: کارشناس، سوپروایزر، بیمارستان، ژل (بی‌تیکِ پنل) ۳۰ تا، مراجعهٔ امروز');
  const feats = (await send('/features')).json ?? [];
  for (const k of ['inventory', 'tech']) if (feats.find((f) => f.key === k)?.enabled === false) { sql(`UPDATE features SET enabled=true WHERE key='${k}'`); trash.features.push(k); }
  const mkAccount = async (user, first, last, level, jobRole) => {
    const made = (await send('/accounts/temporary', 'POST', { firstName: first, lastName: `${last}${tag}`, phone: phone(), level, jobRole, username: `${user}${tag}` })).json;
    if (!made?.account?.id) throw new Error('حساب ساخته نشد: ' + JSON.stringify(made).slice(0, 160));
    trash.accounts.push(made.account.id);
    return { id: made.account.id, username: `${user}${tag}`, password: made.temporaryPassword };
  };
  const tech = await mkAccount('vt', 'نیما', 'کارشناسِ', 2, 'technician');
  const sup = await mkAccount('vs', 'مریم', 'احمدیِ', 4, 'technician');
  const h = (await send('/hospitals', 'POST', { name: `بیمارستانِ پیش‌فرض ${tag}` })).json;
  trash.hospitals.push(h.id);
  const gel = (await send('/stock/items', 'POST', { name: `ژلِ پیش‌فرض ${tag}`, unit: 'تیوب' })).json;
  trash.items.push(gel.id);
  await send('/stock/lots', 'POST', { itemId: gel.id, lotNo: `G-${tag}`, quantity: 30 });
  const form = (await send('/forms', 'POST', { key: tag, title: `عملِ ${tag}`, scope: 'visit' })).json;
  if (form?.id) trash.forms.push(form.id);
  const vr = await send('/visits', 'POST', { kind: tag, firstName: 'بیمارِ', lastName: `پیش‌فرضی${tag}`, phone: phone(), hospitalId: h.id, opDate: `${clinicToday}T00:00:00.000Z`, techId: tech.id, opStartTime: '09:30' });
  const visit = vr.json;
  if (!visit?.id) throw new Error('مراجعه ساخته نشد: ' + JSON.stringify(vr.json).slice(0, 200));
  trash.visits.push(visit.id);
  const sT = await loginAs(tech.username, tech.password), sS = await loginAs(sup.username, sup.password);
  const asT = call(sT.accessToken), asS = call(sS.accessToken);
  const atHome = () => num(`SELECT coalesce(sum(m.quantity),0) FROM stock_movements m JOIN stock_lots l ON l.id=m.lot_id WHERE l.item_id=${gel.id}`);

  await send('/stock/usage-defaults', 'POST', { lines: [] });
  const empty = (await asT(`/stock/visits/${visit.id}/usage`)).json;
  ok(empty && !empty.suggested && !(empty.warehouse ?? []).some((l) => l.itemId === gel.id), 'بی‌پیش‌فرض: برگه خالی است و ژلِ بی‌تیک در آن نیست');

  console.log('\n۱) مرورگر — تعاریفِ پایه ← «مصرفیِ پیش‌فرض»');
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  };
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage(); watch(page);
  await browserLogin(page, login.accessToken, { ui: UI });
  await page.goto(UI + '/app/definitions?section=usage-defaults', { waitUntil: 'networkidle' });
  await page.waitForSelector('.df-usage', { timeout: 15000 });
  await page.locator('.df-usage input[aria-label="جستجوی قلم برای پیش‌فرض"]').fill(`ژلِ پیش‌فرض ${tag}`);
  await page.locator('.df-usage-hits button', { hasText: `ژلِ پیش‌فرض ${tag}` }).click();
  await page.locator('.df-usage-row', { hasText: `ژلِ پیش‌فرض ${tag}` }).locator('input').fill('4');
  await page.locator('.df-usage .df-add', { hasText: 'ذخیره' }).click();
  await page.waitForFunction(() => /پیش‌فرض ذخیره شد/.test(document.body.textContent ?? ''), null, { timeout: 8000 });
  const d = (await send('/stock/usage-defaults')).json;
  ok(d?.lines?.some((l) => l.itemId === gel.id && l.quantity === 4), 'پیش‌فرض ذخیره شد: ژل ۴');
  if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/usage-defaults-desk-dark.png` }); }

  console.log('\n۲) کارشناس — برگه با پیش‌فرض پر است، تا «ثبت» چیزی کم نمی‌شود');
  const sh = (await asT(`/stock/visits/${visit.id}/usage`)).json;
  const gl = sh?.warehouse?.find((l) => l.itemId === gel.id);
  ok(sh?.suggested === true && gl?.suggested === 4 && gl?.quantity === 0, 'API: «پیشنهاد ۴»، ثبت‌شده ۰ (حتی قلمِ بی‌تیکِ پنل)');
  const pt = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage(); watch(pt);
  await browserLogin(pt, sT.accessToken, { ui: UI });
  await pt.goto(UI + '/app/tech', { waitUntil: 'networkidle' });
  const card = pt.locator('article.tk-card', { hasText: `پیش‌فرضی${tag}` });
  await card.waitFor({ timeout: 15000 });
  await card.locator('.tk-usage button').click();
  await pt.waitForSelector('.tk-sheet .tk-savebar', { timeout: 8000 });
  const sheet = pt.locator('.tk-sheet');
  ok((await sheet.innerText()).includes('از «مصرفیِ پیش‌فرض» پر شده'), 'بنرِ «عددها از پیش‌فرض پر شده»');
  const line = sheet.locator('.tk-uline2', { hasText: `ژلِ پیش‌فرض ${tag}` });
  ok((await line.locator('.ui-step b').innerText()).trim() === '۴', 'ژل با ۴ پر شده و بی‌«+ قلمِ دیگر» دیده می‌شود');
  ok(num(`SELECT count(*) FROM visit_usages WHERE visit_id=${visit.id}`) === 0 && atHome() === 30, '**پیش از «ثبت» هیچ ردیف و حرکتی نیست**');
  if (SHOTS) await pt.screenshot({ path: `${SHOTS}/usage-sheet-phone-dark.png` });
  await line.locator('button[aria-label^="کمتر"]').click();
  await sheet.locator('.tk-savebar .tk-save').click();
  await pt.waitForFunction(() => /مصرفی ثبت شد/.test(document.querySelector('.tk-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  ok(num(`SELECT quantity FROM visit_usages WHERE visit_id=${visit.id} AND item_id=${gel.id}`) === 3 && atHome() === 27, 'ثبت: ۳ (اصلاح‌شده از ۴)، انبار ۲۷');

  console.log('\n۳) کاربرِ شرکت — تأییدِ نهایی؛ کارشناس قفل');
  const other = await asS(`/stock/visits/${visit.id}/usage`);
  ok(other.status === 200 && other.json?.canConfirm === true, `سوپروایزر برگهٔ بیمارِ دیگری را می‌بیند و می‌تواند تأیید کند (${other.status})`);
  const notMine = await asT(`/stock/visits/${visit.id}/usage/confirm`, 'POST', { confirmed: true });
  ok(notMine.status === 403, `کارشناس تأیید نمی‌کند (${notMine.status})`);
  const conf = await asS(`/stock/visits/${visit.id}/usage/confirm`, 'POST', { confirmed: true });
  ok(conf.status === 200 && conf.json?.confirmed?.by?.includes('مریم'), 'تأییدِ نهایی با نامِ تأییدکننده');
  const locked = await asT(`/stock/visits/${visit.id}/usage`, 'POST', { lines: [{ source: 'warehouse', itemId: gel.id, quantity: 2 }] });
  ok(locked.status === 403 && /تأییدِ نهایی/.test(locked.json?.message ?? ''), `کارشناس پس از تأیید ثبت نمی‌کند (${locked.status} «${locked.json?.message}»)`);
  await pt.reload({ waitUntil: 'networkidle' });
  await pt.locator('article.tk-card', { hasText: `پیش‌فرضی${tag}` }).locator('.tk-usage button').click();
  await pt.waitForSelector('.tk-sheet .tk-sheet-body', { timeout: 8000 });
  await pt.waitForFunction(() => /تأییدِ نهایی شده/.test(document.querySelector('.tk-sheet')?.textContent ?? ''), null, { timeout: 8000 });
  ok(await pt.locator('.tk-sheet .tk-savebar').count() === 0, 'برگهٔ کارشناس: بنرِ «تأییدِ نهایی شده»، بی‌دکمهٔ ثبت');
  const hist = (await asS(`/stock/visits/${visit.id}/usage`)).json?.history ?? [];
  ok(hist.some((x) => x.kind === 'confirm' && x.by?.includes('مریم')) && hist.some((x) => x.kind === 'edit' && x.by?.includes('نیما')), 'سابقه: ثبتِ کارشناس و تأییدِ سوپروایزر، با نام');
  if (SHOTS) await pt.screenshot({ path: `${SHOTS}/usage-sheet-confirmed-phone-dark.png` });

  console.log('\n۴) فاکتورِ صادرشده = قفل برای همه');
  sql(`INSERT INTO invoice_documents (visit_id, variant, number, fingerprint, snapshot) VALUES (${visit.id}, 'informal', 'INV-${tag}', 'x', '{}'::jsonb)`);
  const inv = await asS(`/stock/visits/${visit.id}/usage`, 'POST', { lines: [{ source: 'warehouse', itemId: gel.id, quantity: 2 }] });
  ok(inv.status === 400 && new RegExp(`INV-${tag}`).test(inv.json?.message ?? ''), `پس از فاکتور حتی سوپروایزر اصلاح نمی‌کند (${inv.status} «${inv.json?.message}»)`);
  ok((await asS(`/stock/visits/${visit.id}/usage`)).json?.canConfirm === false, '… و «تأیید/برداشتن» هم نیست');

  ok(errors.length === 0, `بدونِ خطای جاوااسکریپت/کنسول (${errors.length})${errors.length ? ' — ' + errors.slice(0, 2).join(' | ') : ''}`);
} catch (e) {
  fail++;
  console.log('  ✘ اجرا قطع شد: ' + String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
} finally {
  await browser?.close().catch(() => {});
  const q = (s) => { try { sql(s); } catch (e) { console.log('  (پاک‌سازی) ' + String(e.stderr ?? e.message).trim().split('\n').pop().slice(0, 200)); } };
  if (prevDefaults === '__none__') q(`DELETE FROM settings WHERE key='invoice_neuro_consumables'`);
  else q(`UPDATE settings SET value=$v$${prevDefaults}$v$ WHERE key='invoice_neuro_consumables'`);
  if (trash.visits.length) {
    const ids = trash.visits.join(',');
    q(`DELETE FROM invoice_documents WHERE visit_id IN (${ids})`);
    q(`DELETE FROM work_items WHERE visit_id IN (${ids})`);
    q(`DELETE FROM domain_events WHERE visit_id IN (${ids})`);
  }
  if (trash.items.length) {
    const ids = trash.items.join(',');
    q(`DELETE FROM stock_movements WHERE lot_id IN (SELECT id FROM stock_lots WHERE item_id IN (${ids}))`);
  }
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  if (trash.items.length) {
    const ids = trash.items.join(',');
    q(`DELETE FROM stock_lots WHERE item_id IN (${ids})`);
    q(`DELETE FROM items WHERE id IN (${ids})`);
  }
  for (const hh of trash.hospitals) { q(`DELETE FROM hospital_duties WHERE hospital_id=${hh}`); await send(`/hospitals/${hh}`, 'DELETE').catch(() => {}); }
  for (const id of trash.accounts) { q(`DELETE FROM hospital_duties WHERE tech_id=${id}`); q(`DELETE FROM people WHERE id=(SELECT person_id FROM accounts WHERE id=${id})`); }
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const k of trash.features) q(`UPDATE features SET enabled=false WHERE key='${k}'`);
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
