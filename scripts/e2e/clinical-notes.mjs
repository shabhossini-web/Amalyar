/**
 * شرح‌های ساخت‌یافته (#48):
 *
 * ۱. نوعِ تازهٔ «شرحِ حال» (history) کنارِ شرحِ ویزیت/عمل/… .
 * ۲. قالب‌های شرح (HIS-گونه): CRUD در تعریف‌ها؛ قالبِ عمومی برای همه،
 *    قالبِ گره‌خورده به عمل/تشخیص/موضوع فقط برای مراجعهٔ منطبق و جلوتر.
 * ۳. جستجوی بالینی بینِ همهٔ پرونده‌ها: فیلترِ نوع/عمل/تشخیص/موضوع + متن؛
 *    فقط نسخهٔ جاریِ هر شرح.
 * ۴. مرورگر: چیپِ قالب در ادیتورِ پرونده متن را می‌نشاند؛ صفحهٔ جستجوی
 *    بالینی از کاشیِ لانچر تا نتیجهٔ فیلترشده.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'cn' + randomBytes(3).toString('hex');

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — ' + JSON.stringify(login)); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());

const trash = { forms: [], visits: [], procs: [], diags: [], tpls: [] };

try {
  console.log('۱) چیدمان + قالب‌ها (CRUD)');
  const proc = (await send('/procedure-types', 'POST', { name: `عملِ ${tag}` })).json;
  trash.procs.push(proc.id);
  const diag = (await send('/diagnoses', 'POST', { title: `تشخیصِ ${tag}` })).json;
  trash.diags.push(diag.id);

  const tSpec = (await send('/note-templates', 'POST', {
    kind: 'op', title: `قالبِ اختصاصیِ ${tag}`, body: `شرحِ عملِ استاندارد ${tag}:\nبرش، هموستاز، ترمیم.`,
    procedureTypeId: proc.id,
  })).json;
  trash.tpls.push(tSpec.id);
  ok(tSpec?.id > 0 && tSpec.procedureTypeId === proc.id, `قالبِ اختصاصیِ عمل ساخته شد (#${tSpec?.id})`);
  const tGen = (await send('/note-templates', 'POST', {
    kind: 'op', title: `قالبِ عمومیِ ${tag}`, body: 'شرحِ عمل — عمومی.',
  })).json;
  trash.tpls.push(tGen.id);
  const tHist = (await send('/note-templates', 'POST', {
    kind: 'history', title: `شرحِ حالِ اولیهٔ ${tag}`, body: 'شکایتِ اصلی:\nسابقهٔ بیماری:\nداروها:',
  })).json;
  trash.tpls.push(tHist.id);
  ok((await send('/note-templates', 'POST', { kind: 'bogus', title: 'خطا', body: 'خطا' })).status === 400,
    'نوعِ ناموجود رد می‌شود');
  ok((await send('/note-templates', 'POST', { kind: 'op', title: 'خطا', body: 'خطا', procedureTypeId: 999999 })).status === 400,
    'هدفِ ناموجود رد می‌شود');
  const listed = (await send('/note-templates', 'GET')).json;
  ok(listed.some((x) => x.id === tSpec.id && x.procedureTypeName === `عملِ ${tag}`),
    'فهرستِ تعریف‌ها نامِ هدف را دارد');
  await send(`/note-templates/${tGen.id}`, 'PATCH', { title: `قالبِ عمومیِ ویراستهٔ ${tag}` });
  ok((await send('/note-templates', 'GET')).json.some((x) => x.title.includes('ویراسته')), 'ویرایشِ قالب');

  console.log('\n۲) پیشنهادِ قالب به تفکیکِ مراجعه');
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ شرح', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'شرح‌دار', phone: '09120000821',
    opDate: new Date().toISOString(), procedureTypeId: proc.id,
  })).json;
  trash.visits.push(visit.id);
  const pid = visit.patientId;

  let sug = await get(`/patients/${pid}/note-templates?kind=op&visitId=${visit.id}`);
  ok(sug.length === 2 && sug[0].id === tSpec.id && sug[0].specific === true,
    '**قالبِ اختصاصیِ عملِ منطبق جلوتر از عمومی می‌آید**');
  sug = await get(`/patients/${pid}/note-templates?kind=op`);
  ok(sug.length === 1 && sug[0].id === tGen.id, 'بدونِ مراجعه فقط عمومی می‌آید');
  sug = await get(`/patients/${pid}/note-templates?kind=history`);
  ok(sug.length === 1 && sug[0].id === tHist.id, 'قالبِ شرحِ حال جدا از شرحِ عمل است');

  console.log('\n۳) شرحِ حال + جستجوی بالینی');
  const hist = (await send(`/patients/${pid}/notes`, 'POST', {
    kind: 'history', body: `شرحِ حالِ اولیه — نشانگرِ ${tag}h`,
  })).json;
  ok(hist?.id > 0, `**نوعِ «شرحِ حال» ثبت می‌شود** (#${hist?.id})`);
  const opNote = (await send(`/patients/${pid}/notes`, 'POST', {
    kind: 'op', visitId: visit.id, body: `شرحِ عمل با نشانگرِ ${tag}o — جزئیاتِ برش.`,
  })).json;

  let found = await get(`/patients/notes/search?kind=op&procedureTypeId=${proc.id}`);
  const row1 = found.find((x) => x.id === opNote.id);
  ok(!!row1, '**فیلترِ نوع + نوعِ عمل شرح را پیدا می‌کند**');
  ok(row1 && row1.patientId === pid && row1.procedureName === `عملِ ${tag}` && !!row1.visitCode,
    'نتیجه پرونده و مراجعه و نامِ عمل را دارد');
  found = await get(`/patients/notes/search?t=${encodeURIComponent(tag + 'h')}`);
  ok(found.some((x) => x.id === hist.id) && !found.some((x) => x.id === opNote.id),
    'جستجوی متنی فقط شرحِ دارای عبارت را می‌آورد');
  found = await get(`/patients/notes/search?kind=op&diagnosisId=${diag.id}`);
  ok(!found.some((x) => x.id === opNote.id), 'فیلترِ تشخیصِ نامنطبق نتیجه نمی‌دهد');

  /* ویرایش → فقط نسخهٔ جاری در جستجو */
  await send(`/patients/notes/${opNote.id}`, 'PATCH', { body: `شرحِ عملِ ویراسته با نشانگرِ ${tag}o` });
  found = await get(`/patients/notes/search?t=${encodeURIComponent(tag + 'o')}`);
  ok(found.length === 1 && found[0].snippet.includes('ویراسته'),
    '**بعد از ویرایش فقط نسخهٔ جاری در جستجو است**');

  console.log('\n۴) مرورگر — قالب در ادیتور + صفحهٔ جستجو');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + '/login');
    await page.waitForTimeout(900);
    await page.fill('input[name="identifier"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app**', { timeout: 15000 });

    /* پروندهٔ بیمار → تبِ شرح‌ها → قالب‌ها */
    await page.goto(BASE + `/app/patients/${pid}`);
    await page.waitForTimeout(2200);
    await page.locator('[role="tab"]:has-text("شرح‌ها"), button:has-text("شرح‌ها")').first().click();
    await page.waitForTimeout(1200);
    ok(await page.locator('.rc-kindrow button:has-text("شرحِ حال")').count() === 1, 'چیپِ «شرحِ حال» در پرونده هست');
    /* نوعِ «شرحِ عمل» + مراجعهٔ دارای نوعِ عمل → قالبِ اختصاصی هم بیاید */
    await page.locator('.rc-kindrow button:has-text("شرحِ عمل")').click();
    await page.locator('.rc-upload select').selectOption(String(visit.id));
    await page.waitForTimeout(1200);
    const chips = page.locator('.rc-tpl');
    ok(await chips.count() === 2, `دو چیپِ قالب دیده می‌شود (${await chips.count()})`);
    await chips.first().click();
    const tx = await page.locator('.rc-upload textarea').inputValue();
    ok(tx.includes('برش، هموستاز'), '**کلیکِ قالب متن را در ادیتور می‌نشاند**');

    /* صفحهٔ جستجوی بالینی */
    /* W3.7: `/app` صفحهٔ «امروز» است و لانچرِ کاشی‌ها به `/app/tools` رفت. */
    await page.goto(BASE + '/app/tools');
    await page.waitForTimeout(1500);
    const tile = page.locator('a:has-text("جستجوی بالینی"), button:has-text("جستجوی بالینی")').first();
    ok(await tile.count() === 1, 'کاشیِ لانچر هست');
    await tile.click();
    await page.waitForURL('**/app/notes**', { timeout: 10000 });
    await page.waitForTimeout(1800);
    await page.fill('.ns-q input', `${tag}o`);
    await page.waitForTimeout(1500);
    const card = page.locator('.ns-card', { has: page.locator(`b:has-text("بیمارِ شرح‌دار")`) });
    ok(await card.count() === 1, '**نتیجهٔ جستجوی متنی روی صفحه است**');
    ok((await card.innerText()).includes('شرحِ عمل') && (await card.innerText()).includes(`عملِ ${tag}`),
      'کارت نوعِ شرح و نامِ عمل را دارد');
    const href = await card.locator('a.ns-patient').getAttribute('href');
    ok(href === `/app/patients/${pid}`, `لینکِ کارت به پرونده (${href})`);
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  for (const id of trash.tpls) await send(`/note-templates/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs) await send(`/procedure-types/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.diags) await send(`/diagnoses/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM clinical_notes WHERE patient_id IN (SELECT id FROM patients WHERE phone='09120000821')`);
  sql(`DELETE FROM patients WHERE phone='09120000821'`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
