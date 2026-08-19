/**
 * نامهٔ اداری (#47):
 *
 * - شماره‌گذاری خودکار «سالِ شمسی/شماره» — متوالی؛ بعد از حذفِ نامهٔ وسط،
 *   شماره‌ها **دوباره مصرف نمی‌شوند** (بیشینه+۱ نه شمارش).
 * - CRUD: ساخت/ویرایش (شماره ثابت)/حذف + جستجو.
 * - دروازهٔ سطح: بی‌توکن ۴۰۱؛ حسابِ سطحِ ۴ (منشی) ۴۰۳ — نامهٔ رسمی کارِ ادمین است.
 * - مرورگر: کاشیِ لانچر → صفحه → صدورِ نامه → چاپ (پاپ‌آپ با شماره و موضوع).
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'lt' + randomBytes(3).toString('hex');

const loginAs = (identifier, password) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier, password }),
}).then((r) => r.json());

const login = await loginAs('admin', 'test1234');
if (!login.accessToken) { console.error('ورود نشد — ' + JSON.stringify(login)); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b, headers = A) => fetch(API + p, { method: m, headers, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const made = [];

try {
  console.log('۱) شماره‌گذاری');
  const l1 = (await send('/letters', 'POST', { recipient: `گیرندهٔ ${tag}`, subject: `موضوعِ اولِ ${tag}`, body: 'با سلام؛\nمتنِ آزمون.' })).json;
  made.push(l1.id);
  ok(/^\d{4}\/\d+$/.test(l1.no ?? ''), `قالبِ شماره «سال/شماره» (${l1.no})`);
  const l2 = (await send('/letters', 'POST', { recipient: `گیرندهٔ ${tag}`, subject: `موضوعِ دومِ ${tag}`, body: 'متن ۲', attachment: 'تصویرِ قرارداد' })).json;
  made.push(l2.id);
  const n1 = Number(l1.no.split('/')[1]);
  const n2 = Number(l2.no.split('/')[1]);
  ok(n2 === n1 + 1 && l2.no.split('/')[0] === l1.no.split('/')[0], `متوالی در همان سال (${l1.no} → ${l2.no})`);

  console.log('\n۲) ویرایش و جستجو');
  const patched = (await send(`/letters/${l1.id}`, 'PATCH', { subject: `موضوعِ ویراستهٔ ${tag}` })).json;
  ok(patched.subject.includes('ویراسته') && patched.no === l1.no, '**ویرایش، شماره را عوض نمی‌کند**');
  const found = (await send(`/letters?t=${encodeURIComponent('ویراستهٔ ' + tag)}`, 'GET')).json;
  ok(Array.isArray(found) && found.length === 1 && found[0].id === l1.id, 'جستجو در موضوع کار می‌کند');
  const byNo = (await send(`/letters?t=${encodeURIComponent(l2.no)}`, 'GET')).json;
  ok(byNo.some((x) => x.id === l2.id), 'جستجو با شماره هم می‌آید');
  const bad = await send(`/letters/${l1.id}`, 'PATCH', { subject: 'x' });
  ok(bad.status === 400, `موضوعِ یک‌حرفی رد می‌شود (${bad.status})`);

  console.log('\n۳) حذف بدونِ بازمصرفِ شماره');
  const l3 = (await send('/letters', 'POST', { recipient: `گ ${tag}`, subject: `سومِ ${tag}`, body: 'متن ۳' })).json;
  made.push(l3.id);
  await send(`/letters/${l2.id}`, 'DELETE');
  const l4 = (await send('/letters', 'POST', { recipient: `گ ${tag}`, subject: `چهارمِ ${tag}`, body: 'متن ۴' })).json;
  made.push(l4.id);
  ok(Number(l4.no.split('/')[1]) === Number(l3.no.split('/')[1]) + 1 && l4.no !== l2.no,
    `**شمارهٔ حذف‌شدهٔ وسط دوباره صادر نمی‌شود** (${l2.no} حذف شد، بعدی ${l4.no})`);

  console.log('\n۴) دروازهٔ سطح');
  const anon = await fetch(API + '/letters').then((r) => r.status);
  ok(anon === 401, `بی‌توکن ${anon}`);
  /* حسابِ سطحِ ۴ با SQL کاشته می‌شود (هَشِ همان test1234) — سطحِ زیرِ ادمین
     نباید سندِ رسمی صادر کند. */
  sql(`WITH pr AS (
         INSERT INTO people (first_name, last_name) VALUES ('منشیِ', 'آزمون') RETURNING id
       )
       INSERT INTO accounts (username, password_hash, level, status, person_id)
       SELECT '${tag}u', '$2a$10$VFAPklsJPGax940crODU7O5vdzw2Pny43m/rNCXtTwnDx1YwjVOnu', 4, 'active', id FROM pr`);
  const low = await loginAs(`${tag}u`, 'test1234');
  if (low.accessToken) {
    const L = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + low.accessToken };
    const denied = await send('/letters', 'GET', null, L);
    ok(denied.status === 403, `سطحِ ۴ رد می‌شود (${denied.status})`);
  } else {
    ok(false, 'ورودِ حسابِ سطحِ ۴ نشد: ' + JSON.stringify(low).slice(0, 120));
  }

  console.log('\n۵) مرورگر — لانچر تا چاپ');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + '/login');
    await page.waitForTimeout(900);
    await page.fill('input[name="identifier"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app**', { timeout: 15000 });

    await page.goto(BASE + '/app');
    await page.waitForTimeout(1800);
    const tile = page.locator('a:has-text("نامهٔ اداری"), button:has-text("نامهٔ اداری")').first();
    ok(await tile.count() === 1, 'کاشیِ لانچر روشن شد');
    await tile.click();
    await page.waitForURL('**/app/letters**', { timeout: 10000 });
    await page.waitForTimeout(1500);

    await page.locator('.lt-new').click();
    await page.waitForTimeout(600);
    await page.fill('.lt-sheet input[placeholder*="مدیریت"]', 'مدیریتِ محترمِ آزمایشگاه');
    await page.fill('.lt-sheet input[placeholder="موضوعِ نامه"]', `درخواستِ مرورگریِ ${tag}`);
    await page.fill('.lt-sheet textarea', 'با سلام و احترام؛\nاین نامه از آزمونِ مرورگری صادر شده است.');
    await page.locator('.lt-sheet button:has-text("صدورِ نامه")').click();
    await page.waitForTimeout(1800);
    const row = page.locator('.lt-row', { has: page.locator(`b:has-text("درخواستِ مرورگریِ ${tag}")`) });
    ok(await row.count() === 1, '**نامهٔ صادرشده با شماره در فهرست است**');
    const noTxt = await row.locator('.lt-no').innerText();
    ok(/[۰-۹]{4}\/[۰-۹]+/.test(noTxt), `شمارهٔ فارسی روی ردیف (${noTxt})`);

    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 15000 }),
      row.locator('.lt-print').click(),
    ]);
    await popup.waitForTimeout(900);
    const html = await popup.content();
    ok(html.includes(`درخواستِ مرورگریِ ${tag}`) && html.includes('موضوع:'), 'پاپ‌آپِ چاپ موضوع را دارد');
    ok(html.includes('شماره:') && html.includes('پیوست:'), 'بلوکِ شماره/تاریخ/پیوست چاپ می‌شود');
    await popup.close();
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  sql(`DELETE FROM letters WHERE subject LIKE '%${tag}%' OR recipient LIKE '%${tag}%'`);
  for (const id of made) sql(`DELETE FROM letters WHERE id=${id}`);
  sql(`DELETE FROM account_sessions WHERE account_id IN (SELECT id FROM accounts WHERE username='${tag}u')`);
  sql(`DELETE FROM people WHERE id IN (SELECT person_id FROM accounts WHERE username='${tag}u')`);
  sql(`DELETE FROM accounts WHERE username='${tag}u'`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
