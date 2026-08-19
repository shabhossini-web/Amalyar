/**
 * مدل‌های مرکزیِ AI + وراثتِ شرکت‌ها (#51):
 *
 * - پیکربندیِ مرکزی («مادر») در کنترل: اعتبار + مدل به تفکیکِ قابلیت.
 * - شرکتِ بی‌تنظیم همه‌چیز را از مادر می‌خواند (status: source='central').
 * - override: مدلِ گفتگوی خودِ شرکت بر مرکزی مقدم؛ اعتبارِ خودِ شرکت (base+key
 *   با هم) بر اعتبارِ مرکزی مقدم (source='tenant').
 * - «دستورِ اختصاصیِ شرکت» واقعاً واردِ promptِ شرح‌نویسی و قالب‌ساز می‌شود.
 * - endpointهای /platform/ai بدونِ نشستِ پلتفرم باز نیستند.
 * - مرورگر: فیلدهای تازهٔ AI + راهنمای بازشونده در تنظیماتِ شرکت.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const CTRL = process.env.E2E_CTRL_DB ?? 'postgresql://amal:amal@localhost:5432/ctrl_ui';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (db, q) => execSync(`psql "${db}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'ce' + randomBytes(3).toString('hex');

/* سرورِ ساختگی — پاسخِ JSONِ یک‌جا کافی است (استریم در suiteِ خودش سنجیده شده). */
const captured = [];
const mock = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    const body = JSON.parse(data || '{}');
    captured.push({ url: req.url, auth: req.headers.authorization ?? '', body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: `پاسخِ ${tag}` } }] }));
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
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());
const setAi = (values) => send('/settings', 'PATCH', { values });

const trash = { forms: [], visits: [] };

try {
  console.log('۱) وراثت از مادر');
  await setAi({
    ai_base_url: '', ai_api_key: '', ai_model: '', ai_model_vision: '', ai_model_stt: '',
    ai_model_tts: '', ai_model_image: '', ai_prompt_note: '', ai_prompt_template: '',
  });
  sql(CTRL, `INSERT INTO central_ai_config (id, provider, base_url, api_key, model_chat, model_stt, enabled)
             VALUES (1, 'avalai', 'http://127.0.0.1:3199/v1', 'central-key-${tag}', 'central-chat-1', 'whisper-1', true)
             ON CONFLICT (id) DO UPDATE SET provider='avalai', base_url='http://127.0.0.1:3199/v1',
               api_key='central-key-${tag}', model_chat='central-chat-1', model_stt='whisper-1', enabled=true`);
  let st = await get('/ai/status');
  ok(st.enabled === true && st.model === 'central-chat-1' && st.source === 'central',
    `**شرکتِ بی‌تنظیم از مادر می‌خواند** (${st.model}، ${st.source})`);

  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ مرکزی', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'مرکزی‌خوان', phone: '09120000861',
    opDate: new Date().toISOString(),
  })).json;
  trash.visits.push(visit.id);
  const pid = visit.patientId;

  const d1 = await send('/ai/note-draft', 'POST', { patientId: pid, kind: 'visit', text: 'ویزیتِ ساده انجام شد' });
  ok(d1.status < 300 && d1.json?.text === `پاسخِ ${tag}`, 'پیش‌نویس با اعتبارِ مرکزی برگشت');
  let req = captured[captured.length - 1];
  ok(req?.auth === `Bearer central-key-${tag}` && req?.body?.model === 'central-chat-1',
    '**کلید و مدلِ مادر واقعاً در تماس رفت**');

  console.log('\n۲) override به تفکیک');
  await setAi({ ai_model: 'tenant-chat-9' });
  st = await get('/ai/status');
  ok(st.model === 'tenant-chat-9' && st.source === 'central',
    'مدلِ خودِ شرکت مقدم، اعتبار هنوز از مادر');
  await send('/ai/note-draft', 'POST', { patientId: pid, kind: 'visit', text: 'دوباره' });
  req = captured[captured.length - 1];
  ok(req?.body?.model === 'tenant-chat-9' && req?.auth === `Bearer central-key-${tag}`,
    '**ترکیب: مدلِ شرکت + کلیدِ مادر**');
  await setAi({ ai_base_url: 'http://127.0.0.1:3199/v1', ai_api_key: `tenant-key-${tag}` });
  st = await get('/ai/status');
  ok(st.source === 'tenant', 'با اعتبارِ خودِ شرکت source=tenant');
  await send('/ai/note-draft', 'POST', { patientId: pid, kind: 'visit', text: 'سومی' });
  req = captured[captured.length - 1];
  ok(req?.auth === `Bearer tenant-key-${tag}`, 'کلیدِ خودِ شرکت رفت');

  console.log('\n۳) دستورِ اختصاصیِ شرکت در prompt');
  await setAi({ ai_prompt_note: `همیشه در پایان بنویس: کدِ کیفیِ ${tag}` });
  await send('/ai/note-draft', 'POST', { patientId: pid, kind: 'visit', text: 'با دستور' });
  req = captured[captured.length - 1];
  ok((req?.body?.messages?.[0]?.content ?? '').includes(`کدِ کیفیِ ${tag}`),
    '**دستورِ اختصاصیِ شرح‌نویسی واردِ prompt شد**');
  await setAi({ ai_prompt_template: `قالب را با بسم‌الله شروع کن ${tag}` });
  await send('/ai/template-draft', 'POST', { kind: 'op' });
  req = captured[captured.length - 1];
  ok((req?.body?.messages?.[0]?.content ?? '').includes(`بسم‌الله شروع کن ${tag}`),
    '**دستورِ اختصاصیِ قالب‌ساز واردِ prompt شد**');

  console.log('\n۴) خاموشیِ مادر و دروازهٔ پلتفرم');
  sql(CTRL, `UPDATE central_ai_config SET enabled=false WHERE id=1`);
  await setAi({ ai_base_url: '', ai_api_key: '', ai_model: '' });
  st = await get('/ai/status');
  ok(st.enabled === false, 'مادرِ خاموش + شرکتِ بی‌تنظیم = خاموش');
  const pAi = await fetch(API + '/platform/ai').then((r) => r.status);
  ok(pAi === 401 || pAi === 404, `GET /platform/ai بدونِ نشست باز نیست (${pAi})`);
  const pSet = await fetch(API + '/platform/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.status);
  ok(pSet === 401 || pSet === 404 || pSet === 403, `POST /platform/ai هم بسته است (${pSet})`);

  console.log('\n۵) مرورگر — تنظیمات: فیلدهای تازه + راهنما');
  sql(CTRL, `UPDATE central_ai_config SET enabled=true WHERE id=1`);
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
    await page.goto(BASE + '/app/settings');
    await page.waitForTimeout(2200);
    const aiGroup = page.locator('.st-group', { has: page.locator('b:has-text("دستیارِ هوشِ مصنوعی")') });
    ok(await aiGroup.count() === 1, 'گروهِ AI در تنظیمات هست');
    ok(await aiGroup.locator('label:has-text("مدلِ تحلیلِ عکس")').count() === 1, 'فیلدِ مدلِ تحلیلِ عکس');
    ok(await aiGroup.locator('label:has-text("گفتار به متن")').count() === 1, 'فیلدِ ویسپر');
    ok(await aiGroup.locator('label:has-text("دستورِ اختصاصیِ شرکت — شرح‌نویسی")').count() === 1, 'فیلدِ دستورِ اختصاصی');
    await aiGroup.locator('.st-aiguide-btn').click();
    await page.waitForTimeout(400);
    ok((await aiGroup.locator('.st-aiguide-body').innerText()).includes('حریمِ بیمار'),
      '**راهنمای آموزشی باز می‌شود و کامل است**');
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  mock.close();
  await setAi({
    ai_base_url: '', ai_api_key: '', ai_model: '', ai_prompt_note: '', ai_prompt_template: '',
  }).catch(() => {});
  sql(CTRL, `DELETE FROM central_ai_config WHERE id=1`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(DB, `DELETE FROM clinical_notes WHERE patient_id IN (SELECT id FROM patients WHERE phone='09120000861')`);
  sql(DB, `DELETE FROM patients WHERE phone='09120000861'`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
