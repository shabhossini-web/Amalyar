/**
 * **«+» روی صفحهٔ «امروز» — افزودنِ سریعِ مراجعهٔ دستی** (بازخوردِ مالک ۱۴۰۵/۰۷/۰۱:
 * «تو صفحهٔ امروز یه (+) بذار که هر کسی سریع خواست مراجعهٔ دستی اضافه کنه بتونه»).
 *
 *  باید بیفتد:
 *   - سرور می‌گوید چه کسی می‌تواند (`canCreateVisit`) — همان دو گاردِ `POST /visits`
 *   - دکمه با برچسبِ واژهٔ حوزه («… جدید») دیده می‌شود و همان فرمِ ثبتِ داشبورد را باز می‌کند
 *   - تاریخِ فرم از پیش «امروز» است و ثبت، مراجعه را در فهرستِ «امروز» همین صفحه می‌نشاند
 *   - روی موبایل (۳۹۰) دکمه داخلِ صفحه است و سرریزِ افقی نمی‌سازد
 *  نباید بیفتد:
 *   - باز و بستنِ فرم (Escape) چیزی ثبت کند
 *   - کسی که مجوزِ ساخت ندارد (کارشناسِ سطح ۲) دکمه را ببیند
 *   - خطای جاوااسکریپت
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { browserLogin } from './lib/browser-login.mjs';
import { todayJStr } from '../../src/lib/jalali.js';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const faToEn = (t) => String(t ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m = 'GET', b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'qv' + randomBytes(3).toString('hex');
const trash = { visits: [], accounts: [], surgeons: [], hospitals: [], forms: [] };
const countMine = () => Number(sql(`SELECT count(*) FROM visits v JOIN patients p ON p.id = v.patient_id WHERE p.last_name = 'سریع${tag}'`));
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const errors = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`${who}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${who} [console.error] ${m.text()}`); });
};

try {
  /* اگر فرمِ این نصب جراح را اجباری کرده، دست‌کم یک جراحِ فعال باید باشد. */
  if (!((await send('/surgeons')).json ?? []).some((x) => x.active !== false)) {
    const sg = (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `ثبت‌سریع${tag}` })).json;
    if (sg?.id) trash.surgeons.push(sg.id);
  }
  if (!((await send('/hospitals')).json ?? []).some((x) => x.active !== false)) {
    const h = (await send('/hospitals', 'POST', { name: `بیمارستانِ ثبت‌سریع ${tag}` })).json;
    if (h?.id) trash.hospitals.push(h.id);
  }

  console.log('۱) سرور می‌گوید چه کسی می‌تواند');
  const me = (await send('/work/today')).json;
  ok(me?.canCreateVisit === true, 'مدیر: `canCreateVisit` روشن است');

  console.log('\n۲) دکمه روی صفحهٔ «امروز»');
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(page, 'desktop');
  await browserLogin(page, login.accessToken, { ui: UI });
  await page.goto(UI + '/app', { waitUntil: 'networkidle' });
  await page.waitForSelector('.td-hello', { timeout: 15000 });
  const fab = page.locator('[data-quick-visit]');
  await fab.waitFor({ timeout: 10000 }).catch(() => {});
  ok(await fab.count() === 1, 'دکمهٔ «+» دقیقاً یک‌بار هست');
  const label = (await fab.getAttribute('aria-label')) ?? '';
  ok(/جدید$/.test(label.trim()), `برچسبِ دسترس‌پذیرش واژهٔ حوزه است («${label}»)`);
  ok(await fab.locator('svg').count() === 1 && !/[+＋]/.test(await fab.innerText()), 'آیکونِ SVG، نه گلیفِ «+»ِ متنی');

  console.log('\n۳) **نباید بیفتد:** باز و بستن چیزی ثبت نمی‌کند');
  const before = countMine();
  await fab.click();
  await page.waitForSelector('.db-sheet', { timeout: 8000 });
  ok(await page.locator('.db-sheet').count() === 1, 'فرمِ ثبت باز شد');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.db-sheet', { state: 'detached', timeout: 8000 }).catch(() => {});
  ok(await page.locator('.db-sheet').count() === 0 && countMine() === before, 'Escape بست و چیزی ثبت نشد');

  console.log('\n۴) ثبتِ یک مراجعهٔ دستی از همین‌جا');
  await fab.click();
  await page.waitForSelector('.db-sheet', { timeout: 8000 });
  await page.locator('.db-sheet input[required]').first().fill('بیمارِ');
  await page.locator('.db-sheet input[required]').nth(1).fill(`سریع${tag}`);
  await page.locator('.db-stepnav .db-submit').click();
  await page.waitForTimeout(500);
  const kindBtn = page.locator('.db-sheet .db-kindrow button').first();
  if (await kindBtn.count()) await kindBtn.click();
  await page.locator('.db-stepnav .db-submit').click();
  /* ⚠️ `:visible`: کادرِ «تاریخِ تولد»ِ گامِ ۱ پنهان در DOM می‌ماند و اولین
     `.jd-wrap` همان است، نه تاریخِ مراجعه. */
  const dateInput = page.locator('.db-sheet .jd-wrap:visible input').first();
  await dateInput.waitFor({ timeout: 8000 });
  const dateVal = faToEn(await dateInput.inputValue());
  ok(dateVal === todayJStr(), `تاریخ از پیش «امروز» است (${dateVal} = ${todayJStr()})`);
  /* فیلدهای «اجباری» مالِ فرم‌سازِ هر نصب‌اند (این‌جا مثلاً «جراح»)، نه این آزمون؛
     پس به‌جای حدس، همان پیامی که فرم می‌دهد («X را کامل کنید») خوانده و همان
     فیلد پر می‌شود — گزینهٔ اولِ انتخابگر یا یک متنِ آزمایشی. */
  const fillRequired = async (pg, label) => {
    const field = pg.locator('.db-sheet label.db-field:visible', { hasText: label }).first();
    if (await field.locator('.pk-btn').count()) {
      await field.locator('.pk-btn').first().click();
      await pg.waitForSelector('.pk-panel', { timeout: 5000 });
      await pg.locator('.pk-panel .pk-item:not(.pk-clear)').first().click();
      await pg.waitForSelector('.pk-panel', { state: 'detached', timeout: 5000 }).catch(() => {});
      return true;
    }
    const box = field.locator('input:not([type=hidden]), textarea').first();
    if (await box.count()) { await box.fill('آزمونِ ثبتِ سریع'); return true; }
    return false;
  };
  /* ذخیرهٔ شیت؛ هر «X را کامل کنید» را از پیامِ خودِ فرم پر می‌کند. */
  const saveSheet = async (pg) => {
  let res = null;
  for (let attempt = 0; attempt < 5 && !res; attempt++) {
    const saved = pg.waitForResponse((r) => r.url().endsWith('/api/visits') && r.request().method() === 'POST', { timeout: 4000 });
    await pg.locator('.db-sheet button.db-submit[type="submit"]').click();
    let need = null;
    for (let i = 0; i < 20 && !need; i++) {
      /* از بازبینیِ UX (surgery-08) خطای فیلد کنارِ خودِ فیلد و روی نوارِ ذخیره می‌ماند، نه در toast. */
      const t = (await pg.locator('.sh-toast, [data-save-error]').allInnerTexts()).join(' ');
      need = /«([^»]+)» را کامل کنید/.exec(t)?.[1] ?? null;
      if (!need) {
        const r = await Promise.race([saved.catch(() => null), pg.waitForTimeout(100).then(() => undefined)]);
        if (r) { res = r; break; }
      }
    }
    if (res) break;
    if (!need) { res = await saved.catch(() => null); break; }
    console.log(`  · فرم «${need}» را اجباری می‌خواهد — پر می‌شود`);
    if (!await fillRequired(pg, need)) break;
    await saved.catch(() => null);
  }
  return res;
  };
  const res = await saveSheet(page);
  ok(res?.status() === 201 || res?.status() === 200, `ثبت شد (HTTP ${res?.status()})`);
  const body = await res?.json().catch(() => null);
  if (body?.id) trash.visits.push(body.id);
  await page.waitForSelector('.db-sheet', { state: 'detached', timeout: 8000 }).catch(() => {});
  ok(countMine() === before + 1, 'دقیقاً یک مراجعه در سرور');
  const toast = await page.locator('.sh-toast').innerText({ timeout: 5000 }).catch(() => '');
  ok(/ثبت شد/.test(toast), `پیامِ ثبت آمد («${toast}»)`);
  const row = page.locator('.td-item', { hasText: `سریع${tag}` });
  await row.first().waitFor({ timeout: 8000 }).catch(() => {});
  ok(await row.count() === 1, 'همان مراجعه بی‌رفرش در فهرستِ «امروز» نشست');
  await page.close();

  console.log('\n۴ب) «کاندیدای جراحی» از «+» هم فرمِ عمل را باز می‌کند');
  /* همان قولِ فرم («بعد از ذخیره، فرمِ عملِ همین بیمار باز می‌شود») که داشبورد و
     پرونده نگه می‌داشتند و «+»ِ امروز نه — عملِ بعدی به ویزیتِ تصمیم گره نمی‌خورد. */
  const dform = (await send('/forms', 'POST', { key: `d${tag}`, title: `ویزیتِ سریع ${tag}`, scope: 'visit' })).json;
  if (dform?.id) trash.forms.push(dform.id);
  const pd = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(pd, 'decision');
  await browserLogin(pd, login.accessToken, { ui: UI });
  await pd.goto(UI + '/app', { waitUntil: 'networkidle' });
  await pd.waitForSelector('.td-hello', { timeout: 15000 });
  await pd.locator('[data-quick-visit]').click();
  await pd.waitForSelector('.db-sheet', { timeout: 8000 });
  await pd.locator('.db-sheet input[required]').first().fill('بیمارِ');
  await pd.locator('.db-sheet input[required]').nth(1).fill(`سریع${tag}`);
  await pd.locator('.db-stepnav .db-submit').click();
  await pd.waitForTimeout(500);
  await pd.locator(`.db-sheet .db-kindrow button[data-kind="d${tag}"]`).click(); // کلید، نه متن (clinic-daily-04)
  await pd.locator('.db-stepnav .db-submit').click();
  const dec = pd.locator('.db-sheet .db-decide');
  await dec.waitFor({ timeout: 8000 }).catch(() => {});
  /* تصمیم از بستهٔ زیرفرم‌ها کشوییِ چندتایی است (نه ردیفِ چیپ). */
  await dec.locator('[data-act="decision-open"]').click();
  await dec.locator('.vf-opt[data-decision="surgery"]').click();
  const r2 = await saveSheet(pd);
  ok(r2?.status() === 201, `ویزیتِ تصمیم ثبت شد (HTTP ${r2?.status()})`);
  const b2 = await r2?.json().catch(() => null);
  if (b2?.id) trash.visits.push(b2.id);
  await pd.waitForTimeout(1200);
  await pd.locator('.db-sheet').waitFor({ timeout: 8000 }).catch(() => {});
  const follow = await pd.locator('.sh-toast').innerText({ timeout: 5000 }).catch(() => '');
  ok(await pd.locator('.db-sheet').count() === 1 && /فرمِ عمل را برای همین بیمار/.test(follow),
    `**فرمِ عملِ همین بیمار بلافاصله باز شد** (مثلِ داشبورد و پرونده) — «${follow}»`);
  await pd.close();

  console.log('\n۵) موبایل ۳۹۰');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  watch(m, 'mobile');
  await browserLogin(m, login.accessToken, { ui: UI });
  await m.goto(UI + '/app', { waitUntil: 'networkidle' });
  const mf = m.locator('[data-quick-visit]');
  await mf.waitFor({ timeout: 10000 }).catch(() => {});
  const box = await mf.boundingBox();
  ok(!!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844,
    `دکمه داخلِ صفحهٔ موبایل است (${box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}` : 'نیست'})`);
  ok(!!box && box.width >= 44 && box.height >= 44, 'اندازهٔ لمس دست‌کم ۴۴ پیکسل');
  const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 1, `بدونِ سرریزِ افقی (${over}px)`);
  await ctx.close();

  console.log('\n۶) **نباید بیفتد:** کسی که اجازهٔ ساخت ندارد');
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
    ok(mine?.canCreateVisit === false, 'کارشناسِ سطح ۲: `canCreateVisit` خاموش');
    const denied = await fetch(API + '/visits', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tl.accessToken },
      body: JSON.stringify({ firstName: 'نباید', lastName: tag }),
    });
    ok(denied.status === 403, `… و سرور هم واقعاً رد می‌کند (HTTP ${denied.status}) — دکمه دروغ نمی‌گوید`);
    const tp = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    watch(tp, 'tech');
    await browserLogin(tp, tl.accessToken, { ui: UI });
    await tp.goto(UI + '/app', { waitUntil: 'networkidle' });
    await tp.waitForSelector('.td-hello', { timeout: 15000 });
    ok(await tp.locator('[data-quick-visit]').count() === 0, 'کارشناس دکمه را نمی‌بیند');
    await tp.close();
  } else {
    ok(false, `حسابِ آزمایشی ساخته نشد: ${JSON.stringify(made).slice(0, 120)}`);
  }

  console.log('\n۷) سلامتِ صفحه');
  ok(errors.length === 0, `بدونِ خطای جاوااسکریپت (${errors.length})${errors.length ? ' — ' + errors[0].slice(0, 160) : ''}`);
} finally {
  await browser.close().catch(() => {});
  for (const v of trash.visits) await send(`/visits/${v}`, 'DELETE').catch(() => {});
  for (const id of trash.surgeons) await send(`/surgeons/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.hospitals) await send(`/hospitals/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    sql(`DELETE FROM account_sessions WHERE account_id=${id}`);
    sql(`DELETE FROM accounts WHERE id=${id}`);
  }
}
console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
