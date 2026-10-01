/**
 * سوپرادمینِ بی‌محدودیت در پرتال‌های میدانی — پنلِ کارشناسی و حمل‌ونقل
 * (خواستهٔ مالک ۱۴۰۵/۰۷/۰۳، قانونِ ۲۹) — سرورِ زنده + مرورگرِ واقعی.
 *
 * درسِ واقعی: پنلِ کارشناسی عملِ همه را به سوپرادمین نشان می‌داد ولی هر دکمه‌اش
 * «این عمل در کارهای شما نیست» می‌داد، پذیرش فقط به نامِ خودش بود، و «ثبتِ تحویل»
 * در حمل‌ونقل فقط برای خودِ راننده باز بود. یعنی مالک برای هر کاری باید پروفایل
 * عوض می‌کرد یا از کسِ دیگری می‌خواست وارد شود.
 *
 *  باید بیفتد:
 *   - دفترِ کار برای سوپرادمین `team: true` است، هر ردیف با نام و کلیدِ صاحبش؛ برنامهٔ حضورِ
 *     **همهٔ** کارشناسان با مراجعه‌های آزادشان می‌آید
 *   - ثبتِ ساعت و گزارشِ عمل روی عملِ کارشناسِ دیگر کار می‌کند و ردِ ممیزی بازیگر را خودِ
 *     سوپرادمین نشان می‌دهد؛ ردیفِ برگشتی همان عمل است
 *   - «پذیرش» از کارتِ حضورِ کارشناسِ دیگر، مراجعه را به نامِ **همان کارشناس** می‌نشاند
 *     (نه سوپرادمین) — در مرورگر، با فیلترِ نفر
 *   - «ثبتِ تحویل» روی توقفِ رانندهٔ دیگر کار می‌کند (API و مرورگر، با شیتِ «از طرفِ …»)
 *     و پاسخ همچنان نمای همهٔ مسیرهاست
 *  نباید بیفتد:
 *   - کارشناسِ سطح ۲ کار یا برنامهٔ حضورِ کارشناسِ دیگر را ببیند یا رویش بنویسد، یا با
 *     `dutyId` به نامِ دیگری پذیرش بزند (۴۰۳)؛ پذیرشِ عادیِ خودش همچنان کار کند
 *   - ادمینِ سطح ۵ (بی‌محدودیت نیست) کارِ کسی را ببیند یا بنویسد
 *   - راننده توقفِ رانندهٔ دیگر را ببیند یا ثبت کند
 *   - برچسبِ «مالِ کیست» / فیلترِ نفر برای غیرِ سوپرادمین ظاهر شود؛ هیچ خطای JS/کنسول
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
/* عکس فقط وقتی خواسته شود (قانونِ ۲۸: معیار اسکرین‌شاتِ هر دو تم و موبایل است). */
const SHOTS = process.env.E2E_SHOTS ?? '';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
/* کوئری از stdin، نه آرگومانِ شل — همان قراردادِ بقیهٔ سوییت‌ها. */
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));

const loginAs = (identifier, password) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
}).then((r) => r.json());
const call = (token) => (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const upload = (token, p) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'report.png');
  return fetch(API + p, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
};

const login = await loginAs(process.env.E2E_USER ?? 'admin', process.env.E2E_PASS ?? 'test1234');
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = call(login.accessToken);
const adminId = login.user?.id;

const tag = 'sf' + randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
/* «امروز» یک تعریف دارد: روزِ **مطب** (`common/clinic-day.ts`). دفترِ کار و حمل‌ونقل
   تا این بسته روزِ UTC را می‌بریدند و بینِ نیمه‌شب تا ۳:۳۰ تهران «امروز»شان روزِ قبل
   بود؛ حالا همان روزی است که پذیرش (`assign`) می‌سنجد. پس همه‌چیز روی روزِ مطب ساخته
   و در بازهٔ «امروز» خوانده می‌شود — بی‌استثنای ساعتِ آزمون. */
const clinicToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.CLINIC_TZ || 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const TECH_SCOPE = 'today';

const trash = { visits: [], forms: [], hospitals: [], accounts: [], runs: [], features: [] };
let browser;

try {
  console.log('۰) آماده‌سازی: بیمارستان، دو کارشناس، دو راننده، یک ادمینِ سطح ۵، برنامهٔ حضور، مراجعه‌ها و مسیرها');
  /* ماژول‌ها باید برای حساب‌های سطح ۲ روشن باشند (پلانِ ionm)؛ اگر نصبی خاموششان
     کرده، فقط برای همین آزمون روشن و بعد برگردانده می‌شوند. */
  const feats = (await send('/features')).json ?? [];
  for (const k of ['tech', 'transport', 'dispatch']) {
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
  const techA = await mkAccount('ta', 'کارشناسِ', 'یکم', 2, 'technician');
  const techB = await mkAccount('tb', 'کارشناسِ', 'دوم', 2, 'technician');
  const drv1 = await mkAccount('d1', 'رانندهٔ', 'سوم', 2, 'driver');
  const drv2 = await mkAccount('d2', 'رانندهٔ', 'چهارم', 2, 'driver');
  const admin5 = await mkAccount('m5', 'ادمینِ', 'پنجم', 5, 'secretary');

  const hospital = (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;
  if (!hospital?.id) throw new Error('بیمارستان ساخته نشد: ' + JSON.stringify(hospital).slice(0, 160));
  trash.hospitals.push(hospital.id);
  const form = (await send('/forms', 'POST', { key: tag, title: `عملِ ${tag}`, scope: 'visit' })).json;
  if (form?.id) trash.forms.push(form.id);

  /* برنامهٔ حضور **پیش از** مراجعه: ثبتِ مراجعه ساعتِ حضورِ موجود را بازنویسی نمی‌کند. */
  const duty = async (techId, arriveTime) => {
    const r = await send('/dispatch/roster', 'POST', { date: clinicToday, hospitalId: hospital.id, techId, arriveTime });
    if (!r.json?.id) throw new Error('برنامهٔ حضور ثبت نشد: ' + JSON.stringify(r).slice(0, 160));
    return r.json.id;
  };
  const dutyA = await duty(techA.id, '07:30');
  const dutyB = await duty(techB.id, '08:00');

  const mkVisit = async (last, extra) => {
    const r = await send('/visits', 'POST', {
      kind: tag, firstName: 'بیمارِ', lastName: `${last}${tag}`, phone: phone(),
      hospitalId: hospital.id, opDate: `${clinicToday}T00:00:00.000Z`, ...extra,
    });
    if (!r.json?.id) throw new Error('مراجعه ساخته نشد: ' + JSON.stringify(r.json).slice(0, 160));
    trash.visits.push(r.json.id);
    return r.json;
  };
  const v1 = await mkVisit('عمل', { techId: techA.id, opStartTime: '09:30' });   // کارِ کارشناسِ یکم
  const v2 = await mkVisit('پذیرشی', { opStartTime: '10:30' });                  // آزاد — سوپرادمین برای دوم می‌پذیرد
  const v4 = await mkVisit('خودی', { opStartTime: '11:30' });                    // آزاد — کارشناسِ یکم برای خودش

  const staffOf = (accountId) => num(`SELECT t.id FROM transport_staff t JOIN accounts a ON a.person_id = t.person_id WHERE a.id = ${accountId}`);
  const staff1 = staffOf(drv1.id), staff2 = staffOf(drv2.id);
  const mkRun = async (staffId, plannedAt) => {
    const run = (await send('/routes', 'POST', { staffId, runDate: `${clinicToday}T08:00:00.000Z` })).json;
    if (!run?.id) throw new Error('مسیر ساخته نشد: ' + JSON.stringify(run).slice(0, 160));
    trash.runs.push(run.id);
    await send(`/routes/${run.id}/stops`, 'POST', { hospitalId: hospital.id, kind: 'deliver', plannedAt, handedTo: 'CSR' });
    return { runId: run.id, stopId: num(`SELECT id FROM transport_stops WHERE run_id = ${run.id} ORDER BY seq DESC LIMIT 1`) };
  };
  const r1 = await mkRun(staff1, '09:00');
  const r2 = await mkRun(staff2, '10:00');
  ok(staff1 > 0 && staff2 > 0 && r1.stopId > 0 && r2.stopId > 0, 'دو راننده (نقشِ driver → نیروی حمل) هر کدام یک مسیرِ امروز با یک توقف');

  const sessA = await loginAs(techA.username, techA.password);
  const sessD1 = await loginAs(drv1.username, drv1.password);
  const sessM5 = await loginAs(admin5.username, admin5.password);
  ok(!!(sessA.accessToken && sessD1.accessToken && sessM5.accessToken), 'کارشناس، راننده و ادمینِ سطح ۵ با رمزِ موقت وارد شدند');
  const asA = call(sessA.accessToken), asD1 = call(sessD1.accessToken), asM5 = call(sessM5.accessToken);

  console.log(`\n۱) دفترِ کار از چشمِ سوپرادمین (بازهٔ ${TECH_SCOPE})`);
  const ag = (await send(`/tech/agenda?scope=${TECH_SCOPE}`)).json;
  ok(ag?.team === true, 'پاسخ می‌گوید نمای سرپرستی است (`team: true`) — رابط سطح را حساب نمی‌کند');
  const agV1 = ag?.visits?.find((v) => v.id === v1.id);
  ok(agV1?.techName?.includes(`یکم${tag}`) && agV1?.ownerId === techA.id, `عملِ کارشناسِ یکم با نام و کلیدِ صاحبش آمد (${agV1?.techName})`);
  const agDutyA = ag?.hospitals?.find((h) => h.id === dutyA);
  const agDutyB = ag?.hospitals?.find((h) => h.id === dutyB);
  ok(!!agDutyA && !!agDutyB, 'برنامهٔ حضورِ **هر دو** کارشناس آمد، نه فقط مالِ خودِ کاربر');
  ok(agDutyB?.techName?.includes(`دوم${tag}`) && agDutyB?.ownerId === techB.id, `هر کارتِ حضور نامِ صاحبش را دارد (${agDutyB?.techName})`);
  ok((agDutyB?.openVisits ?? []).some((o) => o.id === v2.id) && (agDutyA?.openVisits ?? []).some((o) => o.id === v2.id),
    'مراجعهٔ آزادِ همان بیمارستان و روز زیرِ کارتِ هر دو کارشناس برای پذیرش آمد');
  ok(!/"(amount|paid|price|fee|discount|charges|payments|shares?)"/.test(JSON.stringify(ag)), 'نمای سرپرستی هم هیچ فیلدِ مالی ندارد');

  console.log('\n۲) سوپرادمین روی عملِ کارشناسِ دیگر می‌نویسد — بی‌آنکه پروفایل عوض کند');
  const times = await send(`/tech/visits/${v1.id}/times`, 'PATCH', { opStartTime: '10:15', opEndTime: '11:40' });
  ok(times.status === 200, `ثبتِ ساعت پذیرفته شد (${times.status}${times.status !== 200 ? ' — ' + JSON.stringify(times.json).slice(0, 120) : ''})`);
  ok(times.json?.id === v1.id && times.json?.techName?.includes(`یکم${tag}`) && times.json?.ownerId === techA.id,
    'ردیفِ برگشتی همان عمل است، با نامِ کارشناسِ صاحبش');
  ok(sql(`SELECT op_start_time || '-' || op_end_time FROM visits WHERE id=${v1.id}`) === '10:15-11:40', 'ساعت در دیتابیس نشست');
  ok(num(`SELECT actor_id FROM audit_events WHERE action='visit.times' AND entity_id='${v1.id}' ORDER BY id DESC LIMIT 1`) === adminId,
    'ردِ ممیزیِ ساعت: بازیگر خودِ سوپرادمین است');
  const rep = await upload(login.accessToken, `/tech/visits/${v1.id}/report`);
  ok(rep.status === 201 && !!rep.json?.reportAt, `گزارشِ عمل روی عملِ کارشناسِ دیگر آپلود شد (${rep.status})`);
  ok(num(`SELECT count(*) FROM documents WHERE visit_id=${v1.id} AND category='report' AND uploaded_by_id=${adminId}`) === 1,
    '… در پروندهٔ همان بیمار، با نامِ سوپرادمین به‌عنوانِ بارگذارنده');
  const ghost = await send(`/tech/visits/${v2.id}/claim`, 'POST', { dutyId: 2147483000 });
  ok(ghost.status === 404 && /برنامه/.test(ghost.json?.message ?? ''), `برنامهٔ حضورِ ناموجود با پیامِ فارسی رد شد (${ghost.status} «${ghost.json?.message}»)`);
  const lost = await send('/tech/visits/2147483000/claim', 'POST', { dutyId: dutyB });
  ok(lost.status === 404 && /مراجعه/.test(lost.json?.message ?? ''), `مراجعهٔ ناموجود «پیدا نشد» می‌گیرد، نه خطای گنگِ تاریخ (${lost.status} «${lost.json?.message}»)`);
  /* سوپرادمین خودش کارشناسِ برنامه نیست: پذیرشِ بی‌کارتِ حضور نباید او را جای کارشناس بنشاند. */
  const bare = await send(`/tech/visits/${v2.id}/claim`, 'POST');
  ok(bare.status === 400 && /کارتِ حضور/.test(bare.json?.message ?? '') && sql(`SELECT coalesce(tech_id::text,'-') FROM visits WHERE id=${v2.id}`) === '-',
    `پذیرشِ سوپرادمین بی‌کارتِ حضور با راهنمای فارسی رد شد و مراجعه آزاد ماند (${bare.status})`);

  console.log('\n۳) نباید بیفتد — پیش از کارِ مرورگر');
  const forged = await asA(`/tech/visits/${v2.id}/claim`, 'POST', { dutyId: dutyB });
  ok(forged.status === 403 && /سوپرادمین/.test(forged.json?.message ?? ''), `کارشناس نمی‌تواند با dutyId به نامِ دیگری پذیرش بزند (${forged.status} «${forged.json?.message}»)`);
  ok(sql(`SELECT coalesce(tech_id::text,'-') FROM visits WHERE id=${v2.id}`) === '-', '… و مراجعه آزاد ماند');
  const d1Foreign = await asD1(`/transport/stops/${r2.stopId}/done`, 'POST', { handedActual: 'CSR' });
  ok(d1Foreign.status === 404, `راننده توقفِ رانندهٔ دیگر را ثبت نمی‌کند (${d1Foreign.status})`);
  ok(sql(`SELECT coalesce(done_at::text,'-') FROM transport_stops WHERE id=${r2.stopId}`) === '-', '… و توقف دست نخورد');
  const m5Agenda = (await asM5(`/tech/agenda?scope=${TECH_SCOPE}`)).json;
  ok(m5Agenda?.team === false && !(m5Agenda?.visits ?? []).some((v) => v.id === v1.id) && !(m5Agenda?.hospitals ?? []).length,
    'ادمینِ سطح ۵ بی‌محدودیت نیست: `team: false` و کارِ هیچ کارشناسی را نمی‌بیند');
  const m5Claim = await asM5(`/tech/visits/${v4.id}/claim`, 'POST', { dutyId: dutyA });
  ok(m5Claim.status === 403 && sql(`SELECT coalesce(tech_id::text,'-') FROM visits WHERE id=${v4.id}`) === '-',
    `… به نامِ کارشناس هم پذیرش نمی‌زند و مراجعه آزاد می‌ماند (${m5Claim.status})`);
  const m5Times = await asM5(`/tech/visits/${v1.id}/times`, 'PATCH', { opStartTime: '06:00' });
  ok(m5Times.status === 404 && sql(`SELECT op_start_time FROM visits WHERE id=${v1.id}`) === '10:15', `… و روی عملِ کارشناس نمی‌نویسد (${m5Times.status})`);
  const m5Done = await asM5(`/transport/stops/${r2.stopId}/done`, 'POST', { handedActual: 'CSR' });
  ok(m5Done.status === 404, `… و توقفِ راننده را هم ثبت نمی‌کند (${m5Done.status})`);

  console.log('\n۴) مرورگر — پنلِ کارشناسی برای سوپرادمین');
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`[${who}] ${e}`));
    /* نشانیِ پاسخِ ۴xx/۵xx هم ثبت می‌شود — «Failed to load resource» به‌تنهایی نمی‌گوید کدام درخواست. */
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`[${who} http ${r.status()}] ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${who} console] ${m.text()}`); });
  };
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'superadmin');
  await browserLogin(page, login.accessToken, { ui: UI });
  const openTech = async (p) => {
    await p.goto(UI + '/app/tech', { waitUntil: 'networkidle' });
    await p.waitForSelector(`.tk-card:has-text("عمل${tag}")`, { timeout: 15000 });
  };
  await openTech(page);
  ok((await page.locator('.tk-head h1').innerText()).trim() === 'پنل کارشناسی', 'عنوانِ صفحه همان نامِ کاشی است (قانونِ ۲۴)');
  ok(/^دفترِ کارِ همهٔ/.test((await page.locator('.tk-head p').innerText()).trim()), 'زیرعنوان با «دفترِ کارِ همهٔ …» شروع می‌شود، نه دفترِ کارِ شخصی');
  ok(!/شما/.test(await page.locator('.tk-head p').innerText()), 'زیرعنوان به سوپرادمین «شما» نمی‌گوید');
  const v1Card = page.locator('article.tk-card', { hasText: `عمل${tag}` });
  ok((await v1Card.locator('.tk-owner').innerText()).includes(`یکم${tag}`), 'کارتِ عمل نامِ کارشناسِ صاحبش را دارد');
  ok(await v1Card.locator('button', { hasText: 'ثبتِ ساعت' }).count() === 1, 'دکمهٔ «ثبتِ ساعت» روی کارِ کارشناسِ دیگر هم هست');
  const dutyCard = (who) => page.locator('section.tk-card').filter({ has: page.locator('.tk-owner', { hasText: who }) });
  ok(await dutyCard(`یکم${tag}`).count() === 1 && await dutyCard(`دوم${tag}`).count() === 1, 'کارتِ حضورِ هر دو کارشناس، هر کدام با نامِ صاحبش');

  const chip = (label) => page.locator('.tk-people button', { hasText: label });
  ok(await chip(`یکم${tag}`).count() === 1 && await chip(`دوم${tag}`).count() === 1 && await chip('همه').count() === 1,
    'فیلترِ نفر: «همه» و یک چیپ برای هر کارشناس');
  await chip(`دوم${tag}`).click();
  await page.waitForFunction((t) => ![...document.querySelectorAll('article.tk-card')].some((a) => a.textContent.includes(t)), `عمل${tag}`, { timeout: 5000 });
  ok(await v1Card.count() === 0 && await dutyCard(`یکم${tag}`).count() === 0 && await dutyCard(`دوم${tag}`).count() === 1,
    'با انتخابِ کارشناسِ دوم فقط کارِ او می‌ماند');
  const claimBtn = dutyCard(`دوم${tag}`).locator('.tk-open-visit', { hasText: `پذیرشی${tag}` }).locator('button');
  ok((await claimBtn.innerText()).includes(`دوم${tag}`), `دکمهٔ پذیرش می‌گوید به نامِ چه کسی («${(await claimBtn.innerText()).trim()}»)`);
  await claimBtn.click();
  await page.waitForFunction(() => /ثبت شد/.test(document.querySelector('.tk-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  ok((await page.locator('.tk-toast').innerText()).includes(`دوم${tag}`), 'پیامِ موفقیت نامِ همان کارشناس را می‌گوید');
  ok(num(`SELECT coalesce(tech_id,0) FROM visits WHERE id=${v2.id}`) === techB.id, '**مراجعه به نامِ کارشناسِ دوم نشست، نه سوپرادمین**');
  ok(num(`SELECT actor_id FROM audit_events WHERE action='dispatch.visit.claim' AND entity_id='${v2.id}' ORDER BY id DESC LIMIT 1`) === adminId,
    '… و ردِ ممیزیِ پذیرش بازیگر را سوپرادمین نشان می‌دهد');
  await page.waitForSelector(`article.tk-card:has-text("پذیرشی${tag}")`, { timeout: 8000 });
  ok((await page.locator('article.tk-card', { hasText: `پذیرشی${tag}` }).locator('.tk-owner').innerText()).includes(`دوم${tag}`),
    'پس از پذیرش، عمل در دفترِ کارشناسِ دوم با نامِ او آمد');

  await chip('همه').click();
  await page.waitForSelector(`article.tk-card:has-text("عمل${tag}")`, { timeout: 5000 });
  await v1Card.locator('button', { hasText: 'ثبتِ ساعت' }).click();
  await page.waitForSelector('.tk-sheet .tp-input', { timeout: 5000 });
  await page.locator('.tk-sheet .tp-input').nth(0).fill('12:05');
  await page.locator('.tk-sheet .tp-input').nth(1).fill('13:20');
  await page.locator('.tk-sheet .tk-save').click();
  await page.waitForFunction(() => /ساعت ثبت شد/.test(document.querySelector('.tk-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  ok(sql(`SELECT op_start_time || '-' || op_end_time FROM visits WHERE id=${v1.id}`) === '12:05-13:20', 'ثبتِ ساعت از رابط روی عملِ کارشناسِ دیگر هم نشست');

  console.log('\n۵) مرورگر — حمل‌ونقل برای سوپرادمین');
  await page.goto(UI + '/app/transport', { waitUntil: 'networkidle' });
  const stopCard = (who) => page.locator('article.tr-card').filter({ has: page.locator('.tr-owner', { hasText: who }) });
  await page.waitForSelector(`.tr-owner:has-text("چهارم${tag}")`, { timeout: 15000 });
  ok((await page.locator('.tr-head h1').innerText()).trim() === 'حمل‌ونقل', 'عنوانِ صفحه همان نامِ کاشی است (قانونِ ۲۴)');
  ok(/^همهٔ مسیرها/.test((await page.locator('.tr-head p').innerText()).trim()), 'زیرعنوان با «همهٔ مسیرها» شروع می‌شود، نه «مسیرِ من»');
  ok(await stopCard(`سوم${tag}`).count() === 1 && await stopCard(`چهارم${tag}`).count() === 1, 'توقفِ هر دو راننده، هر کدام با نامِ نیرویش');
  const trChip = (label) => page.locator('.tr-people button', { hasText: label });
  await trChip(`چهارم${tag}`).click();
  await page.waitForFunction((t) => ![...document.querySelectorAll('.tr-owner')].some((o) => o.textContent.includes(t)), `سوم${tag}`, { timeout: 5000 });
  ok(await stopCard(`سوم${tag}`).count() === 0 && await stopCard(`چهارم${tag}`).count() === 1, 'فیلترِ نیرو فقط توقفِ رانندهٔ انتخاب‌شده را نگه می‌دارد');
  await stopCard(`چهارم${tag}`).locator('.tr-do').click();
  await page.waitForSelector('.tr-sheet', { timeout: 5000 });
  const sheet = await page.locator('.tr-sheet').innerText();
  ok(sheet.includes('از طرفِ') && sheet.includes(`چهارم${tag}`) && !sheet.includes('تحویل دادید'), 'شیتِ تحویل می‌گوید از طرفِ کدام نیرو، و «شما» نمی‌گوید');
  await page.locator('.tr-sheet .tr-field input').first().fill('CSR');
  await page.locator('.tr-sheet .tr-save').click();
  await page.waitForFunction(() => /تحویل ثبت شد/.test(document.querySelector('.tr-toast.on')?.textContent ?? ''), null, { timeout: 8000 });
  ok(sql(`SELECT coalesce(done_at::text,'-') FROM transport_stops WHERE id=${r2.stopId}`) !== '-', '**تحویلِ توقفِ رانندهٔ دیگر از رابط ثبت شد**');
  ok(sql(`SELECT actor_id || '/' || (after_json->>'staffId') FROM audit_events WHERE action='transport.stop.done' AND entity_id='${r2.stopId}' ORDER BY id DESC LIMIT 1`) === `${adminId}/${staff2}`,
    '… با بازیگرِ سوپرادمین و صاحبِ مسیر در ردِ ممیزی');

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    const phoneView = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const shot = await phoneView.newPage();
    watch(shot, 'shots');
    await browserLogin(shot, login.accessToken, { ui: UI });
    for (const theme of ['dark', 'light']) {
      await openTech(shot);
      await shot.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await shot.screenshot({ path: `${SHOTS}/superadmin-tech-${theme}.png`, fullPage: true });
      await shot.goto(UI + '/app/transport', { waitUntil: 'networkidle' });
      await shot.waitForSelector(`.tr-owner:has-text("چهارم${tag}")`, { timeout: 15000 });
      await shot.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await shot.screenshot({ path: `${SHOTS}/superadmin-transport-${theme}.png`, fullPage: true });
    }
    await phoneView.close();
    console.log(`  (عکس‌ها در ${SHOTS})`);
  }

  console.log('\n۶) پاسخِ API پس از نوشتنِ سوپرادمین روی حمل‌ونقل');
  const done1 = await send(`/transport/stops/${r1.stopId}/done`, 'POST', { handedActual: 'CSR', notes: `آزمون ${tag}` });
  ok(done1.status === 201, `ثبتِ تحویلِ رانندهٔ یکم از API (${done1.status}${done1.status !== 201 ? ' — ' + JSON.stringify(done1.json).slice(0, 120) : ''})`);
  ok(done1.json?.team === true && (done1.json?.runs ?? []).some((r) => r.id === r2.runId && r.ownerId === staff2),
    'پاسخ همچنان نمای همهٔ مسیرهاست (مسیرِ رانندهٔ دیگر هم در آن هست)');
  ok(!/patient|nationalId/.test(JSON.stringify(done1.json)), 'نمای سرپرستیِ حمل‌ونقل هم هیچ دادهٔ بیمار ندارد');
  const again = await send(`/transport/stops/${r1.stopId}/done`, 'POST', { handedActual: 'CSR' });
  ok(again.status === 400, `ثبتِ دوباره رد می‌شود (${again.status})`);

  console.log('\n۷) نباید بیفتد — کارشناس و راننده فقط مالِ خودشان را دارند');
  const agA = (await asA(`/tech/agenda?scope=${TECH_SCOPE}`)).json;
  ok(agA?.team === false, 'کارشناسِ سطح ۲: `team: false`');
  ok((agA?.visits ?? []).some((v) => v.id === v1.id) && !(agA?.visits ?? []).some((v) => v.id === v2.id),
    'کارِ خودش را می‌بیند، کارِ کارشناسِ دوم را نه');
  ok((agA?.hospitals ?? []).some((h) => h.id === dutyA) && !(agA?.hospitals ?? []).some((h) => h.id === dutyB),
    'فقط برنامهٔ حضورِ خودش، نه برنامهٔ کارشناسِ دیگر');
  ok(!JSON.stringify(agA).includes('"ownerId"'), 'و هیچ کلیدِ «مالِ کیست»ی در پاسخش نیست');
  const aTimes = await asA(`/tech/visits/${v2.id}/times`, 'PATCH', { opStartTime: '06:00' });
  ok(aTimes.status === 404 && /شما/.test(aTimes.json?.message ?? ''), `روی عملِ کارشناسِ دیگر نمی‌نویسد (${aTimes.status} «${aTimes.json?.message}»)`);
  const aRep = await upload(sessA.accessToken, `/tech/visits/${v2.id}/report`);
  ok(aRep.status === 404, `… و گزارش هم برایش آپلود نمی‌کند (${aRep.status})`);
  const aOwn = await asA(`/tech/visits/${v4.id}/claim`, 'POST');
  ok((aOwn.status === 201 || aOwn.status === 200) && num(`SELECT coalesce(tech_id,0) FROM visits WHERE id=${v4.id}`) === techA.id,
    `پذیرشِ عادیِ خودِ کارشناس مثلِ همیشه کار می‌کند (${aOwn.status})`);
  const trD1 = (await asD1('/transport/agenda')).json;
  ok(trD1?.team === false && (trD1?.runs ?? []).some((r) => r.id === r1.runId) && !(trD1?.runs ?? []).some((r) => r.id === r2.runId),
    'راننده فقط مسیرِ خودش را می‌بیند و `team: false` است');
  ok(!JSON.stringify(trD1).includes('"ownerId"'), '… بی‌کلیدِ «مالِ کیست»');

  console.log('\n۸) مرورگر — همان صفحه‌ها برای کارشناس و راننده');
  const ctxA = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const pageA = await ctxA.newPage();
  watch(pageA, 'tech');
  await browserLogin(pageA, sessA.accessToken, { ui: UI });
  await openTech(pageA);
  ok((await pageA.locator('.tk-head h1').innerText()).trim() === 'پنل کارشناسی', 'کارشناس هم همان نامِ کاشی را می‌بیند');
  ok(/^دفترِ کارِ شما/.test((await pageA.locator('.tk-head p').innerText()).trim()), 'و زیرعنوانش «دفترِ کارِ شما» است');
  ok(await pageA.locator('.tk-owner').count() === 0 && await pageA.locator('.tk-people').count() === 0,
    'برای کارشناس نه برچسبِ «مالِ کیست» هست نه فیلترِ نفر');
  ok(await pageA.locator('article.tk-card', { hasText: `پذیرشی${tag}` }).count() === 0, 'عملِ کارشناسِ دیگر در دفترش نیست');
  const ctxD = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const pageD = await ctxD.newPage();
  watch(pageD, 'driver');
  await browserLogin(pageD, sessD1.accessToken, { ui: UI });
  await pageD.goto(UI + '/app/transport', { waitUntil: 'networkidle' });
  await pageD.waitForSelector('article.tr-card', { timeout: 15000 });
  ok((await pageD.locator('.tr-head h1').innerText()).trim() === 'حمل‌ونقل', 'راننده هم همان نامِ کاشی را می‌بیند');
  ok(/^مسیرِ من/.test((await pageD.locator('.tr-head p').innerText()).trim()), 'و زیرعنوانش «مسیرِ من» است');
  ok(await pageD.locator('.tr-owner').count() === 0 && await pageD.locator('.tr-people').count() === 0, 'بی‌برچسبِ نیرو و بی‌فیلتر');
  ok(await pageD.locator('article.tr-card', { hasText: `بیمارستانِ ${tag}` }).count() === 1, 'فقط توقفِ خودش (نه توقفِ رانندهٔ دیگر در همان بیمارستان)');

  console.log('\n۹) سلامتِ صفحه');
  ok(errors.length === 0, `بدونِ خطای جاوااسکریپت/کنسول (${errors.length})${errors.length ? ' — ' + errors.slice(0, 3).join(' | ').slice(0, 300) : ''}`);
} catch (e) {
  fail++;
  console.log('  ✘ اجرا قطع شد: ' + String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
} finally {
  await browser?.close().catch(() => {});
  /* پاک‌سازی هرگز خودِ نتیجه را قرمز نمی‌کند — هر گام جدا. */
  const q = (s) => { try { sql(s); } catch (e) { console.log('  (پاک‌سازی) ' + String(e.message).split('\n')[0].slice(0, 160)); } };
  for (const id of trash.runs) await send(`/routes/${id}`, 'DELETE').catch(() => {});
  if (trash.visits.length) {
    q(`DELETE FROM documents WHERE visit_id IN (${trash.visits.join(',')})`);
    q(`DELETE FROM work_items WHERE visit_id IN (${trash.visits.join(',')})`);
  }
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const h of trash.hospitals) q(`DELETE FROM hospital_duties WHERE hospital_id=${h}`);
  for (const h of trash.hospitals) await send(`/hospitals/${h}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  /* شخص، نه فقط حساب: حساب، نشست‌ها و نیروی حمل با آبشارِ `people` می‌روند و شمارهٔ
     آزمون در جدولِ اشخاص نمی‌ماند (همان قراردادِ پرتالِ پزشک). برنامهٔ حضور `Restrict`
     است، پس پیش از آن. */
  for (const id of trash.accounts) {
    q(`DELETE FROM hospital_duties WHERE tech_id=${id}`);
    q(`DELETE FROM people WHERE id=(SELECT person_id FROM accounts WHERE id=${id})`);
  }
  for (const k of trash.features) q(`UPDATE features SET enabled=false WHERE key='${k}'`);
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
