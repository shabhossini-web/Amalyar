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
    ok((await sect.locator('h4').innerText()).includes('پس از عمل'), 'عنوانِ بخش درست است');

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

    /* دستیار: پیش‌نویسِ مراقبت. */
    mockReply = `- کمپرسِ سرد ۲۰ دقیقه. [مرورگر ${tag}]`;
    const careBtn = sect.locator('.db-aibtn');
    ok(await careBtn.count() === 1, 'دکمهٔ دستیارِ مراقبت هست (aiOn)');
    await careBtn.click();
    await page.waitForTimeout(1800);
    ok((await sect.locator('textarea').inputValue()).includes(`[مرورگر ${tag}]`),
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
    ok(savedDays === '7', `**ذخیرهٔ فرم روزها را نشاند** (${savedDays})`);
    ok((savedCare ?? '').includes(`[مرورگر ${tag}]`), '**ذخیرهٔ فرم متنِ مراقبت را نشاند**');
    ok(fuCount(visit.id) === 1 && fuFirst(visit.id) === plusDays(op, 7),
      '**یادآوری‌ها با مقادیرِ فرم دوباره کاشته شدند**');
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
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs) await send(`/procedure-types/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.diags) await send(`/diagnoses/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM patients WHERE phone='${PHONE}' AND id NOT IN (SELECT patient_id FROM visits)`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
