/**
 * میزِ پزشک در مطب — جداییِ بیشترِ مدلِ شرکتی/مطبی (بازخوردِ مالک ۱۴۰۵/۰۶/۲۹، بستهٔ ۵،
 * بندهای ۱۰ و ۱۱) — سرورِ زنده + مرورگرِ واقعی.
 *
 *  باید بیفتد:
 *   - سوییچ به مطب کاشیِ `surgeon` را روشن می‌کند و `/features` دیگر آن را برای مطب هاردکد رد نمی‌کند؛
 *     ماژول‌های شرکتی (چینش/کارشناسی/انبار) در مطب خاموش می‌مانند
 *   - حسابِ پزشک (نقشِ doctor) در مطب هم به تعریفِ جراح وصل می‌شود
 *   - `GET /surgeon/today` فقط نوبت‌ها (بدونِ اتکا به ستونی که هیچ مسیرِ واقعی‌ای پر نمی‌کند)،
 *     مراجعه‌ها و نتیجه‌های همین پزشک؛ `GET /surgeon/visits` همهٔ
 *     نوع‌ها (ویزیت و عمل) با `patientId`/`kind`، فقط مالِ او
 *   - پزشکی که ماژولِ «بیماران» را دارد (پلانِ مطب: از سطح ۴) از خودِ میز ویزیت را باز و ذخیره
 *     می‌کند و نتیجه را بررسی می‌کند — با همان پاپ‌آپ‌های مشترک، بدونِ فرمِ تازه
 *   - حسابِ پایین‌ترِ متصل به جراح: دامنهٔ «امروز» و پرتال با `surgeonId` (own-scope)، و میزِ
 *     فقط‌خواندنی بدونِ هیچ ۴۰۳ی
 *   - کاشیِ لانچر و h1 صفحه در مطب «میزِ پزشک» است
 *   - (۵ب) صفحهٔ «امروز» در مطب «ویزیت» می‌گوید نه «عمل»، و «مراجعهٔ جدید» با نوعِ ویزیت باز می‌شود
 *     (`defaultKind` از `/config`، نه هاردکدِ کلاینت)
 *   - migrationِ `clinic_surgeon_feature` روی نصبی که **از قبل** روی مطب است کاشی را روشن کند
 *     (پلانِ حوزه فقط هنگامِ عوض‌کردنِ حوزه اعمال می‌شود — بدونِ این migration مشتریِ فعلی میز را نمی‌بیند)
 *  نباید بیفتد:
 *   - برگشت به حوزهٔ قبلی همه‌چیز را برمی‌گرداند؛ هیچ خطای JS/کنسول در هیچ‌کدام از دو میز
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
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
const num = (q) => Number(sql(q));
const plusD = (n) => new Date(Date.now() + n * 864e5);
const ids = (xs) => (Array.isArray(xs) ? xs : []).map((x) => x.id);

const loginAs = (identifier, password) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
}).then((r) => r.json());
const call = (token) => (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const login = await loginAs(process.env.E2E_USER ?? 'admin', process.env.E2E_PASS ?? 'test1234');
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = call(login.accessToken);
const tag = 'cd' + randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const trash = { visits: [], accounts: [], appts: [] };
let vertical0 = 'ionm';

const answerLab = (token, text) => fetch(`${API}/public/order/${token}/answer`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, link: '', user: '', pass: '' }),
}).then((r) => r.json());

/* حسابِ پزشک از همان مسیرِ واقعیِ «کاربران ← حسابِ موقت» — نقشِ doctor باید تعریفِ جراح بسازد. */
const makeDoctor = async (user, last, level) => {
  const made = (await send('/accounts/temporary', 'POST', { firstName: 'دکتر', lastName: `${last}${tag}`, phone: phone(), level, jobRole: 'doctor', username: `${user}${tag}` })).json;
  if (!made?.account?.id) throw new Error('حسابِ پزشک ساخته نشد: ' + JSON.stringify(made).slice(0, 160));
  trash.accounts.push(made.account.id);
  const personId = num(`SELECT person_id FROM accounts WHERE id=${made.account.id}`);
  const surgeonId = num(`SELECT coalesce((SELECT id FROM surgeons WHERE person_id=${personId}), 0)`);
  const session = await loginAs(`${user}${tag}`, made.temporaryPassword);
  return { id: made.account.id, personId, surgeonId, token: session.accessToken, api: call(session.accessToken) };
};

let browser;
try {
  console.log('۱) مطب: سوییچِ حوزه، کاشیِ پزشک، حسابِ پزشک ↔ تعریفِ جراح');
  vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
  const sw = await send('/config/vertical', 'PATCH', { vertical: 'clinic' });
  ok('سوییچ به مطب', sw.status === 200 && sw.json?.vertical === 'clinic', `${sw.status} ${JSON.stringify(sw.json).slice(0, 100)}`);
  const feats = (await send('/features')).json ?? [];
  const fSurgeon = feats.find((f) => f.key === 'surgeon');
  ok('**کاشیِ `surgeon` در مطب روشن و مجاز است** (تا دیروز برای مطب هاردکد رد می‌شد)', fSurgeon?.enabled === true && fSurgeon.minLevel === 2 && fSurgeon.allowed === true, JSON.stringify(fSurgeon));
  const cfg = (await send('/config')).json;
  ok('پیش‌فرضِ نوعِ «مراجعهٔ جدید» در مطب ویزیت است (`defaultKind` از سرور)', cfg?.defaultKind === 'clinic', JSON.stringify(cfg?.defaultKind));
  const corp = ['dispatch', 'tech', 'inventory'].map((k) => [k, feats.find((f) => f.key === k)?.enabled]);
  ok('ماژول‌های شرکتی در مطب خاموش‌اند (چینش / کارشناسی / انبار)', corp.every(([, e]) => e === false), JSON.stringify(corp));

  /* نصبی که **پیش از** بستهٔ ۵ روی مطب رفته، `features.surgeon` را خاموش گرفته و
     افزودنِ کلید به پلانِ کد آن را روشن نمی‌کند (پلان فقط در `setVertical` اعمال
     می‌شود). این‌جا همان حالت ساخته می‌شود و خودِ SQLِ migration اجرا می‌شود. */
  sql(`UPDATE features SET enabled=false WHERE key='surgeon'`);
  const beforeMig = (await send('/features')).json?.find((f) => f.key === 'surgeon');
  ok('بازسازیِ حالتِ نصبِ قدیمی: کاشیِ پزشک خاموش است', beforeMig?.enabled === false, JSON.stringify(beforeMig?.enabled));
  execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1 -f server/prisma/migrations/20260921070000_clinic_surgeon_feature/migration.sql`);
  const afterMig = (await send('/features')).json?.find((f) => f.key === 'surgeon');
  ok('**migration کاشی را روی نصبِ مطبِ موجود روشن می‌کند** (وگرنه میز برای مشتریِ فعلی نامرئی می‌ماند)', afterMig?.enabled === true && afterMig.minLevel === 2, JSON.stringify(afterMig));
  /* و نباید بیفتد: روی نصبِ غیرِ مطب هیچ کاری نکند. */
  sql(`UPDATE features SET enabled=false WHERE key='surgeon'`);
  sql(`UPDATE settings SET value='ionm' WHERE key='vertical'`);
  execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1 -f server/prisma/migrations/20260921070000_clinic_surgeon_feature/migration.sql`);
  ok('**نباید بیفتد:** روی نصبِ غیرِ مطب migration کاشی را روشن نمی‌کند', sql(`SELECT enabled FROM features WHERE key='surgeon'`) === 'f');
  sql(`UPDATE settings SET value='clinic' WHERE key='vertical'`);
  sql(`UPDATE features SET enabled=true WHERE key='surgeon'`);

  const d1 = await makeDoctor('d1', 'اول', 4);
  const d2 = await makeDoctor('d2', 'دوم', 4);
  const d3 = await makeDoctor('d3', 'سوم', 3);
  ok('**حسابِ پزشک در مطب هم به تعریفِ جراح وصل می‌شود** و با رمزِ موقت وارد می‌شود', d1.surgeonId > 0 && d2.surgeonId > 0 && d3.surgeonId > 0 && !!d1.token && !!d3.token, JSON.stringify([d1.surgeonId, d2.surgeonId, d3.surgeonId]));

  console.log('\n۲) داده: ویزیت‌های امروز، عملِ فردا، نوبت‌ها، نتیجه‌های آزمایش');
  const kinds = (await send('/forms/visit-kinds')).json ?? [];
  if (!kinds.some((k) => (k.kind ?? k.key) === 'clinic')) await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  const hospital = (await send('/hospitals')).json?.[0];
  const mk = async (kind, surgeonId, last, opDate, extra = {}) => {
    const r = await send('/visits', 'POST', { kind, firstName: 'بیمارِ', lastName: `${last}${tag}`, phone: phone(), opDate, surgeonId, ...extra });
    if (!r.json?.id) throw new Error(`مراجعه ساخته نشد: ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
    trash.visits.push(r.json.id);
    /* انتسابِ پزشک را مستقیم می‌نشانیم تا آزمون به فعال‌بودنِ فیلدِ جراح در فرمِ ویزیتِ این نصب گره نخورد. */
    sql(`UPDATE visits SET surgeon_id=${surgeonId} WHERE id=${r.json.id}`);
    return r.json;
  };
  const v1 = await mk('clinic', d1.surgeonId, 'اول', new Date().toISOString());
  const v2 = await mk('clinic', d2.surgeonId, 'دوم', new Date().toISOString());
  const v3 = await mk('surgery', d1.surgeonId, 'عمل', plusD(1).toISOString(), hospital ? { hospitalId: hospital.id } : {});
  const v4 = await mk('clinic', d3.surgeonId, 'سوم', new Date().toISOString());
  ok('چهار مراجعه (دو ویزیتِ امروز و یک عملِ فردا برای پزشکِ اول، یکی برای پزشکِ دوم، یکی برای حسابِ سطح ۳)', [v1, v2, v3, v4].every((v) => v?.id));

  const lab = async (v, note) => {
    const o = (await send('/orders/lab', 'POST', { patientId: v.patientId, visitId: v.id, tests: ['CBC'], note })).json;
    if (!o?.id) throw new Error('سفارشِ آزمایش ساخته نشد: ' + JSON.stringify(o).slice(0, 160));
    await send(`/orders/lab/${o.id}/send`, 'POST');
    const a = await answerLab(o.token, `Hb ۱۳ — ${note}`);
    return { ...o, answered: a?.status === 'answered' };
  };
  const o1 = await lab(v1, `${tag}-1`);
  const o2 = await lab(v1, `${tag}-2`);
  const oOther = await lab(v2, `${tag}-other`);
  ok('سه آزمایشِ پاسخ‌داده (دو تا برای بیمارِ پزشکِ اول، یکی برای بیمارِ پزشکِ دوم)', o1.answered && o2.answered && oOther.answered);
  /* ⚠️ **عمداً بدونِ `doctor_id`** — دقیقاً همان‌طور که مسیرهای واقعی می‌نویسند
     (`appointments.service.walkIn` و `intake.service` هیچ‌کدام آن ستون را پر
     نمی‌کنند). نسخهٔ اولِ این سوییت `doctor_id` را دستی می‌گذاشت و برای همین
     سنجه‌اش توتولوژیک بود: سرور روی همان ستون فیلتر می‌کرد و سبز می‌شد، در حالی
     که روی نصبِ واقعی «نوبت‌های امروز» همیشه خالی بود. */
  const appt = (patientId, seq) => {
    const id = num(`INSERT INTO appointments (patient_id, date, seq, status, created_at, updated_at) VALUES (${patientId}, CURRENT_DATE, ${seq}, 'confirmed', now(), now()) RETURNING id`);
    trash.appts.push(id); return id;
  };
  const a1 = appt(v1.patientId, 91);
  const a2 = appt(v2.patientId, 92);

  console.log('\n۳) API — پزشکِ اول فقط مالِ خودش را می‌بیند و از میز کار می‌کند');
  const f1 = (await d1.api('/features')).json ?? [];
  ok('برای پزشکِ سطح ۴ کاشیِ `surgeon` و ماژولِ «بیماران» (پلانِ مطب) مجازند', f1.find((f) => f.key === 'surgeon')?.allowed === true && f1.find((f) => f.key === 'dashboard')?.allowed === true, JSON.stringify(f1.filter((f) => ['surgeon', 'dashboard'].includes(f.key)).map((f) => [f.key, f.allowed, f.reason])));
  const t1 = (await d1.api('/surgeon/today')).json;
  ok('`/surgeon/today` مراجعه‌های امروزِ او: فقط v1 (نه بیمارِ پزشکِ دیگر، نه عملِ فردا)', ids(t1?.visits).includes(v1.id) && !ids(t1?.visits).includes(v2.id) && !ids(t1?.visits).includes(v3.id) && !ids(t1?.visits).includes(v4.id), JSON.stringify(ids(t1?.visits)));
  const tv1 = t1?.visits?.find((v) => v.id === v1.id);
  ok('… با نام و نوعِ مراجعه و شناسهٔ پرونده', tv1?.patient?.fullName === `بیمارِ اول${tag}` && tv1?.kind === 'clinic' && tv1?.patientId === v1.patientId, JSON.stringify(tv1));
  ok('**نوبتِ امروزِ بیمارِ او می‌آید** (بدونِ `doctor_id` — همان‌طور که مسیرِ واقعی می‌نویسد) و نوبتِ بیمارِ پزشکِ دیگر نمی‌آید', ids(t1?.appointments).includes(a1) && !ids(t1?.appointments).includes(a2), JSON.stringify(ids(t1?.appointments)));
  const unrev = (t1?.unreviewed ?? []).filter((o) => o.kind === 'lab').map((o) => o.id);
  ok('نتیجه‌های بررسی‌نشده: هر دو آزمایشِ بیمارِ او، نه آزمایشِ بیمارِ پزشکِ دیگر', unrev.includes(o1.id) && unrev.includes(o2.id) && !unrev.includes(oOther.id), JSON.stringify(unrev));
  const l1 = (await d1.api('/surgeon/visits')).json;
  ok('`/surgeon/visits` همهٔ نوع‌ها (ویزیت + عمل) فقط مالِ او، با patientId و kind', ids(l1?.rows).includes(v1.id) && ids(l1?.rows).includes(v3.id) && !ids(l1?.rows).includes(v2.id) && !ids(l1?.rows).includes(v4.id) && (l1?.rows ?? []).every((r) => Number.isInteger(r.patientId) && typeof r.kind === 'string') && l1?.workflow === 'clinic', JSON.stringify(ids(l1?.rows)));
  const rv = await d1.api(`/orders/lab/${o1.id}/review`, 'POST', { status: 'reviewed', reviewNote: 'نرمال' });
  ok('پزشک نتیجه را از API بررسی می‌کند (همان مجوزِ «ویرایشِ مراجعه» که پلانِ مطب به سطحش داده)', rv.status === 200 || rv.status === 201, `${rv.status} ${JSON.stringify(rv.json).slice(0, 100)}`);
  ok('… و از فهرستِ بررسی‌نشده‌ها می‌رود', !((await d1.api('/surgeon/today')).json?.unreviewed ?? []).some((o) => o.kind === 'lab' && o.id === o1.id));

  console.log('\n۴) API — حسابِ سطحِ پایین‌ترِ متصل به جراح: دامنه با surgeonId، بدونِ ماژولِ «بیماران»');
  const f3 = (await d3.api('/features')).json ?? [];
  ok('کاشیِ پزشک مجاز، ماژولِ «بیماران» نه (پلانِ مطب از سطح ۴)', f3.find((f) => f.key === 'surgeon')?.allowed === true && f3.find((f) => f.key === 'dashboard')?.allowed === false, JSON.stringify(f3.filter((f) => ['surgeon', 'dashboard'].includes(f.key)).map((f) => [f.key, f.allowed, f.reason])));
  const t3 = (await d3.api('/surgeon/today')).json;
  ok('`/surgeon/today` فقط مراجعهٔ خودش', ids(t3?.visits).length === 1 && ids(t3?.visits)[0] === v4.id, JSON.stringify(ids(t3?.visits)));
  const w3 = (await d3.api('/work/today')).json;
  ok('**صفحهٔ «امروز» هم مراجعه‌های خودِ او را می‌آورد** (own-scope با surgeonId، نه فقط techId)', w3?.sections?.visits === true && ids(w3?.visits).includes(v4.id) && !ids(w3?.visits).includes(v1.id), JSON.stringify([w3?.sections?.visits, ids(w3?.visits)]));
  ok('APIِ مراجعه برایش بسته است (۴۰۳) — پس میز باید فقط‌خواندنی باشد، نه پاپ‌آپِ شکسته', (await d3.api(`/visits/${v4.id}`)).status === 403);

  console.log('\n۵) مرورگر — میزِ پزشک: نام، تب‌ها، ردیف‌ها و پاپ‌آپ‌ها');
  browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const newPage = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, locale: 'fa-IR' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
    await browserLogin(page, token, { ui: UI });
    return page;
  };
  const page = await newPage(d1.token);
  await page.goto(`${UI}/app/surgeon`, { waitUntil: 'networkidle' });
  await page.locator('.sp-page h1').waitFor({ timeout: 15000 });
  ok('h1 و عنوانِ صفحه «میزِ پزشک»', (await page.locator('.sp-page h1').innerText()).trim() === 'میزِ پزشک' && (await page.title()).includes('میزِ پزشک'), await page.title());
  const tabs = page.locator('.sp-tabs button');
  const tabText = (await tabs.allInnerTexts()).join('|');
  ok('**چهار تب: امروزِ من · بیمارانِ من · نتایجِ رسیده · بیلان**', (await tabs.count()) === 4 && tabText.includes('امروزِ من') && tabText.includes('بیمارانِ من') && tabText.includes('نتایجِ رسیده') && tabText.includes('بیلان'), tabText);
  const vrow = page.locator(`button.sp-row[data-visit-id="${v1.id}"]`);
  await vrow.waitFor({ timeout: 10000 });
  ok('ردیفِ مراجعهٔ امروز دکمه است و نامِ بیمار و نوعِ مراجعه را دارد', (await vrow.innerText()).includes(`بیمارِ اول${tag}`) && (await vrow.innerText()).includes('ویزیت'), await vrow.innerText());
  await vrow.click();
  await page.locator('.db-sheet').waitFor({ timeout: 10000 });
  ok('**کلیک روی مراجعه فرمِ همان مراجعه را در خودِ میز باز می‌کند**', (await page.locator('.db-sheet-head').innerText()).includes(v1.code), `${v1.code} ← ${(await page.locator('.db-sheet-head').innerText()).slice(0, 80)}`);
  await page.locator('.db-submit').click();
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 10000 });
  ok('… و «ذخیره» از میز می‌نشیند (فرم بسته شد، بدونِ خطا)', (await page.locator('.db-sheet').count()) === 0 && !errors.length, errors.slice(0, 2).join(' | '));
  const arow = page.locator(`button.sp-row[data-appt-id="${a1}"]`);
  ok('ردیفِ نوبتِ امروز دکمه است', (await arow.count()) === 1);
  await arow.click();
  await page.locator('.rc-pop').waitFor({ timeout: 8000 });
  ok('… و پاپ‌آپِ نوبت باز می‌شود', (await page.locator('.rc-pop').innerText()).includes('نوبت'));
  await page.locator('.rc-pop header button').click();
  await page.locator('.rc-pop').waitFor({ state: 'detached', timeout: 8000 });

  await page.locator('.sp-tabs button', { hasText: 'نتایجِ رسیده' }).click();
  const orow = page.locator(`button.sp-row-order[data-order-id="lab-${o2.id}"]`);
  await orow.waitFor({ timeout: 10000 });
  ok('در «نتایجِ رسیده» فقط آزمایشِ بررسی‌نشدهٔ بیمارِ او مانده', (await page.locator('.sp-row-order').count()) === 1);
  await orow.click();
  await page.locator('.od-sheet').waitFor({ timeout: 8000 });
  ok('کلیک شیتِ همان سفارش را باز می‌کند', (await page.locator('.od-sheet').innerText()).includes('آزمایش'));
  await page.locator('.od-review textarea').fill('نرمال — از میزِ پزشک');
  await page.getByRole('button', { name: 'بررسی شد', exact: true }).click();
  await page.locator('.od-sheet').waitFor({ state: 'detached', timeout: 8000 });
  await page.waitForFunction(() => document.querySelectorAll('.sp-row-order').length === 0, null, { timeout: 8000 }).catch(() => {});
  ok('**«بررسی شد» از شیت، ردیف را همان لحظه می‌برد**', (await page.locator('.sp-row-order').count()) === 0);
  ok('… و در سرور بررسی‌شده است', sql(`SELECT status FROM lab_orders WHERE id=${o2.id}`) === 'reviewed');

  await page.locator('.sp-tabs button', { hasText: 'بیمارانِ من' }).click();
  await page.locator('.sp-list .sp-card').first().waitFor({ timeout: 10000 });
  ok('«بیمارانِ من»: ویزیت و عملِ خودش، نه بیمارانِ دیگران', (await page.locator('.sp-list .sp-card').count()) === 2 && (await page.locator(`.sp-card[data-visit-id="${v3.id}"]`).count()) === 1 && (await page.locator(`.sp-card[data-visit-id="${v2.id}"]`).count()) === 0, String(await page.locator('.sp-list .sp-card').count()));
  await page.locator(`.sp-card[data-visit-id="${v3.id}"] .sp-open`).click();
  await page.locator('.db-sheet').waitFor({ timeout: 10000 });
  ok('نامِ بیمار در کارت فرمِ عمل را باز می‌کند (با سه تبِ قبل / حین / بعد)', (await page.locator('.db-sheet .db-postop .ui-tabs button').count()) === 3);
  await page.locator('.db-sheet .db-x').first().click();
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 8000 });

  await page.goto(`${UI}/app/tools`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lx-hero-ic, .lx-card-ic, .lx-tile-ic', { timeout: 15000 }).catch(() => {});
  ok('کاشیِ لانچر «میزِ پزشک» است، نه «پرتال جراح»', (await page.getByText('میزِ پزشک', { exact: true }).count()) >= 1 && (await page.getByText('پرتال جراح', { exact: true }).count()) === 0);

  console.log('\n۵ب) واژه‌های مطب در «امروز» و پیش‌فرضِ «مراجعهٔ جدید»');
  await page.goto(`${UI}/app`, { waitUntil: 'networkidle' });
  await page.locator('.td-hello').waitFor({ timeout: 15000 });
  const chips = (await page.locator('.td-chips').innerText()).replace(/\s+/g, ' ');
  ok('چیپِ خلاصه «ویزیتِ امروز» می‌گوید، نه «عملِ امروز»', /ویزیتِ امروز/.test(chips) && !/عملِ امروز/.test(chips), chips.slice(0, 120));
  const vsec = page.locator('.td-sec', { hasText: 'ویزیت‌های امروز' });
  ok('بخشِ مراجعه‌های امروز «ویزیت‌های امروز» است و بیمارِ او را دارد', (await vsec.count()) === 1 && (await vsec.locator('.td-item', { hasText: `اول${tag}` }).count()) === 1, String(await page.locator('.td-sec h2').allInnerTexts()));
  await page.goto(`${UI}/app/patients/${v1.patientId}`, { waitUntil: 'networkidle' });
  await page.locator('.rc-actions .rc-act.is-main').waitFor({ timeout: 15000 });
  ok('دکمهٔ پرونده «ویزیتِ جدید» است (واژگانِ مطب)', (await page.locator('.rc-actions .rc-act.is-main').innerText()).includes('ویزیتِ جدید'));
  await page.locator('.rc-actions .rc-act.is-main').click();
  /* از پرونده فرم با بیمارِ از پیش‌انتخاب‌شده مستقیم روی گامِ ۳ باز می‌شود (ردیفِ نوع در گامِ ۲ است)؛
     نوع از برچسبِ تاریخ («تاریخِ ویزیت» نه «تاریخِ عمل») و نبودنِ تب‌های قبل/حین/بعد خوانده می‌شود. */
  await page.locator('.db-sheet').waitFor({ timeout: 10000 });
  await page.waitForFunction(() => /تاریخِ (ویزیت|عمل)/.test(document.querySelector('.db-sheet')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => {});
  const sheetTxt = await page.locator('.db-sheet').innerText();
  ok('**«مراجعهٔ جدید» در مطب با نوعِ ویزیت باز می‌شود، نه عمل** (برچسبِ «تاریخِ ویزیت»، بدونِ تب‌های عمل)', /تاریخِ ویزیت/.test(sheetTxt) && !/تاریخِ عمل/.test(sheetTxt) && (await page.locator('.db-sheet .db-postop .ui-tabs').count()) === 0, sheetTxt.replace(/\s+/g, ' ').slice(0, 140));
  await page.locator('.db-sheet .db-x').first().click();
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 8000 });

  console.log('\n۶) مرورگر — میزِ فقط‌خواندنی برای حسابِ بدونِ ماژولِ «بیماران»: هیچ ۴۰۳، هیچ دکمهٔ شکسته');
  const page3 = await newPage(d3.token);
  await page3.goto(`${UI}/app/surgeon`, { waitUntil: 'networkidle' });
  await page3.locator(`.sp-row[data-visit-id="${v4.id}"]`).waitFor({ timeout: 15000 });
  ok('ردیفِ مراجعه متن است نه دکمه (`is-static`)', (await page3.locator(`div.sp-row.is-static[data-visit-id="${v4.id}"]`).count()) === 1 && (await page3.locator(`button.sp-row[data-visit-id="${v4.id}"]`).count()) === 0);
  ok('راهنمای فقط‌خواندنی نامِ ماژولِ لازم را می‌گوید', (await page3.locator('.sp-hint-ro').count()) === 1 && (await page3.locator('.sp-hint-ro').innerText()).includes('بیماران'));
  ok('هیچ خطای JS/کنسول در هیچ‌کدام از دو میز (هیچ ۴۰۳ی)', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser?.close().catch(() => {});
  sql(`DELETE FROM appointments WHERE id IN (${trash.appts.join(',') || -1})`);
  for (const v of trash.visits) {
    sql(`DELETE FROM work_items WHERE visit_id=${v}`);
    sql(`DELETE FROM domain_events WHERE visit_id=${v}`);
    sql(`DELETE FROM reminders WHERE visit_id=${v}`);
    await send(`/visits/${v}`, 'DELETE').catch(() => {});
  }
  if (trash.accounts.length) {
    const acc = trash.accounts.join(',');
    sql(`UPDATE visits SET surgeon_id=NULL WHERE surgeon_id IN (SELECT id FROM surgeons WHERE person_id IN (SELECT person_id FROM accounts WHERE id IN (${acc})))`);
    sql(`DELETE FROM account_sessions WHERE account_id IN (${acc})`);
    sql(`DELETE FROM surgeons WHERE person_id IN (SELECT person_id FROM accounts WHERE id IN (${acc}))`);
    sql(`DELETE FROM people WHERE id IN (SELECT person_id FROM accounts WHERE id IN (${acc}))`);
  }
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  const f0 = (await send('/features')).json ?? [];
  ok('**نباید بیفتد:** برگشت به حوزهٔ قبلی — `surgeon` روشن و ماژول‌های شرکتی دوباره فعال', back.status === 200 && f0.find((f) => f.key === 'surgeon')?.enabled === true && (vertical0 !== 'ionm' || f0.find((f) => f.key === 'dispatch')?.enabled === true), `${back.status} ${vertical0}`);
  ok('… و پیش‌فرضِ نوعِ مراجعه دوباره عمل است', vertical0 === 'clinic' || (await send('/config')).json?.defaultKind === 'surgery');
}

console.log(`\nقبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
