/**
 * **فرمِ عمل: زیرفرم به‌ازای مرحله + مراقبتِ پاپ‌آپی + دستیار با بافتار** (بازخوردِ مالک
 * ۱۴۰۵/۰۷/۰۳، دورِ دوم — اسکرین‌شاتِ تبِ «قبل از عمل»):
 *   «علائمِ حیاتی هنوز هاردکد مانده؛ ببرش به الصاقِ فرم‌ها — فقط در عمل، فرمی که الصاق می‌شود
 *    باید معلوم باشد قبل، حین یا بعد از عمل است. کادرهای مراقبتِ قبل و بعد از عمل جای تایپ و
 *    دیدن ندارند؛ مثلِ شرحِ عمل پاپ‌آپش کن. AI باید نسبت به نوعِ عمل و تشخیص بنویسد.»
 * سمتِ API در `visit-subforms.mjs` (مرحله‌ها) و `ai-care-context.mjs` (پرامپت‌ها).
 *
 *  باید بیفتد:
 *   - تب‌ها کادرِ ثابتِ علائمِ حیاتی ندارند؛ اندازه‌های قبلیِ عمل کارتِ ضمنیِ همان تب را دارند
 *   - ته‌ِ هر تب «+ الصاقِ فرم به این مرحله»؛ پنجره با همان مرحله باز می‌شود و «الصاق به»
 *     عوض‌شدنی است؛ الصاق تب را به همان مرحله می‌برد
 *   - منتخب به تبِ فعال الصاق می‌شود؛ «الصاق شده» به‌ازای مرحله است
 *   - اندازهٔ تایپ‌شده و زیرفرمِ هر مرحله با ذخیره، با مرحلهٔ خودش می‌نشیند
 *   - مراقبت: پیش‌نما در تب، نوشتن در پاپ‌آپ؛ «خالی = قالبِ نوعِ عمل» (پیش‌نما قالب را کم‌رنگ
 *     نشان می‌دهد و بازکردن آن را در متن نمی‌نشاند)؛ «استفاده و ویرایش» صریح است
 *   - دستیارِ مراقبت: بدنه نوعِ عمل، تشخیص، مرحله و متنِ فعلی را دارد؛ «برگرداندن» کار می‌کند
 *   - ابزارِ «ادامه با AI»ِ کادر بافتارِ فرم + `care` را می‌فرستد
 *   - ثبتِ تازه: ویزیت ← عمل در گامِ «نوع» الصاق و پیش‌نویسِ علائم را به «قبل از عمل» می‌برد
 *  نباید بیفتد:
 *   - کادرِ علائمِ حیاتیِ بیرون از کارت
 *   - بدنهٔ ذخیرهٔ عمل بندِ بی‌مرحله داشته باشد
 *   - دستیارِ مراقبت بی‌بافتار (نه عمل، نه تشخیص، نه متن) فعال باشد
 *   - خطای JS یا سرریزِ افقی در موبایل
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';

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
  method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken }, body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = randomBytes(3).toString('hex');
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const prefs0 = (await send('/auth/prefs')).json;
const trash = [];
const restoreRequired = [];
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const errors = [];
const watch = (p) => p.on('pageerror', (e) => errors.push(String(e)));
/* دستیار روی CI کلید ندارد: وضعیت جعل می‌شود و دو مسیرِ نوشتن رهگیری — بدنه‌شان همان قراردادی
   است که سرور (`ai-care-context.mjs`) با آن پرامپت می‌سازد. */
const aiCalls = { care: [], text: [] };
const fakeAi = async (p) => {
  await p.route('**/api/ai/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, stt: false }) }));
  await p.route('**/api/ai/care-draft', (r) => {
    const body = r.request().postDataJSON();
    aiCalls.care.push(body);
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ text: `- پیش‌نویسِ دستیار ${body?.phase} ${tag}` }) });
  });
  await p.route('**/api/ai/text-draft', (r) => {
    aiCalls.text.push(r.request().postDataJSON());
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ text: `- ادامهٔ دستیار ${tag}` }) });
  });
};
const saveSheet = async (p) => {
  const req = p.waitForRequest((r) => /\/api\/visits(\/\d+)?$/.test(new URL(r.url()).pathname) && ['PATCH', 'POST'].includes(r.method()), { timeout: 15000 }).catch(() => null);
  const resp = p.waitForResponse((r) => /\/api\/visits(\/\d+)?$/.test(new URL(r.url()).pathname) && ['PATCH', 'POST'].includes(r.request().method()), { timeout: 15000 }).catch(() => null);
  await p.locator('.db-sheet .db-submit').last().click();
  const [q, s] = await Promise.all([req, resp]);
  return { body: q ? q.postDataJSON() : null, status: s?.status() ?? null, json: s ? await s.json().catch(() => null) : null };
};
const openVisit = async (p, id) => {
  await p.goto(`${UI}/app/dashboard?patient=${id}`, { waitUntil: 'networkidle' });
  await p.locator('.db-sheet [data-visit-bar]').waitFor({ timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(700);
};
const tab = (p, label) => p.locator('.db-postop .ui-tabs button', { hasText: label }).click();
const card = (p, key, ph) => p.locator(`[data-subform="${key}"][data-subform-phase="${ph}"]`);

try {
  ok('سوییچ به مطب', (await send('/config/vertical', 'PATCH', { vertical: 'clinic' })).status === 200);
  const kinds = (await send('/forms/visit-kinds')).json ?? [];
  if (!kinds.some((k) => (k.kind ?? k.key) === 'clinic')) await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  await send('/forms/subforms');
  await send('/auth/prefs', 'PATCH', { subformPins: ['vitals', null, null], todayPins: [null, null, null] });
  const s1 = (await send('/surgeons', 'POST', { firstName: 'دکترِ', lastName: `مرحله${tag}` })).json;
  const hosp = (await send('/hospitals', 'POST', { name: `بیمارستانِ مرحله ${tag}` })).json;
  const proc = (await send('/procedure-types', 'POST', {
    name: `عملِ مرحله ${tag}`, preOpCare: `از نیمه‌شب ناشتا باشید ${tag}`, postOpCare: `پانسمان را خشک نگه دارید ${tag}`,
  })).json;
  const dx = (await send('/diagnoses', 'POST', { title: `تشخیصِ مرحله ${tag}` })).json;
  /* عملی از پیش از این بسته: اندازه‌های «قبل» و «بعد» دارد ولی ردیفِ الصاق نه. */
  const Sr = await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'مرحلهٔ', lastName: `عمل${tag}`, opDate: new Date(Date.now() + 3 * 864e5).toISOString(),
    surgeonId: s1.id, hospitalId: hosp.id, procedureTypeId: proc.id, diagnosisId: dx.id,
    vitals: [{ hr: '80', phase: 'pre' }, { bpSys: '110', bpDia: '70', phase: 'post' }],
  });
  const S = Sr.json;
  if (!S?.id) throw new Error('عمل ساخته نشد: ' + JSON.stringify(S).slice(0, 240));
  trash.push(S.id);
  sql(`DELETE FROM visit_subforms WHERE visit_id=${S.id}`);

  const ctx = await browser.newContext({ viewport: { width: 1320, height: 900 } });
  const page = await ctx.newPage();
  watch(page);
  await fakeAi(page);
  await browserLogin(page, login.accessToken, { ui: UI });

  console.log('۱) عملِ موجود — علائمِ حیاتی دیگر کادرِ ثابت نیست');
  await openVisit(page, S.id);
  ok('عملِ آینده روی «قبل از عمل» باز شد', (await page.locator('.db-postop .ui-tabs button[aria-selected="true"]').innerText()).includes('قبل از عمل'));
  ok('**هیچ کادرِ علائمِ حیاتیِ بیرون از کارت نیست**',
    await page.locator('.db-sheet .vs-box').count() === await page.locator('.db-sheet .vf-card .vs-box').count());
  ok('**اندازهٔ قبلیِ «قبل» کارتِ ضمنیِ همان تب را دارد** (با «داده دارد» و قفل، نه ×)',
    await card(page, 'vitals', 'pre').locator('[data-vital-row]').count() === 1
    && (await card(page, 'vitals', 'pre').innerText()).includes('داده دارد')
    && await card(page, 'vitals', 'pre').locator('[data-act="subform-remove"]').count() === 0);
  const preAttach = page.locator('[data-act="phase-attach"][data-phase="pre"]');
  ok('ته‌ِ تب «+ الصاقِ فرم به «قبل از عمل»»', await preAttach.count() === 1 && (await preAttach.innerText()).includes('قبل از عمل'));
  ok('منتخبِ «علائمِ حیاتی» روی تبِ «قبل» الصاق‌شده علامت دارد', await page.locator('.vf-pin.is-attached[data-pin="vitals"]').count() === 1);
  ok('ستونِ زیرفرمِ کناری در فرمِ عمل خالی است (یک‌ستونه)', await page.locator('.vf-cols.vf-flat').count() === 1 && await page.locator('.vf-sub .vf-card').count() === 0);
  await tab(page, 'بعد از عمل');
  /* کارتِ هر تب با بازشدنِ همان تب سوار می‌شود و اندازه‌هایش را تازه می‌خواند. */
  await card(page, 'vitals', 'post').locator('[data-vital-row]').first().waitFor({ timeout: 8000 }).catch(() => {});
  ok('تبِ «بعد»: کارتِ علائمِ همان مرحله با اندازهٔ خودش', await card(page, 'vitals', 'post').locator('[data-vital-row]').count() === 1
    && (await card(page, 'vitals', 'post').innerText()).includes('۱۱۰/۷۰'));

  console.log('\n۲) منتخب به تبِ فعال الصاق می‌شود');
  await tab(page, 'حین عمل');
  ok('تبِ «حین» هنوز کارتی ندارد', await page.locator('[data-phase="intra"] .vf-card').count() === 0);
  ok('منتخب در «حین» الصاق‌نشده است', await page.locator('.vf-pin.is-attached[data-pin="vitals"]').count() === 0);
  await page.locator('.vf-pin[data-pin="vitals"]').click();
  await page.waitForTimeout(400);
  ok('**کارتِ علائمِ «حین» ساخته شد**', await card(page, 'vitals', 'intra').count() === 1 && await page.locator('[data-phase="intra"] .vf-card').count() === 1);
  ok('کارتِ خالی × دارد', await card(page, 'vitals', 'intra').locator('[data-act="subform-remove"]').count() === 1);
  await card(page, 'vitals', 'intra').locator('[data-vital="hr"]').fill('95');

  console.log('\n۳) «الصاقِ فرم به این مرحله» و «الصاق به»');
  await page.locator('[data-act="phase-attach"][data-phase="intra"]').click();
  await page.locator('.vf-pick').waitFor({ timeout: 5000 });
  ok('پنجره با همان مرحله باز شد', await page.locator('.vf-pick [data-pick-phase="intra"][aria-checked="true"]').count() === 1);
  ok('«الصاق شده» به‌ازای همان مرحله', (await page.locator('.vf-pick [data-subform-item="vitals"] [data-act="attach"]').innerText()).includes('الصاق شده'));
  ok('«درخواست» پیشنهاد نمی‌شود (تبِ ثابتِ «قبل»)', await page.locator('.vf-pick [data-subform-item="orders"]').count() === 0);
  await page.locator('.vf-pick [data-pick-phase="pre"]').click();
  ok('عوض‌کردنِ «الصاق به»', await page.locator('.vf-pick [data-pick-phase="pre"][aria-checked="true"]').count() === 1);
  await page.locator('.vf-pick [data-subform-item="subform.asa"] [data-act="attach"]').click();
  await page.waitForTimeout(500);
  ok('**الصاق تب را به همان مرحله برد و کارت آن‌جاست**',
    (await page.locator('.db-postop .ui-tabs button[aria-selected="true"]').innerText()).includes('قبل از عمل')
    && await card(page, 'subform.asa', 'pre').count() === 1);
  await page.locator('.vf-attach').click();
  await page.locator('.vf-pick').waitFor({ timeout: 5000 });
  ok('سربرگ پنجره را با تبِ فعال باز می‌کند', await page.locator('.vf-pick [data-pick-phase="pre"][aria-checked="true"]').count() === 1);
  await page.locator('.vf-pick [data-pick-phase="post"]').click();
  ok('ASA در «بعد» هنوز الصاق نشده', (await page.locator('.vf-pick [data-subform-item="subform.asa"] [data-act="attach"]').innerText()).trim() === 'الصاق');
  await page.locator('.vf-pick .db-x').click();

  console.log('\n۴) مراقبتِ «قبل از عمل» — پاپ‌آپ');
  const prev = page.locator('[data-care-open="pre"]');
  ok('**پیش‌نما قالبِ نوعِ عمل را کم‌رنگ نشان می‌دهد («همین فرستاده می‌شود»)**',
    (await prev.getAttribute('class')).includes('is-default') && (await prev.innerText()).includes(`ناشتا باشید ${tag}`) && (await prev.innerText()).includes('همین فرستاده می‌شود'));
  ok('کادرِ سه‌خطیِ قدیمی در تب نیست', await page.locator('[data-phase="pre"] .db-careblock textarea').count() === 0);
  await prev.click();
  const sheet = page.locator('[data-care-sheet="pre"]');
  await sheet.waitFor({ timeout: 5000 });
  const area = sheet.locator('[data-care-area="pre"]');
  ok('**پاپ‌آپ باز شد و بازکردن قالب را در متن ننشاند** (خالی = قالب)', (await area.inputValue()) === '');
  const box = await area.boundingBox();
  ok(`کادرِ نوشتنِ بزرگ (${Math.round(box?.height ?? 0)}px)`, (box?.height ?? 0) >= 300);
  ok('«کِی می‌رود» بالای پاپ‌آپ', (await sheet.innerText()).includes('روز قبل از عمل') || (await sheet.innerText()).includes('پیش از عمل'));
  await sheet.locator('.db-default button', { hasText: 'استفاده و ویرایش' }).click();
  ok('«استفاده و ویرایش» قالب را در متن گذاشت', (await area.inputValue()) === `از نیمه‌شب ناشتا باشید ${tag}`);
  await sheet.locator('[data-act="care-ai"]').click();
  await page.waitForTimeout(400);
  const cb = aiCalls.care[aiCalls.care.length - 1];
  ok('**دستیارِ مراقبت: مرحله، نوعِ عمل، تشخیص، مراجعه و متنِ فعلی در بدنه**',
    cb?.phase === 'pre' && JSON.stringify(cb?.procedureTypeIds) === JSON.stringify([proc.id]) && JSON.stringify(cb?.diagnosisIds) === JSON.stringify([dx.id])
    && cb?.visitId === S.id && cb?.text === `از نیمه‌شب ناشتا باشید ${tag}`, JSON.stringify(cb));
  ok('پیش‌نویس در متن نشست', (await area.inputValue()) === `- پیش‌نویسِ دستیار pre ${tag}`);
  await sheet.locator('.db-aighost', { hasText: 'برگرداندن' }).click();
  ok('**«برگرداندنِ متنِ قبلی»**', (await area.inputValue()) === `از نیمه‌شب ناشتا باشید ${tag}`);
  await sheet.locator('.assisted-tools [aria-label="ادامه با AI"]').click();
  await sheet.locator('.assisted-proposal').waitFor({ timeout: 5000 });
  const tb = aiCalls.text[aiCalls.text.length - 1];
  ok('**«ادامه با AI»ِ کادر: بافتارِ فرم + care در بدنه**',
    tb?.context?.care === 'pre' && JSON.stringify(tb?.context?.procedureTypeIds) === JSON.stringify([proc.id])
    && JSON.stringify(tb?.context?.diagnosisIds) === JSON.stringify([dx.id]) && String(tb?.purpose ?? '').includes('مراقبت‌های قبل از عمل'),
    JSON.stringify(tb));
  await sheet.locator('.assisted-proposal button', { hasText: 'اعمال پیشنهاد' }).click();
  ok('پیشنهادِ ادامه اعمال شد', (await area.inputValue()).includes(`ادامهٔ دستیار ${tag}`));
  await page.locator('[data-act="care-done"]').click();
  await page.locator('[data-care-sheet="pre"]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  ok('«تمام» پاپ‌آپ را بست و پیش‌نما متنِ اختصاصی را نشان می‌دهد',
    await page.locator('[data-care-sheet="pre"]').count() === 0 && !(await prev.getAttribute('class')).includes('is-default')
    && (await prev.innerText()).includes(`ادامهٔ دستیار ${tag}`));

  console.log('\n۵) مراقبتِ «بعد از عمل» — پاپ‌آپ و دستیار');
  await tab(page, 'بعد از عمل');
  await page.locator('[data-care-open="post"]').click();
  const sheet2 = page.locator('[data-care-sheet="post"]');
  await sheet2.waitFor({ timeout: 5000 });
  await sheet2.locator('[data-act="care-ai"]').click();
  await page.waitForFunction(() => document.querySelector('[data-care-area="post"]')?.value?.includes('پیش‌نویسِ دستیار'), null, { timeout: 8000 }).catch(() => {});
  const cb2 = aiCalls.care[aiCalls.care.length - 1];
  ok('دستیارِ «بعد»: مرحلهٔ «بعد» با همان بافتار', cb2?.phase === 'post' && JSON.stringify(cb2?.procedureTypeIds) === JSON.stringify([proc.id]), JSON.stringify(cb2));
  ok('پیش‌نویسِ «بعد» در متن', (await sheet2.locator('[data-care-area="post"]').inputValue()) === `- پیش‌نویسِ دستیار post ${tag}`);
  await page.locator('[data-act="care-done"]').click();
  await page.locator('[data-care-sheet="post"]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});

  console.log('\n۶) ذخیره — هر چیز با مرحلهٔ خودش');
  const sv = await saveSheet(page);
  ok('ذخیره پذیرفته شد', sv.status === 200, `${sv.status} ${JSON.stringify(sv.json).slice(0, 200)}`);
  ok('**بندهای زیرفرمِ بدنه همه مرحله دارند**', Array.isArray(sv.body?.subforms) && sv.body.subforms.length > 0 && sv.body.subforms.every((x) => ['pre', 'intra', 'post'].includes(x.phase)),
    JSON.stringify(sv.body?.subforms));
  ok('اندازهٔ «حین» با مرحله‌اش در بدنه', Array.isArray(sv.body?.vitals) && sv.body.vitals.some((x) => x.phase === 'intra' && x.hr === '95'), JSON.stringify(sv.body?.vitals));
  ok('**سرور: اندازهٔ «حین» با مرحلهٔ خودش نشست**', sql(`SELECT hr FROM vital_signs WHERE visit_id=${S.id} AND phase='intra'`) === '95');
  ok('**سرور: الصاق‌ها با مرحله** (علائمِ «حین»، ASAِ «قبل»)',
    sql(`SELECT string_agg(key || '@' || phase, ',' ORDER BY key) FROM visit_subforms WHERE visit_id=${S.id}`) === 'subform.asa@pre,vitals@intra',
    sql(`SELECT string_agg(key || '@' || phase, ',' ORDER BY key) FROM visit_subforms WHERE visit_id=${S.id}`));
  const savedS = (await send(`/visits/${S.id}`)).json;
  ok('مراقبت‌های قبل و بعد ذخیره شدند',
    String(savedS?.preOpCare ?? '').includes(`ادامهٔ دستیار ${tag}`) && savedS?.postOpCare === `- پیش‌نویسِ دستیار post ${tag}`,
    JSON.stringify([savedS?.preOpCare, savedS?.postOpCare]));
  await ctx.close();

  console.log('\n۷) ثبتِ تازه: ویزیت ← عمل در گامِ «نوع»');
  /* ستاره‌های فرمِ عملِ مطب (تاریخ، پزشک، بیمارستان، عمل) موقتاً خاموش — این بخش فقط جابه‌جاییِ
     الصاق و پیش‌نویس را می‌سنجد، نه پرکردنِ هسته را (آن در `visit-form-sections`). */
  const sForm = (await send('/forms/visit.surgery')).json;
  for (const fld of (sForm?.fields ?? []).filter((x) => x.required)) {
    await send(`/forms/fields/${fld.id}`, 'PATCH', { required: false });
    restoreRequired.push(fld.id);
  }
  /* فهرستِ تازه — فرمِ ویزیت ممکن است همین اولِ سوییت ساخته شده باشد. */
  const kindsNow = (await send('/forms/visit-kinds')).json ?? [];
  const clinicKind = kindsNow.find((k) => (k.kind ?? k.key) === 'clinic')?.title ?? 'فرمِ ویزیت';
  const surgeryKind = kindsNow.find((k) => (k.kind ?? k.key) === 'surgery')?.title ?? 'فرمِ جراحی';
  const ctx2 = await browser.newContext({ viewport: { width: 1320, height: 900 } });
  const p2 = await ctx2.newPage();
  watch(p2);
  await fakeAi(p2);
  await browserLogin(p2, login.accessToken, { ui: UI });
  await p2.goto(`${UI}/app/dashboard`, { waitUntil: 'networkidle' });
  await p2.locator('.db-add').first().click();
  await p2.waitForTimeout(600);
  const nameInp = p2.locator('.db-sheet .db-grid2 input');
  await nameInp.nth(0).fill('تازهٔ');
  await nameInp.nth(1).fill(`مرحله${tag}`);
  await p2.locator('.db-stepnav button').last().click();
  await p2.waitForTimeout(900);
  const kindBtn = (title) => p2.locator('.db-kindrow button').filter({ hasText: new RegExp(`^\\s*${title}\\s*$`) });
  await kindBtn(clinicKind).click();
  await p2.locator('.db-stepnav button').last().click();
  await p2.waitForTimeout(900);
  await p2.locator('.vf-attach').click();
  await p2.locator('.vf-pick').waitFor({ timeout: 5000 });
  ok('ویزیت: پنجره «الصاق به» ندارد', await p2.locator('.vf-pick [data-pick-phase]').count() === 0);
  await p2.locator('.vf-pick [data-subform-item="vitals"] [data-act="attach"]').click();
  await p2.waitForTimeout(300);
  ok('کارتِ علائمِ ویزیت (بی‌مرحله)', await p2.locator('[data-subform="vitals"]:not([data-subform-phase])').count() === 1);
  await p2.locator('[data-subform="vitals"] [data-vital="hr"]').fill('66');
  await p2.locator('.db-steps li').nth(1).locator('button').click();
  await p2.waitForTimeout(400);
  await kindBtn(surgeryKind).click();
  await p2.locator('.db-stepnav button').last().click();
  await p2.waitForTimeout(900);
  ok('**عوض‌شدنِ نوع: کارت و اندازهٔ تایپ‌شده به «قبل از عمل» رفت**',
    await card(p2, 'vitals', 'pre').count() === 1 && (await card(p2, 'vitals', 'pre').locator('[data-vital="hr"]').inputValue()) === '66'
    && await p2.locator('[data-subform="vitals"]:not([data-subform-phase])').count() === 0);
  await p2.locator('[data-care-open="pre"]').click();
  const sheet3 = p2.locator('[data-care-sheet="pre"]');
  await sheet3.waitFor({ timeout: 5000 });
  ok('**دستیارِ مراقبت بی‌بافتار غیرفعال است، با راهنما**',
    await sheet3.locator('[data-act="care-ai"]').isDisabled() && (await sheet3.innerText()).includes('اول نوعِ عمل یا تشخیص'));
  await sheet3.locator('[data-care-area="pre"]').fill(`ناشتا از شب قبل ${tag}`);
  ok('با متنِ خودِ کادر فعال شد', !(await sheet3.locator('[data-act="care-ai"]').isDisabled()));
  await sheet3.locator('[data-act="care-ai"]').click();
  await p2.waitForFunction(() => document.querySelector('[data-care-area="pre"]')?.value?.includes('پیش‌نویسِ دستیار'), null, { timeout: 8000 }).catch(() => {});
  const cb3 = aiCalls.care[aiCalls.care.length - 1];
  ok('**ثبتِ تازه: دستیار بی‌مراجعه، با متنِ فعلی**', cb3?.phase === 'pre' && cb3?.visitId === undefined && cb3?.text === `ناشتا از شب قبل ${tag}`
    && Array.isArray(cb3?.procedureTypeIds) && cb3.procedureTypeIds.length === 0, JSON.stringify(cb3));
  await p2.locator('[data-act="care-done"]').click();
  await p2.locator('[data-care-sheet="pre"]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  const sv2 = await saveSheet(p2);
  const made = sv2.json?.id;
  if (made) trash.push(made);
  ok('ثبتِ تازه پذیرفته شد', sv2.status === 201, `${sv2.status} ${JSON.stringify(sv2.json).slice(0, 200)}`);
  ok('**بدنه: الصاق و اندازه هر دو «قبل از عمل»**',
    JSON.stringify(sv2.body?.subforms) === JSON.stringify([{ key: 'vitals', phase: 'pre' }])
    && sv2.body?.vitals?.phase === 'pre' && sv2.body?.vitals?.hr === '66', JSON.stringify([sv2.body?.subforms, sv2.body?.vitals]));
  ok('**سرور: اندازه و الصاق با مرحلهٔ «قبل»**', !!made
    && sql(`SELECT phase || ':' || hr FROM vital_signs WHERE visit_id=${made}`) === 'pre:66'
    && sql(`SELECT key || '@' || phase FROM visit_subforms WHERE visit_id=${made}`) === 'vitals@pre');
  ok('مراقبتِ قبل از عمل با پیش‌نویسِ دستیار ذخیره شد', !!made && (await send(`/visits/${made}`)).json?.preOpCare === `- پیش‌نویسِ دستیار pre ${tag}`);
  await ctx2.close();

  console.log('\n۸) موبایل ۳۹۰');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  watch(m);
  await fakeAi(m);
  await browserLogin(m, login.accessToken, { ui: UI });
  await openVisit(m, S.id);
  await m.locator('.db-postop .ui-tabs button', { hasText: 'حین عمل' }).click();
  ok('موبایل: کارتِ «حین» و «+ الصاقِ فرم» در تب', await card(m, 'vitals', 'intra').count() === 1 && await m.locator('[data-act="phase-attach"][data-phase="intra"]').count() === 1);
  await m.locator('.db-postop .ui-tabs button', { hasText: 'قبل از عمل' }).click();
  await m.locator('[data-care-open="pre"]').click();
  await m.locator('[data-care-sheet="pre"]').waitFor({ timeout: 5000 });
  const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`بدونِ سرریزِ افقی با پاپ‌آپِ مراقبت (${over}px)`, over <= 1);
  await mctx.close();

  ok('بدونِ خطای JS', errors.length === 0, errors[0]);
} catch (e) {
  ok('اجرا متوقف شد: ' + (e?.stack ?? e), false);
} finally {
  await browser.close().catch(() => {});
  for (const id of restoreRequired) await send(`/forms/fields/${id}`, 'PATCH', { required: true }).catch(() => {});
  for (const id of trash) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  if (prefs0) await send('/auth/prefs', 'PATCH', { subformPins: prefs0.subformPins, todayPins: prefs0.todayPins }).catch(() => {});
  await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => {});
}

console.log(`\n${pass} سنجه سبز${fails.length ? `، ${fails.length} قرمز` : ''}`);
if (fails.length) { for (const f of fails) console.log('  ✘ ' + f); process.exit(1); }
