/**
 * **«افزودن به پیش‌فرض» زیرِ شرحِ عمل** (درخواستِ مالک ۱۴۰۵/۰۷/۰۱: «زیرِ شرحِ عمل
 * وقتی تایپ کردند یک اضافه به پیش‌فرض بگذار، که شرحی که نوشته‌اند را همان‌جا به
 * شرح‌عمل‌های آن عمل اضافه کنند»).
 *
 * پیش‌فرض = `NoteTemplate`ِ نوعِ `op` گره‌خورده به نوعِ عمل؛ قاعده یک‌جاست
 * (`server/src/patients/op-templates.ts`) و رابط یک کامپوننت (`OpDefaults.jsx`)
 * در سه جا: میزِ اتاقِ عمل، فرمِ عمل، کامپوزرِ پرونده.
 *
 *  باید بیفتد:
 *   - عنوانِ پیش‌فرض نامِ عمل است، و «نام (۲)» وقتی نام گرفته شده (A3/A5)
 *   - ترتیب: اصلی، بعد عملِ همزمان، بعد عمومی؛ قالبِ عملِ دیگر نمی‌آید (A1/A7)
 *   - هر افزودن ممیزی دارد (A3)
 *   - از میزِ اتاق مقصد عملِ **اصلیِ** همان مراجعه است (A11)
 *   - اجازه با مجوزِ جدای `templates.add` (سطحِ کارشناس) و سرور `canAdd` را راست
 *     می‌گوید: بستنِ مجوز هم دکمه را می‌برد هم واقعاً ۴۰۳ می‌دهد (A12)
 *   - رابط: دکمه فقط بعد از تایپ؛ چیپِ تازه بی‌رفرش؛ قالبی که در اتاق ساخته شد
 *     در فرمِ عمل هم هست (یک داده، سه نما)؛ کلیکِ چیپ متن را می‌نشاند
 *  نباید بیفتد:
 *   - متنِ کوتاه یا تکراری قالب بسازد؛ قالبی که مدیر غیرفعال کرده بی‌صدا زنده شود
 *   - «افزودن به پیش‌فرض» خودِ شرحِ عمل را ذخیره کند
 *   - Escape در کادرِ عنوان کلِ فرم را ببندد؛ Enter فرمِ مراجعه را ثبت کند
 *   - عملِ بی‌نوعِ عمل پیش‌فرض بسازد
 *   - خطای جاوااسکریپت
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { browserLogin } from './lib/browser-login.mjs';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));
const esc = (s) => String(s).replace(/'/g, "''");

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const hdr = (token) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token });
const call = (token) => (p, m = 'GET', b) => fetch(API + p, { method: m, headers: hdr(token), body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const send = call(login.accessToken);

const tag = 'od' + randomBytes(3).toString('hex');
const trash = { visits: [], accounts: [], procs: [], hospitals: [], surgeons: [] };
const tplCount = (pid) => num(`SELECT count(*) FROM note_templates WHERE kind='op' AND procedure_type_id=${pid}`);
const LONG = (s) => `${s} — بیمار در وضعیتِ خوابیده به شکم، برشِ خطِ وسط، آزادسازیِ ریشه و بستنِ لایه‌به‌لایه (${tag}).`;

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const errors = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`${who}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${who} [console.error] ${m.text()}`); });
};

try {
  /* ── داده ── */
  const hosp = (await send('/hospitals', 'POST', { name: `بیمارستانِ پیش‌فرض ${tag}` })).json;
  if (hosp?.id) trash.hospitals.push(hosp.id);
  /* فرمِ عملِ این نصب جراح را اجباری کرده (سرور هم می‌سنجد) — فیکسچرِ خودِ آزمون. */
  const surg = (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `پیش‌فرض${tag}` })).json;
  if (surg?.id) trash.surgeons.push(surg.id);
  const mk = async (name) => { const r = (await send('/procedure-types', 'POST', { name })).json; trash.procs.push(r.id); return r; };
  const P1 = await mk(`عملِ پیش‌فرض ${tag}`);
  const P2 = await mk(`عملِ همزمان ${tag}`);
  const P3 = await mk(`عملِ بی‌ربط ${tag}`);
  const generic = (await send('/note-templates', 'POST', { kind: 'op', title: `عمومیِ ${tag}`, body: LONG('قالبِ عمومی') })).json;
  const other = (await send('/note-templates', 'POST', { kind: 'op', title: `بی‌ربطِ ${tag}`, body: LONG('قالبِ عملِ دیگر'), procedureTypeId: P3.id })).json;
  const today = new Date().toISOString();
  const S1 = (await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'بیمارِ', lastName: `پیش‌فرض${tag}`, phone: '09120000731', opDate: today,
    hospitalId: hosp.id, surgeonId: surg?.id, procedureTypeId: P1.id, otherProcedureTypeIds: [P2.id],
  })).json;
  const S2 = (await send('/visits', 'POST', {
    kind: 'surgery', patientId: S1?.patientId, opDate: today, hospitalId: hosp.id, surgeonId: surg?.id,
  })).json;
  if (!S1?.id || !S2?.id) { console.error('مراجعه ساخته نشد', JSON.stringify({ S1, S2 }).slice(0, 300)); process.exit(1); }
  trash.visits.push(S1.id, S2.id);

  console.log('۱) API — فهرست، کمینه، عنوان، تکراری، ممیزی');
  const g1 = (await send(`/op-templates?procedureTypeIds=${P1.id},${P2.id}`)).json;
  ok(g1?.canAdd === true, 'مدیر: `canAdd` روشن');
  ok(g1?.items?.some((t) => t.id === generic.id) && !g1.items.some((t) => t.id === other.id),
    'A1 عمومی می‌آید؛ قالبِ عملِ **بی‌ربط** نمی‌آید');
  const short = await send('/op-templates', 'POST', { procedureTypeId: P1.id, body: 'کوتاه' });
  ok(short.status === 400 && /کوتاه/.test(short.json?.message ?? ''), `A2 متنِ کوتاه ۴۰۰ با پیامِ فارسی (${short.status})`);
  const a3 = await send('/op-templates', 'POST', { procedureTypeId: P1.id, body: LONG('شرحِ اول') });
  ok(a3.status === 201 && a3.json?.created === true && a3.json?.template?.title === P1.name,
    `A3 ساخته شد و عنوانش نامِ عمل است («${a3.json?.template?.title}»)`);
  ok(num(`SELECT count(*) FROM audit_events WHERE action='note_template.add' AND entity_id='${a3.json?.template?.id}'`) === 1,
    'A3 … و ممیزی دارد');
  const before4 = tplCount(P1.id);
  const a4 = await send('/op-templates', 'POST', { procedureTypeId: P1.id, body: `  ${LONG('شرحِ اول').replace(/ /g, '   ')}\n\n` });
  ok(a4.json?.duplicate === true && a4.json?.created === false && tplCount(P1.id) === before4,
    'A4 **نباید بیفتد:** همان متن با فاصله‌های دیگر قالبِ تازه نمی‌سازد');
  const a5 = await send('/op-templates', 'POST', { procedureTypeId: P1.id, body: LONG('شرحِ دوم') });
  ok(a5.json?.template?.title === `${P1.name} (۲)`, `A5 نامِ گرفته‌شده → «نام (۲)» («${a5.json?.template?.title}»)`);
  const a6 = await send('/op-templates', 'POST', { procedureTypeId: P1.id, body: LONG('شرحِ سوم'), title: `عنوانِ دستی ${tag}` });
  ok(a6.json?.template?.title === `عنوانِ دستی ${tag}`, 'A6 عنوانِ کاربر همان می‌ماند');
  await send('/op-templates', 'POST', { procedureTypeId: P2.id, body: LONG('شرحِ عملِ همزمان') });
  const g7 = (await send(`/op-templates?procedureTypeIds=${P1.id},${P2.id}`)).json?.items ?? [];
  const rankOf = (t) => (t.procedureTypeId === P1.id ? 0 : t.procedureTypeId === P2.id ? 1 : 2);
  const ranks = g7.map(rankOf);
  ok(ranks.length >= 5 && ranks.every((r, i) => i === 0 || ranks[i - 1] <= r) && ranks[0] === 0 && ranks.includes(1) && ranks.at(-1) === 2,
    `A7 ترتیب: اصلی → همزمان → عمومی (${ranks.join(',')})`);
  await send(`/note-templates/${a5.json.template.id}`, 'PATCH', { active: false });
  const before8 = tplCount(P1.id);
  const a8 = await send('/op-templates', 'POST', { procedureTypeId: P1.id, body: LONG('شرحِ دوم') });
  ok(a8.status === 409 && /غیرفعال/.test(a8.json?.message ?? '') && tplCount(P1.id) === before8
    && sql(`SELECT active FROM note_templates WHERE id=${a5.json.template.id}`) === 'f',
    `A8 **نباید بیفتد:** قالبی که مدیر غیرفعال کرده بی‌صدا زنده نمی‌شود (${a8.status})`);

  console.log('\n۲) API — میزِ اتاقِ عمل');
  const t9 = (await send(`/theatre/visits/${S1.id}/op-templates`)).json;
  ok(t9?.canAdd === true && t9?.procedure?.id === P1.id && t9?.procedure?.name === P1.name,
    'A9 مقصد عملِ **اصلیِ** همان مراجعه است');
  ok(JSON.stringify((t9?.items ?? []).map((t) => t.id)) === JSON.stringify(g7.filter((t) => t.id !== a5.json.template.id).map((t) => t.id)),
    'A9 … و همان فهرستِ فرمِ عمل، به همان ترتیب (یک قاعده)');
  const t10 = await send(`/theatre/visits/${S2.id}/op-templates`, 'POST', { body: LONG('بی‌نوع') });
  ok(t10.status === 400 && /نوعِ عمل ندارد/.test(t10.json?.message ?? ''), `A10 **نباید بیفتد:** عملِ بی‌نوعِ عمل (${t10.status})`);
  const t11 = await send(`/theatre/visits/${S1.id}/op-templates`, 'POST', { body: LONG('از اتاق') });
  ok(t11.json?.created === true && Number(sql(`SELECT procedure_type_id FROM note_templates WHERE id=${t11.json?.template?.id}`)) === P1.id,
    'A11 از اتاق برای عملِ اصلی ساخته شد');

  console.log('\n۳) اجازه — مجوزِ جدای `templates.add`');
  const made = (await send('/accounts/temporary', 'POST', {
    firstName: 'کارشناسِ', lastName: `پیش‌فرض ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
    level: 2, jobRole: 'technician', username: `o${tag}`,
  })).json;
  if (made?.account?.id) {
    trash.accounts.push(made.account.id);
    await send(`/visits/${S1.id}`, 'PATCH', { techId: made.account.id });
    const tl = await fetch(API + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: `o${tag}`, password: made.temporaryPassword }),
    }).then((r) => r.json());
    const tech = call(tl.accessToken);
    ok((await tech(`/theatre/visits/${S1.id}/op-templates`)).json?.canAdd === true, 'A12 کارشناسِ سطح ۲ در اتاق می‌تواند (پیش‌فرضِ مجوز)');
    const off = await send('/access/permissions/templates.add', 'PATCH', { enabled: false });
    ok(off.status === 200, `A12 مدیر مجوز را بست (${off.status})`);
    ok((await tech(`/theatre/visits/${S1.id}/op-templates`)).json?.canAdd === false, 'A12 … `canAdd` خاموش شد');
    const denied = await tech(`/theatre/visits/${S1.id}/op-templates`, 'POST', { body: LONG('بسته') });
    ok(denied.status === 403, `A12 … و سرور واقعاً رد می‌کند (${denied.status}) — دکمه دروغ نمی‌گوید`);
    await send('/access/permissions/templates.add/reset', 'POST');
    ok((await tech(`/theatre/visits/${S1.id}/op-templates`)).json?.canAdd === true, 'A12 بازگردانی به پیش‌فرض');
    await send(`/visits/${S1.id}`, 'PATCH', { techId: null });
  } else {
    ok(false, `حسابِ آزمایشی ساخته نشد: ${JSON.stringify(made).slice(0, 120)}`);
  }

  console.log('\n۴) رابط — میزِ اتاقِ عمل');
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  watch(page, 'desktop');
  await browserLogin(page, login.accessToken, { ui: UI });
  await page.goto(UI + '/app/theatre', { waitUntil: 'networkidle' });
  await page.locator(`.th-item[data-visit-id="${S1.id}"]`).click();
  const box = page.locator('section[data-note="opReport"]');
  await box.waitFor({ timeout: 10000 });
  await box.locator('[data-op-default]').first().waitFor({ timeout: 8000 }).catch(() => {});
  ok(await box.locator('[data-op-default]').count() >= 3, 'U1 چیپ‌های «قالبِ آماده» بالای شرحِ عمل');
  ok(await box.locator('[data-op-default-add]').count() === 0, 'U1 **نباید بیفتد:** پیش از تایپ دکمهٔ افزودن نیست');
  const roomText = LONG('نوشتهٔ اتاق');
  await box.locator('textarea[data-report]').fill(roomText);
  await box.locator('[data-op-default-add]').click();
  await box.locator('.od-row input').fill(`اتاقِ ${tag}`);
  await box.locator('.od-row input').press('Enter');
  const th = await page.locator('.th-toast').innerText({ timeout: 5000 }).catch(() => '');
  ok(/اضافه شد/.test(th), `U1 پیام: «${th}»`);
  await box.locator(`[data-op-default]:has-text("اتاقِ ${tag}")`).waitFor({ timeout: 8000 }).catch(() => {});
  ok(await box.locator(`[data-op-default]:has-text("اتاقِ ${tag}")`).count() === 1, 'U1 چیپِ تازه بی‌رفرش آمد');
  ok(num(`SELECT count(*) FROM note_templates WHERE title='اتاقِ ${tag}' AND procedure_type_id=${P1.id} AND body='${esc(roomText)}'`) === 1,
    'U1 همان متن برای عملِ اصلی ذخیره شد');
  ok(num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${S1.id} AND kind='op' AND replaced_at IS NULL`) === 0,
    'U1 **نباید بیفتد:** افزودن به پیش‌فرض خودِ شرحِ عمل را ذخیره نکرد');

  console.log('\n۵) رابط — فرمِ عمل (همان داده، نمای دیگر)');
  await page.goto(`${UI}/app/dashboard?patient=${S1.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.db-sheet', { timeout: 10000 });
  const intra = page.getByRole('tab', { name: 'حین عمل' });
  if (await intra.count()) await intra.first().click();
  const rep = page.locator('.db-sheet .db-report');
  await rep.waitFor({ timeout: 8000 });
  await rep.locator('[data-op-default]').first().waitFor({ timeout: 8000 }).catch(() => {});
  const chip = rep.locator(`[data-op-default]:has-text("اتاقِ ${tag}")`);
  ok(await chip.count() === 1, 'U2 قالبی که در اتاق ساخته شد در فرمِ عمل هم هست');
  await rep.locator('textarea').fill('');
  await chip.click();
  ok((await rep.locator('textarea').inputValue()) === roomText, 'U2 کلیکِ چیپ متن را در کادرِ خالی نشاند');
  await rep.locator('textarea').fill(LONG('نوشتهٔ فرم'));
  await rep.locator('[data-op-default-add]').click();
  await rep.locator('.od-row input').press('Escape');
  ok(await page.locator('.db-sheet').count() === 1 && await rep.locator('.od-row').count() === 0,
    'U2 **نباید بیفتد:** Escape فقط کادرِ عنوان را بست نه کلِ فرم را');
  const nBefore = tplCount(P1.id);
  const visitSaves = [];
  page.on('request', (r) => { if (r.method() === 'PATCH' && /\/api\/visits\/\d+$/.test(r.url())) visitSaves.push(r.url()); });
  await rep.locator('[data-op-default-add]').click();
  await rep.locator('.od-row input').press('Enter');
  await page.waitForTimeout(1200);
  ok(tplCount(P1.id) === nBefore + 1 && visitSaves.length === 0,
    `U2 Enter پیش‌فرض را افزود و **فرمِ مراجعه را ثبت نکرد** (قالب ${nBefore}→${tplCount(P1.id)}، ذخیرهٔ مراجعه ${visitSaves.length})`);
  await rep.locator('textarea').fill(roomText);
  await rep.locator('[data-op-default-add]').click();
  await rep.locator('.od-row input').press('Enter');
  await page.waitForTimeout(1000);
  ok(tplCount(P1.id) === nBefore + 1, 'U2 **نباید بیفتد:** متنِ تکراری قالبِ دوم نساخت');
  await page.keyboard.press('Escape');

  console.log('\n۶) رابط — کامپوزرِ پرونده');
  await page.goto(`${UI}/app/patients/${S1.patientId}`, { waitUntil: 'networkidle' });
  await page.locator('[role="tab"]:has-text("شرح‌ها"), button:has-text("شرح‌ها")').first().click();
  await page.locator('.rc-kindrow button:has-text("شرحِ عمل")').click();
  await page.locator('.rc-upload textarea').fill(LONG('نوشتهٔ پرونده'));
  await page.locator('[data-op-default-hint]').waitFor({ timeout: 5000 }).catch(() => {});
  ok(await page.locator('[data-op-default-hint]').count() === 1 && await page.locator('[data-op-default-add]').count() === 0,
    'U3 بی‌مراجعه: راهنما می‌گوید مراجعه را انتخاب کنید، دکمه‌ای نیست');
  await page.locator('.rc-upload select').selectOption(String(S1.id));
  await page.locator('[data-op-default-add]').waitFor({ timeout: 5000 }).catch(() => {});
  const nRec = tplCount(P1.id);
  await page.locator('[data-op-default-add]').click();
  await page.locator('.od-row input').press('Enter');
  await page.waitForTimeout(1200);
  ok(tplCount(P1.id) === nRec + 1, 'U3 از پرونده هم برای عملِ اصلیِ همان مراجعه افزوده شد');
  const newest = sql(`SELECT title FROM note_templates WHERE procedure_type_id=${P1.id} ORDER BY id DESC LIMIT 1`);
  await page.locator(`.rc-tpl:has-text("${newest}")`).waitFor({ timeout: 5000 }).catch(() => {});
  ok(await page.locator(`.rc-tpl:has-text("${newest}")`).count() >= 1, `U3 چیپِ «${newest}» بی‌رفرش در «قالبِ آماده» آمد`);
  await page.close();

  console.log('\n۷) موبایل ۳۹۰');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  watch(m, 'mobile');
  await browserLogin(m, login.accessToken, { ui: UI });
  await m.goto(UI + '/app/theatre', { waitUntil: 'networkidle' });
  await m.locator(`.th-item[data-visit-id="${S1.id}"]`).click();
  const mbox = m.locator('section[data-note="opReport"]');
  await mbox.waitFor({ timeout: 10000 });
  await mbox.locator('textarea[data-report]').fill(LONG('موبایل'));
  await mbox.locator('[data-op-default-add]').click();
  const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 1 && await mbox.locator('.od-row input').isVisible(), `U4 کادرِ عنوان روی موبایل جا شد، بدونِ سرریزِ افقی (${over}px)`);
  await ctx.close();

  console.log('\n۸) سلامتِ صفحه');
  ok(errors.length === 0, `بدونِ خطای جاوااسکریپت (${errors.length})${errors.length ? ' — ' + errors[0].slice(0, 160) : ''}`);
} finally {
  await browser.close().catch(() => {});
  await send('/access/permissions/templates.add/reset', 'POST').catch(() => {});
  sql(`DELETE FROM note_templates WHERE title LIKE '%${tag}%' OR body LIKE '%${tag}%' OR procedure_type_id IN (${trash.procs.join(',') || -1})`);
  for (const v of trash.visits) await send(`/visits/${v}`, 'DELETE').catch(() => {});
  for (const id of trash.surgeons) await send(`/surgeons/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.hospitals) await send(`/hospitals/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    sql(`DELETE FROM account_sessions WHERE account_id=${id}`);
    sql(`DELETE FROM accounts WHERE id=${id}`);
  }
}
console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
