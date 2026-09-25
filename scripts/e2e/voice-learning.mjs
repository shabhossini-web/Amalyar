/**
 * دستیارِ صوتی + یادگیری از اصلاح‌های کاربر (#56) — با سرورِ ساختگی:
 *
 * - /ai/transcribe: multipart → `audio/transcriptions`ِ گیت‌وی با مدلِ stt و
 *   language=fa؛ بی‌مدل 400ِ روشن؛ بی‌فایل 400.
 * - /ai/parse-patient: دیکتهٔ فارسی → فیلدهای بیمارِ جدید (JSON سخت‌گیرانه،
 *   ارقامِ لاتین)؛ `ai_prompt_voice` در prompt می‌نشیند.
 * - /ai/feedback: جفتِ (پیش‌نویس، نهایی) ذخیره؛ متنِ یکسان ذخیره نمی‌شود؛
 *   دفتر به ۱۰۰ ردیف هرس می‌شود؛ جفت‌ها در promptِ note-draft و care-draft
 *   تزریق می‌شوند.
 * - مرورگر (میکروفونِ ساختگی): ضبط در پرونده → متن در ادیتور می‌نشیند؛
 *   اصلاحِ دستیِ پیش‌نویسِ دستیار + ثبت → ردیفِ ai_feedback واقعی؛ «دیکتهٔ
 *   بیمارِ جدید» فیلدهای گامِ اول را از صدا پر می‌کند (ویسپر → تحلیل).
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const PHONE = '09120000966';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'vl' + randomBytes(3).toString('hex');
let mockReply = 'جواب';
let mockSttText = 'متنِ ویسپر';
let sttMode = 'ok'; // ok | strict | fail
const chatCaps = [];   // بدنه‌های chat/completions
const sttCaps = [];    // {url, auth, type, body} برای audio/transcriptions
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    if (req.url.includes('/audio/transcriptions')) {
      const body = buf.toString('latin1');
      sttCaps.push({
        url: req.url,
        auth: req.headers.authorization ?? '',
        type: req.headers['content-type'] ?? '',
        body,
      });
      /* strict: گیت‌وی‌ای که فیلدِ language را نمی‌شناسد؛ fail: همیشه 400. */
      if (sttMode === 'fail' || (sttMode === 'strict' && body.includes('language'))) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: sttMode === 'fail' ? 'invalid whisper model [x]' : 'Unknown parameter: language' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: mockSttText }));
      return;
    }
    chatCaps.push({ body: JSON.parse(buf.toString('utf8') || '{}') });
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
const sendAudio = async (bytes = 4000) => {
  const fd = new FormData();
  fd.append('audio', new Blob([new Uint8Array(bytes).fill(7)], { type: 'audio/webm' }), 'voice.webm');
  const r = await fetch(API + '/ai/transcribe', {
    method: 'POST', headers: { Authorization: A.Authorization }, body: fd,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const trash = { visits: [], forms: [], procs: [] };

try {
  console.log('۱) transcribe — بی‌مدل 400، با مدل به گیت‌وی می‌رود');
  await setAi({ ai_base_url: 'http://127.0.0.1:3199/v1', ai_api_key: `key-${tag}`, ai_model: 'mock-1', ai_model_stt: '' });
  const noModel = await sendAudio();
  ok(noModel.status === 400 && (noModel.json?.message ?? '').includes('گفتار'),
    `بی‌مدلِ stt 400ِ روشن (${noModel.status})`);

  await setAi({ ai_model_stt: 'whisper-1' });
  mockSttText = `بیمار درد ندارد. [صوت ${tag}]`;
  const tr = await sendAudio();
  ok(tr.status === 200 && tr.json?.text === mockSttText, `**متنِ ویسپر برگشت** (${tr.status})`);
  const cap = sttCaps[sttCaps.length - 1];
  ok(!!cap && cap.type.startsWith('multipart/form-data'), 'آپلود multipart است');
  ok(cap.auth === `Bearer key-${tag}`, 'کلید همان کلیدِ تنظیمات است');
  ok(cap.body.includes('whisper-1') && cap.body.includes('language') && cap.body.includes('fa'),
    '**مدلِ stt و language=fa در درخواستِ گیت‌وی هست**');
  ok(cap.body.includes('voice.webm'), 'خودِ فایلِ صدا رفته');

  const noFile = await fetch(API + '/ai/transcribe', { method: 'POST', headers: { Authorization: A.Authorization }, body: new FormData() })
    .then((r) => r.status);
  ok(noFile === 400, `بی‌فایل 400 (${noFile})`);

  /* گیت‌ویِ سخت‌گیر: فیلدهای اختیاری را 400 می‌کند → تلاشِ دومِ حداقلی. */
  sttMode = 'strict';
  const before = sttCaps.length;
  const tr2 = await sendAudio();
  ok(tr2.status === 200 && tr2.json?.text === mockSttText,
    `**گیت‌ویِ سخت‌گیر: با فرمِ حداقلی دوباره و موفق** (${tr2.status})`);
  ok(sttCaps.length === before + 2 && sttCaps[sttCaps.length - 1].body.includes('model')
    && !sttCaps[sttCaps.length - 1].body.includes('language'),
    'تلاشِ دوم بدونِ فیلدهای اختیاری رفته');

  /* شکستِ واقعی: پیامِ خودِ گیت‌وی باید به کاربر برسد تا قابلِ عیب‌یابی باشد. */
  sttMode = 'fail';
  const tr3 = await sendAudio();
  ok(tr3.status === 502 && (tr3.json?.message ?? '').includes('invalid whisper model'),
    `**پیامِ خودِ گیت‌وی در خطا هست** (${(tr3.json?.message ?? '').slice(0, 80)})`);
  sttMode = 'ok';

  console.log('\n۲) parse-patient — دیکته → فیلدها + پرامپتِ اختصاصی');
  await setAi({ ai_prompt_voice: `قاعدهٔ صوتیِ ${tag}` });
  mockReply = '```json\n{"firstName":"علی","lastName":"رضایی","phone":"۰۹۱۲۱۲۳۴۵۶۷","nationalId":"0013542419","notes":"شکایت از سردرد"}\n```';
  const pp = await send('/ai/parse-patient', 'POST', { text: `بیمارِ جدید علی رضایی ${tag}` });
  ok(pp.status === 200 && pp.json?.fields?.firstName === 'علی' && pp.json?.fields?.lastName === 'رضایی',
    `**فیلدها از دیکته درآمدند** (${pp.status})`);
  ok(pp.json?.fields?.notes === 'شکایت از سردرد', 'باقی حرف‌ها در notes');
  const ppReq = chatCaps[chatCaps.length - 1];
  ok((ppReq?.body?.messages?.[1]?.content ?? '').includes(tag), 'خودِ دیکته در prompt است');
  ok((ppReq?.body?.messages?.[0]?.content ?? '').includes(`قاعدهٔ صوتیِ ${tag}`),
    '**ai_prompt_voice در دستور نشسته (قابلِ پرامپت)**');
  ok((await send('/ai/parse-patient', 'POST', { text: '' })).status === 400, 'دیکتهٔ خالی 400');

  console.log('\n۳) feedback — ذخیره، بی‌تغییر ذخیره نمی‌شود، هرسِ ۱۰۰تایی');
  sql(`DELETE FROM ai_feedback`);
  const fb1 = await send('/ai/feedback', 'POST', { kind: 'visit', draft: `پیش‌نویسِ ${tag}`, final: `نهاییِ ${tag}` });
  ok(fb1.status === 200 && fb1.json?.saved === true, 'جفتِ متفاوت ذخیره شد');
  const fb2 = await send('/ai/feedback', 'POST', { kind: 'visit', draft: 'یکی', final: 'یکی' });
  ok(fb2.json?.saved === false && Number(sql(`SELECT count(*) FROM ai_feedback`)) === 1,
    '**متنِ بی‌تغییر سیگنال نیست و ذخیره نمی‌شود**');
  sql(`INSERT INTO ai_feedback (kind, draft, final) SELECT 'op', 'د', 'ن' FROM generate_series(1, 105)`);
  await send('/ai/feedback', 'POST', { kind: 'op', draft: 'تازه', final: 'تازه‌تر' });
  ok(Number(sql(`SELECT count(*) FROM ai_feedback`)) === 100, '**دفتر به ۱۰۰ ردیفِ اخیر هرس شد**');

  console.log('\n۴) یادگیری — جفت‌ها در promptهای بعدی');
  sql(`DELETE FROM ai_feedback`);
  await send('/ai/feedback', 'POST', { kind: 'visit', draft: `الگویِ خامِ ${tag}`, final: `الگویِ پسندِ ${tag}` });
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ صوتی', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'صوتی', phone: PHONE, opDate: new Date().toISOString(),
  })).json;
  trash.visits.push(visit.id);
  mockReply = 'شرحِ ساخته‌شده';
  await send('/ai/note-draft', 'POST', { patientId: visit.patientId, kind: 'visit', mode: 'structure', text: 'متنِ خام' });
  let sys = chatCaps[chatCaps.length - 1]?.body?.messages?.[0]?.content ?? '';
  ok(sys.includes(`الگویِ خامِ ${tag}`) && sys.includes(`الگویِ پسندِ ${tag}`) && sys.includes('اصلاح'),
    '**جفتِ اصلاح در promptِ شرح‌نویسی تزریق شد**');

  await send('/ai/feedback', 'POST', { kind: 'care', draft: `مراقبتِ خامِ ${tag}`, final: `مراقبتِ پسندِ ${tag}` });
  await send('/ai/care-draft', 'POST', { visitId: visit.id });
  sys = chatCaps[chatCaps.length - 1]?.body?.messages?.[0]?.content ?? '';
  ok(sys.includes(`مراقبتِ پسندِ ${tag}`), '**جفتِ kind=care در promptِ مراقبت هم هست**');

  console.log('\n۵) مرورگر — میکروفونِ ساختگی، ادیتورِ پرونده و دیکتهٔ بیمارِ جدید');
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
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

    /* الف) ضبط در پروندهٔ بیمار → متن در ادیتور. */
    mockSttText = `دیکتهٔ مرورگری [${tag}]`;
    await page.goto(BASE + `/app/patients/${visit.patientId}`);
    await page.waitForTimeout(2000);
    await page.locator('[role="tab"]:has-text("شرح‌ها"), button:has-text("شرح‌ها")').first().click();
    await page.waitForTimeout(1200);
    const mic = page.locator('.rc-notebar .vc-btn');
    ok(await mic.count() === 1, 'دکمهٔ میکروفون در ادیتورِ شرح هست (stt روشن)');
    await mic.click();
    await page.waitForTimeout(300);
    ok(await page.locator('.rc-notebar .vc-btn.vc-rec').count() === 1, 'حالتِ «در حالِ ضبط» دیده می‌شود');
    await page.waitForTimeout(1200);
    await mic.click();
    await page.waitForTimeout(2500);
    const bodyVal = await page.locator('.rc-upload textarea').inputValue();
    ok(bodyVal.includes(`[${tag}]`), '**صدا ضبط، ویسپر، و متن در ادیتور نشست (اندروید/آیفون یک مسیر)**');
    /* فرمتِ آپلودِ مرورگر: WAVِ کامل — نه webmِ بی‌هدر که گیت‌وی‌ها رد می‌کردند. */
    const uiCap = sttCaps[sttCaps.length - 1];
    ok(uiCap.body.includes('voice.wav') && uiCap.body.includes('RIFF') && uiCap.body.includes('WAVEfmt'),
      '**ضبطِ مرورگر WAVِ استاندارد است (هدرِ RIFF کامل)**');

    /* ب) یادگیری: پیش‌نویسِ دستیار + اصلاحِ دستی + ثبت → ردیفِ ai_feedback. */
    sql(`DELETE FROM ai_feedback`);
    mockReply = `شرحِ دستیار [${tag}]`;
    await page.locator('.rc-upload textarea').fill('متنِ خامِ من');
    await page.locator('.rc-ai:not(.rc-ai-cont)').click();
    await page.waitForTimeout(2200);
    const draftVal = await page.locator('.rc-upload textarea').inputValue();
    ok(draftVal.includes(`[${tag}]`), 'پیش‌نویسِ دستیار در ادیتور است');
    await page.locator('.rc-upload textarea').fill(`${draftVal}\nاصلاحِ دستیِ من`);
    await page.locator('.rc-save').click();
    await page.waitForTimeout(2500);
    const fbRow = sql(`SELECT count(*) FROM ai_feedback WHERE kind='visit' AND final LIKE '%اصلاحِ دستیِ من%' AND draft LIKE '%[${tag}]%'`);
    ok(Number(fbRow) === 1, '**اصلاحِ دستی بعد از ثبت، خودکار به‌عنوانِ جفتِ یادگیری ذخیره شد**');

    /* ج) دیکتهٔ بیمارِ جدید: ضبط → ویسپر → تحلیل → فیلدها. */
    mockSttText = `بیمارِ جدید ${tag}`;
    mockReply = '{"firstName":"سارا","lastName":"محمدی","phone":"09121112233","notes":"تماس برای نوبت"}';
    await page.goto(BASE + '/app/dashboard');
    await page.waitForTimeout(2000);
    await page.locator('.db-add').click();
    await page.waitForTimeout(1000);
    const dict = page.locator('.db-dictate .vc-btn');
    ok(await dict.count() === 1, 'دکمهٔ «دیکتهٔ بیمارِ جدید» در گامِ اول هست');
    await dict.click();
    await page.waitForTimeout(1400);
    await dict.click();
    await page.waitForTimeout(3000);
    const fn = await page.locator('.db-sheet input').nth(0).inputValue().catch(() => '');
    const grid = page.locator('.db-sheet .db-grid2').first();
    const first = await grid.locator('input').nth(0).inputValue();
    const last = await grid.locator('input').nth(1).inputValue();
    const phoneVal = await grid.locator('input').nth(2).inputValue();
    ok(first === 'سارا' && last === 'محمدی' && phoneVal === '09121112233',
    `**دیکته فیلدهای بیمارِ جدید را پر کرد** (${first} ${last} ${phoneVal || fn})`);
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  mock.close();
  await setAi({ ai_base_url: '', ai_api_key: '', ai_model: '', ai_model_stt: '', ai_prompt_voice: '' }).catch(() => {});
  sql(`DELETE FROM ai_feedback`);
  sql(`DELETE FROM clinical_notes WHERE patient_id IN (SELECT id FROM patients WHERE phone='${PHONE}')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM patients WHERE phone='${PHONE}' AND id NOT IN (SELECT patient_id FROM visits)`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
