/**
 * سوپرادمینِ بی‌محدودیت در بقیهٔ پرتال‌ها (قانونِ ۲۹، خواستهٔ مالک ۱۴۰۵/۰۷/۰۳) —
 * اتاقِ عمل و میزِ پذیرش، سرورِ زنده + مرورگرِ واقعی.
 *
 * ممیزیِ این بسته: از میان پرتال‌هایی که «امروز»، پنلِ کارشناسی، میزِ پزشک و
 * حمل‌ونقل نیستند، تنها میزی که برای سطوحِ پایین «مالِ من» است **اتاقِ عمل**
 * است (کارشناس و پزشک فقط عملِ خودشان را می‌بینند). سوپرادمین آن‌جا از قبل
 * همهٔ عمل‌ها را می‌دید و دکمه‌ها برایش کار می‌کردند، ولی هیچ ردیفی نمی‌گفت
 * **مالِ کیست** — کسی که به‌جای کارشناس «شروع شد» می‌زند باید بداند عملِ چه
 * کسی را دست می‌زند، و عملی که هنوز کارشناس ندارد باید خودش را نشان بدهد.
 *
 *  باید بیفتد:
 *   - `GET /theatre/day` برای سوپرادمین `team: true` است؛ هر ردیف جراح و کارشناسِ
 *     صاحبش را دارد (`tech` + `techId`) و ردیفِ بی‌کارشناس `tech: null`
 *   - سوپرادمینِ بی‌نقش روی عملِ کارشناسِ دیگر «شروع/پایان»، شرحِ عمل و تیکِ چک‌لیست
 *     می‌زند؛ همه در دیتابیس می‌نشینند و بازیگرِ ممیزی خودِ سوپرادمین است
 *   - میزِ پذیرش: سوپرادمینِ بی‌نقش «رسید» می‌زند (پذیرشِ حضوری) و ثبت می‌شود
 *   - مرورگر: زیرعنوانِ «عمل‌های همه»، سطرِ «مالِ کیست» با نامِ کارشناس، «تعیین نشده»
 *     برای عملِ بی‌کارشناس (در ردیف و در کارتِ همان عمل)، و «پایان یافت» از خودِ
 *     رابط روی همان عمل
 *  نباید بیفتد:
 *   - کارشناسِ دیگر عمل را در تخته ببیند یا رویش بنویسد (۴۰۴، دیتابیس دست‌نخورده)
 *   - کارشناسِ صاحب یا ادمینِ سطح ۵ `team: true` یا کلیدِ `tech`/`techId` بگیرند —
 *     شکلِ پاسخشان همان دیروز است
 *   - زیرعنوان یا سطرِ «مالِ کیست» برای کارشناس در رابط ظاهر شود؛ هیچ خطای JS/کنسول
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

const login = await loginAs(process.env.E2E_USER ?? 'admin', process.env.E2E_PASS ?? 'test1234');
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = call(login.accessToken);
const adminId = login.user?.id;

const tag = 'sp' + randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
/* تختهٔ اتاقِ عمل روزِ UTC را می‌بُرد (`theatre.service.ts`)؛ مرورگر هم با
   `timezoneId: 'UTC'` همان روز را «امروز» می‌داند، تا سنجه به ساعتِ اجرا بسته نباشد. */
const today = new Date().toISOString().slice(0, 10);
const opDate = `${today}T00:00:00.000Z`;

const trash = { visits: [], appts: [], patients: [], hospitals: [], surgeons: [], accounts: [], features: [], chats: [] };
let browser;

try {
  console.log('۰) آماده‌سازی: دو کارشناس، یک ادمینِ سطح ۵، جراح، بیمارستان، سه عملِ امروز و یک نوبت');
  const feats = (await send('/features')).json ?? [];
  for (const k of ['theatre', 'frontdesk']) {
    if (feats.find((f) => f.key === k)?.enabled === false) { sql(`UPDATE features SET enabled=true WHERE key='${k}'`); trash.features.push(k); }
  }
  const mkAccount = async (user, first, last, level, jobRole) => {
    const made = (await send('/accounts/temporary', 'POST', {
      firstName: first, lastName: `${last}${tag}`, phone: phone(), level, jobRole, username: `${user}${tag}`,
    })).json;
    if (!made?.account?.id) throw new Error('حساب ساخته نشد: ' + JSON.stringify(made).slice(0, 160));
    trash.accounts.push(made.account.id);
    return { id: made.account.id, username: `${user}${tag}`, password: made.temporaryPassword };
  };
  const techA = await mkAccount('pa', 'کارشناسِ', 'صاحب', 2, 'technician');
  const techB = await mkAccount('pb', 'کارشناسِ', 'بیگانه', 2, 'technician');
  const admin5 = await mkAccount('p5', 'ادمینِ', 'پنجم', 5, 'secretary');

  const hospital = (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;
  if (!hospital?.id) throw new Error('بیمارستان ساخته نشد: ' + JSON.stringify(hospital).slice(0, 160));
  trash.hospitals.push(hospital.id);
  const surgeon = (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `اتاق${tag}` })).json;
  if (!surgeon?.id) throw new Error('جراح ساخته نشد: ' + JSON.stringify(surgeon).slice(0, 160));
  trash.surgeons.push(surgeon.id);
  const proc = (await send('/procedure-types')).json?.[0];

  const mkSurgery = async (last, extra) => {
    const r = await send('/visits', 'POST', {
      kind: 'surgery', firstName: 'بیمارِ', lastName: `${last}${tag}`, phone: phone(),
      opDate, surgeonId: surgeon.id, hospitalId: hospital.id, ...(proc ? { procedureTypeId: proc.id } : {}), ...extra,
    });
    if (!r.json?.id) throw new Error('عمل ساخته نشد: ' + JSON.stringify(r.json).slice(0, 220));
    trash.visits.push(r.json.id);
    trash.patients.push(r.json.patientId ?? num(`SELECT patient_id FROM visits WHERE id=${r.json.id}`));
    return r.json;
  };
  /* ⚠️ دو عملِ «فهرستی» ساعتِ شروعِ خیلی زود دارند تا در سقفِ ۶۰ ردیفِ تخته
     (مرتب به ساعت) اول بیایند، حتی اگر سوییت‌های دیگر امروز عمل ساخته باشند.
     عملِ «شروع‌نشده» ساعت ندارد چون «شروع شد» ساعتِ موجود را بازنویسی نمی‌کند. */
  const vA = await mkSurgery('فهرست', { techId: techA.id, opStartTime: '00:02' });   // عملِ کارشناسِ صاحب
  const vFree = await mkSurgery('بی‌کارشناس', { opStartTime: '00:01' });              // هنوز کسی برایش گذاشته نشده
  const vS = await mkSurgery('شروع', { techId: techA.id });                           // برای «شروع/پایان» از API
  ok(num(`SELECT coalesce(tech_id,0) FROM visits WHERE id=${vA.id}`) === techA.id && num(`SELECT coalesce(tech_id,0) FROM visits WHERE id=${vFree.id}`) === 0,
    'سه عملِ امروز: دو تا به نامِ کارشناسِ صاحب، یکی بی‌کارشناس');

  const sessA = await loginAs(techA.username, techA.password);
  const sessB = await loginAs(techB.username, techB.password);
  const sess5 = await loginAs(admin5.username, admin5.password);
  ok(!!(sessA.accessToken && sessB.accessToken && sess5.accessToken), 'دو کارشناس و ادمینِ سطح ۵ با رمزِ موقت وارد شدند');
  const asA = call(sessA.accessToken), asB = call(sessB.accessToken), as5 = call(sess5.accessToken);

  console.log('\n۱) تختهٔ اتاقِ عمل از چشمِ سوپرادمین');
  const day = (await send(`/theatre/day?date=${today}`)).json;
  ok(day?.team === true, 'پاسخ می‌گوید نمای همه است (`team: true`) — رابط سطح را حساب نمی‌کند');
  const rowA = day?.visits?.find((v) => v.id === vA.id);
  const rowFree = day?.visits?.find((v) => v.id === vFree.id);
  ok(!!rowA && rowA.techId === techA.id && String(rowA.tech ?? '').includes(`صاحب${tag}`), `ردیفِ عمل نامِ کارشناسِ صاحبش را دارد («${rowA?.tech}»)`);
  ok(String(rowA?.surgeon ?? '').includes(`اتاق${tag}`), `… و نامِ جراحش را («${rowA?.surgeon}»)`);
  ok(!!rowFree && rowFree.tech === null && rowFree.techId === null, 'عملِ بی‌کارشناس `tech: null` است — «تعیین نشده» خودش خبر است، نه کلیدِ جاافتاده');
  ok(!/"(amount|paid|price|fee|discount|charges|payments|shares?)"/.test(JSON.stringify(day)), 'نمای همه هم هیچ فیلدِ مالی ندارد (قاعدهٔ میزِ اتاقِ عمل)');
  /* فیلترِ «مالِ کیست» (تصمیمِ مالک ۱۴۰۵/۰۷/۰۴: «مثلِ پنلِ کارشناسی») — دسته‌ها از همان ردیف‌ها. */
  const owners = day?.owners ?? [];
  const facetA = owners.find((o) => o.techId === techA.id);
  const facetNone = owners.find((o) => o.kind === 'none');
  ok(facetA?.key === `t:${techA.id}` && facetA.count >= 2 && String(facetA.label ?? '').includes(`صاحب${tag}`),
    `دستهٔ «مالِ کیست»ِ کارشناسِ صاحب با نام و شمارِ عمل‌هایش (${JSON.stringify(facetA)})`);
  ok(!!facetNone && facetNone.count >= 1 && facetNone.techId === null && owners[owners.length - 1] === facetNone,
    'دستهٔ «بی‌کارشناس» هست و ته فهرست است');
  ok(owners.reduce((n, o) => n + o.count, 0) === (day?.visits ?? []).length, 'جمعِ دسته‌ها = همهٔ عمل‌های تخته (هر عمل در یک دسته)');

  console.log('\n۲) نباید بیفتد — پیش از نوشتنِ سوپرادمین');
  const dayB = (await asB(`/theatre/day?date=${today}`)).json;
  ok(dayB?.team === false && !(dayB?.visits ?? []).some((v) => [vA.id, vS.id, vFree.id].includes(v.id)),
    'کارشناسِ دیگر `team: false` است و هیچ‌کدام از این عمل‌ها را در تخته نمی‌بیند');
  const bStart = await asB(`/theatre/visits/${vS.id}/start`, 'POST');
  ok(bStart.status === 404 && sql(`SELECT coalesce(op_start_time,'-') FROM visits WHERE id=${vS.id}`) === '-',
    `کارشناسِ دیگر «شروع شد» نمی‌زند (${bStart.status}) و ساعت خالی ماند`);
  const bCheck = await asB(`/theatre/visits/${vA.id}/check`, 'POST', { stage: 'signIn', key: 'identity', checked: true });
  ok(bCheck.status === 404 && num(`SELECT count(*) FROM safety_checks WHERE visit_id=${vA.id}`) === 0, `… و چک‌لیستش را هم تیک نمی‌زند (${bCheck.status})`);
  const dayA = (await asA(`/theatre/day?date=${today}`)).json;
  const ownRow = (dayA?.visits ?? []).find((v) => v.id === vA.id);
  ok(dayA?.team === false && !!ownRow && !(dayA?.visits ?? []).some((v) => v.id === vFree.id),
    'کارشناسِ صاحب عملِ خودش را می‌بیند، عملِ بی‌کارشناس را نه، و `team: false` است');
  ok(!!ownRow && !('tech' in ownRow) && !('techId' in ownRow), '… و شکلِ ردیفش همان دیروز است (بی‌کلیدِ «مالِ کیست»)');
  const day5 = await as5(`/theatre/day?date=${today}`);
  ok(day5.status === 200 && day5.json?.team === false && !(day5.json?.visits ?? []).some((v) => 'tech' in v || 'techId' in v),
    'ادمینِ سطح ۵ بی‌محدودیت نیست: `team: false` و بی‌کلیدِ «مالِ کیست» (دامنهٔ دیدش همان دیروز)');
  ok(!('owners' in (dayA ?? {})) && !('owners' in (dayB ?? {})) && !('owners' in (day5.json ?? {})),
    '**نباید بیفتد:** کارشناس و ادمینِ سطح ۵ دستهٔ «مالِ کیست» نمی‌گیرند');

  console.log('\n۳) سوپرادمینِ بی‌نقش روی عملِ کارشناسِ دیگر می‌نویسد — بی‌آنکه پروفایل عوض کند');
  const start = await send(`/theatre/visits/${vS.id}/start`, 'POST');
  ok((start.status === 201 || start.status === 200) && start.json?.visit?.id === vS.id, `«شروع شد» پذیرفته شد (${start.status})`);
  ok(sql(`SELECT coalesce(op_start_time,'-') FROM visits WHERE id=${vS.id}`) !== '-', 'ساعتِ شروع در دیتابیس نشست');
  const finish = await send(`/theatre/visits/${vS.id}/finish`, 'POST');
  ok((finish.status === 201 || finish.status === 200) && sql(`SELECT coalesce(op_end_time,'-') FROM visits WHERE id=${vS.id}`) !== '-',
    `«پایان یافت» هم نشست (${finish.status})`);
  ok(num(`SELECT actor_id FROM audit_events WHERE action='visit.start' AND entity_id='${vS.id}' ORDER BY id DESC LIMIT 1`) === adminId
    && num(`SELECT actor_id FROM audit_events WHERE action='visit.finish' AND entity_id='${vS.id}' ORDER BY id DESC LIMIT 1`) === adminId,
    'ردِ ممیزیِ هر دو ساعت: بازیگر خودِ سوپرادمین است');
  ok(String(start.json?.visit?.tech ?? '').includes(`صاحب${tag}`), 'کارتِ برگشتی هنوز کارشناسِ صاحبِ عمل را نشان می‌دهد (نوشتن صاحب را عوض نکرد)');
  const report = await send(`/theatre/visits/${vA.id}/report`, 'POST', { body: `شرحِ آزمونیِ ${tag}` });
  ok((report.status === 201 || report.status === 200)
    && num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${vA.id} AND kind='op' AND replaced_at IS NULL AND author_id=${adminId}`) === 1,
    `شرحِ عمل روی عملِ کارشناسِ دیگر ثبت شد، با سوپرادمین به‌عنوانِ نویسنده (${report.status})`);
  const check = await send(`/theatre/visits/${vA.id}/check`, 'POST', { stage: 'signIn', key: 'identity', checked: true });
  ok((check.status === 201 || check.status === 200) && num(`SELECT coalesce(checked_by_id,0) FROM safety_checks WHERE visit_id=${vA.id} AND stage='signIn' AND key='identity'`) === adminId,
    `تیکِ چک‌لیستِ ایمنی زده شد و نامِ زننده سوپرادمین است (${check.status})`);
  ok(num(`SELECT coalesce(tech_id,0) FROM visits WHERE id=${vA.id}`) === techA.id, '… و عمل هنوز به نامِ همان کارشناس است');

  console.log('\n۴) میزِ پذیرش — «رسید» از سوپرادمینِ بی‌نقش');
  const apptId = num(`INSERT INTO appointments(patient_id, date, start_min, status) VALUES (${trash.patients[0]}, '${today}', ${600 + Math.floor(Math.random() * 400)}, 'confirmed') RETURNING id`);
  trash.appts.push(apptId);
  const arrived = await send(`/frontdesk/appointments/${apptId}/status`, 'POST', { status: 'arrived' });
  ok((arrived.status === 201 || arrived.status === 200) && sql(`SELECT status FROM appointments WHERE id=${apptId}`) === 'arrived',
    `«رسید» ثبت شد (${arrived.status}${arrived.status >= 400 ? ' — ' + JSON.stringify(arrived.json).slice(0, 120) : ''})`);
  ok(num(`SELECT actor_id FROM audit_events WHERE action='appointment.status' AND entity_id='${apptId}' ORDER BY id DESC LIMIT 1`) === adminId,
    '… و ردِ ممیزی بازیگر را سوپرادمین نشان می‌دهد');

  console.log('\n۴ب) محرمانگی — گفتگوی خصوصیِ دو نفرِ دیگر، حتی برای سوپرادمین، بسته است');
  /* تصمیمِ مالک ۱۴۰۵/۰۷/۰۴: «طبقِ اصولِ محرمانگی، دادهٔ خصوصی — نه، نباید ببیند». سوپرادمین
     به همه پیام می‌دهد ولی گفتگوی دو نفرِ دیگر را نه می‌خواند، نه در فهرستش می‌بیند، نه در آن می‌نویسد. */
  const dm = await asA('/chat/dm', 'POST', { accountId: techB.id });
  const chId = dm.json?.id;
  if (chId) trash.chats.push(chId);
  const secret = `پیامِ خصوصی ${tag}`;
  const sentDm = await asA(`/chat/channels/${chId}/messages`, 'POST', { body: secret });
  ok(!!chId && [200, 201].includes(sentDm.status), `دو کارشناس با هم گفتگوی خصوصی دارند (${dm.status}/${sentDm.status})`);
  const peek = await send(`/chat/channels/${chId}/messages`);
  ok(peek.status === 404 && !JSON.stringify(peek.json ?? '').includes(secret), `**سوپرادمین پیام‌های آن گفتگو را نمی‌خواند** (${peek.status})`);
  const myChannels = (await send('/chat/channels')).json;
  ok(Array.isArray(myChannels) && !myChannels.some((c) => c.id === chId), '… آن گفتگو در فهرستِ گفتگوهای او نیست');
  const intrude = await send(`/chat/channels/${chId}/messages`, 'POST', { body: `نفوذ ${tag}` });
  ok(intrude.status === 404 && num(`SELECT count(*) FROM chat_messages WHERE channel_id=${chId}`) === 1, `… و در آن پیامی نمی‌نشیند (${intrude.status})`);
  const readB = await asB(`/chat/channels/${chId}/messages`);
  ok(readB.status === 200 && JSON.stringify(readB.json ?? '').includes(secret), 'عضوِ گفتگو همچنان پیام را می‌خواند (قفل فقط برای غیرعضو است)');

  console.log('\n۵) مرورگر — اتاقِ عمل برای سوپرادمین');
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`[${who}] ${e}`));
    /* نشانیِ پاسخِ ۴xx/۵xx هم ثبت می‌شود — «Failed to load resource» به‌تنهایی نمی‌گوید کدام درخواست. */
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`[${who} http ${r.status()}] ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${who} console] ${m.text()}`); });
  };
  const newPage = async (token, who, viewport = { width: 1200, height: 900 }, extra = {}) => {
    const ctx = await browser.newContext({ viewport, timezoneId: 'UTC', ...extra });
    const p = await ctx.newPage();
    watch(p, who);
    await browserLogin(p, token, { ui: UI });
    return p;
  };
  const openTheatre = async (p, visitId) => {
    await p.goto(UI + '/app/theatre', { waitUntil: 'networkidle' });
    await p.waitForSelector(`.th-item[data-visit-id="${visitId}"]`, { timeout: 15000 });
  };
  const page = await newPage(login.accessToken, 'superadmin');
  await openTheatre(page, vA.id);
  ok(await page.locator('.th-head .th-scope').count() === 1, 'زیرعنوانِ «عمل‌های همه» دیده می‌شود');
  const ownerA = page.locator(`.th-item[data-visit-id="${vA.id}"] .th-item-owner`);
  const ownerAText = (await ownerA.innerText().catch(() => '')).replace(/\s+/g, ' ');
  ok(ownerAText.includes(`صاحب${tag}`) && ownerAText.includes(`اتاق${tag}`), `سطرِ «مالِ کیست» نامِ جراح و کارشناس را دارد («${ownerAText.trim()}»)`);
  const ownerFree = (await page.locator(`.th-item[data-visit-id="${vFree.id}"] .th-item-owner`).innerText().catch(() => '')).replace(/\s+/g, ' ');
  ok(ownerFree.includes('تعیین نشده'), `عملِ بی‌کارشناس «تعیین نشده» می‌گوید («${ownerFree.trim()}»)`);
  ok(!(await page.locator(`.th-item[data-visit-id="${vA.id}"] .th-item-sub`).innerText()).includes(`اتاق${tag}`),
    'نامِ جراح دو بار نوشته نمی‌شود (از سطرِ فرعی به سطرِ «مالِ کیست» آمد)');

  await page.locator(`.th-item[data-visit-id="${vFree.id}"]`).click();
  await page.waitForSelector('.th-card .th-steps', { timeout: 10000 });
  const cardTeam = (await page.locator('.th-card .th-team').innerText().catch(() => '')).replace(/\s+/g, ' ');
  ok(cardTeam.includes('تعیین نشده') && cardTeam.includes(`اتاق${tag}`),
    `کارتِ همان عمل هم «تعیین نشده» را نگه می‌دارد، نه جای خالی («${cardTeam.trim()}»)`);
  /* مراحلِ میز (بازبینیِ UX، surgery-03): «ثبتِ پایان» دکمهٔ مرحلهٔ بعدی است و بعد از ثبت جایش را به
     تیک و ساعت می‌دهد — نه دکمهٔ خاموش. */
  const finishBtn = page.locator('.th-steps [data-act="finish"]');
  ok(await finishBtn.isEnabled(), 'در کارتِ عملِ بی‌کارشناس، «ثبتِ پایان» برای سوپرادمین فعال است');
  await finishBtn.click();
  await page.waitForSelector('.th-steps [data-step="end"][data-state="done"]', { timeout: 8000 });
  ok(sql(`SELECT coalesce(op_end_time,'-') FROM visits WHERE id=${vFree.id}`) !== '-', '**«ثبتِ پایان» از رابط نشست**');
  ok(num(`SELECT actor_id FROM audit_events WHERE action='visit.finish' AND entity_id='${vFree.id}' ORDER BY id DESC LIMIT 1`) === adminId,
    '… با بازیگرِ سوپرادمین در ردِ ممیزی');
  await page.locator('.th-head button', { hasText: 'فهرستِ روز' }).click();
  await page.waitForSelector(`.th-item[data-visit-id="${vFree.id}"]`, { timeout: 8000 });
  ok(await page.locator('.th-head .th-scope').count() === 1, 'برگشت به فهرست: زیرعنوان و برچسب‌ها سرِ جایشان‌اند');

  /* فیلترِ «مالِ کیست» روی تخته — دکمه‌ها از `day.owners`، ردیف‌ها با `techId`ِ همان دسته. */
  await page.waitForSelector('.th-owners', { timeout: 8000 });
  const ids = () => page.$$eval('.th-list .th-item', (els) => els.map((b) => Number(b.dataset.visitId)));
  const tabA = page.locator('.th-owners button', { hasText: `صاحب${tag}` });
  ok(await tabA.count() === 1, 'دکمهٔ فیلترِ کارشناسِ صاحب روی تخته هست');
  await tabA.click();
  const onlyA = await page.waitForFunction(({ a, free }) => {
    const got = [...document.querySelectorAll('.th-list .th-item')].map((b) => Number(b.dataset.visitId));
    return got.includes(a) && !got.includes(free);
  }, { a: vA.id, free: vFree.id }, { timeout: 8000 }).then(() => true).catch(() => false);
  const ownersShown = await page.locator('.th-list .th-item-owner').allInnerTexts();
  ok(onlyA && ownersShown.length > 0 && ownersShown.every((x) => x.includes(`صاحب${tag}`)),
    `**فیلترِ کارشناس: فقط عمل‌های او؛ عملِ بی‌کارشناس نیست** (${JSON.stringify(await ids())})`);
  await page.locator('.th-owners button').last().click();
  const onlyFree = await page.waitForFunction(({ a, free }) => {
    const got = [...document.querySelectorAll('.th-list .th-item')].map((b) => Number(b.dataset.visitId));
    return got.includes(free) && !got.includes(a);
  }, { a: vA.id, free: vFree.id }, { timeout: 8000 }).then(() => true).catch(() => false);
  ok(onlyFree && (await page.locator('.th-owners button').last().innerText()).includes('بی‌'), '**دکمهٔ آخر «بی‌کارشناس»: فقط عمل‌هایی که کسی برایشان گذاشته نشده**');
  await page.locator(`.th-item[data-visit-id="${vFree.id}"]`).click();
  await page.waitForSelector('.th-card .th-steps', { timeout: 10000 });
  await page.locator('.th-head button', { hasText: 'فهرستِ روز' }).click();
  await page.waitForSelector(`.th-item[data-visit-id="${vFree.id}"]`, { timeout: 8000 });
  ok(await page.locator(`.th-item[data-visit-id="${vA.id}"]`).count() === 0, 'باز و بستنِ کارت فیلتر را نگه می‌دارد');
  await page.locator('.th-owners button').first().click();
  await page.waitForSelector(`.th-item[data-visit-id="${vA.id}"]`, { timeout: 8000 });
  ok((await ids()).includes(vFree.id), '«همه» همهٔ عمل‌ها را برمی‌گرداند');

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    const shot = await newPage(login.accessToken, 'shots', { width: 390, height: 844 }, { deviceScaleFactor: 2 });
    for (const theme of ['dark', 'light']) {
      await openTheatre(shot, vA.id);
      await shot.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await shot.screenshot({ path: `${SHOTS}/superadmin-theatre-${theme}.png`, fullPage: true });
    }
    console.log(`  (عکس‌ها در ${SHOTS})`);
  }

  console.log('\n۶) مرورگر — همان صفحه برای کارشناسِ صاحب');
  const pageA = await newPage(sessA.accessToken, 'tech');
  await openTheatre(pageA, vA.id);
  ok(await pageA.locator('.th-scope').count() === 0 && await pageA.locator('.th-item-owner').count() === 0 && await pageA.locator('.th-owners').count() === 0,
    'کارشناس نه زیرعنوانِ «عمل‌های همه» دارد نه سطرِ «مالِ کیست»');
  ok(await pageA.locator(`.th-item[data-visit-id="${vFree.id}"]`).count() === 0, 'و عملی که به نامش نیست در تخته‌اش نیست');
  ok((await pageA.locator(`.th-item[data-visit-id="${vA.id}"] .th-item-sub`).innerText()).includes(`اتاق${tag}`),
    'سطرِ فرعیِ کارشناس همان دیروز است (نامِ جراح همان‌جاست)');

  console.log('\n۷) سلامتِ صفحه');
  ok(errors.length === 0, `بدونِ خطای جاوااسکریپت/کنسول (${errors.length})${errors.length ? ' — ' + errors.slice(0, 3).join(' | ').slice(0, 300) : ''}`);
} catch (e) {
  fail++;
  console.log('  ✘ اجرا قطع شد: ' + String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
} finally {
  await browser?.close().catch(() => {});
  /* پاک‌سازی هرگز خودِ نتیجه را قرمز نمی‌کند — هر گام جدا. */
  const q = (s) => { try { sql(s); } catch (e) { console.log('  (پاک‌سازی) ' + String(e.message).split('\n')[0].slice(0, 160)); } };
  if (trash.chats.length) q(`DELETE FROM chat_channels WHERE id IN (${trash.chats.join(',')})`);
  const pids = trash.patients.filter(Boolean);
  if (pids.length) {
    q(`DELETE FROM work_items WHERE patient_id IN (${pids.join(',')})`);
    q(`DELETE FROM reminders WHERE patient_id IN (${pids.join(',')})`);
    q(`DELETE FROM domain_events WHERE patient_id IN (${pids.join(',')})`);
  }
  if (trash.appts.length) {
    q(`DELETE FROM domain_events WHERE appointment_id IN (${trash.appts.join(',')})`);
    q(`DELETE FROM appointments WHERE id IN (${trash.appts.join(',')})`);
  }
  if (trash.visits.length) {
    q(`DELETE FROM safety_checks WHERE visit_id IN (${trash.visits.join(',')})`);
    q(`DELETE FROM work_items WHERE visit_id IN (${trash.visits.join(',')})`);
    q(`DELETE FROM domain_events WHERE visit_id IN (${trash.visits.join(',')})`);
  }
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  /* ⚠️ عملِ کارشناس با بیمارستان و ساعت یک «حضور در بیمارستان» می‌سازد
     (`syncVisitDuty`) و آن ردیف هم به حساب و هم به بیمارستان `Restrict` است —
     تا پاک نشود نه حساب پاک می‌شود نه بیمارستان، و حسابِ فعال جا می‌ماند. */
  const dutyOf = [
    trash.accounts.length ? `tech_id IN (${trash.accounts.join(',')})` : null,
    trash.hospitals.length ? `hospital_id IN (${trash.hospitals.join(',')})` : null,
  ].filter(Boolean);
  if (dutyOf.length) q(`DELETE FROM hospital_duties WHERE ${dutyOf.join(' OR ')}`);
  for (const id of trash.surgeons) await send(`/surgeons/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.hospitals) await send(`/hospitals/${id}`, 'DELETE').catch(() => {});
  if (trash.accounts.length) {
    const acc = trash.accounts.join(',');
    q(`DELETE FROM account_sessions WHERE account_id IN (${acc})`);
    /* شخص پاک می‌شود و حساب با cascade — وگرنه ردیفِ `people` با نامِ آزمون می‌ماند. */
    q(`DELETE FROM people WHERE id IN (SELECT person_id FROM accounts WHERE id IN (${acc}))`);
  }
  for (const k of trash.features) q(`UPDATE features SET enabled=false WHERE key='${k}'`);
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
