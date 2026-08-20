/**
 * پیگیری و مراقبتِ پس از عمل روی خودِ فرمِ عمل (#55):
 *
 * - override اختصاصیِ مراجعه: `followUpDays`/`postOpCare` روی خودِ visit مقدم
 *   بر قالب/روزهای نوعِ عمل است؛ پاک‌کردنش دوباره قالب را برمی‌گرداند.
 * - /ai/care-draft: پیش‌نویسِ مراقبت با اشراف به نوعِ عمل/تشخیص/شرح + قالبِ
 *   پایهٔ نوعِ عمل در prompt؛ مراجعهٔ ناموجود 400.
 * - مرورگر: بخشِ «پیگیری و مراقبتِ پس از عمل» در ادامهٔ فرمِ عمل — چیپِ
 *   روزها ورودی را پر می‌کند، دکمهٔ دستیار متنِ مراقبت را می‌نویسد،
 *   «ساخت‌یافته کن» شرحِ داخلِ فرم را بازنویسی می‌کند، و ذخیره واقعاً
 *   یادآوری‌ها را با مقادیرِ اختصاصی می‌کارد.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const PHONE = '09120000955';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'po' + randomBytes(3).toString('hex');
let mockReply = 'جواب';
const captured = [];
const mock = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    captured.push({ body: JSON.parse(data || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: mockReply } }] }));
  });
});
await new Promise((r) => mock.listen(3199, '127.0.0.1', r));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const setAi = (values) => send('/settings', 'PATCH', { values });

const fuCount = (id) => Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${id} AND kind='follow_up' AND status='pending'`));
const fuFirst = (id) => sql(`SELECT to_char(min(due_at), 'YYYY-MM-DD') FROM reminders WHERE visit_id=${id} AND kind='follow_up' AND status='pending'`);
const postText = (id) => sql(`SELECT replace(text, E'\\n', ' ') FROM reminders WHERE visit_id=${id} AND kind='post_op_care' AND status='pending'`);
const plusDays = (base, d) => new Date(base.getTime() + d * 864e5).toISOString().slice(0, 10);

const trash = { visits: [], procs: [], diags: [], forms: [] };

try {
  console.log('۱) چیدمان: نوعِ عمل با قالب + فرمِ پیگیری + جراحیِ واقعی');
  /* موجِ پیگیری = پیامک با لینکِ فرم؛ بدونِ فرمِ پیگیریِ عمومی هیچ موجی
     کاشته نمی‌شود (قراردادِ follow-up.mjs) — پس یکی می‌سازیم. */
  const fuForm = (await send('/forms', 'POST', { key: `${tag}g`, title: 'پیگیریِ عمومی', scope: 'record' })).json;
  trash.forms.push(fuForm.id);
  await send(`/forms/${fuForm.id}/fields`, 'POST', { key: 'fuPain', label: 'شدتِ درد' });
  await send(`/forms/${fuForm.id}`, 'PATCH', { followUp: 'general' });
  const proc = (await send('/procedure-types', 'POST', {
    name: `عملِ ${tag}`, followUpDays: '۷,۳۰', postOpCare: 'پانسمان را خشک نگه دارید.',
    preOpCare: 'از نیمه‌شب ناشتا باشید.',
  })).json;
  trash.procs.push(proc.id);
  const diag = (await send('/diagnoses', 'POST', { title: `تشخیصِ ${tag}` })).json;
  trash.diags.push(diag.id);
  const surgeon = (await send('/surgeons', 'GET')).json?.[0]
    ?? (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: 'آزمون' })).json;
  const hospital = (await send('/hospitals', 'GET')).json?.[0]
    ?? (await send('/hospitals', 'POST', { name: '[po] بیمارستانِ آزمون' })).json;

  const op = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  const visit = (await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'بیمارِ', lastName: 'پس‌ازعمل', phone: PHONE,
    opDate: op.toISOString(), procedureTypeId: proc.id, diagnosisId: diag.id,
    surgeonId: surgeon.id, hospitalId: hospital.id,
  })).json;
  ok(!!visit?.id, `جراحیِ واقعی ثبت شد (#${visit?.id})`);
  trash.visits.push(visit.id);

  console.log('\n۲) بی‌override: قالب و روزهای نوعِ عمل حاکم‌اند');
  ok(fuCount(visit.id) === 2, `دو موجِ پیگیری از روزهای نوعِ عمل (${fuCount(visit.id)})`);
  ok(fuFirst(visit.id) === plusDays(op, 7), `موجِ اول = عمل + ۷ (${fuFirst(visit.id)})`);
  ok(postText(visit.id).includes('پانسمان'), 'متنِ مراقبت = قالبِ نوعِ عمل');

  console.log('\n۳) override اختصاصیِ همین بیمار مقدم است');
  const p1 = await send(`/visits/${visit.id}`, 'PATCH', {
    followUpDays: '5,10,20', postOpCare: `مراقبتِ اختصاصیِ ${tag}`,
  });
  ok(p1.status === 200, `ثبتِ override (${p1.status})`);
  ok(p1.json?.postOpCare === `مراقبتِ اختصاصیِ ${tag}` && p1.json?.followUpDays === '5,10,20',
    '**نمای مراجعه هر دو فیلد را برمی‌گرداند**');
  ok(fuCount(visit.id) === 3, `**سه موج با روزهای اختصاصی** (${fuCount(visit.id)})`);
  ok(fuFirst(visit.id) === plusDays(op, 5), `موجِ اول = عمل + ۵ (${fuFirst(visit.id)})`);
  const pt = postText(visit.id);
  ok(pt.includes(`مراقبتِ اختصاصیِ ${tag}`) && !pt.includes('پانسمان'),
    '**پیامکِ مراقبت = متنِ اختصاصی، نه قالب**');

  console.log('\n۴) پاک‌کردنِ override → بازگشت به قالبِ نوعِ عمل');
  await send(`/visits/${visit.id}`, 'PATCH', { followUpDays: '', postOpCare: '' });
  ok(fuCount(visit.id) === 2 && fuFirst(visit.id) === plusDays(op, 7),
    '**خالی = دوباره روزهای نوعِ عمل**');
  ok(postText(visit.id).includes('پانسمان'), 'متنِ مراقبت دوباره از قالب');

  /* ارقامِ فارسی هم مثلِ خودِ نوعِ عمل پذیرفته می‌شوند (همان parseDays). */
  await send(`/visits/${visit.id}`, 'PATCH', { followUpDays: '۳' });
  ok(fuCount(visit.id) === 1 && fuFirst(visit.id) === plusDays(op, 3),
    `ارقامِ فارسیِ override هم خوانده می‌شود (${fuFirst(visit.id)})`);
  await send(`/visits/${visit.id}`, 'PATCH', { followUpDays: '' });

  console.log('\n۴ب) روزِ ۰ و «بلافاصله بعد از ثبت» + گاردِ ضدتکرار');
  const P2 = '09120000956';
  const visit2 = (await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'بیمارِ', lastName: 'بلافاصله', phone: P2,
    opDate: new Date().toISOString(), procedureTypeId: proc.id,
    surgeonId: surgeon.id, hospitalId: hospital.id,
  })).json;
  trash.visits.push(visit2.id);
  await send(`/visits/${visit2.id}`, 'PATCH', { followUpDays: '0,7' });
  const immFu = () => Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${visit2.id} AND kind='follow_up' AND status='pending' AND due_at <= now() + interval '2 minutes'`));
  ok(fuCount(visit2.id) === 2 && immFu() === 1,
    `**روزِ ۰ = موجِ «همین حالا» + موجِ روزِ ۷** (${fuCount(visit2.id)}/${immFu()})`);
  const p2i = await send(`/visits/${visit2.id}`, 'PATCH', { postOpImmediate: true });
  ok(p2i.status === 200 && p2i.json?.postOpImmediate === true, 'postOpImmediate در نما برگشت');
  const immPost = () => Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${visit2.id} AND kind='post_op_care' AND status='pending' AND due_at <= now() + interval '2 minutes'`));
  ok(immPost() === 1, '**پیامکِ مراقبت بلافاصله بعد از ثبت در صف است**');

  /* پیام‌های فوری «رفتند» — ویرایشِ بعدی نباید دوباره بفرستدشان. */
  sql(`UPDATE reminders SET status='sent', sent_at=now() WHERE visit_id=${visit2.id} AND status='pending' AND due_at <= now() + interval '2 minutes' AND kind IN ('follow_up','post_op_care')`);
  await send(`/visits/${visit2.id}`, 'PATCH', { followUpDays: '0,7' });
  ok(immFu() === 0 && fuCount(visit2.id) === 1,
    '**ویرایشِ دوباره موجِ رفته را تکرار نمی‌کند (فقط روزِ ۷ می‌ماند)**');
  ok(immPost() === 0, '**مراقبتِ ارسال‌شده هم با ویرایش دوباره نمی‌رود**');

  /* جداکنندهٔ تنها («,») نباید روزِ ۰ جا بزند — گاردِ Number('')===0. */
  await send(`/visits/${visit2.id}`, 'PATCH', { followUpDays: ',' });
  ok(fuCount(visit2.id) === 0, 'جداکنندهٔ خالی نه موج می‌سازد نه «بلافاصله»');

  console.log('\n۴ج) مراقبتِ قبل از عمل: قالب، سپس override');
  const preText = (id) => sql(`SELECT replace(text, E'\\n', ' ') FROM reminders WHERE visit_id=${id} AND kind='pre_op_care' AND status='pending'`);
  const opFuture = new Date(Date.now() + 10 * 24 * 3600 * 1000);
  const v3 = (await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'بیمارِ', lastName: 'قبل‌ازعمل', phone: '09120000957',
    opDate: opFuture.toISOString(), procedureTypeId: proc.id, surgeonId: surgeon.id, hospitalId: hospital.id,
  })).json;
  trash.visits.push(v3.id);
  ok(preText(v3.id).includes('ناشتا'), '**قالبِ قبل از عمل از نوعِ عمل کاشته شد**');
  const p3 = await send(`/visits/${v3.id}`, 'PATCH', { preOpCare: `ناشتاییِ اختصاصیِ ${tag}` });
  ok(p3.status === 200 && p3.json?.preOpCare === `ناشتاییِ اختصاصیِ ${tag}`, 'preOpCare در نما برگشت');
  const pt3 = preText(v3.id);
  ok(pt3.includes(`ناشتاییِ اختصاصیِ ${tag}`) && !pt3.includes('نیمه‌شب'),
    '**override مراقبتِ قبل از عمل مقدم است**');
  await send(`/visits/${v3.id}`, 'PATCH', { preOpCare: '' });
  ok(preText(v3.id).includes('ناشتا'), '**خالی = بازگشت به قالبِ نوعِ عمل**');

  console.log('\n۴د) پیش‌فرض‌ها و زمان‌بندی برای نمایش در فرم');
  const procList = (await send('/procedure-types', 'GET')).json;
  const mine = (procList ?? []).find((x) => x.id === proc.id);
  ok(!!mine && mine.preOpCare?.includes('ناشتا') && mine.postOpCare?.includes('پانسمان') && !!mine.followUpDays,
    '**فهرستِ نوعِ عمل قالب‌ها را می‌دهد (فرم پیش‌فرض را نشان می‌دهد)**');
  const tm = await send('/care-plan/timing', 'GET');
  ok(tm.status === 200 && Number.isFinite(tm.json?.preOpDays) && Number.isFinite(tm.json?.postOpDays)
    && Number.isFinite(tm.json?.nextVisitDays) && Number.isFinite(tm.json?.hour),
    `**زمان‌بندیِ ارسال برای نمایش برمی‌گردد** (${JSON.stringify(tm.json)})`);

  console.log('\n۵) /ai/care-draft — پیش‌نویسِ مراقبت از پرونده');
  await setAi({ ai_base_url: 'http://127.0.0.1:3199/v1', ai_api_key: `key-${tag}`, ai_model: 'mock-1' });
  await send(`/patients/${visit.patientId}/notes`, 'POST', {
    kind: 'op', visitId: visit.id, body: `شرحِ عمل: برداشتنِ ضایعه بدونِ عارضه. نشانگرِ ${tag}`,
  });
  mockReply = `- زخم را خشک نگه دارید.\n- طبقِ دستورِ پزشک دارو مصرف کنید. [متنِ ${tag}]`;
  const cd = await send('/ai/care-draft', 'POST', { visitId: visit.id });
  ok(cd.status < 300 && (cd.json?.text ?? '').includes(`[متنِ ${tag}]`), `**متنِ پیش‌نویس برگشت** (${cd.status})`);
  const req = captured[captured.length - 1];
  const sys = req?.body?.messages?.[0]?.content ?? '';
  const usr = req?.body?.messages?.[1]?.content ?? '';
  ok(sys.includes('پانسمان'), '**قالبِ پایهٔ نوعِ عمل در prompt است**');
  ok(usr.includes(`عملِ ${tag}`) && usr.includes(`تشخیصِ ${tag}`) && usr.includes(`نشانگرِ ${tag}`),
    'نوعِ عمل/تشخیص/شرح در prompt هستند');
  ok(!usr.includes('پس‌ازعمل') && !usr.includes(PHONE), '**نام و شمارهٔ بیمار نمی‌رود (کمینه‌سازی)**');
  const bad = await send('/ai/care-draft', 'POST', { visitId: 9999999 });
  ok(bad.status === 400, `مراجعهٔ ناموجود 400 (${bad.status})`);

  console.log('\n۶) مرورگر — بخشِ پس از عمل روی خودِ فرم');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + '/login');
    await page.waitForTimeout(900);
    await page.fill('input[name="identifier"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app**', { timeout: 15000 });

    await page.goto(BASE + `/app/dashboard?patient=${visit.id}`);
    await page.waitForTimeout(2500);
    const sect = page.locator('.db-postop');
    ok(await sect.count() === 1, '**بخشِ «پیگیری و مراقبتِ پس از عمل» در ادامهٔ فرم هست**');
    ok((await sect.locator('h4').innerText()).includes('برنامهٔ مراقبت و پیگیری'), 'عنوانِ بخش درست است');

    /* چیپِ روزها ↔ ورودیِ آزاد هم‌گام‌اند. */
    const dayInput = sect.locator('.db-dayinput');
    ok((await dayInput.inputValue()) === '', 'ورودیِ روزها خالی شروع می‌شود (بدونِ override)');
    await sect.locator('.db-daychip', { hasText: '۷' }).click();
    await sect.locator('.db-daychip', { hasText: '۹۰' }).click();
    ok((await dayInput.inputValue()) === '7,90', `**چیپ‌ها ورودی را پر می‌کنند** (${await dayInput.inputValue()})`);
    await sect.locator('.db-daychip', { hasText: '۹۰' }).click();
    ok((await dayInput.inputValue()) === '7', 'کلیکِ دوباره چیپ را برمی‌دارد');
    ok((await sect.locator('.db-postop-plan').innerText()).includes('۷'),
      'خطِ برنامه روزِ انتخابی را می‌گوید');

    /* پیش‌فرضِ نوعِ عمل باید **دیده** شود — نه اینکه کاربر حدس بزند. */
    const defaults = sect.locator('.db-default');
    ok(await defaults.count() === 2, `پیش‌فرضِ قبل و بعد از عمل نشان داده شد (${await defaults.count()})`);
    ok((await defaults.first().innerText()).includes('ناشتا'), '**متنِ پیش‌فرضِ قبل از عمل روی فرم است**');
    ok(await sect.locator('.db-nodefault').count() === 0, 'چون نوعِ عمل قالب دارد، هشدارِ «تعریف نشده» نیست');
    /* زمانِ ارسال کنارِ عنوان نوشته می‌شود. */
    ok((await sect.locator('.db-carehead').first().innerText()).includes('ارسال:'),
      '**زمانِ ارسال کنارِ عنوان صریح گفته شده**');
    /* «استفاده و ویرایش» پیش‌فرض را داخلِ کادر می‌ریزد تا جراح تغییرش دهد. */
    await defaults.first().locator('button').click();
    ok((await sect.locator('.db-careblock').first().locator('textarea').inputValue()).includes('ناشتا'),
      '**«استفاده و ویرایش» پیش‌فرض را در کادر گذاشت**');
    /* ویزیتِ بعدی داخلِ همین بخش است و در فرم دوبار نیامده. */
    ok(await sect.locator('.jd-wrap, .jdate, input[placeholder="۱۴۰۵/۰۵/۱۰"]').count() >= 1,
      'تاریخِ اولین مراجعهٔ بعد از عمل داخلِ همین بخش است');
    ok(await page.locator('input[placeholder="۱۴۰۵/۰۵/۱۰"]').count() === 1,
      '**ورودیِ ویزیتِ بعدی فقط یک‌بار در فرم هست (بدونِ تکرار)**');

    /* تایپِ آزاد ↔ چیپ‌ها: هر عددِ تایپ‌شده چیپِ انتخاب‌شدهٔ خودش را می‌سازد. */
    await dayInput.fill('1,3');
    const chip1 = sect.locator('.db-daychip').filter({ hasText: /^روزِ ۱$/ });
    const chip3 = sect.locator('.db-daychip').filter({ hasText: /^روزِ ۳$/ });
    ok(await chip1.count() === 1 && (await chip1.getAttribute('class')).includes('on')
      && await chip3.count() === 1 && (await chip3.getAttribute('class')).includes('on'),
      '**عددهای تایپ‌شده چیپِ انتخاب‌شده شدند (۱ و ۳)**');
    await sect.locator('.db-daychip').filter({ hasText: /^بلافاصله$/ }).click();
    ok((await dayInput.inputValue()) === '0,1,3', '**چیپِ «بلافاصله» = روزِ ۰**');
    await chip3.click();
    ok((await dayInput.inputValue()) === '0,1', 'برداشتنِ چیپِ تایپ‌شده از ورودی هم حذف می‌کند');
    /* زمانِ ارسالِ مراقبت — پیش‌فرض فردای عمل، انتخابِ «بلافاصله بعد از ثبت». */
    const immBtn = sect.locator('.db-daychip').filter({ hasText: /^بلافاصله بعد از ثبت$/ });
    ok(await immBtn.count() === 1, 'گزینهٔ زمانِ ارسالِ مراقبت هست');
    await immBtn.click();
    ok((await sect.locator('.db-careblock').nth(1).locator('.db-carehead i').innerText()).includes('بلافاصله بعد از ثبت'),
      '**نشانِ زمانِ ارسال با انتخابِ «بلافاصله» عوض شد**');

    /* دستیار: پیش‌نویسِ مراقبت. */
    mockReply = `- کمپرسِ سرد ۲۰ دقیقه. [مرورگر ${tag}]`;
    const careBtn = sect.locator('.db-aibtn');
    ok(await careBtn.count() === 1, 'دکمهٔ دستیارِ مراقبت هست (aiOn)');
    await careBtn.click();
    await page.waitForTimeout(1800);
    ok((await sect.locator('.db-careblock').nth(1).locator('textarea').inputValue()).includes(`[مرورگر ${tag}]`),
      '**دستیار متنِ مراقبت را نوشت**');

    /* همان «ساخت‌یافته کن/ادامه بنویس» روی شرحِ داخلِ فرم. */
    const rep = page.locator('.db-report');
    await rep.locator('textarea').fill(`شرحِ خام برای بازنویسی ${tag}`);
    const structBtn = rep.locator('.db-aibtn', { hasText: 'ساخت‌یافته' });
    ok(await structBtn.count() === 1, 'دکمهٔ «ساخت‌یافته کن» روی شرحِ فرم هست');
    mockReply = `## شرحِ ساخت‌یافته [${tag}]`;
    await structBtn.click();
    await page.waitForTimeout(1800);
    ok((await rep.locator('textarea').inputValue()).includes(`[${tag}]`), '**شرح بازنویسی شد**');
    ok(await rep.locator('.db-aighost').count() === 1, 'دکمهٔ «برگرداندنِ متنِ خام» آمد');

    /* ذخیره → override واقعاً می‌نشیند و یادآوری‌ها با آن کاشته می‌شوند. */
    await page.locator('.db-submit').click();
    await page.waitForTimeout(2500);
    const savedDays = sql(`SELECT follow_up_days FROM visits WHERE id=${visit.id}`);
    const savedCare = sql(`SELECT post_op_care FROM visits WHERE id=${visit.id}`);
    ok(savedDays === '0,1', `**ذخیرهٔ فرم روزها را نشاند** (${savedDays})`);
    ok(sql(`SELECT post_op_immediate FROM visits WHERE id=${visit.id}`) === 't',
      '**«بلافاصله بعد از ثبت» ذخیره شد**');
    ok((savedCare ?? '').includes(`[مرورگر ${tag}]`), '**ذخیرهٔ فرم متنِ مراقبت را نشاند**');
    /* عمل دو روزِ دیگر است → موجِ ۰ = روزِ عمل (در ساعتِ ارسال)، موجِ ۱ فردایش. */
    ok(fuCount(visit.id) === 2 && fuFirst(visit.id) === plusDays(op, 0),
      '**یادآوری‌ها با مقادیرِ فرم دوباره کاشته شدند (۰ و ۱)**');
    ok(postText(visit.id).includes(`[مرورگر ${tag}]`), 'پیامکِ مراقبت همان متنِ فرم است');
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  mock.close();
  await setAi({ ai_base_url: '', ai_api_key: '', ai_model: '' }).catch(() => {});
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE phone='${PHONE}')`);
  sql(`DELETE FROM clinical_notes WHERE patient_id IN (SELECT id FROM patients WHERE phone='${PHONE}')`);
  sql(`DELETE FROM intake_submissions WHERE patient_id IN (SELECT id FROM patients WHERE phone='${PHONE}')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  /* ⚠️ نقشِ «پیگیریِ عمومی» را **قبل از حذف** برمی‌داریم: اگر حذف به هر دلیل
     شکست بخورد (پاسخِ ثبت‌شده و…)، فرمِ رهاشده پایهٔ پیگیریِ سوئیت‌های دیگر
     می‌شود و آن‌ها را بی‌ربط قرمز می‌کند. */
  for (const id of trash.forms) await send(`/forms/${id}`, 'PATCH', { followUp: null }).catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs) await send(`/procedure-types/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.diags) await send(`/diagnoses/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE phone IN ('09120000956','09120000957'))`);
  sql(`DELETE FROM intake_submissions WHERE patient_id IN (SELECT id FROM patients WHERE phone='09120000956')`);
  sql(`DELETE FROM patients WHERE phone IN ('${PHONE}','09120000956','09120000957') AND id NOT IN (SELECT patient_id FROM visits)`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
