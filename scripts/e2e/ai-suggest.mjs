/**
 * خلاصهٔ ارجاع + پیشنهادِ کد از شرح (#53) — با سرورِ ساختگی:
 *
 * - record-summary: داده‌ی promptش مراجعه/تشخیص/شرح دارد ولی **نه نام، نه
 *   شماره** (کمینه‌سازی)؛ پروندهٔ خالی 400ِ روشن.
 * - suggest-codes: نامزدها = کدهای داخلیِ فعال + جستجوی کتاب با نامِ عمل؛
 *   جوابِ مدل سخت‌گیرانه با نامزدها تلاقی می‌شود — کدِ ساختگی دور می‌ریزد؛
 *   مراجعهٔ بی‌شرح 400.
 * - مرورگر: دکمهٔ «خلاصهٔ ارجاع» در پرونده مودال با متن می‌دهد و «ثبت
 *   به‌عنوانِ مشاوره» واقعاً شرح می‌سازد؛ چیپِ پیشنهادِ کد در صورت‌حساب
 *   جستجو را پر می‌کند.
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

const tag = 'sg' + randomBytes(3).toString('hex');
const IC = `AI${tag.slice(2, 6).toUpperCase()}`;
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

const trash = { forms: [], visits: [], procs: [], diags: [], codes: [] };

try {
  await setAi({ ai_base_url: 'http://127.0.0.1:3199/v1', ai_api_key: `key-${tag}`, ai_model: 'mock-1' });

  console.log('۱) چیدمان');
  const proc = (await send('/procedure-types', 'POST', { name: `عملِ ${tag}` })).json;
  trash.procs.push(proc.id);
  const diag = (await send('/diagnoses', 'POST', { title: `تشخیصِ ${tag}` })).json;
  trash.diags.push(diag.id);
  const ic = (await send('/internal-codes', 'POST', { code: IC, name: `تزریقِ ${tag}`, price: 500000 })).json;
  trash.codes.push(ic.id);
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ پیشنهاد', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'ارجاعی', phone: '09120000881',
    opDate: new Date().toISOString(), procedureTypeId: proc.id, diagnosisId: diag.id,
  })).json;
  trash.visits.push(visit.id);
  const pid = visit.patientId;

  console.log('\n۲) پیشنهادِ کد — مراجعهٔ بی‌شرح 400');
  const dry = await send('/ai/suggest-codes', 'POST', { visitId: visit.id });
  ok(dry.status === 400, `بی‌شرح 400 (${dry.status})`);

  await send(`/patients/${pid}/notes`, 'POST', {
    kind: 'op', visitId: visit.id, body: `شرحِ عمل: تزریقِ موضعی انجام شد. نشانگرِ ${tag}`,
  });

  console.log('\n۳) پیشنهادِ کد — اعتبارسنجیِ سخت');
  mockReply = `${IC}\nZZZFAKE99\nهیچ‌کدامِ دیگر`;
  const sug = await send('/ai/suggest-codes', 'POST', { visitId: visit.id });
  ok(sug.status < 300 && Array.isArray(sug.json?.suggestions), `پاسخ آمد (${sug.status})`);
  ok(sug.json.suggestions.some((x) => x.code === IC && x.codeSystem === 'internal' && x.price === 500000),
    '**کدِ داخلیِ واقعی با مبلغ پیشنهاد شد**');
  ok(!sug.json.suggestions.some((x) => x.code === 'ZZZFAKE99'),
    '**کدِ ساختگیِ مدل دور ریخته شد**');
  let req = captured[captured.length - 1];
  const sys = req?.body?.messages?.[0]?.content ?? '';
  ok(sys.includes(IC) && sys.includes(`تزریقِ ${tag}`), 'نامزدها در prompt هستند');
  ok((req?.body?.messages?.[1]?.content ?? '').includes(`نشانگرِ ${tag}`), 'متنِ شرح در prompt است');

  console.log('\n۴) خلاصهٔ ارجاع');
  mockReply = `بیمار با تشخیصِ مذکور تحتِ عمل قرار گرفت. [خلاصهٔ ${tag}]`;
  const sum = await send('/ai/record-summary', 'POST', { patientId: pid });
  ok(sum.status < 300 && (sum.json?.text ?? '').includes(`[خلاصهٔ ${tag}]`), '**متنِ خلاصه برگشت**');
  req = captured[captured.length - 1];
  const data = req?.body?.messages?.[1]?.content ?? '';
  ok(data.includes(`عملِ ${tag}`) && data.includes(`تشخیصِ ${tag}`) && data.includes(`نشانگرِ ${tag}`),
    'مراجعه/تشخیص/شرح در دادهٔ prompt هست');
  ok(!data.includes('ارجاعی') && !data.includes('09120000881'),
    '**نام و شمارهٔ بیمار نمی‌رود (کمینه‌سازی)**');
  const empty = await send('/ai/record-summary', 'POST', { patientId: 999999 });
  ok(empty.status === 400 || empty.status === 404, `پروندهٔ ناموجود رد می‌شود (${empty.status})`);

  console.log('\n۵) مرورگر — مودالِ خلاصه + چیپِ پیشنهاد در صورت‌حساب');
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

    mockReply = `خلاصهٔ ارجاعِ مرورگری [${tag}]`;
    await page.goto(BASE + `/app/patients/${pid}`);
    await page.waitForTimeout(2200);
    const btn = page.locator('.rc-refsum-btn');
    ok(await btn.count() === 1, 'دکمهٔ «خلاصهٔ ارجاع» در پرونده هست');
    await btn.click();
    await page.waitForTimeout(1800);
    ok((await page.locator('.rc-refsum-body').innerText()).includes(`[${tag}]`), '**مودالِ خلاصه با متن باز شد**');
    await page.locator('.rc-refsum-main').click();
    await page.waitForTimeout(1800);
    const saved = sql(`SELECT count(*) FROM clinical_notes WHERE patient_id=${pid} AND kind='consult' AND replaced_at IS NULL`);
    ok(Number(saved) === 1, '**«ثبت به‌عنوانِ مشاوره» واقعاً شرح ساخت**');

    /* صورت‌حساب — از دیپ‌لینکِ داشبورد، دکمهٔ صورت‌حسابِ کارت. */
    mockReply = `${IC}`;
    await page.goto(BASE + `/app/dashboard?patient=${visit.id}`);
    await page.waitForTimeout(2500);
    /* دیپ‌لینک شیتِ ویرایش را باز می‌کند — با X می‌بندیم تا به کارت برسیم. */
    await page.locator('.db-sheet .db-x').click();
    await page.waitForTimeout(900);
    const billBtn = page.locator('button.db-ico[title="صورت‌حساب"]').first();
    ok(await billBtn.count() >= 1, 'دکمهٔ صورت‌حساب پیدا شد');
    await billBtn.click();
    await page.waitForTimeout(1800);
    const aiBtn = page.locator('.bl-ai-btn');
    ok(await aiBtn.count() === 1, 'دکمهٔ پیشنهادِ کد در صورت‌حساب هست');
    await aiBtn.click();
    await page.waitForTimeout(1800);
    const chip = page.locator('.bl-ai-chip');
    ok(await chip.count() === 1 && (await chip.innerText()).includes(IC), '**چیپِ پیشنهاد آمد**');
    await chip.click();
    await page.waitForTimeout(900);
    ok((await page.locator('.bl-codesearch input').inputValue()) === IC,
      '**کلیکِ چیپ جستجوی کد را پر کرد (مسیرِ فیِ همیشگی)**');
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  mock.close();
  await setAi({ ai_base_url: '', ai_api_key: '', ai_model: '' }).catch(() => {});
  sql(`DELETE FROM clinical_notes WHERE patient_id IN (SELECT id FROM patients WHERE phone='09120000881')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.codes) await send(`/internal-codes/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs) await send(`/procedure-types/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.diags) await send(`/diagnoses/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM patients WHERE phone='09120000881'`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
