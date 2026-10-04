/**
 * بستهٔ ج (مالک، ۱۴۰۵/۰۷/۱۱) — سرورِ زنده + مرورگرِ واقعی: ثبتِ مصرفیِ کارشناس + شمارشِ راننده هنگامِ جمع‌آوری.
 *
 *  باید بیفتد:
 *   - بلوکِ «ثبتِ مصرفی» بالای آپلودِ گزارش؛ تا ست «منتظرِ تأییدِ» کارشناس است بسته، پس از «تحویل گرفتم» باز
 *   - برگه: از ست (الکترود یک‌بارمصرف با شمارنده، کابلِ چندبارمصرف فقط شمرده)، ارسالیِ حواله (گاز)، از انبار
 *     (ژل و پروبِ تیک‌خورده) — عددها جمع‌اند؛ ثبت از ست/حواله/انبار کم می‌کند، چندبارمصرف نه
 *   - خلاصه و ساعتِ ثبت روی کارت؛ اصلاح به همان لات‌ها برمی‌گردد
 *   - پیش‌فرضِ شخصی: «ذخیرهٔ این ترکیب» → چیپ → یک لمس عددها را می‌نشاند (در `/auth/prefs`، همراهِ حساب)
 *   - راننده هنگامِ جمع‌آوری بسته‌ها را می‌شمارد (پیش‌فرض = ارسالی − مصرف)؛ کم‌شمرده = کسریِ مرحلهٔ جمع‌آوری
 *  نباید بیفتد:
 *   - شمارشِ بیشتر از آنچه باید برگردد (۴۰۰ فارسی)؛ پیش‌فرضِ بی‌نام (۴۰۰ فارسی)؛ هیچ خطای JS/کنسول/HTTP
 *
 * پیش‌نیازها: `scripts/e2e/README.md`. عکس با `E2E_SHOTS=<پوشه>` (گوشی، هر دو تم).
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

/* سنجهٔ دیتابیس منتظرِ خودِ نتیجه می‌ماند، نه ساعت (CI محلیِ هم‌زمان) — نه نوشتنِ تازه، نه توستِ قبلی. */
const untilSql = async (fn, ms = 8000) => { const t0 = Date.now(); let v = fn(); while (!v && Date.now() - t0 < ms) { await new Promise((r) => setTimeout(r, 150)); v = fn(); } return v; };
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('.tk-toast.on, .tr-toast.on'), null, { timeout: 8000 }).catch(() => {});
const loginAs = (identifier, password) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
}).then((r) => r.json());
const call = (token) => (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const login = await loginAs(process.env.E2E_USER ?? 'admin', process.env.E2E_PASS ?? 'test1234');
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = call(login.accessToken);

const tag = 'cu' + randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const clinicToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.CLINIC_TZ || 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const trash = { visits: [], forms: [], hospitals: [], accounts: [], runs: [], features: [], lots: [], items: [] };
let browser;

try {
  console.log('۰) آماده‌سازی: کارشناس، راننده، بیمارستان، ستِ پُرشده، کالاهای تیک‌خورده، مراجعهٔ امروز، تحویلِ تخته');
  const feats = (await send('/features')).json ?? [];
  for (const k of ['tech', 'transport']) {
    if (feats.find((f) => f.key === k)?.enabled === false) { sql(`UPDATE features SET enabled=true WHERE key='${k}'`); trash.features.push(k); }
  }
  const mkAccount = async (user, first, last, level, jobRole) => {
    const made = (await send('/accounts/temporary', 'POST', { firstName: first, lastName: `${last}${tag}`, phone: phone(), level, jobRole, username: `${user}${tag}` })).json;
    if (!made?.account?.id) throw new Error('حساب ساخته نشد: ' + JSON.stringify(made).slice(0, 160));
    trash.accounts.push(made.account.id);
    return { id: made.account.id, username: `${user}${tag}`, password: made.temporaryPassword, name: `${first} ${last}${tag}` };
  };
  const techA = await mkAccount('ta', 'نیما', 'کارشناسِ', 2, 'technician');
  const drv = await mkAccount('dr', 'رضا', 'احمدیِ', 2, 'driver');
  const h = (await send('/hospitals', 'POST', { name: `بیمارستانِ آرمان ${tag}` })).json;
  if (!h?.id) throw new Error('بیمارستان ساخته نشد');
  trash.hospitals.push(h.id);
  const form = (await send('/forms', 'POST', { key: tag, title: `عملِ ${tag}`, scope: 'visit' })).json;
  if (form?.id) trash.forms.push(form.id);

  const mkItem = async (body) => {
    const r = await send('/items', 'POST', body);
    if (!r.json?.id) throw new Error('کالا ساخته نشد: ' + JSON.stringify(r.json).slice(0, 160));
    trash.items.push(r.json.id);
    return r.json;
  };
  const setItem = await mkItem({ name: `ست SDN ${tag}`, assetKind: 'set' });
  const elItem = await mkItem({ name: `الکترود ${tag}`, assetKind: 'consumable', unit: 'عدد', usageMode: 'single' });
  const cableItem = await mkItem({ name: `کابلِ رابط ${tag}`, assetKind: 'consumable', unit: 'عدد', usageMode: 'multi' });
  const gelItem = await mkItem({ name: `ژلِ هادی ${tag}`, assetKind: 'consumable', unit: 'تیوب', usageMode: 'single', showInTechPanel: true });
  const probeItem = await mkItem({ name: `پروبِ تحریک ${tag}`, assetKind: 'consumable', unit: 'عدد', usageMode: 'multi', showInTechPanel: true });
  const gauzeItem = await mkItem({ name: `گازِ استریل ${tag}`, assetKind: 'consumable', unit: 'بسته', usageMode: 'single' });
  for (const [label, quantity, partId] of [[`الکترود ${tag}`, 20, elItem.id], [`کابلِ رابط ${tag}`, 2, cableItem.id]]) {
    const c = await send(`/assets/items/${setItem.id}/contents`, 'POST', { label, quantity, partId });
    if (c.status >= 400) throw new Error('قالبِ ست ساخته نشد: ' + JSON.stringify(c.json).slice(0, 160));
  }
  const mkLot = async (itemId, body, lotNoCol, lotNoVal) => {
    const r = await send('/stock/lots', 'POST', { itemId, ...body });
    if (r.status >= 400) throw new Error('لات ساخته نشد: ' + JSON.stringify(r.json).slice(0, 160));
    const id = num(`SELECT id FROM stock_lots WHERE ${lotNoCol}='${lotNoVal}'`);
    trash.lots.push(id);
    return id;
  };
  const setLot = await mkLot(setItem.id, { serialNo: `SE-${tag}`, quantity: 1 }, 'serial_no', `SE-${tag}`);
  const elLot = await mkLot(elItem.id, { lotNo: `E-${tag}`, quantity: 100 }, 'lot_no', `E-${tag}`);
  const cableLot = await mkLot(cableItem.id, { lotNo: `C-${tag}`, quantity: 5 }, 'lot_no', `C-${tag}`);
  const gelLot = await mkLot(gelItem.id, { lotNo: `G-${tag}`, quantity: 3 }, 'lot_no', `G-${tag}`);
  await mkLot(probeItem.id, { lotNo: `P-${tag}`, quantity: 2 }, 'lot_no', `P-${tag}`);
  const gauzeLot = await mkLot(gauzeItem.id, { lotNo: `GZ-${tag}`, quantity: 50 }, 'lot_no', `GZ-${tag}`);
  const home = sql(`SELECT location FROM stock_lots WHERE id=${setLot}`);
  const setLoc = `ست SE-${tag}`;
  const atLoc = (lot, loc) => num(`SELECT coalesce(sum(quantity),0) FROM stock_movements WHERE lot_id=${lot} AND location='${loc.replace(/'/g, "''")}'`);
  const filled = await send(`/stock/sets/${setLot}/fill`, 'POST', {});
  ok(filled.status < 300 && atLoc(elLot, setLoc) === 20 && atLoc(cableLot, setLoc) === 2, 'ست از انبار پُر شد: ۲۰ الکترود + ۲ کابل داخلِ ست');

  const vr = await send('/visits', 'POST', { kind: tag, firstName: 'بیمارِ', lastName: `آرمانی${tag}`, phone: phone(), hospitalId: h.id, opDate: `${clinicToday}T00:00:00.000Z`, techId: techA.id, opStartTime: '09:30' });
  if (!vr.json?.id) throw new Error('مراجعه ساخته نشد: ' + JSON.stringify(vr.json).slice(0, 160));
  const visit = vr.json; trash.visits.push(visit.id);
  const staffId = num(`SELECT t.id FROM transport_staff t JOIN accounts a ON a.person_id = t.person_id WHERE a.id = ${drv.id}`);
  const plan = await send('/routes/board/delivery', 'POST', { on: clinicToday, hospitalId: h.id, plannedAt: '08:00', handedTo: 'CSR', staffId, lines: [{ lotId: setLot, quantity: 1 }, { lotId: gauzeLot, quantity: 10 }] });
  if (plan.status >= 400) throw new Error('تحویلِ تخته ثبت نشد: ' + JSON.stringify(plan.json).slice(0, 200));
  const tId = num(`SELECT id FROM stock_transfers WHERE visit_id=${visit.id}`);
  const tCode = sql(`SELECT code FROM stock_transfers WHERE id=${tId}`);
  const stopId = num(`SELECT stop_id FROM stock_transfers WHERE id=${tId}`);
  trash.runs.push(...sql(`SELECT string_agg(id::text, ',') FROM transport_runs WHERE staff_id=${staffId}`).split(',').filter(Boolean).map(Number));
  const sessA = await loginAs(techA.username, techA.password);
  const sessD = await loginAs(drv.username, drv.password);
  ok(!!(sessA.accessToken && sessD.accessToken), 'کارشناس و راننده وارد شدند');
  const asA = call(sessA.accessToken), asD = call(sessD.accessToken);
  const doneA = await asD(`/transport/stops/${stopId}/done`, 'POST', { handedActual: 'CSR' });
  ok(doneA.status === 201 && sql(`SELECT status FROM stock_transfers WHERE id=${tId}`) === 'sent', 'راننده تحویل داد — حواله ارسال شد، منتظرِ تأییدِ کارشناس');

  console.log('\n۱) مرورگر — بلوکِ «ثبتِ مصرفی» تا تأییدِ تحویل بسته است');
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`[${who}] ${e}`));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`[${who} http ${r.status()}] ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${who} console] ${m.text()}`); });
  };
  const ctxA = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const pageA = await ctxA.newPage();
  watch(pageA, 'tech');
  await browserLogin(pageA, sessA.accessToken, { ui: UI });
  const openTech = async (p) => {
    await p.goto(UI + '/app/tech', { waitUntil: 'networkidle' });
    await p.waitForSelector(`.tk-card:has-text("آرمانی${tag}")`, { timeout: 15000 });
  };
  await openTech(pageA);
  const card = pageA.locator('article.tk-card', { hasText: `آرمانی${tag}` });
  const block = card.locator('.tk-usage');
  ok(await block.count() === 1, 'کارت بلوکِ «ثبتِ مصرفی» دارد');
  ok(await block.locator('button').isDisabled() && (await block.innerText()).includes('پس از تحویل‌گرفتن فعال می‌شود'), 'تا تأیید نکرده: دکمه بسته، «پس از تحویل‌گرفتن فعال می‌شود»');
  const acts = card.locator('footer.tk-acts');
  ok((await block.boundingBox()).y < (await acts.boundingBox()).y, 'بلوک بالای آپلودِ گزارش است');
  const locked = await asA(`/stock/visits/${visit.id}/usage`, 'POST', { lines: [{ source: 'warehouse', itemId: gelItem.id, quantity: 1 }] });
  ok(locked.status === 400 && /تحویلِ ست را تأیید/.test(locked.json?.message ?? ''), `ثبت از API هم پیش از تأیید رد می‌شود (${locked.status} «${locked.json?.message}»)`);
  await card.locator('.tk-set button', { hasText: 'تحویل گرفتم' }).click();
  await pageA.waitForFunction(() => /^تحویل ثبت شد/.test(document.querySelector('.tk-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  await pageA.waitForFunction(() => [...document.querySelectorAll('.tk-usage button')].some((b) => !b.disabled), null, { timeout: 8000 });
  ok((await block.locator('button').innerText()).trim() === 'ثبتِ مصرفیِ این بیمار', 'پس از «تحویل گرفتم»: «ثبتِ مصرفیِ این بیمار» باز شد');

  console.log('\n۲) مرورگر — برگهٔ مصرفی: سه گروه، شمارنده، چندبارمصرف فقط شمرده می‌شود');
  await block.locator('button').click();
  await pageA.waitForSelector('.tk-sheet .tk-group', { timeout: 8000 });
  const sheet = pageA.locator('.tk-sheet');
  const groups = sheet.locator('.tk-group');
  const groupTexts = await groups.allInnerTexts();
  ok(groupTexts.some((t) => t.includes('پیش‌فرض‌های من')) && groupTexts.some((t) => t.includes(`از ستِ SE-${tag}`)) && groupTexts.some((t) => t.includes(`ارسالیِ حوالهٔ ${tCode}`)) && groupTexts.some((t) => t.includes('از کیف/انبار')), 'چهار گروه: پیش‌فرض‌ها، از ست، ارسالیِ حواله، از کیف/انبار');
  const line = (name) => sheet.locator('.tk-uline2', { hasText: name });
  ok((await line(`الکترود ${tag}`).innerText()).includes('۲۰ در ست') && (await line(`کابلِ رابط ${tag}`).innerText()).includes('چندبارمصرف') && (await line(`ژلِ هادی ${tag}`).innerText()).includes('۳ در انبار') && (await line(`گازِ استریل ${tag}`).innerText()).includes('۱۰ ارسالی'), 'زیرنویسِ هر قلم: سقف و منبعش');
  ok(await sheet.locator('.tk-uline2', { hasText: `پیچ` }).count() === 0, 'کالای بی‌تیک در برگه نیست');
  const more = async (name, n) => { for (let i = 0; i < n; i++) await line(name).locator(`button[aria-label^="بیشتر"]`).click(); };
  await more(`الکترود ${tag}`, 2);
  await more(`کابلِ رابط ${tag}`, 1);
  await more(`گازِ استریل ${tag}`, 3);
  await more(`ژلِ هادی ${tag}`, 1);
  await more(`پروبِ تحریک ${tag}`, 1);
  ok((await line(`الکترود ${tag}`).locator('.ui-step b').innerText()).trim() === '۲' && (await line(`کابلِ رابط ${tag}`).locator('.ui-step small').innerText()).trim() === 'بار', 'شمارنده: الکترود ۲؛ کابل با واحدِ «بار»');
  const note = (await sheet.locator('.tk-note').last().innerText()).replace(/\s+/g, ' ');
  ok(note.includes(`۲ الکترود ${tag}`) && note.includes('از موجودی کم می‌شود') && note.includes(`کابلِ رابط ${tag}`) && note.includes('فقط شمرده می‌شود'), `جمع‌بندی: «${note.slice(0, 90)}…»`);

  console.log('\n۳) پیش‌فرضِ شخصی — ذخیره، سپس ثبت');
  await toastGone(pageA);
  await sheet.locator('.tk-chip.dash').click();
  await sheet.locator('.tk-preset-name input').fill(`ستونِ فقرات ${tag}`);
  await sheet.locator('.tk-preset-name .tk-ghost', { hasText: 'ذخیره' }).click();
  await pageA.waitForFunction(() => /پیش‌فرضِ «.+» ذخیره شد/.test(document.querySelector('.tk-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  ok(await sheet.locator('.tk-preset .tk-chip', { hasText: `ستونِ فقرات ${tag}` }).count() === 1, 'چیپِ پیش‌فرض آمد');
  const prefs = (await asA('/auth/prefs')).json;
  const preset = prefs?.usagePresets?.find((p) => p.name === `ستونِ فقرات ${tag}`);
  ok(preset && preset.lines.length === 5 && preset.lines.find((l) => l.itemId === elItem.id)?.quantity === 2, 'پیش‌فرض در /auth/prefs با پنج قلم نشست (همراهِ حساب)');
  const badPreset = await asA('/auth/prefs', 'PATCH', { usagePresets: [{ name: '', lines: [{ itemId: elItem.id, quantity: 1 }] }] });
  ok(badPreset.status === 400 && /نام می‌خواهد/.test(badPreset.json?.message ?? ''), `پیش‌فرضِ بی‌نام رد می‌شود (${badPreset.status} «${badPreset.json?.message}»)`);
  await sheet.locator('.tk-save').click();
  await pageA.waitForFunction(() => /مصرفی ثبت شد/.test(document.querySelector('.tk-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  ok(await untilSql(() => atLoc(elLot, setLoc) === 18 && num(`SELECT count(*) FROM stock_movements WHERE lot_id=${elLot} AND kind='out' AND location='${setLoc}' AND visit_id=${visit.id} AND transfer_id=${tId}`) === 1), 'دفتر: ۲ الکترود از خودِ ست کم شد، به نامِ همین عمل و همین حواله');
  ok(atLoc(gelLot, home) === 2 && atLoc(gauzeLot, h.name) === 7, 'ژل از انبار (۳ ← ۲)، گاز از حواله (۱۰ ← ۷)');
  ok(atLoc(cableLot, setLoc) === 2 && num(`SELECT count(*) FROM stock_movements WHERE lot_id=${cableLot} AND kind IN ('out','return')`) === 0, 'کابل: هیچ حرکتی — فقط شمرده شد');
  ok(num(`SELECT count(*) FROM visit_usages WHERE visit_id=${visit.id}`) === 5, 'پنج ردیفِ مصرفی');
  await pageA.waitForFunction(() => [...document.querySelectorAll('.tk-usage')].some((b) => /ویرایشِ مصرفی/.test(b.textContent)), null, { timeout: 8000 });
  const blockText = (await block.innerText()).replace(/\s+/g, ' ');
  ok(blockText.includes(`۲ الکترود ${tag}`) && blockText.includes(`کابلِ رابط ${tag} ۱ بار`) && /ثبت شد/.test(blockText), `خلاصه روی کارت: «${blockText.slice(0, 110)}…»`);

  console.log('\n۴) اصلاح + پیش‌فرض با یک لمس');
  await block.locator('button', { hasText: 'ویرایشِ مصرفی' }).click();
  await pageA.waitForSelector('.tk-sheet .tk-group', { timeout: 8000 });
  ok((await line(`الکترود ${tag}`).locator('.ui-step b').innerText()).trim() === '۲', 'برگه با عددهای ثبت‌شده باز می‌شود');
  await line(`الکترود ${tag}`).locator('button[aria-label^="کمتر"]').click();
  await toastGone(pageA); // توستِ ثبتِ قبلی همان متن را دارد — منتظرِ خودِ نتیجه می‌مانیم نه توست
  await sheet.locator('.tk-save').click();
  await pageA.waitForFunction(() => /مصرفی ثبت شد/.test(document.querySelector('.tk-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  ok(await untilSql(() => atLoc(elLot, setLoc) === 19 && num(`SELECT count(*) FROM stock_movements WHERE lot_id=${elLot} AND kind='return' AND location='${setLoc}'`) === 1), 'اصلاح: یکی به ست برگشت (حرکتِ برگشت، نه ویرایش)');
  await pageA.waitForFunction(() => [...document.querySelectorAll('.tk-usage')].some((b) => /ویرایشِ مصرفی/.test(b.textContent)), null, { timeout: 8000 });
  await block.locator('button', { hasText: 'ویرایشِ مصرفی' }).click();
  await pageA.waitForSelector('.tk-sheet .tk-preset .tk-chip', { timeout: 8000 });
  await sheet.locator('.tk-preset .tk-chip', { hasText: `ستونِ فقرات ${tag}` }).click();
  await pageA.waitForFunction(() => /نشست/.test(document.querySelector('.tk-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  ok((await line(`الکترود ${tag}`).locator('.ui-step b').innerText()).trim() === '۲', 'یک لمس روی پیش‌فرض: الکترود دوباره ۲');
  await sheet.locator('.tk-x').click();
  await pageA.waitForSelector('.tk-sheet', { state: 'detached', timeout: 8000 });
  ok(atLoc(elLot, setLoc) === 19, 'بستن بدونِ ثبت چیزی را عوض نمی‌کند');

  console.log('\n۵) راننده هنگامِ جمع‌آوری می‌شمارد');
  const rel = await asA(`/stock/transfers/${tId}/release`, 'POST', { pickupAt: '17:00', leftAt: 'CSR' });
  ok(rel.status < 300, 'کارشناس پایانِ عمل را اعلام کرد');
  const pickStop = num(`SELECT stop_id FROM stock_transfers WHERE id=${tId}`);
  ok(pickStop > 0 && pickStop !== stopId && sql(`SELECT kind FROM transport_stops WHERE id=${pickStop}`) === 'pickup', 'توقفِ جمع‌آوری ساخته شد');
  const runId = num(`SELECT id FROM transport_runs WHERE staff_id=${staffId} ORDER BY id DESC LIMIT 1`);
  const assigned = await send(`/routes/stops/${pickStop}/assign`, 'POST', { runId });
  ok(assigned.status < 300, 'توقفِ جمع‌آوری به مسیرِ راننده رفت');
  const ctxD = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const pageD = await ctxD.newPage();
  watch(pageD, 'driver');
  await browserLogin(pageD, sessD.accessToken, { ui: UI });
  const openTransport = async (p) => {
    await p.goto(UI + '/app/transport', { waitUntil: 'networkidle' });
    await p.waitForSelector(`article.tr-card.k-pickup:has-text("${h.name}")`, { timeout: 15000 });
  };
  await openTransport(pageD);
  const pickCard = pageD.locator('article.tr-card.k-pickup', { hasText: h.name });
  ok((await pickCard.locator('.tr-do').innerText()).trim() === 'ثبتِ جمع‌آوری', 'دکمهٔ توقفِ جمع‌آوری: «ثبتِ جمع‌آوری»');
  await pickCard.locator('.tr-do').click();
  await pageD.waitForSelector('.tr-sheet .tr-count', { timeout: 8000 });
  const rows = pageD.locator('.tr-sheet .tr-count-items li');
  ok(await rows.count() === 2, 'دو بسته برای شمارش: ست و گاز');
  const gauzeRow = pageD.locator('.tr-sheet .tr-count-items li', { hasText: `گازِ استریل ${tag}` });
  ok((await gauzeRow.innerText()).includes('باید برگردد ۷') && (await gauzeRow.innerText()).includes('مصرف ۳'), 'گاز: «باید برگردد ۷ (ارسالی ۱۰، مصرف ۳)» — پیش‌فرض ارسالی − مصرف است');
  await gauzeRow.locator('button[aria-label^="کمتر"]').click();
  ok((await gauzeRow.innerText()).includes('کسری ۱') && (await pageD.locator('.tr-sheet .tr-save').innerText()).includes('۱ کسری'), 'یکی کمتر: «کسری ۱» و دکمه «ثبتِ جمع‌آوری با ۱ کسری»');
  await pageD.locator('.tr-sheet .tr-chip', { hasText: 'پلمبِ ست باز است' }).click();
  await pageD.locator('.tr-sheet .tr-field input').nth(1).fill(`یک گاز کم بود ${tag}`);
  await pageD.locator('.tr-sheet .tr-save').click();
  await pageD.waitForFunction(() => /جمع‌آوری ثبت شد/.test(document.querySelector('.tr-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  ok(await untilSql(() => sql(`SELECT driver_count_issue::text || '/' || driver_seal_intact::text || '/' || coalesce(driver_counted_by_id::text,'-') FROM stock_transfers WHERE id=${tId}`) === `true/false/${drv.id}`), 'حواله: شمارشِ راننده با کسری، پلمب باز، به نامِ راننده');
  ok(sql(`SELECT label || ':' || missing || ':' || kind || ':' || stage FROM set_shortages WHERE transfer_id=${tId} AND stage='pickup'`) === `گازِ استریل ${tag} GZ-${tag}:1:missing:pickup`, 'ردیفِ کسریِ مرحلهٔ جمع‌آوری');
  ok(atLoc(gauzeLot, h.name) === 7, 'شمارش موجودی را جابه‌جا نمی‌کند');
  await pageD.waitForSelector(`article.tr-card.k-pickup:has-text("${h.name}") .tr-tag.ok`, { timeout: 8000 });
  ok((await pickCard.locator('header .tr-tag').innerText()).trim() === 'جمع‌آوری شد' && (await pickCard.locator('.tr-recv.warn').innerText()).includes('با کسری') && (await pickCard.locator('.tr-recv.warn').innerText()).includes('پلمب باز'), 'کارتِ راننده: «جمع‌آوری شد» + «شمرده و تحویل گرفته شد — با کسری · پلمب باز»');
  const over = await asD(`/transport/stops/${pickStop}/done`, 'POST', { counts: [{ transferId: tId, lotId: gauzeLot, counted: 9 }] });
  ok(over.status === 400 && /قبلاً انجام‌شده/.test(over.json?.message ?? ''), `توقفِ انجام‌شده دوباره ثبت نمی‌شود (${over.status})`);
  const det = (await send(`/stock/transfers/${tId}`)).json;
  ok(det?.pickup?.issue === true && det?.pickup?.sealIntact === false && det?.pickup?.note === `یک گاز کم بود ${tag}`, 'انبار شمارشِ راننده را می‌بیند (pickup روی حواله)');

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    const phoneView = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const shot = await phoneView.newPage();
    watch(shot, 'shots');
    await browserLogin(shot, sessA.accessToken, { ui: UI });
    for (const theme of ['dark', 'light']) {
      await openTech(shot);
      await shot.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await shot.waitForTimeout(400);
      const c = shot.locator('article.tk-card', { hasText: `آرمانی${tag}` });
      await c.screenshot({ path: `${SHOTS}/consumables-card-${theme}.png` });
      await c.locator('.tk-usage button').click();
      await shot.waitForSelector('.tk-sheet .tk-group', { timeout: 8000 });
      await shot.waitForTimeout(450);
      await shot.screenshot({ path: `${SHOTS}/consumables-sheet-${theme}.png` });
      await shot.locator('.tk-sheet .tk-x').click();
      await shot.waitForSelector('.tk-sheet', { state: 'detached', timeout: 8000 });
    }
    const shotD = await phoneView.newPage();
    watch(shotD, 'shots');
    await browserLogin(shotD, sessD.accessToken, { ui: UI });
    /* برگهٔ شمارشِ راننده روی یک توقفِ تازه (توقفِ قبلی انجام شده) — فقط برای عکس. */
    const pick2 = num(`INSERT INTO transport_stops (run_id, seq, kind, hospital_id, planned_at) VALUES (${runId}, 90, 'pickup', ${h.id}, '18:00') RETURNING id`);
    sql(`UPDATE stock_transfers SET stop_id=${pick2} WHERE id=${tId}`);
    for (const theme of ['dark', 'light']) {
      await openTransport(shotD);
      await shotD.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await shotD.locator('article.tr-card.k-pickup', { hasText: h.name }).locator('.tr-do').first().click();
      await shotD.waitForSelector('.tr-sheet .tr-count', { timeout: 8000 });
      await shotD.waitForTimeout(450);
      await shotD.screenshot({ path: `${SHOTS}/consumables-pickup-${theme}.png` });
      await shotD.locator('.tr-sheet .tr-x').click();
      await shotD.waitForSelector('.tr-sheet', { state: 'detached', timeout: 8000 });
    }
    sql(`UPDATE stock_transfers SET stop_id=${pickStop} WHERE id=${tId}`);
    sql(`DELETE FROM transport_stops WHERE id=${pick2}`);
    await phoneView.close();
    console.log(`  (عکس‌ها در ${SHOTS})`);
  }

  console.log('\n۶) سلامتِ صفحه');
  ok(errors.length === 0, `بدونِ خطای جاوااسکریپت/کنسول/HTTP (${errors.length})${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  fail++;
  console.log('  ✘ اجرا قطع شد: ' + String(e?.message ?? e).split('\n').slice(0, 3).join(' | '));
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
  for (const hh of trash.hospitals) { q(`DELETE FROM hospital_duties WHERE hospital_id=${hh}`); await send(`/hospitals/${hh}`, 'DELETE').catch(() => {}); }
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    q(`DELETE FROM hospital_duties WHERE tech_id=${id}`);
    q(`DELETE FROM people WHERE id=(SELECT person_id FROM accounts WHERE id=${id})`);
  }
  for (const k of trash.features) q(`UPDATE features SET enabled=false WHERE key='${k}'`);
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
