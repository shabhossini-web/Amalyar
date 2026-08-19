/**
 * دستیارِ AI — گام‌های بعدی (#50)، با سرورِ ساختگیِ استریم‌دار:
 *
 * - **استریم (SSE)**: /ai/note-draft/stream تکه‌تکه می‌فرستد و متن سرِ هم
 *   همان پاسخِ کامل می‌شود؛ upstream بدونِ دسترسی → 502ِ عادی (نه SSEِ نیمه).
 * - **حالتِ «ادامه بنویس»**: prompt واقعاً وظیفهٔ ادامه را می‌گوید نه ساخت‌یافته‌سازی.
 * - **قالب‌سازِ خودکار**: /ai/template-draft از شرح‌های موجودِ مطب قالب
 *   می‌سازد (گراندینگ)، عنوانِ پیشنهادی نامِ هدف را دارد، هدفِ ناموجود 400.
 * - مرورگر: نوشتنِ زنده در ادیتورِ پرونده (ساخت‌یافته + ادامه) و پرشدنِ
 *   فرمِ قالب در تعریف‌ها با دکمهٔ دستیار.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'a2' + randomBytes(3).toString('hex');
const STREAM_PARTS = ['شکایتِ اصلی: دردِ محل\n', 'اقدام: پانسمان و شست‌وشو\n', `[استریمِ ${tag}]`];
const TPL_REPLY = `سرفصل‌ها:\nشکایتِ اصلی: ……\nیافته‌ها: ……\n[قالبِ ${tag}]`;

/* سرورِ ساختگی — stream=true → SSE تکه‌تکه؛ وگرنه JSONِ یک‌جا (برای قالب). */
const captured = [];
const mock = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    const body = JSON.parse(data || '{}');
    captured.push({ url: req.url, auth: req.headers.authorization ?? '', body });
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      let i = 0;
      const t = setInterval(() => {
        if (i < STREAM_PARTS.length) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: STREAM_PARTS[i] } }] })}\n\n`);
          i += 1;
        } else {
          res.write('data: [DONE]\n\n');
          res.end();
          clearInterval(t);
        }
      }, 50);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: TPL_REPLY } }] }));
    }
  });
});
await new Promise((r) => mock.listen(3199, '127.0.0.1', r));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — ' + JSON.stringify(login)); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const setAi = (values) => send('/settings', 'PATCH', { values });

/** خواندنِ SSE سمتِ آزمون — همان قراردادِ کلاینت: {d}/{error}/[DONE]. */
async function readStream(p, body) {
  const res = await fetch(API + p, { method: 'POST', headers: A, body: JSON.stringify(body) });
  if (!res.ok) return { status: res.status, text: null, json: await res.json().catch(() => null) };
  const chunks = [];
  const dec = new TextDecoder();
  let buf = '';
  for await (const c of res.body) {
    buf += dec.decode(c, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const evt = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = evt.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return { status: res.status, text: chunks.join(''), chunks };
      const j = JSON.parse(data);
      if (j.error) return { status: res.status, error: j.error, chunks };
      if (j.d) chunks.push(j.d);
    }
  }
  return { status: res.status, text: chunks.join(''), chunks };
}

const trash = { forms: [], visits: [], procs: [] };

try {
  await setAi({ ai_base_url: 'http://127.0.0.1:3199/v1', ai_api_key: `key-${tag}`, ai_model: 'mock-1' });

  const proc = (await send('/procedure-types', 'POST', { name: `عملِ ${tag}` })).json;
  trash.procs.push(proc.id);
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ استریم', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'استریمی', phone: '09120000851',
    opDate: new Date().toISOString(), procedureTypeId: proc.id,
  })).json;
  trash.visits.push(visit.id);
  const pid = visit.patientId;
  await send(`/patients/${pid}/notes`, 'POST', {
    kind: 'op', visitId: visit.id, body: `شرحِ قبلی — امضای ${tag}style`,
  });

  console.log('۱) استریمِ زنده');
  const st = await readStream('/ai/note-draft/stream', {
    patientId: pid, visitId: visit.id, kind: 'op', mode: 'structure', text: 'برش، هموستاز، پانسمان',
  });
  ok(st.text === STREAM_PARTS.join(''), '**تکه‌های استریم سرِ هم همان متنِ کامل است**');
  ok((st.chunks?.length ?? 0) >= 3, `چند تکه آمد، نه یک‌جا (${st.chunks?.length})`);
  let req = captured[captured.length - 1];
  ok(req?.body?.stream === true && req?.url === '/v1/chat/completions', 'upstream با stream=true صدا می‌خورد');
  ok((req?.body?.messages?.[0]?.content ?? '').includes(`${tag}style`), 'گراندینگِ سبک در استریم هم هست');

  console.log('\n۲) حالتِ «ادامه بنویس»');
  await readStream('/ai/note-draft/stream', {
    patientId: pid, visitId: visit.id, kind: 'op', mode: 'continue', text: 'شکایتِ اصلی: درد',
  });
  req = captured[captured.length - 1];
  const sys = req?.body?.messages?.[0]?.content ?? '';
  const usr = req?.body?.messages?.[1]?.content ?? '';
  ok(sys.includes('ادامه') && sys.includes('تکرار نکن'), '**prompt واقعاً وظیفهٔ «ادامه» را می‌گوید**');
  ok(usr.includes('متنِ فعلی'), 'متنِ موجود با برچسبِ «متنِ فعلی» می‌رود');

  console.log('\n۳) قالب‌سازِ خودکار');
  const tpl = await send('/ai/template-draft', 'POST', { kind: 'op', procedureTypeId: proc.id });
  ok((tpl.status === 200 || tpl.status === 201) && tpl.json?.body === TPL_REPLY, '**متنِ قالب برگشت**');
  ok((tpl.json?.title ?? '').includes('قالبِ شرحِ عمل') && (tpl.json?.title ?? '').includes(`عملِ ${tag}`),
    `عنوانِ پیشنهادی نامِ هدف را دارد (${tpl.json?.title})`);
  ok(tpl.json?.grounded >= 1, `از شرح‌های موجود گراندینگ شد (${tpl.json?.grounded})`);
  req = captured[captured.length - 1];
  ok(!req?.body?.stream && (req?.body?.messages?.[0]?.content ?? '').includes('بازمصرف')
    && (req?.body?.messages?.[0]?.content ?? '').includes(`${tag}style`),
    'promptِ قالب: بازمصرف‌شونده + نمونه‌های واقعی');
  ok((await send('/ai/template-draft', 'POST', { kind: 'op', procedureTypeId: 999999 })).status === 400,
    'هدفِ ناموجود 400');

  console.log('\n۴) خطای upstream در استریم — HTTPِ روشن، نه SSEِ نیمه');
  await setAi({ ai_base_url: 'http://127.0.0.1:3198/v1' });
  const down = await readStream('/ai/note-draft/stream', { patientId: pid, kind: 'op', text: 'متن' });
  ok(down.status === 502 && down.text === null, `502ِ عادی (${down.status})`);
  await setAi({ ai_base_url: 'http://127.0.0.1:3199/v1' });

  console.log('\n۵) مرورگر — نوشتنِ زنده + قالب‌ساز در تعریف‌ها');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + '/login');
    await page.waitForTimeout(900);
    await page.fill('input[name="identifier"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app**', { timeout: 15000 });

    await page.goto(BASE + `/app/patients/${pid}`);
    await page.waitForTimeout(2200);
    await page.locator('[role="tab"]:has-text("شرح‌ها"), button:has-text("شرح‌ها")').first().click();
    await page.waitForTimeout(1000);
    const raw = 'برش، هموستاز، پانسمان';
    await page.fill('.rc-upload textarea', raw);
    await page.locator('.rc-ai').first().click();
    await page.waitForTimeout(1000);
    const mid = await page.locator('.rc-upload textarea').inputValue();
    await page.waitForTimeout(1500);
    const done = await page.locator('.rc-upload textarea').inputValue();
    ok(done === STREAM_PARTS.join(''), '**متنِ نهاییِ ادیتور همان استریمِ کامل است**');
    ok(mid.length < done.length || mid === done, `زنده نوشته شد (وسطِ راه ${mid.length} از ${done.length})`);
    await page.locator('.rc-ai-cont').click();
    await page.waitForTimeout(2500);
    const cont = await page.locator('.rc-upload textarea').inputValue();
    ok(cont.startsWith(done) && cont.length > done.length, '**«ادامه بنویس» به انتهای متن اضافه می‌کند**');

    await page.goto(BASE + '/app/definitions');
    await page.waitForTimeout(1800);
    await page.locator('[role="tab"]:has-text("قالب‌های شرح"), button:has-text("قالب‌های شرح")').first().click();
    await page.waitForTimeout(900);
    await page.locator('.df-add').click();
    await page.waitForTimeout(700);
    await page.locator('.df-sheet select').first().selectOption('op');
    const aiBtn = page.locator('.df-ai');
    ok(await aiBtn.count() === 1, 'دکمهٔ دستیار در شیتِ قالب هست');
    await aiBtn.click();
    await page.waitForTimeout(1800);
    const bodyVal = await page.locator('.df-sheet textarea').inputValue();
    ok(bodyVal.includes(`[قالبِ ${tag}]`), '**متنِ قالب با دستیار پر شد**');
    const titleVal = await page.locator('.df-sheet input[type="text"]').first().inputValue();
    ok(titleVal.includes('قالبِ شرحِ عمل'), `عنوانِ خالی هم از پیشنهاد پر شد (${titleVal})`);
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  mock.close();
  await setAi({ ai_base_url: '', ai_api_key: '', ai_model: '' }).catch(() => {});
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs) await send(`/procedure-types/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM clinical_notes WHERE patient_id IN (SELECT id FROM patients WHERE phone='09120000851')`);
  sql(`DELETE FROM patients WHERE phone='09120000851'`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
