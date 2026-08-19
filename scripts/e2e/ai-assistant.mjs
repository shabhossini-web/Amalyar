/**
 * دستیارِ هوشِ مصنوعیِ شرح‌نویسی (#49) — با سرورِ ساختگیِ سازگار با OpenAI:
 *
 * - پیکربندی از تنظیماتِ شرکت (base_url/key/model)؛ ناقص = خاموش و 400ِ روشن.
 * - note-draft: prompt واقعاً چه می‌برد؟ (نوعِ شرح، بافتارِ مراجعه، و
 *   **نمونه‌های سبکِ قبلیِ همین مطب** = یادگیریِ تدریجی) و کلید/مدل درست می‌رود.
 * - خطای سرویس → 502ِ قابلِ‌فهم، نه سکوت.
 * - مرورگر: دکمهٔ دستیار در ادیتورِ پرونده متنِ خام را ساخت‌یافته می‌کند و
 *   «برگرداندنِ متنِ خام» برمی‌گرداند.
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

const tag = 'ai' + randomBytes(3).toString('hex');
const MOCK_REPLY = `شکایتِ اصلی: دردِ محل\nاقدام: پانسمان\n[پیش‌نویسِ ساختگیِ ${tag}]`;

/* سرورِ ساختگیِ OpenAI-compatible — هر چه می‌رسد ثبت می‌شود تا خودِ prompt سنجیده شود. */
const captured = [];
const mock = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    captured.push({ url: req.url, auth: req.headers.authorization ?? '', body: JSON.parse(data || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: MOCK_REPLY } }] }));
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
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());
const setAi = (values) => send('/settings', 'PATCH', { values });

const trash = { forms: [], visits: [], procs: [] };

try {
  console.log('۱) خاموش تا پیکربندی نشده');
  await setAi({ ai_base_url: '', ai_api_key: '', ai_model: '' });
  let st = await get('/ai/status');
  ok(st.enabled === false, 'status: خاموش');
  const off = await send('/ai/note-draft', 'POST', { patientId: 1, kind: 'op', text: 'متنِ خام' });
  ok(off.status === 400 && (off.json?.message ?? '').includes('پیکربندی'), `بدونِ پیکربندی 400ِ روشن (${off.status})`);
  const anon = await fetch(API + '/ai/status').then((r) => r.status);
  ok(anon === 401, `بی‌توکن ${anon}`);

  console.log('\n۲) پیکربندی و گراندینگ');
  await setAi({ ai_base_url: 'http://127.0.0.1:3199/v1', ai_api_key: `key-${tag}`, ai_model: 'mock-1' });
  st = await get('/ai/status');
  ok(st.enabled === true && st.model === 'mock-1', 'status: روشن با نامِ مدل');

  const proc = (await send('/procedure-types', 'POST', { name: `عملِ ${tag}` })).json;
  trash.procs.push(proc.id);
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ دستیار', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'دستیارخواه', phone: '09120000841',
    opDate: new Date().toISOString(), procedureTypeId: proc.id,
  })).json;
  trash.visits.push(visit.id);
  const pid = visit.patientId;
  /* شرحِ قبلیِ همان نوع/عمل — باید به‌عنوانِ نمونهٔ سبک واردِ prompt شود. */
  await send(`/patients/${pid}/notes`, 'POST', {
    kind: 'op', visitId: visit.id, body: `شرحِ عملِ پیشینِ کلینیک — امضای سبک: ${tag}style`,
  });

  const draft = await send('/ai/note-draft', 'POST', {
    patientId: pid, visitId: visit.id, kind: 'op', text: 'برشِ کوچک، هموستاز، بخیه. مرخص شد.',
  });
  ok((draft.status === 200 || draft.status === 201) && draft.json?.text === MOCK_REPLY,
    '**پیش‌نویسِ ساخت‌یافته برگشت**');
  const req = captured[captured.length - 1];
  ok(req?.url === '/v1/chat/completions', `مسیرِ OpenAI-compatible (${req?.url})`);
  ok(req?.auth === `Bearer key-${tag}` && req?.body?.model === 'mock-1', 'کلید و مدل از تنظیمات می‌روند');
  const sys = req?.body?.messages?.[0]?.content ?? '';
  const usr = req?.body?.messages?.[1]?.content ?? '';
  ok(sys.includes('شرحِ عمل') && sys.includes(`${tag}style`),
    '**نمونهٔ سبکِ قبلیِ خودِ مطب در prompt است (یادگیریِ تدریجی)**');
  ok(usr.includes(`عملِ ${tag}`) && usr.includes('برشِ کوچک'),
    'بافتارِ مراجعه و متنِ خام در پیام است');
  ok(!usr.includes('دستیارخواه') && !sys.includes('09120000841'),
    '**نام و شمارهٔ بیمار به سرویسِ بیرونی نمی‌رود (کمینه‌سازی)**');

  console.log('\n۳) خطاها');
  ok((await send('/ai/note-draft', 'POST', { patientId: pid, kind: 'bogus', text: 'متن' })).status === 400, 'نوعِ نامعتبر 400');
  await setAi({ ai_base_url: 'http://127.0.0.1:3198/v1' });
  const down = await send('/ai/note-draft', 'POST', { patientId: pid, kind: 'op', text: 'متنِ خام' });
  ok(down.status === 502, `سرویسِ در دسترس‌نبودن 502ِ روشن (${down.status})`);
  await setAi({ ai_base_url: 'http://127.0.0.1:3199/v1' });

  console.log('\n۴) مرورگر — از تایپِ خام تا پیش‌نویس و برگشت');
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
    await page.waitForTimeout(1200);
    /* از #50 دو دکمهٔ دستیار هست (ساخت‌یافته + ادامه) — این‌جا فقط اولی. */
    const aiBtn = page.locator('.rc-ai:not(.rc-ai-cont)');
    ok(await aiBtn.count() === 1, '**دکمهٔ دستیار دیده می‌شود (چون پیکربندی شده)**');
    const raw = 'زخم تمیز بود، پانسمان عوض شد';
    await page.fill('.rc-upload textarea', raw);
    await aiBtn.click();
    await page.waitForTimeout(1800);
    const after = await page.locator('.rc-upload textarea').inputValue();
    ok(after.includes(`[پیش‌نویسِ ساختگیِ ${tag}]`), '**متنِ ادیتور ساخت‌یافته شد**');
    await page.locator('.rc-ai-undo').click();
    ok((await page.locator('.rc-upload textarea').inputValue()) === raw, '«برگرداندنِ متنِ خام» کار می‌کند');
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
  sql(`DELETE FROM clinical_notes WHERE patient_id IN (SELECT id FROM patients WHERE phone='09120000841')`);
  sql(`DELETE FROM patients WHERE phone='09120000841'`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
