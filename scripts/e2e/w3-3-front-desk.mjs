/**
 * W3.3 — میزِ پذیرشِ روز (§۴.۵ سند):
 * - تختهٔ پنج‌ستونی؛ ستون و برچسبِ دکمه‌ها **مشتقِ سرور**اند نه کپیِ کلاینتی
 * - بیمارِ رسیده ≤ ۲ کلیک تا شروعِ مراجعه و ≤ ۱ کلیک برگشت به میز
 * - سطحِ منشی (۲) واقعاً کار می‌کند — کلِ دلیلِ وجودِ این بسته
 * - «نباید بیفتد»: نوبتِ ثبت‌نامِ آنلاین (که `visitId` دارد) در ستونِ «نوبت‌دار» گیر کند ·
 *   `lane` از `visitId` به‌تنهایی مشتق شود · نوبتِ روزِ دیگر از میز شروع شود ·
 *   `held` بی‌«قطعی» شروع شود · لغوشده ستون بگیرد · مراجعهٔ لغوشده ماندهٔ مالی نشان دهد ·
 *   برگشت از فرم به داشبورد بپرد (منشی آن‌جا دسترسی ندارد)
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { browserLogin } from './lib/browser-login.mjs';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.E2E_SHOTS ?? 'docs/plan/shots';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'fd' + randomBytes(3).toString('hex');
const TODAY = new Date(); TODAY.setUTCHours(0, 0, 0, 0);
const ISO = TODAY.toISOString().slice(0, 10);
const trash = { visits: [], forms: [], accounts: [] };
let pid = -1, made = null, tl = null;

try {
  /* ⚠️ نوعِ مراجعه را **خودمان** می‌سازیم: `startVisit` نوعِ `clinic` را می‌خواهد و
     اگر نباشد اولین نوعِ غیرِ `surgery` را برمی‌دارد — که محلی یک نوعِ یتیم است.
     تکیه به حالتِ محیط یعنی تستی که روی ماشینِ دیگری چیزِ دیگری می‌سنجد. */
  const kindForm = (await send('/forms', 'POST', { key: `clinic-${tag}`, title: `ویزیتِ ${tag}`, scope: 'visit', visitKind: 'clinic' })).json;
  if (kindForm?.id) trash.forms.push(kindForm.id);

  const v0 = (await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'مریمِ', lastName: `پذیرش${tag}`, phone: '09120000916',
    opDate: new Date().toISOString(),
  })).json;
  if (!v0?.id) { console.error('مراجعهٔ پایه ساخته نشد', v0); process.exit(1); }
  trash.visits.push(v0.id);
  pid = num(`SELECT patient_id FROM visits WHERE id=${v0.id}`);

  /* شش نوبت، یکی در هر وضعیت. */
  const mk = (status, extra = '') => num(
    `INSERT INTO appointments(patient_id, date, start_min, status, created_at, updated_at${extra ? ', visit_id' : ''})
     VALUES (${pid}, '${ISO}', ${540 + Math.floor(Math.random() * 300)}, '${status}', now(), now()${extra}) RETURNING id`);
  const aHeld = mk('held');
  const aConf = mk('confirmed');
  const aArr = mk('arrived');
  const aDone = mk('done');
  const aNo = mk('noshow');
  const aCan = mk('cancelled');
  /* 🔴 همان حالتی که بن‌بست را می‌ساخت: نوبتِ **قطعیِ ثبت‌نامِ آنلاین** که
     `visitId` از قبل دارد (`intake.service.ts:1736`). */
  const aIntake = mk('confirmed', `, ${v0.id}`);

  console.log('۱) تخته');
  const day = (await send(`/frontdesk/day?date=${ISO}`, 'GET')).json;
  ok(day?.isToday === true && day.lanes.length === 5, `تختهٔ امروز با پنج ستون (${day?.lanes?.length})`);
  const laneOf = (id) => day.rows.find((r) => r.id === id)?.lane;
  ok(laneOf(aHeld) === 'booked' && laneOf(aConf) === 'booked', 'در انتظار و قطعی ← نوبت‌دار');
  ok(laneOf(aArr) === 'present', 'رسیده بدونِ مراجعه ← حاضر');
  ok(laneOf(aDone) === 'finished' && laneOf(aNo) === 'absent', 'تمام‌شده و غایب ستونِ خودشان');
  ok(laneOf(aIntake) === 'booked',
    `**نباید بیفتد:** نوبتِ ثبت‌نامِ آنلاین چون \`visitId\` دارد «در جریان» شمرده شود (${laneOf(aIntake)}) — بیمار هنوز خانه است`);
  /* ⚠️ تخته **روزمحور** است نه بیمارمحور: نوبتِ بیمارانِ دیگرِ همان روز هم در
     شمارنده‌هاست. پس ادعا را روی ردیفِ خودمان می‌بندیم، نه روی عددِ کل —
     وگرنه سنجه به حالتِ محیط تکیه می‌کند و روی ماشینِ دیگری چیزِ دیگری می‌سنجد. */
  ok(day.lanes.every((l) => l.key !== 'cancelled') && laneOf(aCan) === 'cancelled' && day.cancelledCount >= 1,
    '**نباید بیفتد:** لغوشده ستون بگیرد — فقط یک شمارنده کنارِ تخته');
  ok(!day.lanes.some((l) => l.count && day.rows.filter((r) => r.lane === l.key).some((r) => r.id === aCan)),
    '**نباید بیفتد:** ردیفِ لغوشده در یکی از پنج ستون هم بیاید');

  console.log('\n۲) برچسب‌ها و دکمه‌ها مشتقِ سرورند');
  const conf = day.rows.find((r) => r.id === aConf);
  ok(conf.nextOptions.some((o) => o.status === 'arrived' && o.label === 'رسید'),
    'برچسبِ **اقدام** («رسید») می‌آید نه برچسبِ وضعیت («در مطب»)');
  ok(!conf.nextOptions.some((o) => o.status === 'done'),
    '**نباید بیفتد:** گذارِ نامجاز به دکمه تبدیل شود (قطعی مستقیم «تمام شد» ندارد)');
  ok(conf.canStart === true && day.rows.find((r) => r.id === aHeld).canStart === false,
    '`canStart` مشتقِ سرور: قطعی می‌تواند، در-انتظارِ-پرداخت نمی‌تواند');

  console.log('\n۳) شروع — همان بن‌بستی که بسته شد');
  const started = await send(`/frontdesk/appointments/${aIntake}/start`, 'POST');
  ok(started.status < 300 && started.json?.visitId === v0.id, `شروع شد و همان مراجعه برگشت (${started.status})`);
  ok(started.json?.appointment?.status === 'arrived' && started.json?.appointment?.lane === 'inVisit',
    `**نباید بیفتد:** نوبتِ \`visitId\`دار بعد از «شروع» در «نوبت‌دار» گیر کند (${started.json?.appointment?.lane})`);

  const heldStart = await send(`/frontdesk/appointments/${aHeld}/start`, 'POST');
  ok(heldStart.status === 400 && /قطعی/.test(heldStart.json?.message ?? ''),
    '**نباید بیفتد:** نوبتِ در-انتظارِ-پرداخت بدونِ «قطعی» شروع شود (پرداخت ادعای عمدی است)');
  const canStart = await send(`/frontdesk/appointments/${aCan}/start`, 'POST');
  ok(canStart.status === 400, '**نباید بیفتد:** نوبتِ لغوشده شروع شود');

  const aYesterday = num(`INSERT INTO appointments(patient_id, date, start_min, status, created_at, updated_at)
    VALUES (${pid}, '${ISO}'::date - 1, 600, 'confirmed', now(), now()) RETURNING id`);
  const old = await send(`/frontdesk/appointments/${aYesterday}/start`, 'POST');
  ok(old.status === 400 && /امروز/.test(old.json?.message ?? ''),
    '**نباید بیفتد:** نوبتِ روزِ دیگر از میز شروع شود (تاریخِ مراجعه با امروز بازنویسی می‌شد)');

  console.log('\n۴) مالی');
  await send(`/visits/${v0.id}/charges`, 'POST', { title: 'ویزیت', unitPrice: 400000 });
  const withMoney = (await send(`/frontdesk/day?date=${ISO}`, 'GET')).json;
  const mrow = withMoney.rows.find((r) => r.id === aIntake);
  ok(mrow.billing?.due === 400000, `ماندهٔ مالی روی کارت (${mrow.billing?.due})`);
  sql(`UPDATE visits SET op_status='cancelled' WHERE id=${v0.id}`);
  const afterCancel = (await send(`/frontdesk/day?date=${ISO}`, 'GET')).json;
  ok(afterCancel.rows.find((r) => r.id === aIntake)?.billing === null,
    '**نباید بیفتد:** مراجعهٔ لغوشده ماندهٔ مالی نشان دهد');
  sql(`UPDATE visits SET op_status='pending' WHERE id=${v0.id}`);

  console.log('\n۵) سطحِ منشی — کلِ دلیلِ وجودِ این بسته');
  made = (await send('/accounts/temporary', 'POST', {
    firstName: 'منشیِ', lastName: `میز ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
    level: 2, jobRole: 'secretary', username: `d${tag}`,
  })).json;
  if (made?.account?.id) {
    trash.accounts.push(made.account.id);
    tl = await fetch(API + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: `d${tag}`, password: made.temporaryPassword }),
    }).then((r) => r.json());
    const H = { Authorization: 'Bearer ' + tl.accessToken };
    const asDesk = await fetch(`${API}/frontdesk/day?date=${ISO}`, { headers: H });
    ok(asDesk.status === 200, `منشیِ سطح‌۲ تختهٔ میز را می‌گیرد (${asDesk.status})`);
    /* و همان حساب نباید به داشبورد (سطحِ ادمین) یا تقویم (سوپروایزر) برسد —
       وگرنه «سطحِ ۲» فقط یک عدد در سند بود. */
    const asDash = await fetch(`${API}/visits?limit=1`, { headers: H });
    ok(asDash.status >= 400,
      `**نباید بیفتد:** همان حساب به داشبورد هم برسد (${asDash.status}) — برگشتِ فرم به داشبورد بی‌معنی می‌شد`);
    const asCal = await fetch(`${API}/appointments/day?date=${ISO}`, { headers: H });
    ok(asCal.status >= 400, `**نباید بیفتد:** گیتِ تقویم با بازشدنِ میز پایین بیاید (${asCal.status})`);
  } else { ok(false, 'حسابِ منشی ساخته نشد'); }

  console.log('\n۶) روی صفحه');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  try {
    await browserLogin(page, login.accessToken, { ui: UI });
    await page.goto(`${UI}/app/frontdesk`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.fd-board', { timeout: 15000 });
    ok(await page.locator('.fd-lane').count() === 5, 'پنج ستون رندر شد');
    ok(await page.locator('.fd-card').count() >= 5, 'کارت‌ها روی ستون‌هایشان نشستند');
    const boardText = await page.locator('.fd-board').innerText();
    ok(!/\{visit\}/.test(boardText) && /مراجع/.test(await page.locator('.fd-sum').innerText()),
      'واژهٔ حوزه از `useTerms()` پُر شد');

    console.log('\n۷) ≤ ۲ کلیک تا شروع، ≤ ۱ کلیک برگشت');
    const card = page.locator(`.fd-card[data-appt="${aConf}"]`);
    await card.waitFor({ timeout: 8000 });
    await card.locator('.fd-btn.primary').click();          // کلیکِ ۱
    await page.waitForSelector('.db-sheet', { timeout: 15000 });
    ok(true, 'با **یک** کلیک فرمِ مراجعه روی خودِ میز باز شد');
    ok(/\/app\/frontdesk/.test(page.url()),
      `**نباید بیفتد:** برگشت به داشبورد بپرد (${page.url().split('/app')[1]}) — منشی آن‌جا دسترسی ندارد`);
    await page.keyboard.press('Escape');                     // کلیکِ برگشت
    await page.waitForTimeout(500);
    ok(await page.locator('.db-sheet').count() === 0 && await page.locator('.fd-board').count() === 1,
      'با **یک** اقدام (Escape) به میز برگشت');

    execSync(`mkdir -p ${SHOTS}`);
    await page.screenshot({ path: `${SHOTS}/w3-3-desk-dark.png` });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/w3-3-desk-light.png` });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    ok(true, `اسکرین‌شاتِ هر دو تم در ${SHOTS}`);
    ok(errors.length === 0, `بدونِ خطای جاوااسکریپت و بدونِ پاسخِ ≥۴۰۰ (${errors.length})${errors.length ? ' — ' + errors[0].slice(0, 160) : ''}`);
  } finally { await browser.close().catch(() => {}); }
} finally {
  if (pid > 0) sql(`DELETE FROM appointments WHERE patient_id=${pid}`);
  for (const v of trash.visits.reverse()) await send(`/visits/${v}`, 'DELETE').catch(() => {});
  for (const f of trash.forms) await send(`/forms/${f}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    sql(`DELETE FROM account_sessions WHERE account_id=${id}`);
    sql(`DELETE FROM accounts WHERE id=${id}`);
  }
}
console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
