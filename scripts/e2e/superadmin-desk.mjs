/**
 * سوپرادمینِ بی‌محدودیت در میزِ پزشک (قانونِ ۲۹، خواستهٔ مالک ۱۴۰۵/۰۷/۰۳) —
 * سرورِ زنده + مرورگرِ واقعی.
 *
 * میزِ پزشک برای سوپرادمین همهٔ پزشکان را ادغام می‌کرد ولی نه می‌گفت هر ردیف مالِ کدام
 * پزشک است، نه می‌شد میزِ **یک** پزشک را دید، و «کارهای من»ش صفِ خودِ او بود نه پزشک.
 * برای دیدن یا انجامِ کارِ یک پزشک باید با حسابِ او وارد می‌شد.
 *
 *  باید بیفتد:
 *   - `GET /surgeon/desk` برای سوپرادمین `unrestricted: true` و فهرستِ پزشکان با `accountId`
 *   - `GET /surgeon/today` بی‌انتخاب: `team: true`، مراجعه‌ها و نتیجه‌های هر دو پزشک، هر ردیف
 *     با نامِ پزشکش (`doctor`) از سرور؛ `?surgeonId=` فقط همان پزشک + `doctorAccountId`
 *   - `/surgeon/visits` و `/surgeon/month` همان دامنه را با `surgeonId` می‌گیرند
 *   - سوپرادمین دستورِ پزشک را روی مراجعهٔ او ثبت می‌کند: در دیتابیس و ممیزی به نامِ خودش
 *   - رابط: «میزِ کدام پزشک؟»، تب‌های خنثی («امروز» نه «امروزِ من»)، راهنمای «نمای ناظر»،
 *     برچسبِ پزشک روی ردیف‌های ادغامی؛ با انتخابِ پزشک فقط میزِ او، نشانیِ `?doctor=`،
 *     و «کارهای <پزشک>» از صفِ همان پزشک — «انجام شد» روی کارِ او، بستن به نامِ سوپرادمین؛
 *     بی‌انتخاب «کارهای پزشکان» (نقشِ پزشک)، نه کلِ صفِ تیم
 *   - از همان میز: بررسیِ نتیجهٔ آزمایشِ بیمارِ پزشک، بازکردن و ذخیرهٔ فرمِ مراجعه، بیلانِ پزشک
 *   - در عرضِ گوشی (۳۹۰) نوارِ ناظر صفحه را افقی اسکرول نمی‌کند و انتخابگر ≥۴۴px است
 *  نباید بیفتد:
 *   - پزشکِ دیگر (سطح ۴) و ادمینِ سطح ۵: `unrestricted: false`، دادهٔ پزشکِ دیگر را نمی‌بینند،
 *     `surgeonId`ِ پزشکِ دیگر ۴۰۳ با پیامِ فارسی (شناسهٔ خودِ پزشک مجاز)، دستورِ مراجعهٔ دیگری ۴۰۴
 *   - میزِ پزشک برای خودش عوض نمی‌شود: «امروزِ من»، بی‌انتخابگر، بی‌برچسبِ پزشک — حتی با `?doctor=`
 *   - هیچ خطای JS/کنسول (هیچ ۴xx در مرورگر)
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { browserLogin } from './lib/browser-login.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));
const fa = (s) => /[؀-ۿ]/.test(String(s ?? ''));
const ids = (xs) => (Array.isArray(xs) ? xs : []).map((x) => x.id);
const until = async (fn, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) if (fn()) return true;
  return fn();
};

const loginAs = (identifier, password) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
}).then((r) => r.json());
const call = (token) => (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const login = await loginAs(process.env.E2E_USER ?? 'admin', process.env.E2E_PASS ?? 'test1234');
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
if (login.user?.level !== 6) { console.error(`این سوییت سوپرادمین می‌خواهد (سطحِ ${login.user?.level})`); process.exit(1); }
const send = call(login.accessToken);
const adminId = login.user.id;
const tag = 'sd' + randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const trash = { visits: [], accounts: [], appts: [] };
let vertical0 = 'ionm';

/* حساب از همان مسیرِ واقعیِ «کاربران ← حسابِ موقت»؛ نقشِ doctor تعریفِ جراح می‌سازد. */
const makeAccount = async (user, firstName, lastName, level, jobRole) => {
  const made = (await send('/accounts/temporary', 'POST', { firstName, lastName, phone: phone(), level, jobRole, username: `${user}${tag}` })).json;
  if (!made?.account?.id) throw new Error('حساب ساخته نشد: ' + JSON.stringify(made).slice(0, 160));
  trash.accounts.push(made.account.id);
  const personId = num(`SELECT person_id FROM accounts WHERE id=${made.account.id}`);
  const surgeonId = num(`SELECT coalesce((SELECT id FROM surgeons WHERE person_id=${personId}), 0)`);
  const session = await loginAs(`${user}${tag}`, made.temporaryPassword);
  if (!session.accessToken) throw new Error('ورودِ حسابِ آزمایشی نشد');
  return { id: made.account.id, personId, surgeonId, name: `${firstName} ${lastName}`, token: session.accessToken, api: call(session.accessToken) };
};

/* ماهِ شمسیِ امروز — برای `/surgeon/month` (همان منطقهٔ زمانیِ مطب). */
const jNow = Object.fromEntries(new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { year: 'numeric', month: 'numeric', timeZone: 'Asia/Tehran' })
  .formatToParts(new Date()).filter((p) => p.type !== 'literal').map((p) => [p.type, parseInt(p.value, 10)]));
const monthVisits = (r) => (r?.json?.days ?? []).reduce((s, d) => s + (d.visits ?? 0), 0);

let browser;
try {
  console.log('۰) داده: مطب، دو پزشک (سطح ۴)، ادمینِ سطح ۵، مراجعه/نتیجه/کار برای هر پزشک');
  vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
  const sw = await send('/config/vertical', 'PATCH', { vertical: 'clinic' });
  ok('سوییچ به مطب (میزِ پزشک با «امروز» و «نتایج»)', sw.status === 200 && sw.json?.vertical === 'clinic', `${sw.status}`);

  const d1 = await makeAccount('sd1', 'دکتر', `اول${tag}`, 4, 'doctor');
  const d2 = await makeAccount('sd2', 'دکتر', `دوم${tag}`, 4, 'doctor');
  const boss = await makeAccount('sdb', 'آزمونِ', `ادمین${tag}`, 5, 'secretary');
  ok('دو حسابِ پزشک به تعریفِ جراح وصل‌اند', d1.surgeonId > 0 && d2.surgeonId > 0, JSON.stringify([d1.surgeonId, d2.surgeonId]));

  const kinds = (await send('/forms/visit-kinds')).json ?? [];
  if (!kinds.some((k) => (k.kind ?? k.key) === 'clinic')) await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  const mk = async (surgeonId, last) => {
    const r = await send('/visits', 'POST', { kind: 'clinic', firstName: 'بیمارِ', lastName: `${last}${tag}`, phone: phone(), opDate: new Date().toISOString(), surgeonId });
    if (!r.json?.id) throw new Error(`مراجعه ساخته نشد: ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
    trash.visits.push(r.json.id);
    /* انتسابِ پزشک مستقیم — آزمون به فعال‌بودنِ فیلدِ جراح در فرمِ ویزیتِ این نصب گره نخورد. */
    sql(`UPDATE visits SET surgeon_id=${surgeonId} WHERE id=${r.json.id}`);
    return r.json;
  };
  const v1 = await mk(d1.surgeonId, 'اول');
  const v2 = await mk(d2.surgeonId, 'دوم');
  /* نوبتِ امروزِ بیمارِ پزشکِ دوم، بی `doctor_id` — همان‌طور که مسیرهای واقعی می‌نویسند. */
  const a2 = num(`INSERT INTO appointments (patient_id, date, seq, status, created_at, updated_at) VALUES (${v2.patientId}, CURRENT_DATE, 97, 'confirmed', now(), now()) RETURNING id`);
  trash.appts.push(a2);
  const lab = async (v, note) => {
    const o = (await send('/orders/lab', 'POST', { patientId: v.patientId, visitId: v.id, tests: ['CBC'], note })).json;
    if (!o?.id) throw new Error('سفارشِ آزمایش ساخته نشد: ' + JSON.stringify(o).slice(0, 160));
    await send(`/orders/lab/${o.id}/send`, 'POST');
    const a = await fetch(`${API}/public/order/${o.token}/answer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `Hb ۱۳ — ${note}`, link: '', user: '', pass: '' }),
    }).then((r) => r.json());
    return { ...o, answered: a?.status === 'answered' };
  };
  const o1 = await lab(v1, `${tag}-1`);
  const o2 = await lab(v2, `${tag}-2`);
  const W = (await d1.api('/work', 'POST', { title: `پیگیریِ پزشکِ اول ${tag}`, priority: 3 })).json?.id;
  ok('دو مراجعهٔ امروز، دو آزمایشِ پاسخ‌داده، یک نوبت و یک کارِ شخصیِ پزشکِ اول', v1?.id && v2?.id && o1.answered && o2.answered && a2 > 0 && Number.isInteger(W),
    JSON.stringify([v1?.id, v2?.id, o1.answered, o2.answered, W]));

  console.log('\n۱) API — سوپرادمین: همهٔ پزشکان، با برچسبِ «مالِ کدام پزشک»، یا یک پزشک');
  const desk = (await send('/surgeon/desk')).json;
  const doc1 = (desk?.doctors ?? []).find((d) => d.id === d1.surgeonId);
  const doc2 = (desk?.doctors ?? []).find((d) => d.id === d2.surgeonId);
  ok('`/surgeon/desk`: `unrestricted: true` و هر دو پزشک با نام و حساب', desk?.unrestricted === true && doc1?.name === d1.name && doc1?.accountId === d1.id && doc2?.accountId === d2.id,
    JSON.stringify([desk?.unrestricted, doc1, doc2]));
  /* دو پزشکِ این سوییت «خودِ» سوپرادمین نیستند: `me: false` و برچسبِ نمایشی همان نام. */
  ok('… برچسبِ نمایشی از سرور، و پزشکِ دیگر «خودم» نیست', doc1?.me === false && doc2?.me === false && doc1?.label === d1.name,
    JSON.stringify([doc1?.me, doc2?.me, doc1?.label]));

  const all = (await send('/surgeon/today')).json;
  const dayRow = (t, visitId) => (t?.day ?? []).find((r) => r.visitId === visitId);
  ok('بی‌انتخاب: `team: true` و مراجعه‌های امروزِ هر دو پزشک', all?.team === true && all?.unrestricted === true && all?.doctor === null && ids(all?.visits).includes(v1.id) && ids(all?.visits).includes(v2.id),
    JSON.stringify([all?.team, ids(all?.visits)]));
  ok('**هر ردیفِ ادغامی نامِ پزشکش را از سرور دارد**', dayRow(all, v1.id)?.doctor === d1.name && dayRow(all, v2.id)?.doctor === d2.name,
    JSON.stringify([dayRow(all, v1.id)?.doctor, dayRow(all, v2.id)?.doctor]));
  ok('… نوبتِ بی‌`doctor_id` با مراجعهٔ همان بیمار ادغام و برچسبِ پزشکِ دوم را دارد', dayRow(all, v2.id)?.apptId === a2, JSON.stringify(dayRow(all, v2.id)));
  const un = (t, id) => (t?.unreviewed ?? []).find((o) => o.kind === 'lab' && o.id === id);
  ok('نتیجه‌های بررسی‌نشدهٔ هر دو پزشک، هرکدام با نامِ پزشکش', un(all, o1.id)?.doctor === d1.name && un(all, o2.id)?.doctor === d2.name,
    JSON.stringify([un(all, o1.id)?.doctor, un(all, o2.id)?.doctor]));

  const one = (await send(`/surgeon/today?surgeonId=${d1.surgeonId}`)).json;
  ok('**`?surgeonId=` فقط میزِ همان پزشک** — مراجعه و نتیجهٔ پزشکِ دوم نیست', ids(one?.visits).includes(v1.id) && !ids(one?.visits).includes(v2.id) && !!un(one, o1.id) && !un(one, o2.id),
    JSON.stringify([ids(one?.visits), (one?.unreviewed ?? []).map((o) => o.id)]));
  ok('… با `team: false`، `doctor` و `doctorAccountId` (برای صفِ کارِ او)', one?.team === false && one?.unrestricted === true && one?.doctor?.id === d1.surgeonId && one?.doctor?.name === d1.name && one?.doctorAccountId === d1.id,
    JSON.stringify([one?.team, one?.doctor, one?.doctorAccountId]));
  ok('… و روی میزِ یک پزشک برچسبِ پزشک تکرار نمی‌شود', (one?.day ?? []).every((r) => r.doctor === null) && (one?.unreviewed ?? []).every((o) => o.doctor === null));

  const listAll = (await send(`/surgeon/visits?q=${encodeURIComponent(tag)}`)).json;
  const listOne = (await send(`/surgeon/visits?q=${encodeURIComponent(tag)}&surgeonId=${d1.surgeonId}`)).json;
  const lr = (l, id) => (l?.rows ?? []).find((r) => r.id === id);
  ok('`/surgeon/visits`: ادغامی با نامِ پزشک، و با `surgeonId` فقط همان پزشک', lr(listAll, v1.id)?.doctor === d1.name && lr(listAll, v2.id)?.doctor === d2.name && listAll?.team === true
    && !!lr(listOne, v1.id) && !lr(listOne, v2.id) && lr(listOne, v1.id)?.doctor === null && listOne?.doctor?.id === d1.surgeonId,
    JSON.stringify([ids(listAll?.rows), ids(listOne?.rows)]));
  const mAll = await send(`/surgeon/month?year=${jNow.year}&month=${jNow.month}`);
  const mOne = await send(`/surgeon/month?year=${jNow.year}&month=${jNow.month}&surgeonId=${d1.surgeonId}`);
  ok('`/surgeon/month` با `surgeonId`: نشانهٔ روزهای همان پزشک (زیرمجموعهٔ همه)', mAll.status === 200 && mOne.status === 200 && monthVisits(mOne) >= 1 && monthVisits(mOne) < monthVisits(mAll),
    `${mAll.status}/${mOne.status} ${monthVisits(mOne)} < ${monthVisits(mAll)}`);
  const fin = (await send(`/surgeon/finances?surgeonId=${d1.surgeonId}`)).json;
  ok('بیلانِ پزشکِ انتخاب‌شده', fin?.surgeon === d1.name && Array.isArray(fin?.rows), JSON.stringify(fin?.surgeon));
  const bad = await send('/surgeon/today?surgeonId=abc');
  ok('`surgeonId` نامعتبر ۴۰۰ با پیامِ فارسی', bad.status === 400 && fa(bad.json?.message), `${bad.status} ${JSON.stringify(bad.json?.message)}`);
  const ghost = await send('/surgeon/today?surgeonId=987654321');
  ok('پزشکِ ناموجود ۴۰۴ با پیامِ فارسی', ghost.status === 404 && fa(ghost.json?.message), `${ghost.status}`);

  const text = `دستورِ ناظر ${tag}`;
  const saved = await send(`/surgeon/visits/${v1.id}/instructions`, 'PATCH', { instructions: text });
  ok('**سوپرادمین دستورِ پزشک را روی مراجعهٔ او ثبت می‌کند**', saved.status === 200 && sql(`SELECT surgeon_instructions FROM visits WHERE id=${v1.id}`) === text, `${saved.status}`);
  ok('… و ممیزی با actor = سوپرادمین', num(`SELECT count(*) FROM audit_events WHERE action='surgeon.instructions' AND entity_id='${v1.id}' AND actor_id=${adminId}`) === 1);
  const byOwner = (await send(`/work?scope=inbox&owner=${d1.id}&limit=50`)).json;
  const wRow = (Array.isArray(byOwner) ? byOwner : []).find((w) => w.id === W);
  ok('صفِ کارِ پزشکِ اول (`owner=`) کارِ او را با برچسبِ مالک می‌دهد', !!wRow && wRow.ownerLabel === d1.name, JSON.stringify([ids(byOwner), wRow?.ownerLabel]));
  /* «کارهای پزشکان» در نمای ادغامی = نقشِ پزشک (کارِ شخصیِ پزشکی که خودش ساخته هم همین نقش را دارد). */
  const byRole = (await send('/work?scope=inbox&ownerRole=doctor&limit=300')).json;
  const rRow = (Array.isArray(byRole) ? byRole : []).find((w) => w.id === W);
  ok('صفِ «کارهای پزشکان» (`ownerRole=doctor`) کارِ پزشکِ اول را با نامِ او دارد', !!rRow && rRow.ownerLabel === d1.name, JSON.stringify([Array.isArray(byRole) ? byRole.length : byRole, rRow?.ownerLabel]));

  console.log('\n۲) API — نباید بیفتد: پزشکِ دیگر و ادمینِ سطح ۵ چیزِ تازه‌ای نمی‌بینند');
  const dd2 = (await d2.api('/surgeon/desk')).json;
  ok('پزشک: `unrestricted: false` و فهرستِ پزشکان خالی', dd2?.unrestricted === false && (dd2?.doctors ?? []).length === 0 && dd2?.selfSurgeonId === d2.surgeonId, JSON.stringify(dd2));
  const t2 = (await d2.api('/surgeon/today')).json;
  ok('میزِ پزشکِ دوم همان همیشگی: فقط مالِ خودش، بی‌برچسبِ پزشک، `team: false`', t2?.team === false && t2?.unrestricted === false && ids(t2?.visits).includes(v2.id) && !ids(t2?.visits).includes(v1.id)
    && (t2?.day ?? []).every((r) => r.doctor === null) && !un(t2, o1.id), JSON.stringify([t2?.team, ids(t2?.visits)]));
  for (const p of [`/surgeon/today?surgeonId=${d1.surgeonId}`, `/surgeon/visits?surgeonId=${d1.surgeonId}`, `/surgeon/month?year=${jNow.year}&month=${jNow.month}&surgeonId=${d1.surgeonId}`]) {
    const r = await d2.api(p);
    ok(`پزشک: ${p.split('?')[0]} با \`surgeonId\`ِ پزشکِ دیگر ۴۰۳ با پیامِ فارسی`, r.status === 403 && fa(r.json?.message), `${r.status} ${JSON.stringify(r.json?.message)}`);
  }
  const own = await d2.api(`/surgeon/today?surgeonId=${d2.surgeonId}`);
  ok('… ولی شناسهٔ خودش مجاز است و همان میزِ خودش را می‌دهد', own.status === 200 && ids(own.json?.visits).includes(v2.id) && !ids(own.json?.visits).includes(v1.id), `${own.status}`);
  const steal = await d2.api(`/surgeon/visits/${v1.id}/instructions`, 'PATCH', { instructions: `دزدی ${tag}` });
  ok('پزشک دستورِ مراجعهٔ پزشکِ دیگر را نمی‌نویسد (۴۰۴)', steal.status === 404 && sql(`SELECT surgeon_instructions FROM visits WHERE id=${v1.id}`) === text, `${steal.status}`);
  const f2 = (await d2.api(`/surgeon/finances?surgeonId=${d1.surgeonId}`)).json;
  ok('بیلان: پزشک با `surgeonId`ِ دیگری همچنان بیلانِ خودش را می‌گیرد (رفتارِ پیشین)', f2?.surgeon === d2.name, JSON.stringify(f2?.surgeon));
  const bd = (await boss.api('/surgeon/desk')).json;
  const bt = await boss.api(`/surgeon/today?surgeonId=${d1.surgeonId}`);
  ok('ادمینِ سطح ۵: `unrestricted: false` و میزِ پزشک ۴۰۳ با پیامِ فارسی', bd?.unrestricted === false && bt.status === 403 && fa(bt.json?.message), `${bd?.unrestricted} ${bt.status}`);
  const bw = await Promise.all([`/work?scope=inbox&ownerRole=doctor`, `/work?scope=inbox&owner=${d1.id}`].map((p) => boss.api(p)));
  ok('ادمینِ سطح ۵: صفِ کارِ پزشکان و صفِ پزشکِ اول ۴۰۳ با پیامِ فارسی', bw.every((r) => r.status === 403 && fa(r.json?.message)), bw.map((r) => r.status).join('/'));

  console.log('\n۳) مرورگر — میزِ سوپرادمین: نمای ناظر، انتخابِ پزشک، و کارِ پزشک از همین میز');
  browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const newPage = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, locale: 'fa-IR' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
    await browserLogin(page, token, { ui: UI });
    return page;
  };
  const page = await newPage(login.accessToken);
  await page.goto(`${UI}/app/surgeon`, { waitUntil: 'networkidle' });
  await page.locator('.sp-scope').waitFor({ timeout: 15000 });
  const vrow = (id) => page.locator(`.sp-row[data-visit-id="${id}"]`);
  await vrow(v2.id).waitFor({ timeout: 10000 });
  const tabText = (await page.locator('.sp-tabs button').allInnerTexts()).join('|');
  ok('تب‌های خنثی: «امروز» و «بیماران»، نه «امروزِ من»', tabText.includes('امروز') && tabText.includes('بیماران') && !tabText.includes('امروزِ من') && !tabText.includes('بیمارانِ من'), tabText);
  ok('راهنمای «نمای ناظر» و انتخابگر روی «همهٔ پزشکان»', (await page.locator('.sp-hint').first().innerText()).includes('نمای ناظر') && (await page.locator('.sp-scope .pk-btn').innerText()).includes('همهٔ پزشکان'));
  const tagOf = async (loc) => ((await loc.locator('.sp-doc').count()) ? loc.locator('.sp-doc').first().getAttribute('data-doctor') : null);
  ok('**ردیفِ هر مراجعه برچسبِ پزشکِ خودش را دارد**', (await tagOf(vrow(v1.id))) === d1.name && (await tagOf(vrow(v2.id))) === d2.name,
    JSON.stringify([await tagOf(vrow(v1.id)), await tagOf(vrow(v2.id))]));
  ok('… و ردیفِ نتیجهٔ بررسی‌نشده هم', (await tagOf(page.locator(`.sp-row[data-order-id="lab-${o2.id}"]`))) === d2.name);
  const teamWork = page.locator(`.wk-row[data-work-id="${W}"]`);
  await teamWork.waitFor({ timeout: 10000 }).catch(() => {});
  ok('**«کارهای پزشکان»: کارِ پزشکِ اول با برچسبِ نامِ او، بی‌انتخابِ پزشک**', (await page.locator('#sp-work-h').innerText()).trim() === 'کارهای پزشکان'
    && (await teamWork.count()) === 1 && (await teamWork.locator('[data-owner]').first().getAttribute('data-owner')) === d1.name,
    (await page.locator('#sp-work-h').innerText()).trim());

  await page.locator('.sp-scope .pk-btn').click();
  await page.locator('.pk-panel').waitFor({ timeout: 8000 });
  await page.locator('.pk-panel .pk-item', { hasText: d1.name }).click();
  const narrowed = await page.waitForFunction(({ a, b }) => !document.querySelector(`.sp-row[data-visit-id="${b}"]`) && !!document.querySelector(`.sp-row[data-visit-id="${a}"]`),
    { a: v1.id, b: v2.id }, { timeout: 10000 }).then(() => true).catch(() => false);
  ok('**با انتخابِ پزشکِ اول فقط میزِ او می‌ماند**', narrowed);
  ok('… نشانی `?doctor=` دارد (تازه‌سازی همان میز را باز می‌کند)', new URL(page.url()).searchParams.get('doctor') === String(d1.surgeonId), page.url());
  ok('… راهنما نامِ پزشک را می‌گوید و برچسبِ پزشک روی ردیف‌ها تکرار نمی‌شود', (await page.locator('.sp-hint').first().innerText()).includes(d1.name) && (await page.locator('.sp-rows .sp-doc').count()) === 0);
  const wrow = page.locator(`.wk-row[data-work-id="${W}"]`);
  await wrow.waitFor({ timeout: 10000 });
  ok(`**«کارهای ${d1.name}»: کارِ شخصیِ پزشک با برچسبِ نامِ او**`, (await page.locator('#sp-work-h').innerText()).trim() === `کارهای ${d1.name}` && (await wrow.locator('[data-owner]').first().getAttribute('data-owner')) === d1.name,
    (await page.locator('#sp-work-h').innerText()).trim());
  await wrow.locator('.wk-btn.primary').click();
  await wrow.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  const closed = await until(() => sql(`SELECT state || '|' || owner_account_id || '|' || coalesce(completed_by_id, 0) FROM work_items WHERE id=${W}`) === `done|${d1.id}|${adminId}`);
  ok('**«انجام شد» روی کارِ پزشک: بسته، مالک همان پزشک، بستن به نامِ سوپرادمین**', closed, sql(`SELECT state || '|' || owner_account_id || '|' || coalesce(completed_by_id, 0) FROM work_items WHERE id=${W}`));

  await vrow(v1.id).click();
  await page.locator('.db-sheet').waitFor({ timeout: 10000 });
  ok('کلیک روی مراجعهٔ پزشک فرمِ همان مراجعه را در میز باز می‌کند', (await page.locator('.db-sheet-head').innerText()).includes(v1.code), (await page.locator('.db-sheet-head').innerText()).slice(0, 80));
  await page.locator('.db-submit').click();
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  ok('… و «ذخیره» از میزِ ناظر می‌نشیند', (await page.locator('.db-sheet').count()) === 0);

  await page.locator('.sp-tabs button', { hasText: 'نتایجِ رسیده' }).click();
  const orow = page.locator(`.sp-row-order[data-order-id="lab-${o1.id}"]`);
  await orow.waitFor({ timeout: 10000 });
  ok('«نتایجِ رسیده» فقط نتیجهٔ بیمارِ پزشکِ اول', (await page.locator(`.sp-row-order[data-order-id="lab-${o2.id}"]`).count()) === 0);
  await orow.click();
  await page.locator('.od-sheet').waitFor({ timeout: 8000 });
  await page.locator('.od-review textarea').fill(`بررسیِ ناظر ${tag}`);
  await page.getByRole('button', { name: 'بررسی شد', exact: true }).click();
  await page.locator('.od-sheet').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  ok('**سوپرادمین نتیجهٔ بیمارِ پزشک را از میز بررسی می‌کند** (در سرور `reviewed`)', await until(() => sql(`SELECT status FROM lab_orders WHERE id=${o1.id}`) === 'reviewed'));

  await page.locator('.sp-tabs button', { hasText: 'بیلان' }).click();
  await page.locator('.sp-list .sp-card h2').first().waitFor({ timeout: 10000 });
  ok('بیلانِ پزشکِ انتخاب‌شده، بی‌انتخابگرِ دوم', (await page.locator('.sp-list .sp-card h2').first().innerText()).trim() === d1.name && (await page.locator('.sp-list select').count()) === 0);
  await page.locator('.sp-scope .pk-btn').click();
  await page.locator('.pk-panel .pk-clear').click();
  await page.locator('.sp-list .sp-empty').waitFor({ timeout: 10000 });
  ok('«همهٔ پزشکان» در بیلان: راهنمای انتخابِ پزشک، و نشانی بی `?doctor=`', (await page.locator('.sp-list .sp-empty').innerText()).includes('میزِ کدام پزشک') && !new URL(page.url()).searchParams.has('doctor'));

  /* عرضِ گوشی (قانونِ ۲۸): نوارِ ناظر و قرصِ پزشک نباید صفحه را افقی اسکرول کنند و انتخابگر
     باید هدفِ لمسیِ کامل داشته باشد. */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${UI}/app/surgeon`, { waitUntil: 'networkidle' });
  await vrow(v2.id).waitFor({ timeout: 15000 });
  const narrow = await page.evaluate(() => ({
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    pick: Math.round(document.querySelector('.sp-scope .pk-btn')?.getBoundingClientRect().height ?? 0),
  }));
  ok('موبایلِ ۳۹۰: بی‌اسکرولِ افقی، انتخابگرِ پزشک با هدفِ لمسیِ ≥۴۴px', narrow.over <= 1 && narrow.pick >= 44, JSON.stringify(narrow));

  console.log('\n۴) مرورگر — نباید بیفتد: میزِ پزشکِ دوم همان همیشگی، حتی با `?doctor=`ِ پزشکِ دیگر');
  const page2 = await newPage(d2.token);
  await page2.goto(`${UI}/app/surgeon?doctor=${d1.surgeonId}`, { waitUntil: 'networkidle' });
  await page2.locator(`.sp-row[data-visit-id="${v2.id}"]`).waitFor({ timeout: 15000 });
  const tab2 = (await page2.locator('.sp-tabs button').allInnerTexts()).join('|');
  ok('پزشک: بی‌انتخابگر، «امروزِ من»، بی‌برچسبِ پزشک', (await page2.locator('.sp-scope').count()) === 0 && tab2.includes('امروزِ من') && (await page2.locator('.sp-doc').count()) === 0, tab2);
  ok('… و مراجعهٔ پزشکِ اول در میزش نیست', (await page2.locator(`.sp-row[data-visit-id="${v1.id}"]`).count()) === 0);
  ok('هیچ خطای JS/کنسول (هیچ ۴xx)', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser?.close().catch(() => {});
  sql(`DELETE FROM appointments WHERE id IN (${trash.appts.join(',') || -1})`);
  sql(`DELETE FROM work_items WHERE title LIKE '%${tag}%'`);
  for (const v of trash.visits) {
    sql(`DELETE FROM work_items WHERE visit_id=${v}`);
    sql(`DELETE FROM domain_events WHERE visit_id=${v}`);
    sql(`DELETE FROM reminders WHERE visit_id=${v}`);
    await send(`/visits/${v}`, 'DELETE').catch(() => {});
  }
  if (trash.accounts.length) {
    const acc = trash.accounts.join(',');
    sql(`UPDATE visits SET surgeon_id=NULL WHERE surgeon_id IN (SELECT id FROM surgeons WHERE person_id IN (SELECT person_id FROM accounts WHERE id IN (${acc})))`);
    sql(`DELETE FROM work_items WHERE owner_account_id IN (${acc})`);
    sql(`DELETE FROM account_sessions WHERE account_id IN (${acc})`);
    sql(`DELETE FROM surgeons WHERE person_id IN (SELECT person_id FROM accounts WHERE id IN (${acc}))`);
    sql(`DELETE FROM people WHERE id IN (SELECT person_id FROM accounts WHERE id IN (${acc}))`);
  }
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  ok('برگشت به حوزهٔ قبلی', back.status === 200, `${back.status} ${vertical0}`);
}

console.log(`\nقبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
