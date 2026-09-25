/**
 * دستیارِ جستجوی بالینی (#59) — با سرورِ ساختگی:
 *
 * - پرسشِ آماری («چند درصد گرسپر داشتند؟»): مرحلهٔ ۱ طرحِ جستجو، مرحلهٔ ۲
 *   داوریِ شماره‌ای — اعداد (صورت/مخرج/درصد) سمتِ سرورند نه از مدل.
 * - کمینه‌سازی: promptِ داوری فقط شرح‌های شماره‌دار دارد — نه نام، نه شماره.
 * - نفی/شرطِ عددی با خودِ داوری؛ شمارهٔ خارج از بازه دور ریخته می‌شود.
 * - بی‌نامزد → پاسخِ روشن بدونِ تماسِ دوم.
 * - مرورگر: نوارِ «از دستیار بپرس» در /app/notes — پاسخ + نوارِ درصد +
 *   کارتِ بیمارِ لینک‌دار به پرونده.
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

const tag = 'nq' + randomBytes(3).toString('hex');
/* صفِ پاسخ‌ها — هر پرسشِ دستیار دو تماسِ chat دارد (طرح + داوری). */
const replies = [];
const chatCaps = [];
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    chatCaps.push({ body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: replies.length ? replies.shift() : 'جواب' } }] }));
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

const trash = { visits: [], forms: [] };
const PHONES = ['09120000971', '09120000972', '09120000973'];

try {
  await setAi({ ai_base_url: 'http://127.0.0.1:3199/v1', ai_api_key: `key-${tag}`, ai_model: 'mock-1' });

  console.log('۱) چیدمان: سه بیمار با شرحِ عمل');
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ جستجو', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const NOTES = [
    `از گرسپرِ ${tag} پنج میلی‌متری استفاده شد. کمرا پورتِ ۵.`,
    `گراسپر به کار رفت؛ کمرا پورتِ ۱۰ — نشانگرِ ${tag}`,
    `عمل بدونِ گرسپر انجام شد (${tag}).`,
  ];
  const patients = [];
  for (let i = 0; i < 3; i++) {
    const visit = (await send('/visits', 'POST', {
      kind: tag, firstName: 'بیمارِ', lastName: `جستجو${i + 1}`, phone: PHONES[i],
      opDate: new Date().toISOString(),
    })).json;
    trash.visits.push(visit.id);
    patients.push(visit.patientId);
    await send(`/patients/${visit.patientId}/notes`, 'POST', { kind: 'op', visitId: visit.id, body: NOTES[i] });
  }
  const totalOp = Number(sql(`SELECT COUNT(DISTINCT patient_id) FROM clinical_notes WHERE replaced_at IS NULL AND kind='op'`));
  ok(patients.length === 3 && totalOp >= 3, `سه بیمار کاشته شد (مخرجِ کل: ${totalOp})`);

  console.log('\n۲) پرسشِ آماری — درصد سمتِ سرور، نفی نامنطبق');
  /* «بدونِ گرسپر» هیچ کلیدواژه‌ای ندارد و اصلاً نامزد نمی‌شود — نامزدها
     دو شرحِ گرسپردارند (به ترتیبِ createdAt desc: [۲، ۱])؛ ۹۹ باید دور
     ریخته شود. */
  replies.push(
    JSON.stringify({ keywords: [`گرسپرِ ${tag}`, 'گراسپر', 'grasper'], kind: 'op', mode: 'stats', criterion: 'از گرسپر استفاده شده باشد' }),
    JSON.stringify({ matches: [1, 2, 99], summary: 'در دو عمل گرسپر به کار رفته.' }),
  );
  const st = await send('/ai/notes-query', 'POST', { question: `چند درصدِ بیماران گرسپرِ ${tag} داشتند؟` });
  ok(st.status === 200 && st.json?.mode === 'stats', `پاسخِ آماری آمد (${st.status})`);
  const expPct = Math.round((2 / totalOp) * 100);
  ok(st.json?.stats?.matched === 2 && st.json?.stats?.total === totalOp && st.json?.stats?.percent === expPct,
    `**آمار سمتِ سرور: ۲ از ${totalOp} = ${expPct}٪ (شمارهٔ نامعتبرِ مدل دور ریخته شد)**`);
  ok((st.json?.answer ?? '').includes('٪') && (st.json?.answer ?? '').includes('گرسپر به کار رفته'),
    'پاسخ: عددِ سرور + جمله‌بندیِ مدل');
  ok((st.json?.matches ?? []).length === 2 && st.json.matches.every((m) => m.patientName && m.patientId),
    '**کارتِ بیمارانِ منطبق با نام و لینکِ پرونده برگشت**');

  const planReq = chatCaps[chatCaps.length - 2];
  ok((planReq?.body?.messages?.[1]?.content ?? '').includes(`گرسپرِ ${tag}`), 'پرسشِ خام به مرحلهٔ طرح رفت');
  const judgeReq = chatCaps[chatCaps.length - 1];
  const judgeMsg = judgeReq?.body?.messages?.[1]?.content ?? '';
  ok(judgeMsg.includes('شرحِ 1') && judgeMsg.includes('کمرا پورتِ ۱۰'), 'شرح‌های شماره‌دار در داوری هستند');
  ok(!judgeMsg.includes('بدونِ گرسپر'), 'شرحِ بی‌کلیدواژه اصلاً نامزد نشده');
  ok(!judgeMsg.includes('جستجو1') && !judgeMsg.includes('جستجو۱') && !PHONES.some((ph) => judgeMsg.includes(ph)),
    '**نه نامِ بیمار نه شماره‌ای به مدل نمی‌رود (کمینه‌سازی)**');

  console.log('\n۳) پرسشِ فهرستی با شرطِ عددی');
  replies.push(
    JSON.stringify({ keywords: ['کمرا پورت', 'port'], kind: 'op', mode: 'list', criterion: 'کمرا پورتِ ۵ یا بیشتر' }),
    JSON.stringify({ matches: [1], summary: 'یک مورد پورتِ ۱۰ داشت.' }),
  );
  const ls = await send('/ai/notes-query', 'POST', { question: 'بیمارانی که کمرا پورتِ ۵ یا بیشتر داشتند' });
  ok(ls.status === 200 && ls.json?.mode === 'list' && ls.json?.stats === null,
    'حالتِ فهرستی بدونِ آمار');
  ok((ls.json?.matches ?? []).length === 1 && ls.json.matches[0].snippet.includes('پورتِ ۱۰'),
    '**شرحِ منطبق با شرطِ عددی برگشت**');

  console.log('\n۴) لبه‌ها');
  replies.push(JSON.stringify({ keywords: [`ناموجود${tag}xyz`], kind: 'op', mode: 'list', criterion: 'هرچه' }));
  const before = chatCaps.length;
  const none = await send('/ai/notes-query', 'POST', { question: 'چیزی که وجود ندارد' });
  ok(none.status === 200 && none.json?.matches?.length === 0 && (none.json?.answer ?? '').includes('پیدا نشد'),
    'بی‌نامزد: پاسخِ روشن');
  ok(chatCaps.length === before + 1, '**بدونِ نامزد، تماسِ داوری نمی‌رود (صرفه)**');
  ok((await send('/ai/notes-query', 'POST', { question: '' })).status === 400, 'پرسشِ خالی 400');

  console.log('\n۵) مرورگر — نوارِ دستیار در جستجوی بالینی');
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

    replies.push(
      JSON.stringify({ keywords: [`گرسپرِ ${tag}`, 'گراسپر', 'grasper'], kind: 'op', mode: 'stats', criterion: 'گرسپر استفاده شده' }),
      JSON.stringify({ matches: [1, 2], summary: 'دو عمل با گرسپر.' }),
    );
    await page.goto(BASE + '/app/notes');
    await page.waitForTimeout(2000);
    const box = page.locator('.ns-ai');
    ok(await box.count() === 1, 'نوارِ دستیار روی صفحه هست (aiOn)');
    await box.locator('input').fill(`چند درصد گرسپرِ ${tag} داشتند؟`);
    await box.locator('.ns-ai-ask').click();
    await page.waitForTimeout(2500);
    const answer = await page.locator('.ns-ai-answer').innerText();
    ok(answer.includes('٪'), `**پاسخ با درصد نشسته** (${answer.slice(0, 60)}…)`);
    ok(await page.locator('.ns-ai-meter').count() === 1, 'نوارِ درصد هست');
    const hits = page.locator('.ns-ai-hit');
    ok(await hits.count() === 2, 'دو کارتِ بیمارِ منطبق');
    const href = await hits.first().locator('a.ns-patient').getAttribute('href');
    ok(/^\/app\/patients\/\d+$/.test(href ?? ''), `**کارت به پرونده لینک است** (${href})`);
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  mock.close();
  await setAi({ ai_base_url: '', ai_api_key: '', ai_model: '' }).catch(() => {});
  sql(`DELETE FROM clinical_notes WHERE patient_id IN (SELECT id FROM patients WHERE phone IN ('${PHONES.join("','")}'))`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM patients WHERE phone IN ('${PHONES.join("','")}') AND id NOT IN (SELECT patient_id FROM visits)`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
