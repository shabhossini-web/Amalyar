/**
 * دستیارِ هوشمندِ مدیریت (#52) — با سرورِ ساختگیِ استریم‌دار:
 *
 * - system prompt واقعاً «مشاورِ نرم‌افزار» است: نقشهٔ مسیرها (/app/intake…)
 *   + وضعیتِ لحظه‌ای (فرمِ منتظرِ تایید با نامِ بیمار، نوبتِ امروز، عملِ
 *   بی‌وضعیت) + دستورِ اختصاصیِ شرکت.
 * - تاریخچهٔ چت می‌رود؛ سطحِ زیرِ ادمین ۴۰۳؛ بی‌توکن ۴۰۱.
 * - مرورگر: از کاشیِ لانچر تا چتِ زنده؛ مسیرِ /app/intake در جواب لینک می‌شود.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'aa' + randomBytes(3).toString('hex');
const REPLY = [`دو فرم منتظرِ تایید است؛ برای تایید به `, `/app/intake بروید. [${tag}]`];

const captured = [];
const mock = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    const body = JSON.parse(data || '{}');
    captured.push({ body });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let i = 0;
    const t = setInterval(() => {
      if (i < REPLY.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: REPLY[i] } }] })}\n\n`);
        i += 1;
      } else {
        res.write('data: [DONE]\n\n');
        res.end();
        clearInterval(t);
      }
    }, 50);
  });
});
await new Promise((r) => mock.listen(3199, '127.0.0.1', r));

const loginAs = (identifier, password) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier, password }),
}).then((r) => r.json());
const login = await loginAs('admin', 'test1234');
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b, headers = A) => fetch(API + p, { method: m, headers, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const setAi = (values) => send('/settings', 'PATCH', { values });

async function readStream(body, headers = A) {
  const res = await fetch(API + '/ai/assistant', { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) return { status: res.status, json: await res.json().catch(() => null) };
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
      if (data === '[DONE]') return { status: res.status, text: chunks.join('') };
      const j = JSON.parse(data);
      if (j.d) chunks.push(j.d);
    }
  }
  return { status: res.status, text: chunks.join('') };
}

const trash = { forms: [], visits: [] };

try {
  await setAi({
    ai_base_url: 'http://127.0.0.1:3199/v1', ai_api_key: `key-${tag}`, ai_model: 'mock-1',
    ai_prompt_assistant: `همیشه با «چشم» شروع کن ${tag}`,
  });

  console.log('۱) چیدمانِ وضعیتِ لحظه‌ای');
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ دستیارِ کل', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'منتظرِتایید', phone: '09120000871',
    opDate: new Date(Date.now() - 3 * 864e5).toISOString(),
  })).json;
  trash.visits.push(visit.id);
  sql(`UPDATE visits SET kind='surgery' WHERE id=${visit.id}`); // عملِ گذشتهٔ بی‌وضعیت
  /* فرمِ منتظرِ تایید — ارسالِ مستقیم + جهشِ وضعیت (مسیرِ پرداخت این‌جا موضوع نیست). */
  const survey = (await send('/forms', 'POST', { key: `${tag}s`, title: 'نظرسنجیِ دستیار', scope: 'record' })).json;
  trash.forms.push(survey.id);
  await send('/intake/send', 'POST', { patientId: visit.patientId, formId: survey.id });
  sql(`UPDATE intake_submissions SET status='pending_approval'
       WHERE patient_id=${visit.patientId} AND form_id=${survey.id}`);
  /* نوبتِ امروز — مستقیم در دفتر (ظرفیت این‌جا موضوع نیست). */
  sql(`INSERT INTO appointments (patient_id, date, seq, status, created_at, updated_at)
       VALUES (${visit.patientId}, '${new Date().toISOString().slice(0, 10)}', 77, 'confirmed', now(), now())`);

  console.log('\n۲) چتِ استریمی و محتوای prompt');
  const r1 = await readStream({ messages: [{ role: 'user', content: 'چه فرم‌هایی منتظرِ تاییدند؟' }] });
  ok(r1.status === 200 && r1.text === REPLY.join(''), '**جوابِ استریمی کامل رسید**');
  const req = captured[captured.length - 1];
  const sys = req?.body?.messages?.[0]?.content ?? '';
  /* نقشهٔ نرم‌افزار از `assistant-knowledge.ts` می‌آید (متنش با ماژول‌ها
     نسخه‌بندی می‌شود)؛ وضعیتِ لحظه‌ای هم دیگر متنِ آزاد با نام و نوبت نیست —
     یک JSONِ **کمینه** است: شمارنده‌ها + نتیجهٔ جستجوی مجاز. نام و شمارهٔ
     بیمار به سرویسِ بیرونی نمی‌رود (همان قاعده‌ای که `ai-assistant.mjs`
     صریحاً می‌سنجد)، پس سنجهٔ «نامِ بیمار در prompt» حالا باید **منفی** باشد. */
  ok(sys.includes('/app/intake') && sys.includes('صف تأیید'), '**نقشهٔ نرم‌افزار (مشاور) در prompt است**');
  ok(/"pendingForms":\s*[1-9]/.test(sys), '**صفِ تایید (شمارنده) در وضعیتِ لحظه‌ای است**');
  ok(!sys.includes('منتظرِتایید'), 'نامِ بیمار به سرویسِ بیرونی نمی‌رود (کمینه‌سازی)');
  ok(/"pendingSurgeries":\s*[1-9]/.test(sys), 'عملِ گذشتهٔ بی‌وضعیت شمرده شد');
  ok(sys.includes(`«چشم» شروع کن ${tag}`), '**دستورِ اختصاصیِ شرکت در prompt است**');
  ok(req?.body?.messages?.length === 2 && req.body.messages[1].role === 'user', 'تاریخچه درست می‌رود');

  console.log('\n۲ب) راهنما و هویتِ دستیار از نوعِ همین نصب می‌آید (باید بیفتد)');
  /* ⚠️ مالک (۱۴۰۵/۰۷/۱۵): «دستیار گیج نزند» — مدیرِ مطب نباید دربارهٔ چینش/حمل‌ونقل/انبار بشنود و مدیرِ شرکت
     نباید از «فهرستِ انتظارِ عمل». اینجا **سیم‌کشیِ واقعی** سنجیده می‌شود (kind و ماژول‌های روشن از DBِ همین
     نصب)؛ محتوای هر نوع را `assistant-guide-unit.mjs` روی جدول می‌سنجد. */
  const cfg0 = (await send('/config')).json;
  const promptFor = async () => {
    await readStream({ messages: [{ role: 'user', content: 'مسیرها را بگو' }] });
    return captured[captured.length - 1]?.body?.messages?.[0]?.content ?? '';
  };
  const judge = (s, kind, label) => {
    const clinic = kind === 'clinic';
    ok(s.includes(clinic ? 'مدیریتِ مطب/کلینیک هستی' : 'مدیریتِ شرکتِ خدماتِ جراحی هستی'), `${label}: هویتِ دستیار ${clinic ? 'مطب' : 'شرکت'} است`);
    ok(clinic ? s.includes('/app/waitlist') && s.includes('/app/frontdesk') : s.includes('/app/dispatch') && s.includes('/app/inventory'),
      `${label}: نشانیِ ماژول‌های همین نوع در راهنما هست`);
    ok(clinic ? !/\/app\/(dispatch|transport|inventory|tech)\b/.test(s) : !s.includes('/app/waitlist'),
      `${label}: **نشانیِ ماژولِ نوعِ دیگر نیست**`);
  };
  judge(sys, cfg0.kind, cfg0.kind === 'clinic' ? 'مطب' : 'شرکت');
  const servicesRow0 = sql(`SELECT value FROM settings WHERE key='services'`);
  try {
    const flipped = cfg0.kind === 'clinic' ? 'ionm' : 'clinic';
    ok((await send('/config/vertical', 'PATCH', { vertical: flipped })).status === 200, `تعویضِ نوعِ نصب به ${flipped}`);
    const sys2 = await promptFor();
    judge(sys2, flipped === 'clinic' ? 'clinic' : 'company', 'پس از تعویض');
    ok(sys2 !== sys, 'راهنما با تعویضِ نوع واقعاً عوض شد (کش نشده)');
  } finally {
    await send('/config/vertical', 'PATCH', { vertical: cfg0.vertical });
    sql(`DELETE FROM settings WHERE key='services'`);
    if (servicesRow0) sql(`INSERT INTO settings (key, value) VALUES ('services', '${servicesRow0.replace(/'/g, "''")}')`);
  }
  judge(await promptFor(), cfg0.kind, 'پس از بازگشت');

  const r2 = await readStream({
    messages: [
      { role: 'user', content: 'سلام' },
      { role: 'assistant', content: 'سلام!' },
      { role: 'user', content: 'ادامه' },
    ],
  });
  ok(r2.status === 200, 'چندپیامی هم کار می‌کند');
  ok(captured[captured.length - 1]?.body?.messages?.length === 4, 'تاریخچهٔ کامل + system');

  console.log('\n۳) دروازه‌ها');
  ok((await readStream({ messages: [] })).status === 400, 'بدونِ پیام 400');
  const anon = await fetch(API + '/ai/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.status);
  ok(anon === 401, `بی‌توکن ${anon}`);
  sql(`WITH pr AS (INSERT INTO people (first_name, last_name) VALUES ('منشیِ', 'دستیار') RETURNING id)
       INSERT INTO accounts (username, password_hash, level, status, person_id)
       SELECT '${tag}u', '$2a$10$VFAPklsJPGax940crODU7O5vdzw2Pny43m/rNCXtTwnDx1YwjVOnu', 4, 'active', id FROM pr`);
  const low = await loginAs(`${tag}u`, 'test1234');
  if (low.accessToken) {
    const denied = await readStream({ messages: [{ role: 'user', content: 'سلام' }] },
      { 'Content-Type': 'application/json', Authorization: 'Bearer ' + low.accessToken });
    ok(denied.status === 403, `سطحِ ۴ رد می‌شود (${denied.status})`);
  } else {
    ok(false, 'ورودِ سطحِ ۴ نشد');
  }

  console.log('\n۴) مرورگر — از کاشی تا چت و لینک');
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

    /* W3.7: `/app` صفحهٔ «امروز» است و لانچرِ کاشی‌ها به `/app/tools` رفت. */
    await page.goto(BASE + '/app/tools');
    await page.waitForTimeout(1500);
    const tile = page.locator('a:has-text("دستیارِ هوشمند"), button:has-text("دستیارِ هوشمند")').first();
    ok(await tile.count() === 1, 'کاشیِ لانچر هست');
    await tile.click();
    await page.waitForURL('**/app/assistant**', { timeout: 10000 });
    await page.waitForTimeout(1500);
    ok(await page.locator('.as-starters button').count() >= 3, 'پیشنهادهای شروع دیده می‌شوند');
    await page.locator('.as-starters button').first().click();
    await page.waitForTimeout(2500);
    const bubble = page.locator('.as-msg.assistant .as-bubble').last();
    ok((await bubble.innerText()).includes(`[${tag}]`), '**جوابِ زنده در چت نشست**');
    const link = bubble.locator('a.as-link');
    ok(await link.count() === 1 && (await link.getAttribute('href')) === '/app/intake',
      '**مسیرِ /app/intake در جواب لینکِ کلیک‌شدنی شد**');
    /* بی‌جداسازی، اسلشِ اولِ مسیر در متنِ راست‌به‌چپ به تهش می‌پرید («app/intake/»). */
    ok(await link.evaluate((a) => getComputedStyle(a).direction === 'ltr' && getComputedStyle(a).unicodeBidi === 'isolate'),
      'مسیرِ لینک چپ‌به‌راست و جدا از متنِ فارسی نوشته می‌شود');
    await page.fill('.as-inputbar input', 'مرسی');
    await page.locator('.as-inputbar button[type="submit"]').click();
    await page.waitForTimeout(2200);
    ok(await page.locator('.as-msg.assistant').count() === 2, 'گفتگو ادامه پیدا می‌کند');
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  mock.close();
  await setAi({ ai_base_url: '', ai_api_key: '', ai_model: '', ai_prompt_assistant: '' }).catch(() => {});
  sql(`DELETE FROM appointments WHERE seq=77 AND patient_id IN (SELECT id FROM patients WHERE phone='09120000871')`);
  sql(`DELETE FROM intake_submissions WHERE patient_id IN (SELECT id FROM patients WHERE phone='09120000871')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM account_sessions WHERE account_id IN (SELECT id FROM accounts WHERE username='${tag}u')`);
  sql(`DELETE FROM accounts WHERE username='${tag}u'`);
  sql(`DELETE FROM people WHERE first_name='منشیِ' AND last_name='دستیار'`);
  sql(`DELETE FROM patients WHERE phone='09120000871'`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
