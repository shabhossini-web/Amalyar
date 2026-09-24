/**
 * **اصلاحاتِ مالک ۱۴۰۵/۰۷/۰۲ روی فرمِ ویزیت و عملِ مطب:**
 *  ۱) خلاصهٔ کوچکِ بیمار بالای فرم؛ کادرهای مشخصات پشتِ «ویرایشِ مشخصات» (پیش‌فرض بسته)
 *  ۲) «یافته‌های پاراکلینیک» کادرِ متنی نیست — مدارکِ همین ویزیت کامل دیده می‌شوند، وگرنه
 *     یک خطِ «+ افزودنِ مدارک…» که باکسِ استاندارد (عکس، لینک + ورود، صدا) را باز می‌کند
 *  ۳) «یافته‌های حینِ عمل» در مطب نیست؛ شرحِ عمل پیش‌نما + پاپ‌آپِ بزرگ؛ کلِ کادر دکمه است و
 *     تا شرحی نوشته نشده پیش‌فرضِ همان نوعِ عمل کم‌رنگ رویش دیده می‌شود (با بازکردن در متن می‌نشیند)
 *  ۵) باکسِ مدارکِ تب‌های عمل همان الگو را دارد: مدرکِ همان مرحله باز، وگرنه فقط «+»؛ و «+» با
 *     توضیح زیرِ فهرستِ پر هم هست
 *  ۴) فایلِ ناموجود: پیامِ خودِ سرور («روی سرور نیست»)، نه «فایل در دسترس نیست»
 *
 *  نباید بیفتد:
 *   - مدرکِ مرحله‌دارِ عمل، کارتِ شناسایی، پاسخِ درخواست، مدرکِ ویزیتِ دیگر یا کلِ پرونده
 *     در فهرستِ مدارکِ این ویزیت
 *   - کادرهای بستهٔ مشخصات ذخیره را ببندند
 *   - Escape در پاپ‌آپِ شرح کلِ شیتِ ویزیت را ببندد
 *   - میزِ اتاقِ عملِ مطب «یافته‌های حینِ عمل» داشته باشد
 *   - پیش‌فرضِ دیده‌نشده با «ذخیره» شرحِ عمل شود
 *   - مدرکِ مرحلهٔ دیگر یا بی‌مرحله در تبِ یک مرحله
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { browserLogin } from './lib/browser-login.mjs';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const H = { Authorization: 'Bearer ' + login.accessToken };
const send = (p, m = 'GET', b) => fetch(API + p, { method: m, headers: { ...H, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const upload = async (pid, buf, name, type, fields) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  const r = await fetch(`${API}/patients/${pid}/documents`, { method: 'POST', headers: H, body: fd });
  return r.json().catch(() => null);
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function wav(seconds = 0.3) {
  const rate = 16000, n = Math.round(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1'); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), 44 + i * 2);
  return b;
}

const tag = randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const trash = [];
let browser;

try {
  ok('سوییچ به مطب', (await send('/config/vertical', 'PATCH', { vertical: 'clinic' })).status === 200);
  /* DBِ تازهٔ CI فرمِ ویزیتِ مطب ندارد — مثلِ بقیهٔ سوییت‌ها، اگر نیست ساخته می‌شود. */
  if (!((await send('/forms/visit-kinds')).json ?? []).some((k) => (k.kind ?? k.key) === 'clinic')) {
    await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  }
  const surgeon = (await send('/surgeons', 'POST', { firstName: 'پزشکِ', lastName: `مدرک${tag}` })).json;
  const hospital = (await send('/hospitals', 'POST', { name: `بیمارستانِ مدرک ${tag}` })).json;
  const mk = async (body) => {
    const v = (await send('/visits', 'POST', { surgeonId: surgeon?.id, chiefComplaint: 'درد', opDate: new Date().toISOString(), ...body })).json;
    if (!v?.id) throw new Error('مراجعه ساخته نشد: ' + JSON.stringify(v).slice(0, 200));
    trash.push(v.id);
    return v;
  };

  /* V1: ویزیتِ بی‌مدرک · V2: ویزیتی با مدرک + «نباید بیفتد»ها · V3: عملِ مطب */
  const P1 = phone();
  const V1 = await mk({ kind: 'clinic', firstName: 'بی‌مدرکِ', lastName: `ویزیت${tag}`, phone: P1 });
  const V2 = await mk({ kind: 'clinic', firstName: 'با‌مدرکِ', lastName: `ویزیت${tag}`, phone: phone() });
  const V2b = await mk({ kind: 'clinic', patientId: V2.patientId, opDate: new Date(Date.now() - 20 * 864e5).toISOString() });
  const proc = (await send('/procedure-types', 'POST', { name: `عملِ مدرک ${tag}` })).json;
  const TPL = `پیش‌فرضِ شرحِ عملِ آزمایشی ${tag}: وضعیتِ پرون، برشِ خطِ وسط، بستن.`;
  const tpl = (await send('/op-templates', 'POST', { procedureTypeId: proc?.id, title: `پیش‌فرض ${tag}`, body: TPL })).json;
  const V3 = await mk({ kind: 'surgery', firstName: 'عملِ', lastName: `مطب${tag}`, phone: phone(), hospitalId: hospital?.id, procedureTypeId: proc?.id });
  const dIntra = (await send(`/patients/${V3.patientId}/documents/link`, 'POST', { url: `https://pacs.example.test/intra-${tag}`, category: 'report', title: `گزارشِ حین ${tag}`, visitId: V3.id, phase: 'intra' })).json;
  const dNoPhase = await upload(V3.patientId, PNG, 'nophase.png', 'image/png', { category: 'imaging', visitId: V3.id, title: 'بی‌مرحله' });

  const dImg = await upload(V2.patientId, PNG, 'mri.png', 'image/png', { category: 'imaging', visitId: V2.id, title: `MRI ${tag}` });
  const dLink = (await send(`/patients/${V2.patientId}/documents/link`, 'POST', { url: `https://pacs.example.test/${tag}`, category: 'lab', title: `جوابِ آزمایش ${tag}`, user: `u${tag}`, pass: `p${tag}`, visitId: V2.id })).json;
  const dAud = await upload(V2.patientId, wav(), 'voice.wav', 'audio/wav', { category: 'report', visitId: V2.id, title: 'توضیحِ صوتی — مشاوره' });
  const dId = await upload(V2.patientId, PNG, 'id.png', 'image/png', { category: 'identity', visitId: V2.id });
  const dPhase = await upload(V2.patientId, PNG, 'phase.png', 'image/png', { category: 'imaging', visitId: V2.id, title: 'مرحله‌دار' });
  sql(`UPDATE documents SET phase='pre' WHERE id=${dPhase.id}`);
  const dOrder = await upload(V2.patientId, PNG, 'answer.png', 'image/png', { category: 'imaging', visitId: V2.id, title: 'پاسخِ درخواست' });
  sql(`UPDATE documents SET ref_type='imaging_order', ref_id=1 WHERE id=${dOrder.id}`);
  const dOther = await upload(V2.patientId, PNG, 'other.png', 'image/png', { category: 'imaging', visitId: V2b.id, title: 'ویزیتِ دیگر' });
  const dChart = await upload(V2.patientId, PNG, 'chart.png', 'image/png', { category: 'imaging', title: 'کلِ پرونده' });
  ok('داده‌ها ساخته شدند', [dImg, dLink, dAud, dId, dPhase, dOrder, dOther, dChart, proc, tpl?.template ?? tpl, dIntra, dNoPhase].every((d) => d?.id),
    JSON.stringify([dImg, dLink, dAud, proc, tpl, dIntra].map((d) => d?.id ?? d)).slice(0, 300));

  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, locale: 'fa-IR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await browserLogin(page, login.accessToken, { ui: UI });
  const openForm = async (id) => {
    await page.goto(`${UI}/app/dashboard?patient=${id}`, { waitUntil: 'networkidle' });
    await page.locator('.db-sheet [data-patient-summary]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    return page.locator('.db-sheet').first();
  };

  console.log('۱) خلاصهٔ کوچکِ بیمار');
  let sheet = await openForm(V1.id);
  const sum = sheet.locator('[data-patient-summary]');
  const sumText = await sum.innerText();
  ok('خلاصه نام و موبایل را دارد (رقمِ فارسی)', sumText.includes(`ویزیت${tag}`) && sumText.includes(fa(P1)), sumText.slice(0, 160));
  ok('**نباید بیفتد:** کارتِ بزرگِ قبلی (`.db-prep`) دیگر نیست', (await sheet.locator('.db-prep').count()) === 0);
  ok('کادرهای مشخصات پیش‌فرض بسته‌اند', await sheet.locator('.db-step').first().isHidden());

  console.log('\n۲) مدارکِ بالینیِ ویزیت — ویزیتِ بی‌مدرک');
  const vd = sheet.locator('[data-visit-docs]');
  ok('یک خطِ «+ افزودنِ مدارک…» و نه بیشتر', (await vd.count()) === 1 && (await vd.locator('[data-act="add-docs"]').innerText()).includes('افزودنِ مدارک') && (await vd.locator('[data-doc]').count()) === 0);
  const sheetText = await sheet.innerText();
  ok('**نباید بیفتد:** کادرِ متنیِ «یافته‌های پاراکلینیک»', !sheetText.includes('یافته‌های پاراکلینیک'));
  ok('**نباید بیفتد:** باکس‌های خالیِ عکس/لینکِ فرم زیرِ ویزیت', (await sheet.locator('.db-media, .dyn-img, .dyn-links').count()) === 0);
  await vd.locator('[data-act="add-docs"]').click();
  const box = vd.locator('[data-docs-box]');
  ok('باکسِ استاندارد باز شد: دسته‌ها، عکس، لینک + ورود، ضبطِ صدا',
    (await box.locator('[role="radio"]').count()) === 4 && (await box.locator('input[type="file"]').count()) >= 1
      && (await box.locator('input[type="url"]').count()) === 1 && (await box.locator('.vd-cred input').count()) === 2
      && (await box.locator('[data-voice-note]').count()) === 1);
  await box.locator('[role="radio"]', { hasText: 'آزمایش' }).click();
  await box.locator('input[type="url"]').fill(`https://lab.example.test/${tag}`);
  await box.locator('.vd-cred input').nth(0).fill(`user${tag}`);
  await box.locator('.vd-cred input').nth(1).fill(`pw${tag}`);
  await box.locator('[data-act="add-link"]').click();
  await vd.locator('[data-doc]').first().waitFor({ timeout: 8000 });
  const lrow = JSON.parse(sql(`SELECT row_to_json(d)::text FROM (SELECT visit_id, category, external_user, external_pass FROM documents WHERE external_url='https://lab.example.test/${tag}' AND deleted_at IS NULL) d`) || 'null');
  ok('لینک با نام کاربری/رمز روی **همین ویزیت** و با دستهٔ انتخابی ثبت شد', lrow?.visit_id === V1.id && lrow?.category === 'lab' && lrow?.external_user === `user${tag}` && lrow?.external_pass === `pw${tag}`, JSON.stringify(lrow));
  ok('و همان‌جا با «ورود» دیده می‌شود', (await vd.innerText()).includes(`user${tag} / pw${tag}`));
  await box.locator('input[type="file"]').first().setInputFiles({ name: `scan-${tag}.png`, mimeType: 'image/png', buffer: PNG });
  await vd.locator('.vd-grid [data-doc]').first().waitFor({ timeout: 10000 });
  const irow = sql(`SELECT visit_id || ':' || category FROM documents WHERE patient_id=${V1.patientId} AND file_name='scan-${tag}.png' AND deleted_at IS NULL`);
  ok('عکس هم روی همین ویزیت نشست و بندانگشتی‌اش آمد', irow === `${V1.id}:lab`, irow);

  console.log('\n۱ب) کادرهای بستهٔ مشخصات ذخیره را نمی‌بندند');
  await page.locator('.db-submit').click();
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  ok('ذخیره با مشخصاتِ بسته انجام شد', (await page.locator('.db-sheet').count()) === 0, await page.locator('.lx-toast').innerText().catch(() => ''));

  console.log('\n۲ب) ویزیتی که مدرک دارد — کامل، و فقط مالِ خودش');
  sheet = await openForm(V2.id);
  const vd2 = sheet.locator('[data-visit-docs]');
  await vd2.locator('[data-doc]').first().waitFor({ timeout: 8000 });
  const shown = (await vd2.locator('[data-doc]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-doc'))))).sort((a, b) => a - b);
  ok('عکس، لینک و صدای همین ویزیت همه دیده می‌شوند', [dImg.id, dLink.id, dAud.id].every((id) => shown.includes(id)), JSON.stringify(shown));
  for (const [d, why] of [[dId, 'کارتِ شناسایی'], [dPhase, 'مدرکِ مرحله‌دارِ عمل'], [dOrder, 'پاسخِ درخواست'], [dOther, 'مدرکِ ویزیتِ دیگر'], [dChart, 'مدرکِ کلِ پرونده']]) {
    ok(`**نباید بیفتد:** ${why} در فهرستِ این ویزیت`, !shown.includes(d.id));
  }
  ok('نام کاربری/رمزِ لینکِ فرستاده‌شده کنارش است', (await vd2.locator(`[data-doc="${dLink.id}"]`).innerText()).includes(`u${tag} / p${tag}`));
  ok('صدا پخش‌کننده دارد، نه لینکِ دانلود', (await vd2.locator(`[data-doc="${dAud.id}"] button`).count()) >= 1);
  ok('زیرِ فهرستِ پر هم همان «+» با توضیح هست', (await vd2.locator('[data-act="add-docs"]').innerText()).includes('افزودنِ مدارک (تصویربرداری'));

  console.log('\n۴) فایلی که روی سرور نیست — پیامِ روشن');
  sql(`UPDATE documents SET sha256='${randomBytes(32).toString('hex')}' WHERE id=${dImg.id}`);
  await vd2.locator(`[data-doc="${dImg.id}"] .vd-thumb`).click();
  await page.locator('.lx-toast.on').waitFor({ timeout: 6000 }).catch(() => {});
  const toast = await page.locator('.lx-toast').innerText().catch(() => '');
  ok('پیامِ سرور دیده می‌شود («روی سرور نیست»)، نه پیامِ کلی', toast.includes('روی سرور نیست') && !toast.includes('فایل در دسترس نیست'), toast);
  await page.keyboard.press('Escape');

  console.log('\n۳) عملِ مطب — بی «یافته‌های حینِ عمل»؛ شرح در پاپ‌آپ');
  sheet = await openForm(V3.id);
  await sheet.locator('.ui-tabs button', { hasText: 'حین عمل' }).first().click();
  await page.waitForTimeout(300);
  const intra = sheet.locator('.db-phase[data-phase="intra"]');
  ok('**نباید بیفتد:** «یافته‌های حینِ عمل» در تبِ حین', !(await intra.innerText()).includes('یافته‌های حین'));
  ok('شرحِ عمل فقط پیش‌نما دارد، کادرِ نوشتن در فرم نیست', (await intra.locator('[data-report-open]').count()) === 1 && (await intra.locator('.db-report textarea').count()) === 0);
  const defShown = await intra.locator('[data-report-open] [data-report-default]').innerText().catch(() => '');
  ok('تا شرحی نیست، پیش‌فرضِ همین نوعِ عمل روی کادر دیده می‌شود', defShown.includes(TPL) && (await intra.locator('.db-report-preview.is-default').count()) === 1, defShown.slice(0, 80));
  await page.locator('.db-submit').click();
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  const untouched = (await send(`/visits/${V3.id}`)).json;
  ok('**نباید بیفتد:** پیش‌فرضِ دیده‌نشده با «ذخیره» شرحِ عمل شود', !(untouched?.opReport ?? '').trim(), String(untouched?.opReport).slice(0, 60));
  sheet = await openForm(V3.id);
  await sheet.locator('.ui-tabs button', { hasText: 'حین عمل' }).first().click();
  await page.waitForTimeout(300);
  /* کلیک روی **متنِ** کادر، نه روی «بزنید…»: کلِ کادر باید دکمه باشد. */
  await intra.locator('[data-report-default]').click();
  const pop = page.locator('[data-report-sheet]');
  await pop.waitFor({ timeout: 5000 });
  /* ⚠️ خودِ پنلِ پاپ‌آپ هم `.db-sheet` است؛ «شیتِ ویزیت» همانی است که خلاصهٔ بیمار را دارد. */
  ok('پاپ‌آپ بیرونِ شیتِ ویزیت (روی body) باز شد', (await page.locator('.db-sheet:has([data-patient-summary]) [data-report-sheet]').count()) === 0
    && (await page.locator('[data-report-sheet]').count()) === 1);
  ok('کلیک روی هر جای کادر پاپ‌آپ را باز کرد و پیش‌فرض در متن نشست', (await page.locator('[data-report-area]').inputValue()) === TPL);
  ok('**نباید بیفتد:** «افزودن به پیش‌فرض» برای همان پیش‌فرضِ دست‌نخورده', (await page.locator('[data-report-sheet] [data-op-default-add]').count()) === 0);
  const TEXT = `شرحِ عملِ آزمایشی ${tag}`;
  await page.locator('[data-report-area]').fill(TEXT);
  await page.keyboard.press('Escape');
  await pop.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  ok('**نباید بیفتد:** Escape کلِ شیتِ ویزیت را ببندد (فقط پاپ‌آپ بسته شد)', (await page.locator('[data-report-sheet]').count()) === 0 && (await page.locator('.db-sheet').count()) === 1);
  ok('متن در پیش‌نما آمد', (await intra.locator('[data-report-open]').innerText()).includes(TEXT));
  await intra.locator('[data-report-open]').click();
  await page.locator('[data-act="report-done"]').click();
  await page.locator('[data-report-sheet]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  ok('«تمام» پاپ‌آپ را می‌بندد', (await page.locator('[data-report-sheet]').count()) === 0);
  await page.locator('.db-submit').click();
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  const saved = (await send(`/visits/${V3.id}`)).json;
  ok('ذخیره شرحِ نوشته‌شده در پاپ‌آپ را نشاند', (saved?.opReport ?? '').includes(TEXT), String(saved?.opReport).slice(0, 80));

  console.log('\n۵) باکسِ مدارکِ تب‌های عمل');
  sheet = await openForm(V3.id);
  const tabTo = async (n) => { await sheet.locator('.ui-tabs button', { hasText: n }).first().click(); await page.waitForTimeout(300); };
  await tabTo('حین عمل');
  const bi = sheet.locator('[data-visit-docs][data-phase="intra"]');
  await bi.locator('[data-doc]').first().waitFor({ timeout: 8000 }).catch(() => {});
  const inIntra = await bi.locator('[data-doc]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-doc'))));
  ok('مدرکِ همین مرحله باز و دیده می‌شود', inIntra.includes(dIntra.id), JSON.stringify(inIntra));
  ok('**نباید بیفتد:** مدرکِ بی‌مرحلهٔ همین عمل در تبِ مرحله', !inIntra.includes(dNoPhase.id));
  ok('زیرِ فهرستِ پر هم «+» با توضیحِ همان مرحله هست', (await bi.locator('[data-act="add-docs"]').innerText()).includes('افزودنِ مدارکِ حین عمل ('));
  await tabTo('قبل از عمل');
  const bp = sheet.locator('[data-visit-docs][data-phase="pre"]');
  ok('مرحلهٔ بی‌مدرک: فقط یک خطِ «+» با توضیح', (await bp.locator('[data-doc]').count()) === 0 && (await bp.locator('[data-act="add-docs"]').innerText()).includes('افزودنِ مدارکِ قبل از عمل ('));
  ok('**نباید بیفتد:** مدرکِ مرحلهٔ دیگر در تبِ «قبل از عمل»', (await bp.locator(`[data-doc="${dIntra.id}"]`).count()) === 0);
  await bp.locator('[data-act="add-docs"]').click();
  await bp.locator('[role="radio"]', { hasText: 'آزمایش' }).click();
  await bp.locator('input[type="file"]').first().setInputFiles({ name: `pre-${tag}.png`, mimeType: 'image/png', buffer: PNG });
  await bp.locator('[data-doc]').first().waitFor({ timeout: 10000 }).catch(() => {});
  const prow = sql(`SELECT coalesce(phase,'-') || ':' || category || ':' || visit_id FROM documents WHERE patient_id=${V3.patientId} AND file_name='pre-${tag}.png' AND deleted_at IS NULL`);
  ok('بارگذاری از تبِ «قبل از عمل» برچسبِ همان مرحله و دستهٔ انتخابی را گرفت', prow === `pre:lab:${V3.id}`, prow);
  await page.keyboard.press('Escape');
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

  console.log('\n۳ب) میزِ اتاقِ عملِ مطب');
  await send(`/theatre/visits/${V3.id}/start`, 'POST');
  await page.goto(`${UI}/app/theatre`, { waitUntil: 'networkidle' });
  await page.locator(`.th-item[data-visit-id="${V3.id}"]`).click();
  await page.locator('[data-report]').first().waitFor({ timeout: 8000 });
  ok('**نباید بیفتد:** «یافته‌های حینِ عمل» سرِ میزِ مطب', (await page.locator('[data-findings]').count()) === 0 && (await page.locator('[data-report]').count()) === 1);

  ok(`بدونِ خطای جاوااسکریپت (${errors.length})`, errors.length === 0, errors[0]?.slice(0, 160));
} catch (e) {
  ok(`اجرا متوقف شد: ${e?.message ?? e}`, false);
} finally {
  await browser?.close().catch(() => {});
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  ok('برگشت به حوزهٔ قبلی', back.status === 200, String(back.status));
  for (const id of trash.reverse()) await send(`/visits/${id}`, 'DELETE').catch(() => {});
}

console.log(`\n${pass} سبز · ${fails.length} قرمز`);
if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
