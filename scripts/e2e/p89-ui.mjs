/**
 * **رابطِ بسته‌های ۸ و ۹** (طرحِ مصوبِ ۱۴۰۵/۰۷/۰۶) — سمتِ API در `p89-clinical.mjs` و `waitlist.mjs`.
 *
 *  باید بیفتد:
 *   - میز: «ارزیابیِ پیش از عمل» از زیرفرمِ «قبل»؛ «الصاقِ فرم» همان پنجرهٔ فرمِ مراجعه (بی‌ستاره)؛
 *     پرکردن و ذخیره سرِ میز، خلاصه با ارقامِ فارسی (U1–U2)
 *   - ترخیص: داروها و ویزیتِ بعدی در پاپ‌آپ؛ «فوت» هر دو را پنهان و هشدار نشان می‌دهد (U3)
 *   - فهرستِ انتظار: ردیف‌ها، آمار، تب‌ها؛ «برنامهٔ عمل» فرمِ «عملِ جدید» را در حالتِ «هنوز تاریخ
 *     ندارد» باز می‌کند و ذخیره‌اش ردیف را «بی‌تاریخ» می‌کند؛ بستنِ تصمیم با دلیل (U4–U6)
 *   - تعریف‌ها: «خودکار: …» زیرِ موضوع و چیپ‌های فرم‌های خودکار (U7)
 *   - پرونده: پاسخِ زیرفرم‌ها زیرِ مراجعه (U8)
 *   - هر دو تم و موبایلِ ۳۹۰: بی‌سرریزِ افقی، بی‌خطای صفحه؛ عکس‌ها در `E2E_SHOTS` (اختیاری)
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';
import { ymdToJStr } from '../../src/lib/jalali.js';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';
const SHOTS = process.env.E2E_SHOTS ?? '';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken }, body: b !== undefined ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = randomBytes(3).toString('hex');
const day = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const faDigits = (s) => String(s).replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[x]);
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const trash = [];
const keep = (v) => { if (v?.id) trash.push(v.id); return v; };
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const errors = [];

const pageFor = async ({ width = 1280, height = 900, theme = 'dark' } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'fa-IR' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* */ } }, theme);
  await browserLogin(p, login.accessToken, { ui: UI });
  return p;
};
const shot = async (p, name, target) => {
  if (!SHOTS) return;
  await (target ?? p).screenshot({ path: `${SHOTS}/${name}.png`, ...(target ? {} : { fullPage: false }) }).catch(() => {});
};
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  ok('سوییچ به مطب', (await send('/config/vertical', 'PATCH', { vertical: 'clinic' })).status === 200);
  for (const [kind, title] of [['clinic', 'فرمِ ویزیت'], ['surgery', 'فرمِ عمل']]) {
    if (Number(sql(`SELECT count(*) FROM form_defs WHERE scope='visit' AND active=TRUE AND visit_kind='${kind}'`)) === 0) {
      await send('/forms', 'POST', { key: kind, title, scope: 'visit' });
    }
  }
  await send('/forms');
  const surgeon = (await send('/surgeons', 'POST', { firstName: 'دکترِ', lastName: `رابط${tag}` })).json;
  const hosp = (await send('/hospitals', 'POST', { name: `بیمارستانِ رابط ${tag}` })).json;
  const proc = (await send('/procedure-types', 'POST', { name: `میکرودیسککتومی ${tag}` })).json;
  const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
  const A = keep((await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'شوکت', lastName: `جاوله${tag}`, phone: phone(), opDate: day(-45), surgeonId: surgeon.id,
    chiefComplaint: 'کمردردِ تیرکشنده', decisions: ['surgery'],
  })).json);
  const X = keep((await send('/visits', 'POST', {
    kind: 'surgery', patientId: A.patientId, decidedInVisitId: A.id, opDate: day(0), surgeonId: surgeon.id, hospitalId: hosp.id,
    procedureTypeId: proc.id, subforms: [{ key: 'subform.asa', phase: 'pre', data: { asa: 'II' } }],
  })).json);
  await send(`/theatre/visits/${X.id}/start`, 'POST');
  await send(`/theatre/visits/${X.id}/finish`, 'POST');
  const B = keep((await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'رضا', lastName: `کریمی${tag}`, phone: phone(), opDate: day(-62), surgeonId: surgeon.id,
    chiefComplaint: 'لنگشِ نوروژنیک', decisions: ['surgery'],
  })).json);
  const C = keep((await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'سارا', lastName: `نادری${tag}`, phone: phone(), opDate: day(-20), surgeonId: surgeon.id,
    chiefComplaint: 'بی‌حسیِ پا', decisions: ['surgery'],
  })).json);

  console.log('۱) میزِ اتاقِ عمل');
  let p = await pageFor();
  await p.goto(`${UI}/app/theatre`, { waitUntil: 'domcontentloaded' });
  await p.locator(`[data-visit-id="${X.id}"]`).click({ timeout: 20000 });
  await p.locator('.th-pre.on').waitFor({ timeout: 15000 });
  ok('U1 «ارزیابیِ پیش از عمل» از زیرفرمِ ASA', (await p.locator('.th-pre.on').innerText()).includes('ASA'));
  const desk = p.locator('[data-desk-subforms]');
  ok('U1 «فرم‌های حینِ عمل» با دکمهٔ الصاق', await desk.isVisible() && await desk.locator('[data-act="desk-attach"]').isVisible());
  await desk.locator('[data-act="desk-attach"]').click();
  await p.locator('.vf-pick [data-subform-item="subform.intra"]').waitFor({ timeout: 10000 });
  ok('U1 همان پنجرهٔ الصاق، بی‌ستارهٔ منتخب (میز منتخب ندارد)', (await p.locator('.vf-pick .vf-star').count()) === 0);
  await shot(p, 'u1-desk-attach-dark');
  await p.locator('.vf-pick [data-subform-item="subform.intra"] [data-act="attach"]').click();
  await p.locator('.th-sub-form').waitFor({ timeout: 10000 });
  await p.locator('.th-sub-form label.pf-field', { hasText: 'خون‌ریزیِ تخمینی' }).locator('input').fill('150');
  await p.locator('[data-act="desk-subform-save"]').click();
  await p.locator('[data-desk-subform="subform.intra"] .th-sub-sum').waitFor({ timeout: 10000 });
  ok('U2 ذخیره سرِ میز؛ خلاصه با ارقامِ فارسی', (await p.locator('[data-desk-subform="subform.intra"] .th-sub-sum').innerText()).includes('۱۵۰'));
  await shot(p, 'u2-desk-dark', p.locator('.th-card, .th').first());

  console.log('\n۲) ترخیص');
  await p.locator('[data-act="discharge"]').click();
  await p.locator('.th-dialog').waitFor({ timeout: 10000 });
  await p.locator('[data-disposition="home"]').click();
  await p.locator('[data-discharge-note]').fill('هوشیار، درد کنترل‌شده');
  ok('U3 داروها و ویزیتِ بعدی در پاپ‌آپ (مطب)', await p.locator('[data-discharge-rx]').isVisible() && await p.locator('[data-discharge-next]').isVisible());
  await p.locator('[data-disposition="death"]').click();
  ok('U3 «فوت»: هشدار، بی‌دارو و بی‌ویزیتِ بعدی', await p.locator('[data-discharge-death]').isVisible()
    && (await p.locator('[data-discharge-rx]').count()) === 0 && (await p.locator('[data-discharge-next]').count()) === 0);
  await shot(p, 'u3-discharge-death-dark', p.locator('.th-dialog'));
  await p.locator('[data-disposition="home"]').click();
  await p.locator('[data-discharge-rx]').fill('استامینوفن ۵۰۰ هر ۸ ساعت');
  await p.locator('[data-discharge-next] input').fill(ymdToJStr(day(7)));
  await shot(p, 'u3-discharge-dark', p.locator('.th-dialog'));
  await p.locator('.th-dialog button[type="submit"]').click();
  await p.locator('[data-discharged-rx]').waitFor({ timeout: 10000 });
  ok('U3 ترخیص با داروها و ویزیتِ بعدی ثبت شد', (await p.locator('[data-discharged-next]').innerText()).length > 0
    && sql(`SELECT count(*) FROM visits WHERE follow_of_visit_id=${X.id} AND op_status='pending'`) === '1');
  const childId = Number(sql(`SELECT coalesce(max(id), 0) FROM visits WHERE follow_of_visit_id=${X.id}`));
  if (childId) trash.push(childId);
  ok('U3 بی‌سرریزِ افقی (دسکتاپ)', await noHScroll(p));
  await p.context().close();

  console.log('\n۳) فهرستِ انتظار');
  for (const [theme, w] of [['dark', 1280], ['light', 1280], ['light', 390], ['dark', 390]]) {
    p = await pageFor({ theme, width: w, height: w < 500 ? 844 : 900 });
    await p.goto(`${UI}/app/waitlist`, { waitUntil: 'domcontentloaded' });
    await p.locator('.wl-row').first().waitFor({ timeout: 20000 });
    /* تب‌ها از `/config` می‌آیند و آن درخواست با فهرست مسابقه می‌دهد — منتظرِ خودِ نتیجه، نه ساعت. */
    await p.waitForFunction(() => document.querySelectorAll('.wl-tabs [role="tab"]').length >= 5, null, { timeout: 10000 }).catch(() => {});
    const seen = [await p.locator(`[data-wl-row="awaiting:${B.id}"]`).count(), await p.locator('.wl-kpi').count(), await p.locator('.wl-tabs [role="tab"]').count()];
    ok(`U4 ${theme}/${w}: ردیف‌ها، دو عددِ آمار و تب‌ها`, seen[0] === 1 && seen[1] === 2 && seen[2] === 5, JSON.stringify(seen));
    ok(`U4 ${theme}/${w}: بی‌سرریزِ افقی`, await noHScroll(p));
    ok(`U4 ${theme}/${w}: عنوانِ صفحه = نامِ کاشی`, (await p.title()).startsWith('فهرستِ انتظارِ عمل') && (await p.locator('h1').innerText()).includes('فهرستِ انتظارِ عمل'));
    await shot(p, `u4-waitlist-${theme}-${w}`);
    if (!(theme === 'light' && w === 1280)) await p.context().close();
  }
  /* همان صفحهٔ روشنِ دسکتاپ (بالا) برای کنش‌ها */
  const [ctxLight] = browser.contexts().filter((c) => c.pages().length);
  p = ctxLight.pages()[0];
  ok('U4 روزهای انتظارِ ردیفِ ۶۲روزه', (await p.locator(`[data-wl-row="awaiting:${B.id}"] .wl-days`).innerText()).includes(faDigits(62)));
  await p.locator(`[data-wl-row="awaiting:${C.id}"] [data-act="plan"]`).click();
  await p.locator('.db-sheet [data-sheet-title]').waitFor({ timeout: 15000 });
  ok('U5 «برنامهٔ عمل» ← فرمِ «عملِ جدید»، نه «ویزیتِ جدید»', (await p.locator('.db-sheet [data-sheet-title]').innerText()).trim() === 'عملِ جدید');
  const pills = p.locator('.db-sheet .db-when-pill');
  ok('U5 حالتِ «هنوز تاریخ ندارد» روشن با کادرِ تاریخِ تقریبی', (await pills.count()) === 2
    && (await pills.nth(1).getAttribute('aria-pressed')) === 'true' && (await p.locator('.db-sheet .db-when-hint').count()) === 1);
  await shot(p, 'u5-plan-light', p.locator('.db-sheet'));
  await p.locator('.db-sheet .db-submit').last().click();
  await p.locator(`[data-wl-row^="surgery:"]:has-text("نادری${tag}")`).waitFor({ timeout: 15000 });
  const planned = p.locator(`[data-wl-row^="surgery:"]:has-text("نادری${tag}")`);
  ok('U5 ذخیره ← ردیف «بی‌تاریخ» شد', (await planned.getAttribute('class')).includes('st-planned'));
  const madeId = Number(String(await planned.getAttribute('data-wl-row')).split(':')[1]);
  if (madeId) trash.push(madeId);
  await p.locator(`[data-wl-row="awaiting:${B.id}"] [data-act="close"]`).click();
  await p.locator('.wl-dialog').waitFor({ timeout: 10000 });
  ok('U6 دلایلِ بستن با جملهٔ راهنما؛ دکمه تا انتخاب غیرفعال', (await p.locator('.wl-reasons button small').count()) === 4
    && await p.locator('[data-act="close-confirm"]').isDisabled());
  await shot(p, 'u6-close-light', p.locator('.wl-dialog'));
  await p.locator('.wl-reasons button').first().click();
  await p.locator('[data-act="close-confirm"]').click();
  await p.locator(`[data-wl-row="awaiting:${B.id}"]`).waitFor({ state: 'detached', timeout: 10000 });
  ok('U6 بسته شد و در «بسته‌شده» با دلیل', sql(`SELECT surgery_decision_close_reason FROM visits WHERE id=${B.id}`) === 'declined');
  await p.context().close();

  console.log('\n۴) تعریف‌ها و پرونده');
  p = await pageFor({ theme: 'light' });
  await p.goto(`${UI}/app/definitions?section=visit-topics`, { waitUntil: 'domcontentloaded' });
  await p.getByText('خودکار:', { exact: false }).first().waitFor({ timeout: 15000 });
  ok('U7 «خودکار: …» زیرِ موضوع‌های پره‌آپ/پست‌آپ', (await p.getByText('خودکار:', { exact: false }).count()) >= 2);
  await p.locator('.df-row', { hasText: 'ویزیتِ قبل از عمل (پره‌آپ)' }).locator('button[title="ویرایش"]').click();
  await p.locator('.df-subdef').first().waitFor({ timeout: 10000 });
  ok('U7 چیپ‌های فرم‌های خودکار با وضعیتِ روشن/خاموش', (await p.locator('.df-subdef[aria-pressed="true"]').count()) >= 1);
  await shot(p, 'u7-topic-light', p.locator('.df-sheet, .db-sheet, [role="dialog"]').first());
  await p.goto(`${UI}/app/patients/${A.patientId}`, { waitUntil: 'domcontentloaded' });
  await p.locator('.rc-subs').first().waitFor({ timeout: 20000 }).catch(() => {});
  const subsText = (await p.locator('.rc-subs').first().innerText().catch(() => ''));
  ok('U8 پرونده: پاسخِ زیرفرم‌ها با مرحله زیرِ مراجعه', subsText.includes('ASA') && subsText.includes('حین'), subsText.slice(0, 160));
  await shot(p, 'u8-record-light');
  await p.context().close();

  ok('بی‌خطای صفحه', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  ok(`اجرا متوقف شد: ${e?.message ?? e}`, false);
} finally {
  await browser.close().catch(() => {});
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  ok('برگشت به حوزهٔ قبلی', back.status === 200, String(back.status));
  for (const id of trash.reverse()) await send(`/visits/${id}`, 'DELETE').catch(() => {});
}
console.log(`\n${pass} سبز · ${fails.length} قرمز`);
if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
