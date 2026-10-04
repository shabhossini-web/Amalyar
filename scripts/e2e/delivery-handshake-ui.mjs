/**
 * تحویلِ دوطرفه (مالک، ۱۴۰۵/۰۷/۱۱) — سرورِ زنده + مرورگرِ واقعی.
 *
 * گزارشِ مالک: «الان راننده میزنه تحویل داده شد ولی تو پنل کارشناسی نوشته فرستاده نشد». تختهٔ روز
 * حواله را `planned` می‌ساخت و هیچ دکمه‌ای ارسالش نمی‌کرد؛ «ثبتِ تحویل»ِ راننده فقط توقف را مهر
 * می‌زد و دفترِ انبار تکان نمی‌خورد.
 *
 *  باید بیفتد:
 *   - «ثبتِ تحویل»ِ راننده از رابط حواله را ارسال می‌کند (دفتر: انبار ← بیمارستان) و کارتش
 *     «منتظرِ تأییدِ کارشناس» می‌گیرد
 *   - کارشناس در پنلِ خودش «راننده (…) ساعتِ … تحویل داد» و «منتظرِ تأییدِ شما» می‌بیند؛ تا تأیید
 *     نکرده نه «پایانِ عمل» دارد نه «ثبتِ مصرفی»
 *   - «با مغایرت» برگهٔ شمارش را باز می‌کند: استاندارد از قالبِ ست، کسری **حساب** می‌شود؛ ثبتش
 *     ردیف‌های کسری/خرابی با `stage = receipt` می‌سازد و هر دو پنل «تحویل با مغایرت» می‌شوند
 *   - «تحویل گرفتم» بی‌مغایرت: کارت سبز، بی‌ردیفِ کسری؛ نمای سرپرستی «کارشناس تحویل گرفت» می‌گوید
 *   - تحویلِ تأییدنشده که روزش گذشته → کارِ «تأییدِ تحویل» برای دفتر؛ تأییدِ کارشناس می‌بنددش
 *  نباید بیفتد:
 *   - تأیید پیش از ارسال (۴۰۰ فارسی)؛ راننده یا کارشناسِ دیگر روی حوالهٔ این کارشناس (۴۰۴)
 *   - هیچ خطای JS/کنسول/HTTP در سه نما
 *
 * پیش‌نیازها: `scripts/e2e/README.md`. عکس با `E2E_SHOTS=<پوشه>` (هر دو تم، موبایل).
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

const tag = 'dh' + randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const clinicToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.CLINIC_TZ || 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const trash = { visits: [], forms: [], hospitals: [], accounts: [], runs: [], features: [], lots: [], items: [] };
let browser;

try {
  console.log('۰) آماده‌سازی: کارشناس، راننده، سه بیمارستان، ست با قالبِ محتویات، لات‌ها، سه مراجعهٔ امروز، سه تحویلِ تخته');
  const feats = (await send('/features')).json ?? [];
  for (const k of ['tech', 'transport']) {
    if (feats.find((f) => f.key === k)?.enabled === false) { sql(`UPDATE features SET enabled=true WHERE key='${k}'`); trash.features.push(k); }
  }
  const mkAccount = async (user, first, last, level, jobRole) => {
    const made = (await send('/accounts/temporary', 'POST', {
      firstName: first, lastName: `${last}${tag}`, phone: phone(), level, jobRole, username: `${user}${tag}`,
    })).json;
    if (!made?.account?.id) throw new Error('حساب ساخته نشد: ' + JSON.stringify(made).slice(0, 160));
    trash.accounts.push(made.account.id);
    return { id: made.account.id, username: `${user}${tag}`, password: made.temporaryPassword, name: `${first} ${last}${tag}` };
  };
  const techA = await mkAccount('ta', 'نیما', 'کارشناسِ', 2, 'technician');
  const techB = await mkAccount('tb', 'سمیرا', 'دیگرِ', 2, 'technician');
  const drv = await mkAccount('dr', 'رضا', 'احمدیِ', 2, 'driver');

  const mkHospital = async (name) => {
    const h = (await send('/hospitals', 'POST', { name: `${name} ${tag}` })).json;
    if (!h?.id) throw new Error('بیمارستان ساخته نشد: ' + JSON.stringify(h).slice(0, 160));
    trash.hospitals.push(h.id);
    return h;
  };
  const hA = await mkHospital('بیمارستانِ آرمان');
  const hB = await mkHospital('بیمارستانِ میلاد');
  const hC = await mkHospital('بیمارستانِ لقمان');
  const form = (await send('/forms', 'POST', { key: tag, title: `عملِ ${tag}`, scope: 'visit' })).json;
  if (form?.id) trash.forms.push(form.id);

  const setItem = (await send('/items', 'POST', { name: `ست SDN ${tag}`, assetKind: 'set' })).json;
  const elItem = (await send('/items', 'POST', { name: `الکترود ${tag}`, assetKind: 'consumable', unit: 'عدد' })).json;
  if (!setItem?.id || !elItem?.id) throw new Error('کالا ساخته نشد: ' + JSON.stringify([setItem, elItem]).slice(0, 200));
  trash.items.push(setItem.id, elItem.id);
  for (const [label, quantity] of [['الکترود SDN', 20], ['سوزن', 5]]) {
    const c = await send(`/assets/items/${setItem.id}/contents`, 'POST', { label, quantity });
    if (c.status >= 400) throw new Error('قالبِ ست ساخته نشد: ' + JSON.stringify(c.json).slice(0, 160));
  }
  const l1 = await send('/stock/lots', 'POST', { itemId: setItem.id, serialNo: `SE-${tag}`, quantity: 1 });
  const l2 = await send('/stock/lots', 'POST', { itemId: elItem.id, lotNo: `E-${tag}`, quantity: 100 });
  if (l1.status >= 400 || l2.status >= 400) throw new Error('لات ساخته نشد: ' + JSON.stringify([l1.json, l2.json]).slice(0, 200));
  const setLot = num(`SELECT id FROM stock_lots WHERE serial_no='SE-${tag}'`);
  const elLot = num(`SELECT id FROM stock_lots WHERE lot_no='E-${tag}'`);
  trash.lots.push(setLot, elLot);
  const home = sql(`SELECT location FROM stock_lots WHERE id=${setLot}`);

  const mkVisit = async (last, hospitalId, opStartTime) => {
    const r = await send('/visits', 'POST', {
      kind: tag, firstName: 'بیمارِ', lastName: `${last}${tag}`, phone: phone(),
      hospitalId, opDate: `${clinicToday}T00:00:00.000Z`, techId: techA.id, opStartTime,
    });
    if (!r.json?.id) throw new Error('مراجعه ساخته نشد: ' + JSON.stringify(r.json).slice(0, 160));
    trash.visits.push(r.json.id);
    return r.json;
  };
  const vA = await mkVisit('آرمانی', hA.id, '09:30');
  const vB = await mkVisit('میلادی', hB.id, '11:00');
  const vC = await mkVisit('لقمانی', hC.id, '13:00');
  const staffId = num(`SELECT t.id FROM transport_staff t JOIN accounts a ON a.person_id = t.person_id WHERE a.id = ${drv.id}`);
  ok(staffId > 0, 'نقشِ راننده → نیروی حمل');

  const plan = async (hospitalId, plannedAt, handedTo, lines) => {
    const r = await send('/routes/board/delivery', 'POST', { on: clinicToday, hospitalId, plannedAt, handedTo, staffId, lines });
    if (r.status >= 400) throw new Error('تحویلِ تخته ثبت نشد: ' + JSON.stringify(r.json).slice(0, 200));
  };
  await plan(hA.id, '08:00', 'کارشناسِ حاضر', [{ lotId: setLot, quantity: 1 }, { lotId: elLot, quantity: 10 }]);
  await plan(hB.id, '10:00', 'CSR', [{ lotId: elLot, quantity: 5 }]);
  await plan(hC.id, '12:00', 'CSR', [{ lotId: elLot, quantity: 3 }]);
  const tOf = (visitId) => ({ id: num(`SELECT id FROM stock_transfers WHERE visit_id=${visitId}`), code: sql(`SELECT code FROM stock_transfers WHERE visit_id=${visitId}`), stopId: num(`SELECT stop_id FROM stock_transfers WHERE visit_id=${visitId}`) });
  const tA = tOf(vA.id), tB = tOf(vB.id), tC = tOf(vC.id);
  trash.runs.push(...sql(`SELECT string_agg(id::text, ',') FROM transport_runs WHERE staff_id=${staffId}`).split(',').filter(Boolean).map(Number));
  ok(tA.id > 0 && tB.id > 0 && tC.id > 0 && tA.stopId > 0, `سه حوالهٔ برنامه‌ریزی‌شده روی سه توقفِ راننده (${tA.code}, ${tB.code}, ${tC.code})`);
  const atHospital = (lot, loc) => num(`SELECT coalesce(sum(quantity),0) FROM stock_movements WHERE lot_id=${lot} AND location='${loc}'`);
  ok(atHospital(setLot, home) === 1 && atHospital(setLot, hA.name) === 0, 'پیش از راننده: ست در انبار است، نه بیمارستان');

  const sessA = await loginAs(techA.username, techA.password);
  const sessB = await loginAs(techB.username, techB.password);
  const sessD = await loginAs(drv.username, drv.password);
  ok(!!(sessA.accessToken && sessB.accessToken && sessD.accessToken), 'کارشناس‌ها و راننده با رمزِ موقت وارد شدند');
  const asA = call(sessA.accessToken), asB = call(sessB.accessToken), asD = call(sessD.accessToken);

  console.log('\n۱) پیش از تحویلِ راننده — وضعیت از سرور');
  const ag0 = (await asA('/tech/agenda?scope=today')).json;
  const trA0 = ag0?.visits?.find((v) => v.id === vA.id)?.transfers?.[0];
  ok(trA0?.delivery === 'not_sent' && trA0?.handover === null && trA0?.receipt === null, 'پنلِ کارشناسی: «هنوز ارسال نشده»، بی‌تحویل، بی‌رسید');
  const early = await asA(`/stock/transfers/${tA.id}/receipt`, 'POST', {});
  ok(early.status === 400 && /ارسال نشده/.test(early.json?.message ?? ''), `«تحویل گرفتم» پیش از ارسال رد می‌شود (${early.status} «${early.json?.message}»)`);
  const drv0 = (await asD('/transport/agenda')).json;
  const cargo0 = (drv0?.runs ?? []).flatMap((r) => r.stops).flatMap((s) => s.cargo).find((c) => c.id === tA.id);
  ok(cargo0?.delivery === 'not_sent' && cargo0?.status === 'planned', 'پنلِ راننده: بارِ برنامه‌ریزی‌شده');

  console.log('\n۲) مرورگر — راننده «ثبتِ تحویل» می‌زند و حواله ارسال می‌شود');
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`[${who}] ${e}`));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`[${who} http ${r.status()}] ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${who} console] ${m.text()}`); });
  };
  const ctxD = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const pageD = await ctxD.newPage();
  watch(pageD, 'driver');
  await browserLogin(pageD, sessD.accessToken, { ui: UI });
  const openTransport = async (p) => {
    await p.goto(UI + '/app/transport', { waitUntil: 'networkidle' });
    await p.waitForSelector(`article.tr-card:has-text("${hA.name}")`, { timeout: 15000 });
  };
  await openTransport(pageD);
  const cardA = pageD.locator('article.tr-card', { hasText: hA.name });
  ok(await cardA.locator('.tr-tag.warn').count() === 0, 'پیش از تحویل، برچسبِ تأیید روی بار نیست');
  await cardA.locator('.tr-do').click();
  await pageD.waitForSelector('.tr-sheet', { timeout: 5000 });
  await pageD.locator('.tr-sheet .tr-field input').first().fill('کارشناسِ حاضر');
  await pageD.locator('.tr-sheet .tr-save').click();
  await pageD.waitForFunction(() => /منتظرِ تأییدِ کارشناس/.test(document.querySelector('.tr-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  ok(true, 'پیامِ موفقیت می‌گوید «منتظرِ تأییدِ کارشناس»');
  ok(sql(`SELECT status FROM stock_transfers WHERE id=${tA.id}`) === 'sent', '**حواله ارسال شد** (ریشهٔ باگ: تا دیروز planned می‌ماند)');
  ok(atHospital(setLot, home) === 0 && atHospital(setLot, hA.name) === 1 && atHospital(elLot, hA.name) === 10, 'دفترِ انبار: ست و ۱۰ الکترود انبار ← بیمارستان');
  ok(sql(`SELECT coalesce(done_at::text,'-') FROM transport_stops WHERE id=${tA.stopId}`) !== '-', 'توقف انجام‌شده مهر خورد');
  await pageD.waitForSelector(`article.tr-card:has-text("${hA.name}") .tr-tag.warn`, { timeout: 8000 });
  ok((await cardA.locator('.tr-bag .tr-tag.warn').innerText()).trim() === 'منتظرِ تأییدِ کارشناس', 'کارتِ راننده روی بار: «منتظرِ تأییدِ کارشناس»');
  ok((await cardA.locator('header .tr-tag').innerText()).trim() === 'تحویل شد', '… و سرِ کارت همان «تحویل شد»');

  console.log('\n۳) مرورگر — کارشناس می‌بیند راننده تحویل داده و باید تأیید کند');
  const ctxA = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const pageA = await ctxA.newPage();
  watch(pageA, 'tech');
  await browserLogin(pageA, sessA.accessToken, { ui: UI });
  const openTech = async (p) => {
    await p.goto(UI + '/app/tech', { waitUntil: 'networkidle' });
    await p.waitForSelector(`.tk-card:has-text("آرمانی${tag}")`, { timeout: 15000 });
  };
  await openTech(pageA);
  const setA = pageA.locator('article.tk-card', { hasText: `آرمانی${tag}` }).locator('.tk-set:not(.tk-usage)');
  ok(await setA.count() === 1 && /d-awaiting/.test(await setA.getAttribute('class')), 'کارتِ ست کهربایی (awaiting) است');
  const hand = (await setA.locator('.tk-hand').innerText()).replace(/\s+/g, ' ').trim();
  ok(/^راننده \(رضا احمدیِ/.test(hand) && /تحویل داد/.test(hand) && /کارشناسِ حاضر/.test(hand), `«${hand}»`);
  ok((await setA.locator('.tk-tag.warn').innerText()).trim() === 'منتظرِ تأییدِ شما', 'برچسب: «منتظرِ تأییدِ شما»');
  ok(await setA.locator('button', { hasText: 'پایانِ عمل' }).count() === 0 && await pageA.locator('article.tk-card', { hasText: `آرمانی${tag}` }).locator('.tk-usage button').isDisabled(), 'تا تأیید نکرده نه «پایانِ عمل» دارد نه «ثبتِ مصرفی» (بستهٔ ج)');
  ok(await setA.locator('button', { hasText: 'تحویل گرفتم' }).count() === 1 && await setA.locator('button', { hasText: 'با مغایرت' }).count() === 1, 'دو دکمه: «تحویل گرفتم» و «با مغایرت»');

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    const phoneView = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const shot = await phoneView.newPage();
    watch(shot, 'shots');
    await browserLogin(shot, sessA.accessToken, { ui: UI });
    for (const theme of ['dark', 'light']) {
      await openTech(shot);
      await shot.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await shot.screenshot({ path: `${SHOTS}/handshake-tech-awaiting-${theme}.png`, fullPage: true });
      await shot.locator('article.tk-card', { hasText: `آرمانی${tag}` }).locator('button', { hasText: 'با مغایرت' }).click();
      await shot.waitForSelector('.tk-sheet .tk-count-row', { timeout: 8000 });
      await shot.locator('.tk-sheet .tk-count-row:not(.tk-count-cols)').first().locator('input').first().fill('18');
      await shot.waitForTimeout(200);
      await shot.screenshot({ path: `${SHOTS}/handshake-tech-count-${theme}.png`, fullPage: true });
      await shot.locator('.tk-sheet .tk-x').click();
    }
    const shotD = await phoneView.newPage();
    watch(shotD, 'shots');
    await browserLogin(shotD, sessD.accessToken, { ui: UI });
    for (const theme of ['dark', 'light']) {
      await openTransport(shotD);
      await shotD.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await shotD.screenshot({ path: `${SHOTS}/handshake-driver-${theme}.png`, fullPage: true });
    }
    await phoneView.close();
    console.log(`  (عکس‌ها در ${SHOTS})`);
  }

  console.log('\n۴) «با مغایرت» — برگهٔ شمارش');
  await setA.locator('button', { hasText: 'با مغایرت' }).click();
  await pageA.waitForSelector('.tk-sheet .tk-count-row:not(.tk-count-cols)', { timeout: 8000 });
  const rows = pageA.locator('.tk-sheet .tk-count-row:not(.tk-count-cols)');
  ok(await rows.count() === 3, `سه ردیف: دو قلمِ قالبِ ست + یک قلمِ مصرفی (${await rows.count()})`);
  const row0 = rows.nth(0), row1 = rows.nth(1), row2 = rows.nth(2);
  ok((await row0.locator('.tk-count-label').innerText()).trim() === 'الکترود SDN' && (await row0.locator('.tk-count-std').innerText()).trim() === '۲۰', 'ردیفِ اول: الکترود SDN، استاندارد ۲۰ (از قالبِ ست)');
  ok((await row1.locator('.tk-count-std').innerText()).trim() === '۵' && (await row2.locator('.tk-count-std').innerText()).trim() === '۱۰', 'سوزن ۵، قلمِ مصرفی ۱۰ (تعدادِ ارسالی)');
  ok((await pageA.locator('.tk-sheet .tk-save').innerText()).includes('بی‌مغایرت'), 'پیش از تغییر، دکمه «بی‌مغایرت» است');
  await row0.locator('input').first().fill('18');
  await row1.locator('input').nth(1).fill('1');
  ok((await row0.locator('.tk-count-miss').innerText()).trim() === '۲', 'کسری حساب شد: ۲۰ − ۱۸ = ۲ (تایپ نشد)');
  ok((await pageA.locator('.tk-sheet .tk-save').innerText()).includes('۲ مغایرت'), 'دکمه: «ثبتِ تحویل با ۲ مغایرت»');
  await pageA.locator('.tk-sheet .tk-field input').fill(`دو الکترود کم بود ${tag}`);
  await pageA.locator('.tk-sheet .tk-save').click();
  await pageA.waitForFunction(() => /تحویل با مغایرت ثبت شد/.test(document.querySelector('.tk-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  ok(sql(`SELECT tech_receipt_issue::text || '/' || coalesce(tech_received_by_id::text,'-') FROM stock_transfers WHERE id=${tA.id}`) === `true/${techA.id}`, 'حواله: با مغایرت، به نامِ همین کارشناس');
  ok(sql(`SELECT string_agg(label || ':' || missing || ':' || kind || ':' || stage, ',' ORDER BY id) FROM set_shortages WHERE transfer_id=${tA.id}`) === 'الکترود SDN:2:missing:receipt,سوزن:1:damaged:receipt', 'دو ردیفِ کسری/خرابی با stage=receipt — ردیفِ صفر ثبت نشد');
  ok(sql(`SELECT tech_receipt_note FROM stock_transfers WHERE id=${tA.id}`) === `دو الکترود کم بود ${tag}`, 'یادداشت نشست');
  ok(atHospital(setLot, hA.name) === 1, 'تأیید موجودی را جابه‌جا نمی‌کند');
  await pageA.waitForSelector(`article.tk-card:has-text("آرمانی${tag}") .tk-set.d-received_issue`, { timeout: 8000 });
  ok((await setA.locator('.tk-tag.warn').innerText()).trim() === 'تحویل با مغایرت' && await setA.locator('.tk-note.warn').count() === 1, 'کارت: «تحویل با مغایرت» + یادداشتِ رسید');
  ok(await setA.locator('button', { hasText: 'پایانِ عمل' }).count() === 1, 'حالا «پایانِ عمل و جمع‌آوری» باز است (مصرف در بلوکِ «ثبتِ مصرفی»، بستهٔ ج)');
  await openTransport(pageD);
  ok((await cardA.locator('.tr-bag .tr-tag.warn').innerText()).trim() === 'تحویل با مغایرت' && await cardA.locator('.tr-recv.warn').count() === 1, 'پنلِ راننده هم «تحویل با مغایرت» و ساعتِ رسید را می‌گوید');

  console.log('\n۵) «تحویل گرفتم» بی‌مغایرت + نمای سرپرستی');
  const doneB = await asD(`/transport/stops/${tB.stopId}/done`, 'POST', { handedActual: 'CSR' });
  ok(doneB.status === 201 && sql(`SELECT status FROM stock_transfers WHERE id=${tB.id}`) === 'sent', `ثبتِ تحویلِ دوم از API هم حواله را ارسال می‌کند (${doneB.status})`);
  await openTech(pageA);
  const setB = pageA.locator('article.tk-card', { hasText: `میلادی${tag}` }).locator('.tk-set:not(.tk-usage)');
  await setB.locator('button', { hasText: 'تحویل گرفتم' }).click();
  await pageA.waitForFunction(() => /^تحویل ثبت شد/.test(document.querySelector('.tk-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  await pageA.waitForSelector(`article.tk-card:has-text("میلادی${tag}") .tk-set.d-received`, { timeout: 8000 });
  ok((await setB.locator('.tk-tag.ok').innerText()).trim() === 'تحویل گرفتید', 'کارت سبز: «تحویل گرفتید»');
  ok(sql(`SELECT tech_receipt_issue::text FROM stock_transfers WHERE id=${tB.id}`) === 'false' && num(`SELECT count(*) FROM set_shortages WHERE transfer_id=${tB.id}`) === 0, 'بی‌مغایرت: بی‌ردیفِ کسری');
  const agTeam = (await send('/tech/agenda?scope=today')).json;
  const teamB = agTeam?.visits?.find((v) => v.id === vB.id)?.transfers?.[0];
  ok(agTeam?.team === true && teamB?.delivery === 'received' && teamB?.receipt?.issue === false, 'نمای سرپرستی همان وضعیت را از سرور می‌گیرد');
  const ctxS = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const pageS = await ctxS.newPage();
  watch(pageS, 'superadmin');
  await browserLogin(pageS, login.accessToken, { ui: UI });
  await openTech(pageS);
  ok((await pageS.locator('article.tk-card', { hasText: `میلادی${tag}` }).locator('.tk-set .tk-tag.ok').innerText()).trim() === 'کارشناس تحویل گرفت', 'سوپرادمین «کارشناس تحویل گرفت» می‌بیند، نه «گرفتید»');
  const invDetail = (await send(`/stock/transfers/${tA.id}`)).json;
  ok(invDetail?.receipt?.issue === true && /کم بود/.test(invDetail?.receipt?.note ?? ''), 'جزئیاتِ حواله در انبار رسیدِ کارشناس را دارد');

  console.log('\n۶) تحویلِ تأییدنشده که روزش گذشت → کارِ «تأییدِ تحویل» برای دفتر');
  const doneC = await asD(`/transport/stops/${tC.stopId}/done`, 'POST', { handedActual: 'CSR' });
  ok(doneC.status === 201, `تحویلِ سوم ثبت شد (${doneC.status})`);
  const p0 = (await send('/work/process', 'POST')).json;
  ok((p0?.detected?.deliveryUnconfirmed ?? -1) === 0, 'همان روز: هنوز کاری ساخته نمی‌شود (کارشناس روز را دارد)');
  sql(`UPDATE transport_stops SET done_at = now() - interval '36 hours' WHERE id=${tC.stopId}`);
  const p1 = (await send('/work/process', 'POST')).json;
  ok((p1?.detected?.deliveryUnconfirmed ?? 0) >= 1, `روزِ تحویل گذشته → رویدادِ delivery.unconfirmed (${p1?.detected?.deliveryUnconfirmed})`);
  const wq = `SELECT state || '/' || coalesce(owner_role,'-') || '/' || title FROM work_items WHERE type='confirm_delivery' AND ref_type='stock_transfer' AND ref_id=${tC.id}`;
  const w1 = sql(wq);
  ok(/^open\/secretary\//.test(w1) && w1.includes(tC.code) && w1.includes('نیما'), `کارِ باز برای دفتر: «${w1.split('/').slice(2).join('/')}»`);
  ok(num(`SELECT count(*) FROM work_items WHERE type='confirm_delivery' AND ref_id IN (${tA.id},${tB.id})`) === 0, 'حواله‌های تأییدشده کار نساختند');
  const confirmC = await asA(`/stock/transfers/${tC.id}/receipt`, 'POST', {});
  ok(confirmC.status === 201 && confirmC.json?.receipt?.issue === false, `کارشناس از API تأیید می‌کند (${confirmC.status})`);
  await send('/work/process', 'POST');
  ok(/^done\//.test(sql(wq)), '«تحویل گرفتم» کارِ دفتر را بست');

  console.log('\n۷) نباید بیفتد');
  const again = await asA(`/stock/transfers/${tA.id}/receipt`, 'POST', {});
  ok(again.status === 400 && /قبلاً/.test(again.json?.message ?? ''), `تأییدِ دوباره رد می‌شود (${again.status})`);
  const foreign = await asB(`/stock/transfers/${tA.id}/receipt`, 'GET');
  ok(foreign.status === 404, `کارشناسِ دیگر برگهٔ این حواله را نمی‌بیند (${foreign.status})`);
  const drvConfirm = await asD(`/stock/transfers/${tB.id}/receipt`, 'POST', {});
  ok(drvConfirm.status === 404 || drvConfirm.status === 403, `راننده به‌جای کارشناس تأیید نمی‌زند (${drvConfirm.status})`);
  const agB = (await asB('/tech/agenda?scope=today')).json;
  ok(!(agB?.visits ?? []).some((v) => v.id === vA.id), 'کارشناسِ دیگر این عمل‌ها را در دفترش ندارد');
  ok(!/"(amount|paid|price|fee|discount|charges|payments|shares?)"/.test(JSON.stringify((await asA('/tech/agenda?scope=today')).json)), 'پنلِ کارشناسی هنوز هیچ فیلدِ مالی ندارد');

  console.log('\n۸) سلامتِ صفحه');
  const real = errors.filter((e) => !/http 400\] POST \/api\/stock\/transfers\/\d+\/receipt/.test(e));
  ok(real.length === 0, `بدونِ خطای جاوااسکریپت/کنسول/HTTP (${real.length})${real.length ? ' — ' + real.slice(0, 3).join(' | ').slice(0, 300) : ''}`);
} catch (e) {
  fail++;
  console.log('  ✘ اجرا قطع شد: ' + String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
} finally {
  await browser?.close().catch(() => {});
  const q = (s) => { try { sql(s); } catch (e) { console.log('  (پاک‌سازی) ' + String(e.message).split('\n')[0].slice(0, 160)); } };
  if (trash.visits.length) {
    q(`DELETE FROM work_items WHERE visit_id IN (${trash.visits.join(',')}) OR (ref_type='stock_transfer' AND ref_id IN (SELECT id FROM stock_transfers WHERE visit_id IN (${trash.visits.join(',')})))`);
    q(`DELETE FROM domain_events WHERE visit_id IN (${trash.visits.join(',')})`);
  }
  if (trash.lots.length) {
    q(`DELETE FROM stock_movements WHERE lot_id IN (${trash.lots.join(',')})`);
    q(`DELETE FROM stock_transfers WHERE id IN (SELECT DISTINCT transfer_id FROM set_shortages WHERE lot_id IN (${trash.lots.join(',')}))`);
  }
  for (const id of trash.runs) await send(`/routes/${id}`, 'DELETE').catch(() => {});
  if (trash.visits.length) q(`DELETE FROM stock_transfers WHERE visit_id IN (${trash.visits.join(',')})`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  if (trash.lots.length) q(`DELETE FROM stock_lots WHERE id IN (${trash.lots.join(',')})`);
  if (trash.items.length) { q(`DELETE FROM item_components WHERE set_id IN (${trash.items.join(',')})`); q(`DELETE FROM items WHERE id IN (${trash.items.join(',')})`); }
  for (const h of trash.hospitals) { q(`DELETE FROM hospital_duties WHERE hospital_id=${h}`); await send(`/hospitals/${h}`, 'DELETE').catch(() => {}); }
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    q(`DELETE FROM hospital_duties WHERE tech_id=${id}`);
    q(`DELETE FROM people WHERE id=(SELECT person_id FROM accounts WHERE id=${id})`);
  }
  for (const k of trash.features) q(`UPDATE features SET enabled=false WHERE key='${k}'`);
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
