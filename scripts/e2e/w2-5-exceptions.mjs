/**
 * W2.5 — نمای استثنای مدیر روی صفحهٔ «امروز»:
 * - چهار شکاف دیده می‌شوند: کارِ بی‌مسئولِ قدیمی، رویدادِ پردازش‌نشده،
 *   نتیجهٔ بررسی‌نشده، و ثبت‌نامِ تأییدشدهٔ بدونِ مراجعه
 * - «نباید بیفتد»: کارِ بی‌مسئولِ **تازه** (زیرِ ۲۴ ساعت)، کارِ دارای مسئول،
 *   رویدادِ پردازش‌شده، و نتیجهٔ تازه‌پاسخ‌داده (زیرِ ۴۸ ساعت) شمرده نمی‌شوند
 * - گیت: سطح ۲ اصلاً `sections.exceptions=false` می‌گیرد و `exceptions=null`
 * - وقتی هیچ استثنایی نیست، بخش روی صفحه رندر **نمی‌شود**
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { browserLogin } from './lib/browser-login.mjs';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const today = () => send('/work/today', 'GET').then((r) => r.json);

const tag = 'ex' + randomBytes(3).toString('hex');
const trash = { visits: [], forms: [], accounts: [], orders: [], subs: [] };

try {
  console.log('۰) پایهٔ خالی');
  const base = await today();
  ok(base?.sections?.exceptions === true && base.exceptions, 'ادمین نمای استثنا را می‌گیرد');
  const before = Object.fromEntries(Object.entries(base.exceptions).map(([k, v]) => [k, v.count]));

  const form = (await send('/forms', 'POST', { key: tag, title: `ویزیتِ ${tag}`, scope: 'visit' })).json;
  trash.forms.push(form.id);
  const visit = (await send('/visits', 'POST', { kind: tag, firstName: 'نگارِ', lastName: `استثنا${tag}`, phone: '09120000916', opDate: new Date().toISOString() })).json;
  trash.visits.push(visit.id);
  const pid = num(`SELECT patient_id FROM visits WHERE id=${visit.id}`);

  console.log('\n۱) کارِ بی‌مسئولِ قدیمی');
  /* کارِ دستی مالِ سازنده‌اش است؛ برای «بی‌مسئول» باید صفِ نقش باشد و کهنه. */
  const old = num(`INSERT INTO work_items(type, state, performer, title, owner_role, idempotency_key, patient_id, created_at, updated_at)
    VALUES ('call_patient','open','human','تماسِ رهاشده ${tag}','secretary','manual:${tag}:old',${pid}, now()-interval '30 hours', now()-interval '30 hours') RETURNING id`);
  const fresh = num(`INSERT INTO work_items(type, state, performer, title, owner_role, idempotency_key, patient_id, created_at, updated_at)
    VALUES ('call_patient','open','human','تماسِ تازه ${tag}','secretary','manual:${tag}:fresh',${pid}, now(), now()) RETURNING id`);
  const owned = num(`INSERT INTO work_items(type, state, performer, title, owner_account_id, idempotency_key, patient_id, created_at, updated_at)
    VALUES ('call_patient','open','human','تماسِ مسئول‌دار ${tag}',${login.user.id},'manual:${tag}:owned',${pid}, now()-interval '30 hours', now()-interval '30 hours') RETURNING id`);
  const t1 = await today();
  ok(t1.exceptions.unowned.count === before.unowned + 1, `فقط کارِ قدیمیِ بی‌مسئول شمرده شد (${before.unowned} → ${t1.exceptions.unowned.count})`);
  const ids = t1.exceptions.unowned.items.map((w) => w.id);
  ok(ids.includes(old), 'خودش در نمونه‌ها هست');
  ok(!ids.includes(fresh), '**نباید بیفتد:** کارِ بی‌مسئولِ تازه (زیرِ ۲۴ ساعت) استثنا نیست');
  ok(!ids.includes(owned), '**نباید بیفتد:** کارِ دارای مسئول استثنا نیست');

  console.log('\n۲) رویدادِ پردازش‌نشده');
  const stuck = num(`INSERT INTO domain_events(type, patient_id, visit_id, at) VALUES ('visit.done', ${pid}, ${visit.id}, now()-interval '3 hours') RETURNING id`);
  const done = num(`INSERT INTO domain_events(type, patient_id, visit_id, at, processed_at) VALUES ('visit.done', ${pid}, ${visit.id}, now()-interval '3 hours', now()) RETURNING id`);
  const t2 = await today();
  ok(t2.exceptions.stuckEvents.count >= 1 && t2.exceptions.stuckEvents.items.some((e) => e.id === stuck), 'رویدادِ کهنه و پردازش‌نشده دیده شد');
  ok(!t2.exceptions.stuckEvents.items.some((e) => e.id === done), '**نباید بیفتد:** رویدادِ پردازش‌شده استثنا نیست');

  console.log('\n۳) نتیجهٔ بررسی‌نشده');
  const ord = (await send('/orders/imaging', 'POST', { patientId: pid, visitId: visit.id, modalities: ['MRI'] })).json;
  trash.orders.push(ord.id);
  const ord2 = (await send('/orders/imaging', 'POST', { patientId: pid, visitId: visit.id, modalities: ['CT'] })).json;
  trash.orders.push(ord2.id);
  sql(`UPDATE imaging_orders SET status='answered', updated_at=now()-interval '72 hours' WHERE id=${ord.id}`);
  sql(`UPDATE imaging_orders SET status='answered', updated_at=now() WHERE id=${ord2.id}`);
  const t3 = await today();
  const un = t3.exceptions.unreviewed;
  ok(un.count >= 1 && un.items.some((o) => o.id === ord.id && o.refType === 'imaging_order'), 'نتیجهٔ ۷۲ساعته بررسی‌نشده دیده شد');
  ok(!un.items.some((o) => o.id === ord2.id), '**نباید بیفتد:** نتیجه‌ای که همین حالا آمده هنوز استثنا نیست');

  console.log('\n۴) ثبت‌نامِ تأییدشدهٔ بدونِ مراجعه');
  const sub = num(`INSERT INTO intake_submissions(token, status, amount, discount_amount, data, expires_at, patient_id, reviewed_at, created_at, updated_at)
    VALUES ('${tag}half', 'approved', 0, 0, '{}'::jsonb, now()+interval '10 days', ${pid}, now(), now(), now()) RETURNING id`);
  trash.subs.push(sub);
  const subOk = num(`INSERT INTO intake_submissions(token, status, amount, discount_amount, data, expires_at, patient_id, visit_id, reviewed_at, created_at, updated_at)
    VALUES ('${tag}full', 'approved', 0, 0, '{}'::jsonb, now()+interval '10 days', ${pid}, ${visit.id}, now(), now(), now()) RETURNING id`);
  trash.subs.push(subOk);
  /* فرمِ **زیرپرونده** (`scope='record'`) عمداً مراجعه نمی‌سازد — قاعدهٔ خودِ
     مخزن `makesVisit = scope !== 'record'`. پاسخِ سالمِ آن نباید استثنا شمرده
     شود، وگرنه نمای مدیر پر از هشدارِ دروغین می‌شود. */
  const recForm = (await send('/forms', 'POST', { key: `${tag}rec`, title: `زیرپروندهٔ ${tag}`, scope: 'record' })).json;
  trash.forms = trash.forms ?? [];
  if (recForm?.id) trash.forms.push(recForm.id);
  const subRec = num(`INSERT INTO intake_submissions(token, status, amount, discount_amount, data, expires_at, patient_id, form_id, reviewed_at, created_at, updated_at)
    VALUES ('${tag}rec', 'approved', 0, 0, '{}'::jsonb, now()+interval '10 days', ${pid}, ${recForm?.id ?? 'NULL'}, now(), now(), now()) RETURNING id`);
  trash.subs.push(subRec);

  const t4 = await today();
  const half = t4.exceptions.halfApproved;
  ok(half.count === before.halfApproved + 1 && half.items.some((i) => i.id === sub), 'ثبت‌نامِ تأییدشدهٔ بدونِ مراجعه دیده شد');
  ok(!half.items.some((i) => i.id === subOk), '**نباید بیفتد:** ثبت‌نامِ تأییدشده‌ای که مراجعه دارد استثنا نیست');
  ok(!half.items.some((i) => i.id === subRec),
    '**نباید بیفتد:** پاسخِ سالمِ فرمِ زیرپرونده «تأییدِ نیمه‌کاره» شمرده شود (گزارشِ لِینِ الف)');

  console.log('\n۵) روی صفحه');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); });
  try {
    await browserLogin(page, login.accessToken, { ui: UI });
    await page.goto(UI + '/app', { waitUntil: 'networkidle' });
    await page.waitForSelector('.td-ex', { timeout: 15000 });
    const cards = await page.locator('.td-ex-card').count();
    ok(cards === 4, `هر چهار ردیفِ استثنا کارت دارند (${cards})`);
    const txt = (await page.locator('.td-ex').innerText()).replace(/\s+/g, ' ');
    ok(/کارِ بی‌مسئول/.test(txt) && /رویدادِ پردازش‌نشده/.test(txt) && /نتیجهٔ بررسی‌نشده/.test(txt) && /تأییدِ نیمه‌کاره/.test(txt), 'عنوانِ هر چهار ردیف روی صفحه است');
    ok(/تماسِ رهاشده/.test(txt), 'نمونهٔ واقعی (نه فقط عدد) نشان داده می‌شود');
    ok(errors.length === 0, `بدونِ خطای جاوااسکریپت (${errors.length})${errors.length ? ' — ' + errors[0].slice(0, 140) : ''}`);

    console.log('\n۶) گیتِ نقش');
    const made = (await send('/accounts/temporary', 'POST', {
      firstName: 'کارشناسِ', lastName: `استثنا ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
      level: 2, jobRole: 'technician', username: `x${tag}`,
    })).json;
    if (made?.account?.id) {
      trash.accounts.push(made.account.id);
      const tl = await fetch(API + '/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: `x${tag}`, password: made.temporaryPassword }),
      }).then((r) => r.json());
      const mine = await fetch(API + '/work/today', { headers: { Authorization: 'Bearer ' + tl.accessToken } }).then((r) => r.json());
      ok(mine?.sections?.exceptions === false && mine.exceptions === null,
        '**نباید بیفتد:** سطح ۲ نمای استثنا را نه بخش دارد نه داده');
    } else { ok(false, `حسابِ آزمایشی ساخته نشد: ${JSON.stringify(made).slice(0, 110)}`); }

    console.log('\n۷) بدونِ استثنا، بخش رندر نمی‌شود');
    sql(`DELETE FROM work_items WHERE id IN (${old},${fresh},${owned})`);
    sql(`DELETE FROM domain_events WHERE id IN (${stuck},${done})`);
    sql(`DELETE FROM imaging_orders WHERE id IN (${trash.orders.join(',') || -1})`);
    sql(`DELETE FROM intake_submissions WHERE id IN (${trash.subs.join(',') || -1})`);
    trash.orders = []; trash.subs = [];
    const clean = await today();
    const zero = Object.values(clean.exceptions).every((v) => v.count === 0);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.td-hello', { timeout: 10000 });
    if (zero) ok(await page.locator('.td-ex').count() === 0, 'با صفرشدنِ همهٔ ردیف‌ها بخش اصلاً رندر نمی‌شود');
    else ok(await page.locator('.td-ex').count() === 1, 'روی نصبِ دارای استثنای قبلی، بخش سرِ جایش می‌ماند');
  } finally { await browser.close().catch(() => {}); }
} finally {
  sql(`DELETE FROM work_items WHERE idempotency_key LIKE 'manual:${tag}:%'`);
  sql(`DELETE FROM intake_submissions WHERE token LIKE '${tag}%'`);
  sql(`DELETE FROM imaging_orders WHERE id IN (${trash.orders.join(',') || -1})`);
  for (const v of trash.visits) {
    sql(`DELETE FROM domain_events WHERE visit_id=${v}`);
    sql(`DELETE FROM imaging_orders WHERE visit_id=${v}`);
    sql(`DELETE FROM intake_submissions WHERE visit_id=${v}`);
    await send(`/visits/${v}`, 'DELETE').catch(() => {});
  }
  for (const f of (trash.forms ?? [])) await send(`/forms/${f}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    sql(`DELETE FROM account_sessions WHERE account_id=${id}`);
    sql(`DELETE FROM accounts WHERE id=${id}`);
  }
}
console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
