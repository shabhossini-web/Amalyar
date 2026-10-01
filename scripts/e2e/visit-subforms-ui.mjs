/**
 * **رابطِ زیرفرم‌های مراجعه** (طرحِ مصوبِ ۱۴۰۵/۰۷/۰۳) — سمتِ API در `visit-subforms.mjs`.
 *
 *  باید بیفتد:
 *   - سربرگ فقط نامِ مراجعه + موضوع + «الصاقِ فرم» + منتخب‌ها (تا ستاره‌ای نخورده، یک خطِ راهنما به‌جای سه
 *     اسلاتِ خالی — بازبینیِ UX، surgery-22)؛ ویرایش انتخابگرِ نوع ندارد
 *   - ستاره در پنجرهٔ الصاق فرم را منتخب می‌کند (سمتِ سرور) و اسلات با یک کلیک الصاقش می‌کند
 *   - زیرفرمِ پرشده با ذخیرهٔ مراجعه می‌نشیند و دوباره باز می‌شود؛ × فقط روی خالی
 *   - تصمیمِ کشویی: گزینهٔ انحصاری بقیه را پاک می‌کند
 *   - اندازهٔ علائمِ حیاتیِ تایپ‌شده بی «ثبت» با ذخیرهٔ فرم می‌نشیند
 *   - ابزارهای دستیار آیکونِ کوچکِ داخلِ کادرند
 *   - دسکتاپ دوستونه، موبایل زیرفرم‌ها بالا؛ بدونِ سرریزِ افقی
 *   - «میان‌بُر»ِ صفحهٔ امروز با «+ افزودنِ میان‌بُر» پر، ماندگار و با × خالی می‌شود
 *  نباید بیفتد:
 *   - جعبهٔ «اطلاعات تکمیلی» برگردد
 *   - «درخواست» روی فرمِ عمل الصاق شود (تبِ ثابتِ «قبل از عمل» را دارد)
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
const trashFields = [];
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const errors = [];
const watch = (p) => p.on('pageerror', (e) => errors.push(String(e)));
/* دستیار روی CI کلید ندارد؛ وضعیتش را جعل می‌کنیم تا جای آیکون‌ها سنجیده شود (متن هرگز فرستاده نمی‌شود). */
const fakeAi = (p) => p.route('**/api/ai/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, stt: true }) }));
const saveSheet = async (p) => {
  const resp = p.waitForResponse((r) => /\/api\/visits(\/\d+)?$/.test(new URL(r.url()).pathname) && ['PATCH', 'POST'].includes(r.request().method()), { timeout: 15000 }).catch(() => null);
  await p.locator('.db-sheet .db-submit').last().click();
  return resp;
};
const openVisit = async (p, id) => {
  await p.goto(`${UI}/app/dashboard?patient=${id}`, { waitUntil: 'networkidle' });
  await p.locator('.db-sheet [data-visit-bar]').waitFor({ timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(600);
};

try {
  ok('سوییچ به مطب', (await send('/config/vertical', 'PATCH', { vertical: 'clinic' })).status === 200);
  if (!((await send('/forms/visit-kinds')).json ?? []).some((k) => (k.kind ?? k.key) === 'clinic')) {
    await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  }
  await send('/forms/subforms');
  await send('/auth/prefs', 'PATCH', { subformPins: [null, null, null], todayPins: [null, null, null] });
  /* قالبِ قدیمیِ مطب «مدتِ علائم» را فیلدِ فرم‌ساز داشت و تنها ساکنِ جعبهٔ «اطلاعات تکمیلی» بود
     (همان اسکرین‌شاتِ مالک) — حالا کنارِ شکایت می‌نشیند. */
  const clinicForm = (await send('/forms/visit.clinic')).json;
  if (!clinicForm?.fields?.some((f) => f.key === 'historyDuration')) {
    const df = await send(`/forms/${clinicForm.id}/fields`, 'POST', { key: 'historyDuration', label: 'مدتِ علائم', type: 'text' });
    /* افزودنِ فیلد کلِ فرم را برمی‌گرداند — شناسهٔ فیلد از روی کلیدش، نه `json.id` (شناسهٔ فرم). */
    const fid = df.json?.fields?.find((f) => f.key === 'historyDuration')?.id;
    if (fid) trashFields.push(fid);
  }
  const s1 = (await send('/surgeons', 'POST', { firstName: 'دکترِ', lastName: `رابط${tag}` })).json;
  const office = (await send('/hospitals', 'POST', { name: `مطبِ رابط ${tag}` })).json;
  const proc = (await send('/procedure-types', 'POST', { name: `عملِ رابط ${tag}` })).json;
  const V = (await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'زیرفرمِ', lastName: `رابط${tag}`, opDate: new Date().toISOString(),
    surgeonId: s1.id, hospitalId: office.id, chiefComplaint: `سرفهٔ خشک ${tag}`,
  })).json;
  if (!V?.id) throw new Error('ویزیت ساخته نشد: ' + JSON.stringify(V).slice(0, 200));
  trash.push(V.id);

  const ctx = await browser.newContext({ viewport: { width: 1320, height: 900 } });
  const page = await ctx.newPage();
  watch(page);
  await fakeAi(page);
  await browserLogin(page, login.accessToken, { ui: UI });

  console.log('۱) سربرگ و چیدمان');
  await openVisit(page, V.id);
  const bar = page.locator('.db-sheet [data-visit-bar]');
  ok('سربرگِ مراجعه هست', await bar.count() === 1);
  ok('ویرایش انتخابگرِ نوع ندارد', await page.locator('.db-sheet .db-kindrow').count() === 0);
  ok('«الصاقِ فرم» و به‌جای سه خانهٔ خالیِ «فرمِ منتخب» یک خطِ راهنما (surgery-22)',
    await bar.locator('.vf-attach').count() === 1 && await bar.locator('.vf-pin').count() === 0
    && (await bar.locator('[data-pin-hint]').innerText()).includes('ستاره'));
  ok('**جعبهٔ «اطلاعات تکمیلی» برنگشت**', !(await page.locator('.db-sheet').innerText()).includes('اطلاعات تکمیلی'));
  ok('برگهٔ پهن', await page.locator('.db-sheet.vf-wide').count() === 1);
  const main = await page.locator('.vf-main').boundingBox();
  const side = await page.locator('.vf-side').boundingBox();
  ok('**دوستونه: ستونِ کناری کنارِ ستونِ اصلی است، نه زیرش**',
    !!main && !!side && side.x + side.width <= main.x + 4 && side.y < main.y + main.height, JSON.stringify({ main, side }));
  const ccWrap = page.locator('.vf-cc').first();
  ok('**«مدتِ علائم» کنارِ شکایت است، نه در جعبهٔ جدا**', await ccWrap.count() === 1 && (await ccWrap.innerText()).includes('مدتِ علائم')
    && await page.locator('.db-sheet .db-extra [data-field="historyDuration"], .db-sheet .db-extra label', { hasText: 'مدتِ علائم' }).count() === 0);
  const tools = page.locator('.db-sheet .assisted-text').first();
  const tb = await tools.locator('.assisted-tools').boundingBox().catch(() => null);
  const ta = await tools.locator('textarea').first().boundingBox().catch(() => null);
  ok('**ابزارهای دستیار آیکونِ داخلِ کادرند** (سه آیکون)',
    await tools.locator('.at-ic').count() === 2 && await tools.locator('.assisted-tools button').count() === 3
    && !!tb && !!ta && tb.y >= ta.y - 1 && tb.y + tb.height <= ta.y + ta.height + 1, JSON.stringify({ tb, ta }));

  console.log('\n۲) پنجرهٔ الصاق و منتخب');
  await bar.locator('.vf-attach').click();
  const pick = page.locator('.vf-pick');
  await pick.waitFor({ timeout: 5000 }).catch(() => {});
  ok('پنجره با گروه‌های طرح باز شد', await pick.locator('[data-subform-group]').count() >= 3);
  ok('علائمِ حیاتی و درخواست در «پرکاربرد»', await pick.locator('[data-subform-group="common"] [data-subform-item]').count() === 2);
  const woundRow = pick.locator('[data-subform-item="subform.wound"]');
  const prefsResp = page.waitForResponse((r) => r.url().includes('/auth/prefs') && r.request().method() === 'PATCH', { timeout: 8000 }).catch(() => null);
  await woundRow.locator('.vf-star').click();
  await prefsResp;
  ok('ستاره روشن شد', (await woundRow.locator('.vf-star').getAttribute('aria-pressed')) === 'true');
  ok('**منتخب سمتِ سرور نشست**', (await send('/auth/prefs')).json?.subformPins?.[0] === 'subform.wound');
  await pick.locator('input[aria-label="جستجوی فرم"]').fill('ASA');
  ok('جستجو فهرست را محدود می‌کند', await pick.locator('[data-subform-item]').count() === 1
    && await pick.locator('[data-subform-item="subform.asa"]').count() === 1);
  await pick.locator('.db-x').click();
  await page.waitForTimeout(400);
  const slot = bar.locator('.vf-pin[data-pin="subform.wound"]');
  ok('اسلاتِ اول «زخم» شد', await slot.count() === 1 && (await slot.innerText()).includes('زخم'));
  ok('با اولین منتخب خطِ راهنما کنار رفت', await bar.locator('[data-pin-hint]').count() === 0);
  await slot.click();
  const wound = page.locator('[data-subform="subform.wound"]');
  await wound.waitFor({ timeout: 5000 }).catch(() => {});
  ok('**یک کلیک روی منتخب زیرفرم را الصاق کرد**', await wound.count() === 1);
  ok('کارتِ خالی × دارد', await wound.locator('[data-act="subform-remove"]').count() === 1);
  await wound.locator('label[data-ftype="text"]', { hasText: 'محلِ زخم' }).locator('input').fill(`زانوی چپ ${tag}`);
  ok('کارتِ پرشده × ندارد (قفل)', await wound.locator('[data-act="subform-remove"]').count() === 0);

  console.log('\n۳) الصاق و برداشتنِ کارتِ خالی');
  await bar.locator('.vf-attach').click();
  await pick.locator('[data-subform-item="subform.growth"] .vf-add').click();
  const growth = page.locator('[data-subform="subform.growth"]');
  await growth.waitFor({ timeout: 5000 }).catch(() => {});
  ok('«قد و وزن» از پنجره الصاق شد', await growth.count() === 1);
  await growth.locator('[data-act="subform-remove"]').click();
  ok('× کارتِ خالی را برداشت', await growth.count() === 0);

  console.log('\n۴) علائمِ حیاتیِ ثبت‌نخورده + تصمیم');
  await bar.locator('.vf-attach').click();
  await pick.locator('[data-subform-item="vitals"] .vf-add').click();
  const vit = page.locator('[data-subform="vitals"]');
  await vit.waitFor({ timeout: 5000 }).catch(() => {});
  await vit.locator('[data-vital="hr"]').fill('۷۷');
  const dec = page.locator('.db-sheet .db-decide');
  await dec.locator('[data-act="decision-open"]').click();
  await dec.locator('.vf-opt[data-decision="followup"]').click().catch(() => {});
  await dec.locator('.vf-opt[data-decision="none"]').click();
  ok('**گزینهٔ انحصاری بقیه را پاک کرد**', await dec.locator('[data-decision-tag]').count() === 1 && await dec.locator('[data-decision-tag="none"]').count() === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('Escape فقط کشو را بست', await page.locator('.db-sheet').count() === 1);

  const r1 = await saveSheet(page);
  ok('ذخیره شد', r1?.status() === 200, String(r1?.status()));
  await page.waitForTimeout(800);
  const woundRow2 = sql(`SELECT data->>'site' FROM visit_subforms WHERE visit_id=${V.id} AND key='subform.wound'`);
  ok('**پاسخِ زخم روی سرور نشست**', woundRow2 === `زانوی چپ ${tag}`, woundRow2);
  ok('کارتِ برداشته‌شده ردیفی نساخت', Number(sql(`SELECT count(*) FROM visit_subforms WHERE visit_id=${V.id} AND key='subform.growth'`)) === 0);
  ok('**اندازهٔ «ثبت»‌نخورده با ذخیره نشست**', sql(`SELECT hr FROM vital_signs WHERE visit_id=${V.id} ORDER BY id DESC LIMIT 1`) === '77');
  ok('تصمیم ذخیره شد', sql(`SELECT array_to_string(decisions, ',') FROM visits WHERE id=${V.id}`) === 'none');

  console.log('\n۵) بازگشاییِ همان مراجعه');
  await openVisit(page, V.id);
  const wound2 = page.locator('[data-subform="subform.wound"]');
  ok('کارتِ زخم با «الصاق‌شده» برگشت', await wound2.count() === 1 && (await wound2.innerText()).includes('الصاق‌شده'));
  ok('مقدار ماند', (await wound2.locator('label[data-ftype="text"]', { hasText: 'محلِ زخم' }).locator('input').inputValue()) === `زانوی چپ ${tag}`);
  ok('کارتِ داده‌دار قفلِ «داده دارد» دارد نه ×', await wound2.locator('[data-act="subform-remove"]').count() === 0 && await wound2.locator('.vf-card-lock').count() === 1);
  ok('کارتِ علائمِ حیاتی با اندازهٔ ثبت‌شده', await page.locator('[data-subform="vitals"] [data-vital-row]').count() === 1);
  ok('منتخبِ ستاره‌خورده روی کارتِ الصاق‌شده علامت دارد', await page.locator('.vf-pin.is-attached[data-pin="subform.wound"]').count() === 1);
  await wound2.locator('label[data-ftype="text"]', { hasText: 'محلِ زخم' }).locator('input').fill('');
  ok('پاک‌کردنِ مقدار × را برگرداند', await wound2.locator('[data-act="subform-remove"]').count() === 1);
  await page.locator('[data-subform="subform.wound"] .vf-ic[aria-expanded]').click();
  ok('کارت جمع می‌شود', await page.locator('[data-subform="subform.wound"] .vf-card-body').count() === 0);
  await wound2.locator('[data-act="subform-remove"]').click();
  const r2 = await saveSheet(page);
  ok('**پاک‌کردن و × در یک ذخیره پذیرفته شد**', r2?.status() === 200, String(r2?.status()));
  await page.waitForTimeout(600);
  ok('ردیفِ زخم از سرور رفت', Number(sql(`SELECT count(*) FROM visit_subforms WHERE visit_id=${V.id} AND key='subform.wound'`)) === 0);

  console.log('\n۶) فرمِ عمل');
  const S = (await send('/visits', 'POST', {
    kind: 'surgery', patientId: V.patientId, decidedInVisitId: V.id, opDate: new Date().toISOString(),
    surgeonId: s1.id, hospitalId: office.id, procedureTypeId: proc.id,
  })).json;
  if (S?.id) trash.unshift(S.id);
  await send('/auth/prefs', 'PATCH', { subformPins: ['vitals', 'subform.asa', null] });
  await openVisit(page, S.id);
  const sbar = page.locator('.db-sheet [data-visit-bar]');
  /* از دورِ دوم (۱۴۰۵/۰۷/۰۳): علائمِ حیاتی در عمل هم الصاقی است — به‌ازای مرحله؛ جزئیات در
     `surgery-subform-phases-ui.mjs`. «درخواست» هنوز تبِ ثابتِ «قبل از عمل» را دارد. */
  ok('**منتخبِ علائمِ حیاتی روی فرمِ عمل فعال است** (به تبِ فعال الصاق می‌شود)', !(await sbar.locator('.vf-pin[data-pin="vitals"]').isDisabled()));
  ok('منتخبِ فرم‌ساز (ASA) فعال است', !(await sbar.locator('.vf-pin[data-pin="subform.asa"]').isDisabled()));
  await sbar.locator('.vf-attach').click();
  ok('پنجرهٔ فرمِ عمل «الصاق به» سه مرحله دارد و «درخواست» را پیشنهاد نمی‌دهد',
    await page.locator('.vf-pick [data-pick-phase]').count() === 3
    && await page.locator('.vf-pick [data-subform-item="orders"]').count() === 0
    && await page.locator('.vf-pick [data-subform-item="vitals"]').count() === 1
    && await page.locator('.vf-pick [data-subform-item="subform.asa"]').count() === 1);
  await page.locator('.vf-pick .db-x').click();
  const over1 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`بدونِ سرریزِ افقی در دسکتاپ (${over1}px)`, over1 <= 1);
  await ctx.close();

  console.log('\n۷) موبایل ۳۹۰');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  watch(m);
  await browserLogin(m, login.accessToken, { ui: UI });
  await openVisit(m, V.id);
  const mSub = await m.locator('.vf-sub').boundingBox();
  const mMain = await m.locator('.vf-main').boundingBox();
  ok('**موبایل: کارت‌های زیرفرم بالای فرم‌اند**', !!mSub && !!mMain && mSub.y < mMain.y, JSON.stringify({ mSub, mMain }));
  const over2 = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`بدونِ سرریزِ افقی در موبایل (${over2}px)`, over2 <= 1);
  await mctx.close();

  console.log('\n۸) صفحهٔ امروز — میان‌بُرها');
  const tctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const t = await tctx.newPage();
  watch(t);
  await browserLogin(t, login.accessToken, { ui: UI });
  await t.goto(UI + '/app', { waitUntil: 'networkidle' });
  await t.locator('[data-today-favs]').waitFor({ timeout: 15000 }).catch(() => {});
  /* بازبینیِ UX (shell-13): خانه‌های خالی دیگر سه کادرِ بزرگ نیستند — یک دکمهٔ «+ افزودنِ میان‌بُر»
     که کشو را برای **اولین خانهٔ خالی** باز می‌کند. */
  ok('خانهٔ پُری نیست و دکمهٔ «+ افزودنِ میان‌بُر» یک‌بار هست',
    await t.locator('[data-today-favs] .td-fav.on').count() === 0 && await t.locator('[data-today-favs] [data-fav-add]').count() === 1);
  await t.locator('[data-fav-add]').click();
  const drawer = t.locator('.td-drawer');
  await drawer.waitFor({ timeout: 5000 }).catch(() => {});
  ok('«+» کشوی ابزارها را برای انتخابِ میان‌بُر باز کرد', (await drawer.locator('h2').innerText().catch(() => '')).includes('میان‌بُر'));
  const pathBefore = new URL(t.url()).pathname;
  const firstTile = drawer.locator('.td-tile').first();
  const tileLabel = (await firstTile.locator('.td-tile-label').innerText()).trim();
  const tp = t.waitForResponse((r) => r.url().includes('/auth/prefs') && r.request().method() === 'PATCH', { timeout: 8000 }).catch(() => null);
  await firstTile.click();
  await tp;
  const fav = t.locator('.td-fav.on[data-fav-slot="0"]');
  ok(`اولین خانه «${tileLabel}» شد`, await fav.count() === 1 && (await fav.innerText()).includes(tileLabel));
  await t.locator('.td-drawer').waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
  ok('کشو بسته شد و صفحه جابه‌جا نشد (انتخاب، نه بازکردنِ ابزار)',
    await t.locator('.td-drawer').count() === 0 && new URL(t.url()).pathname === pathBefore, `${pathBefore} → ${new URL(t.url()).pathname}`);
  await t.reload({ waitUntil: 'networkidle' });
  await t.locator('[data-today-favs]').waitFor({ timeout: 15000 }).catch(() => {});
  ok('**بعد از بارگذاریِ دوباره ماند** (سمتِ سرور)', await t.locator('.td-fav.on[data-fav-slot="0"]').count() === 1);
  const tp2 = t.waitForResponse((r) => r.url().includes('/auth/prefs') && r.request().method() === 'PATCH', { timeout: 8000 }).catch(() => null);
  await t.locator('.td-fav.on[data-fav-slot="0"] .td-fav-x').click();
  await tp2;
  ok('× خانه را خالی کرد', await t.locator('.td-fav.on').count() === 0
    && JSON.stringify((await send('/auth/prefs')).json?.todayPins) === '[null,null,null]');
  await tctx.close();

  ok('بدونِ خطای JS', errors.length === 0, errors[0]);
} catch (e) {
  fails.push('اجرا متوقف شد: ' + (e?.message ?? e));
  console.log('  ✘ اجرا متوقف شد: ' + (e?.stack ?? e));
} finally {
  await browser.close().catch(() => {});
  for (const id of trash) {
    try { for (const tb of ['vital_signs', 'visit_subforms']) sql(`DELETE FROM ${tb} WHERE visit_id=${id}`); } catch { /* نیست */ }
    await send(`/visits/${id}`, 'DELETE').catch(() => {});
  }
  for (const id of trashFields) await send(`/forms/fields/${id}`, 'DELETE').catch(() => {});
  if (prefs0) await send('/auth/prefs', 'PATCH', { subformPins: prefs0.subformPins, todayPins: prefs0.todayPins }).catch(() => {});
  await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => {});
  console.log('\nبرگشت به حوزهٔ قبلی');
}

console.log(`\n${pass} ✔  ${fails.length} ✘`);
if (fails.length) { console.log('\nقرمزها:'); for (const f of fails) console.log('  - ' + f); }
process.exit(fails.length ? 1 : 0);
