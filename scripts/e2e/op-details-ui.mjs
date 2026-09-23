/**
 * **جزئیاتِ عمل در رابط** (بستهٔ ۸) — فرمِ عمل، میزِ اتاقِ عمل، پاپ‌آپِ ترخیص و پرونده.
 *
 *  باید بیفتد:
 *   - فرمِ عمل: سه بلوک در سه تب + سمتِ هر عمل زیرِ «نوعِ عمل»؛ ذخیره فقط کلیدِ
 *     تغییرکرده را می‌فرستد و بقیه دست‌نخورده می‌مانند (F1–F3)
 *   - «بله/خیر» با ضربهٔ دوباره به «ثبت نشده» برمی‌گردد (F2)
 *   - میز: سطرِ پیش از عمل، تیم با واژهٔ حوزه، ذخیرهٔ حینِ عمل (T1–T2)
 *   - ترخیص: دارو + ویزیتِ بعدی، هشدارِ تأییدِ تشخیص، «فوت» هر دو را قفل می‌کند (D1–D2)
 *   - پرونده خلاصهٔ بالینی را نشان می‌دهد (R1)
 *  نباید بیفتد:
 *   - فیلدِ عکسِ فرم‌ساز از فرمِ عمل ناپدید شود (F4 — رفعِ باگ)
 *   - سرریزِ افقی روی موبایلِ ۳۹۰ (M1)
 *   - خطای جاوااسکریپت
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
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const od = (id, col) => sql(`SELECT coalesce(${col}::text, '∅') FROM visit_op_details WHERE visit_id=${id}`);

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken }, body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = randomBytes(3).toString('hex');
const today = new Date().toISOString().slice(0, 10);
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const trash = { visits: [], procs: [], fields: [] };
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const errors = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`${who}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${who} [console.error] ${m.text()}`); });
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/op-details-${name}.png`, fullPage: true }).catch(() => {}); };

try {
  const sw = await send('/config/vertical', 'PATCH', { vertical: 'clinic' });
  ok('سوییچ به حوزهٔ مطب', sw.status === 200, String(sw.status));
  const surgeon = (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `رابط${tag}` })).json;
  const hospital = (await send('/hospitals')).json?.[0] ?? (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;
  const mk = async (name) => { const r = (await send('/procedure-types', 'POST', { name })).json; trash.procs.push(r.id); return r; };
  const P1 = await mk(`زانو ${tag}`);
  const P2 = await mk(`منیسک ${tag}`);
  const dx = (await send('/diagnoses', 'POST', { title: `پارگیِ منیسک ${tag}` })).json;
  /* فیلدِ عکسِ فرم‌ساز روی فرمِ عمل — شاهدِ رفعِ «ناپدیدشدن» (F4). */
  const sForm = ((await send('/forms')).json ?? []).find((f) => f.scope === 'visit' && f.visitKind === 'surgery');
  const img = await send(`/forms/${sForm.id}/fields`, 'POST', { key: `img${tag}`, label: `عکسِ محلِ برش ${tag}`, type: 'image' });
  if (img.json?.fields) trash.fields.push(img.json.fields.find((x) => x.key === `img${tag}`)?.id);
  const created = await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'رابطِ', lastName: `جزئیات${tag}`, opDate: today, surgeonId: surgeon.id, hospitalId: hospital.id,
    procedureTypeId: P1.id, otherProcedureTypeIds: [P2.id], diagnosisId: dx.id, anesthesia: 'spinal',
    opDetails: { asaClass: 'II', consentSigned: true, assistantSurgeonName: 'دکتر دستیار', bloodLossMl: 150 },
    procedureDetails: [{ procedureTypeId: P1.id, side: 'right' }],
  });
  const V = created.json;
  if (!V?.id) throw new Error('مراجعه ساخته نشد: ' + JSON.stringify(created.json).slice(0, 200));
  trash.visits.push(V.id);

  console.log('۱) فرمِ عمل');
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  watch(page, 'form');
  await browserLogin(page, login.accessToken, { ui: UI });
  await page.goto(`${UI}/app/dashboard?patient=${V.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.db-sheet', { timeout: 10000 });
  const sheet = page.locator('.db-sheet');
  const tab = async (name) => { await sheet.locator('.ui-tabs button', { hasText: name }).first().click(); await page.waitForTimeout(250); };

  const sides = sheet.locator('[data-proc-sides]');
  await sides.waitFor({ timeout: 8000 }).catch(() => {});
  ok('F1 سمتِ هر عمل زیرِ «نوعِ عمل»، برای هر دو عمل', await sides.locator('[data-proc-side]').count() === 2);
  ok('F1 سمتِ ثبت‌شدهٔ P1 روشن است', await sides.locator(`[data-proc-side="${P1.id}"] button[aria-checked="true"]`).innerText().catch(() => '') === 'راست');
  await sides.locator(`[data-proc-side="${P2.id}"] button`, { hasText: 'چپ' }).click();
  await sides.locator(`[data-proc-side="${P2.id}"] input`).fill('داخلی');

  await tab('قبل از عمل');
  const pre = sheet.locator('[data-opdetails="pre"]');
  ok('F1 بلوکِ پیش از عمل در تبِ «قبل از عمل»', await pre.count() === 1 && !(await pre.evaluate((e) => e.disabled)));
  ok('F1 کلاسِ ASA روشن و برچسبِ کامل زیرش', await pre.locator('[data-od="asaClass"] button[aria-checked="true"]').innerText() === 'II'
    && /بیماریِ سیستمیکِ خفیف/.test(await pre.locator('[data-od="asaClass"] .odx-hint').innerText()));
  await pre.locator('[data-od="asaClass"] button', { hasText: /^III$/ }).click();
  await pre.locator('[data-od="npoConfirmed"] button', { hasText: 'بله' }).click();
  await pre.locator('[data-od="npoConfirmed"] button', { hasText: 'بله' }).click();
  ok('F2 ضربهٔ دوباره «بله» را به «ثبت نشده» برگرداند', await pre.locator('[data-od="npoConfirmed"] .odx-unset').count() === 1);
  await pre.locator('[data-od="anticoagulant"] button', { hasText: 'قطع و جایگزینیِ هپارین' }).click();
  ok('F2 کادرِ «دارو و آخرین دوز» با انتخابِ ضدانعقاد آمد', await pre.locator('[data-od="anticoagNote"] input').count() === 1);
  await pre.locator('[data-od="anticoagNote"] input').fill('وارفارین — ۵ روز پیش');
  await shot(page, 'pre');

  await tab('حین عمل');
  const intra = sheet.locator('[data-opdetails="intra"]');
  ok('F1 بلوکِ تیم و حینِ عمل', await intra.count() === 1);
  ok('F1 کمک‌جراحِ ثبت‌شده', await intra.locator('[data-od="assistantSurgeonName"] input').inputValue() === 'دکتر دستیار');
  await intra.locator('[data-od="bloodLossMl"] input').fill('۳۵۰');
  await intra.locator('[data-od="drainPlaced"] button', { hasText: 'بله' }).click();
  await intra.locator('[data-od="drainNote"] input').fill('همووک');

  await tab('بعد از عمل');
  const post = sheet.locator('[data-opdetails="post"]');
  ok('F1 بلوکِ پیامد با تشخیصِ پس از عمل', await post.count() === 1 && (await post.locator('[data-od="postopDx"]').innerText()).includes(dx.title));
  ok('F2 درجهٔ عارضه تا «داشت» پنهان است', await post.locator('[data-od="clavienGrade"]').count() === 0);
  await post.locator('[data-od="complication"] button', { hasText: /^داشت$/ }).click();
  await post.locator('[data-od="clavienGrade"] button', { hasText: /^II$/ }).click();
  await post.locator('[data-od="postopDxConfirmed"] button', { hasText: 'بله' }).click();
  await shot(page, 'post');

  const saves = [];
  page.on('request', (r) => { if (r.method() === 'PATCH' && /\/api\/visits\/\d+$/.test(r.url())) saves.push(r.postDataJSON()); });
  await sheet.locator('.db-submit').click();
  await page.waitForTimeout(1500);
  const body = saves[0] ?? {};
  ok('F3 ذخیره فقط کلیدهای تغییرکرده را فرستاد',
    JSON.stringify(Object.keys(body.opDetails ?? {}).sort()) === JSON.stringify(['anticoagNote', 'anticoagulant', 'asaClass', 'bloodLossMl', 'clavienGrade', 'complication', 'drainNote', 'drainPlaced', 'postopDxConfirmed'].sort()),
    JSON.stringify(body.opDetails));
  ok('F3 … و فقط سمتِ عوض‌شده', JSON.stringify(body.procedureDetails) === JSON.stringify([{ procedureTypeId: P2.id, side: 'left', level: 'داخلی' }]), JSON.stringify(body.procedureDetails));
  ok('F3 DB: ASA III، خون‌ریزی ۳۵۰، عارضه II، رضایتِ قبلی ماند',
    od(V.id, 'asa_class') === 'III' && od(V.id, 'blood_loss_ml') === '350' && od(V.id, 'clavien_grade') === 'II' && od(V.id, 'consent_signed') === 'true'
      && od(V.id, 'npo_confirmed') === '∅' && od(V.id, 'assistant_surgeon_name') === 'دکتر دستیار',
    ['asa_class', 'blood_loss_ml', 'clavien_grade', 'consent_signed', 'npo_confirmed'].map((c) => od(V.id, c)).join(','));
  ok('F3 DB: سمتِ هر دو عمل', sql(`SELECT string_agg(side, ',' ORDER BY procedure_type_id) FROM visit_procedure_details WHERE visit_id=${V.id}`) === 'right,left');

  await page.goto(`${UI}/app/dashboard?patient=${V.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.db-sheet', { timeout: 10000 });
  ok('F4 **نباید بیفتد:** فیلدِ عکسِ فرم‌ساز در فرمِ عمل ناپدید شود',
    await page.locator('.db-sheet .db-extra', { hasText: `عکسِ محلِ برش ${tag}` }).count() >= 1);
  await page.close();

  console.log('\n۲) میزِ اتاقِ عمل');
  await send(`/theatre/visits/${V.id}/start`, 'POST');
  await send(`/theatre/visits/${V.id}/finish`, 'POST');
  const desk = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  watch(desk, 'theatre');
  await browserLogin(desk, login.accessToken, { ui: UI });
  await desk.goto(UI + '/app/theatre', { waitUntil: 'networkidle' });
  const item = desk.locator(`.th-item[data-visit-id="${V.id}"]`);
  ok('T1 فهرستِ روز سمت را نشان می‌دهد', /راست/.test(await item.innerText()) && /چپ · داخلی/.test(await item.innerText()), await item.innerText());
  await item.click();
  await desk.locator('[data-preop]').waitFor({ timeout: 8000 });
  ok('T1 سطرِ پیش از عمل', /ASA III/.test(await desk.locator('[data-preop]').innerText()) && /نخاعی|اسپاینال|spinal/i.test(await desk.locator('[data-preop]').innerText()),
    await desk.locator('[data-preop]').innerText());
  ok('T1 تیم: کمک‌جراح', /کمک‌جراح: دکتر دستیار/.test(await desk.locator('.th-team').innerText()));
  ok('T1 سمتِ هر عمل کنارِ نامش روی کارت', JSON.stringify(await desk.locator('.th-op [data-proc-side-label]').allInnerTexts()) === JSON.stringify(['راست', 'چپ · داخلی']),
    JSON.stringify(await desk.locator('.th-op [data-proc-side-label]').allInnerTexts()));
  const dIntra = desk.locator('[data-opdetails="intra"]');
  await dIntra.locator('[data-od="anesthesiologistName"] input').fill('دکتر بیهوش');
  await desk.locator('[data-act="save-opdetails"]').click();
  await desk.locator('.th-toast').waitFor({ timeout: 5000 }).catch(() => {});
  ok('T2 ذخیرهٔ حینِ عمل از میز', od(V.id, 'anesthesiologist_name') === 'دکتر بیهوش' && /جزئیاتِ عمل ذخیره شد/.test(await desk.locator('.th-toast').innerText().catch(() => '')));
  ok('T2 تیم تازه شد', /متخصصِ بیهوشی: دکتر بیهوش/.test(await desk.locator('.th-team').innerText()));
  ok('T2 **نباید بیفتد:** بلوکِ پیش از عمل یا عارضه سرِ میز', await desk.locator('[data-opdetails="pre"], [data-opdetails="post"]').count() === 0);

  console.log('\n۳) ترخیص');
  await desk.locator('[data-act="discharge"]').click();
  const dlg = desk.locator('.th-dialog');
  await dlg.waitFor({ timeout: 5000 });
  ok('D1 تشخیصِ پس از عمل در پاپ‌آپ', (await dlg.locator('[data-postop-dx]').innerText()).includes(dx.title));
  await dlg.locator('[data-disposition="home"]').click();
  await dlg.locator('[data-discharge-note]').fill('هوشیار، دردِ کم');
  await dlg.locator('[data-discharge-rx]').fill('سلکوکسیب ۲۰۰ — روزی دو بار');
  const nextIso = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  const { toJalaali } = await import('../../src/lib/jalali.js');
  const t = new Date(nextIso);
  const j = toJalaali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  await dlg.locator('[data-discharge-next] input').fill(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`);
  await shot(desk, 'discharge');
  await dlg.locator('button[type="submit"]').click();
  await desk.locator('[data-discharged-rx]').waitFor({ timeout: 8000 }).catch(() => {});
  ok('D1 دارو و ویزیتِ بعدی ثبت شد', sql(`SELECT next_visit_date::date::text FROM visits WHERE id=${V.id}`) === nextIso
    && /سلکوکسیب/.test(await desk.locator('[data-discharged-rx]').innerText().catch(() => '')) && await desk.locator('[data-discharged-next]').count() === 1,
    sql(`SELECT coalesce(next_visit_date::text,'∅') FROM visits WHERE id=${V.id}`));
  await desk.locator('[data-act="discharge"]').click();
  await dlg.waitFor({ timeout: 5000 });
  await dlg.locator('[data-disposition="death"]').click();
  ok('D2 «فوت» دارو و ویزیتِ بعدی را قفل می‌کند', await dlg.locator('[data-discharge-rx]').isDisabled()
    && await dlg.locator('[data-discharge-next] input').isDisabled() && await dlg.locator('[data-death-hint]').count() === 1);
  await dlg.locator('button', { hasText: 'انصراف' }).click();
  await desk.close();

  console.log('\n۴) پرونده');
  const rec = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  watch(rec, 'record');
  await browserLogin(rec, login.accessToken, { ui: UI });
  await rec.goto(`${UI}/app/patients/${V.patientId}`, { waitUntil: 'networkidle' });
  const visitsTab = rec.locator('[role="tab"]', { hasText: 'مراجع' }).first();
  if (await visitsTab.count()) await visitsTab.click();
  const clin = rec.locator('[data-visit-clinical]').first();
  await clin.waitFor({ timeout: 8000 }).catch(() => {});
  const ct = await clin.innerText().catch(() => '');
  ok('R1 خلاصهٔ بالینی: سمت، خون‌ریزی، عارضه، دارو، ویزیتِ بعدی',
    /راست/.test(ct) && /۳۵۰/.test(ct) && /IIIa|درجهٔ II/.test(ct) && /سلکوکسیب/.test(ct) && /ویزیتِ بعدی/.test(ct), ct.slice(0, 300));
  await shot(rec, 'record');
  await rec.close();

  console.log('\n۵) موبایل ۳۹۰');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  watch(m, 'mobile');
  await browserLogin(m, login.accessToken, { ui: UI });
  await m.goto(`${UI}/app/dashboard?patient=${V.id}`, { waitUntil: 'networkidle' });
  await m.waitForSelector('.db-sheet', { timeout: 10000 });
  let over = 0;
  for (const name of ['قبل از عمل', 'حین عمل', 'بعد از عمل']) {
    await m.locator('.db-sheet .ui-tabs button', { hasText: name }).first().click();
    await m.waitForTimeout(250);
    over = Math.max(over, await m.evaluate(() => {
      const s = document.querySelector('.db-sheet');
      return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, s ? s.scrollWidth - s.clientWidth : 0);
    }));
  }
  ok(`M1 بی‌سرریزِ افقی در هر سه تب (${over}px)`, over <= 1);
  await shot(m, 'mobile');
  await ctx.close();

  ok('بدونِ خطای جاوااسکریپت', errors.length === 0, errors[0]?.slice(0, 200));
} catch (e) {
  ok(`اجرا متوقف شد: ${e?.message ?? e}`, false);
} finally {
  await browser.close().catch(() => {});
  for (const id of trash.fields.filter(Boolean)) await send(`/forms/fields/${id}`, 'DELETE').catch(() => {});
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  ok('برگشت به حوزهٔ قبلی', back.status === 200, String(back.status));
  for (const v of trash.visits) await send(`/visits/${v}`, 'DELETE').catch(() => {});
}

console.log(`\n${pass} سبز · ${fails.length} قرمز`);
if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
