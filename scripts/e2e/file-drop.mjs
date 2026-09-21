/**
 * آپلودرِ چندعکسیِ مشترک (#65):
 *
 * - چند فایل با یک انتخاب می‌روند و **همه** ثبت می‌شوند (تا دیروز یکی).
 * - فایلِ تازه به همان کادر اضافه می‌شود؛ فهرست پاک نمی‌شود.
 * - فایلِ بزرگ‌تر از سقف، **پیشِ ارسال** قرمز می‌شود و بقیه را زمین نمی‌زند.
 * - خطای سرور روی یک فایل ⇒ همان ردیف خطا می‌گیرد و «تلاشِ دوباره» دارد.
 * - کادرِ عکسِ جواب داخلِ فرمِ سفارش هم همان کامپوننت است.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const TMP = '/tmp/claude-0/-home-user-malekteb/95ee6f0b-abd4-5243-b5cd-45d56a076bd0/scratchpad/fd';
const PHONE = '09120000968';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'fd' + randomBytes(3).toString('hex');
/* PNGِ ۱×۱ واقعی — سرور فایلِ تصویریِ سالم می‌خواهد، نه بایتِ تصادفی. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
mkdirSync(TMP, { recursive: true });
const files = ['a', 'b', 'c'].map((n) => {
  const p = `${TMP}/${tag}-${n}.png`;
  writeFileSync(p, PNG);
  return p;
});
/* فایلِ بزرگ‌تر از سقفِ ۲۵ مگابایت — باید پیشِ ارسال رد شود. */
const bigPath = `${TMP}/${tag}-big.png`;
writeFileSync(bigPath, Buffer.concat([PNG, Buffer.alloc(26 * 1024 * 1024)]));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const trash = { visits: [], forms: [] };

try {
  console.log('۱) چیدمان');
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ آپلود', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'آپلودی', phone: PHONE, opDate: new Date().toISOString(),
  })).json;
  trash.visits.push(visit.id);
  const pid = visit.patientId;
  const docs = () => Number(sql(`SELECT count(*) FROM documents WHERE patient_id=${pid}`));
  ok(docs() === 0, 'پرونده بدونِ مدرک شروع می‌شود');

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1150, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + '/login');
    await page.waitForTimeout(900);
    await page.fill('input[name="identifier"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app**', { timeout: 15000 });

    console.log('\n۲) پروندهٔ بیمار — سه فایل با یک انتخاب');
    await page.goto(BASE + `/app/patients/${pid}`);
    await page.waitForTimeout(2000);
    await page.locator('[role="tab"]:has-text("مدارک"), button:has-text("مدارک")').first().click();
    await page.waitForTimeout(1200);
    const drop = page.locator('.fdrop').first();
    ok(await drop.count() === 1, 'کادرِ مشترکِ بارگذاری روی صفحه است');
    await drop.locator('input[type="file"]').setInputFiles(files);
    await page.waitForTimeout(4000);
    ok(await page.locator('.fdrop-item').count() === 3, `**سه فایل با هم در صف نشستند** (${await page.locator('.fdrop-item').count()})`);
    ok(await page.locator('.fdrop-item.done').count() === 3,
      `**هر سه ارسال شدند** (${await page.locator('.fdrop-item.done').count()})`);
    ok(docs() === 3, `**سرور هر سه مدرک را گرفت** (${docs()})`);

    console.log('\n۳) فایلِ تازه به همان کادر اضافه می‌شود');
    await drop.locator('input[type="file"]').setInputFiles([files[0]]);
    await page.waitForTimeout(3000);
    ok(await page.locator('.fdrop-item').count() === 4, '**فهرست پاک نشد؛ موردِ چهارم اضافه شد**');
    ok(docs() === 4, `مدرکِ چهارم هم ثبت شد (${docs()})`);

    console.log('\n۴) فایلِ بزرگ‌تر از سقف');
    await drop.locator('input[type="file"]').setInputFiles([bigPath]);
    await page.waitForTimeout(1500);
    const bad = page.locator('.fdrop-item.error');
    ok(await bad.count() === 1, 'فایلِ بزرگ قرمز شد');
    ok((await bad.innerText()).includes('مگابایت'), '**علتش پیشِ ارسال گفته شد (سقفِ حجم)**');
    ok(docs() === 4, 'و چیزی به سرور نرفت');
    ok(await page.locator('.fdrop-item.done').count() === 4, 'ارسال‌شده‌های قبلی دست‌نخورده ماندند');

    console.log('\n۵) پاک‌کردنِ فهرستِ ارسال‌شده‌ها');
    await page.locator('.fdrop-clear').click();
    await page.waitForTimeout(600);
    ok(await page.locator('.fdrop-item.done').count() === 0 && await page.locator('.fdrop-item.error').count() === 1,
      '**فقط ارسال‌شده‌ها پاک شدند؛ خطا برای رسیدگی ماند**');
    ok(docs() === 4, 'پاک‌کردنِ فهرست مدارکِ سرور را نمی‌برد');
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  sql(`DELETE FROM documents WHERE patient_id IN (SELECT id FROM patients WHERE phone='${PHONE}')`);
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE phone='${PHONE}')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM patients WHERE phone='${PHONE}' AND id NOT IN (SELECT patient_id FROM visits)`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
