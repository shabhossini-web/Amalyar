/**
 * فرمِ عمل — سه مرحله، سه تب: قبل / حین / بعد از عمل (بازخوردِ مالک ۱۴۰۵/۰۶/۲۹، بستهٔ ۴)
 * — سرورِ زنده + مرورگرِ واقعی.
 *
 *  باید بیفتد:
 *   - پایینِ فرمِ عمل نوارِ تبِ سه‌تایی از `Tabs` (تک‌منبع) باشد، نه یک ستونِ شلوغ
 *   - عملِ آینده روی «قبل از عمل» باز شود؛ عملِ گذشتهٔ بی‌شرح روی «حین عمل»؛ با شرح روی «بعد از عمل»
 *   - «شرحِ عمل» و ساعت‌ها در تبِ «حین عمل» باشند، نه در کارتِ بالا
 *   - «قبل از عمل» درخواست‌های پاراکلینیک را هم داشته باشد (یافتهٔ جانبیِ بستهٔ ۱)
 *   - جابه‌جایی بین تب‌ها مقدارها را پاک نکند و «ذخیره» هر سه مرحله را با هم بنشاند
 *   - خطِ برنامه بیرونِ تب‌ها همیشه دیده شود
 *  نباید بیفتد:
 *   - فرمِ ویزیت (غیرِ عمل) تبِ مرحله نگیرد؛ هیچ خطای JS/کنسول
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { browserLogin } from './lib/browser-login.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const plusD = (n) => new Date(Date.now() + n * 864e5);

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const H = { Authorization: 'Bearer ' + login.accessToken };
const send = (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const tag = 'ph' + randomBytes(3).toString('hex');
const trash = { visits: [] };

let browser;
try {
  console.log('۱) داده: عملِ آینده، عملِ گذشتهٔ بی‌شرح، و یک ویزیت');
  const kinds = (await send('/forms/visit-kinds')).json ?? [];
  if (!kinds.some((k) => (k.kind ?? k.key) === 'clinic')) await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  const surgeon = (await send('/surgeons')).json?.[0];
  const hospital = (await send('/hospitals')).json?.[0];
  const mk = (kind, opDate, last) => send('/visits', 'POST', {
    kind, firstName: 'مرحله', lastName: `${last}${tag}`, phone: '09120000968', opDate,
    ...(kind === 'surgery' ? { surgeonId: surgeon?.id, hospitalId: hospital?.id } : {}),
  }).then((r) => r.json);
  const future = await mk('surgery', plusD(3).toISOString(), 'آینده');
  const past = await mk('surgery', new Date().toISOString(), 'گذشته');
  const clinic = await mk('clinic', new Date().toISOString(), 'ویزیت');
  ok('سه مراجعه ساخته شد', !!future?.id && !!past?.id && !!clinic?.id, JSON.stringify([future?.id, past?.id, clinic?.id]));
  trash.visits.push(future.id, past.id, clinic.id);
  sql(`UPDATE visits SET op_date = now() - interval '2 days' WHERE id=${past.id}`);

  console.log('\n۲) مرورگر — عملِ آینده: تب‌ها، جای فیلدها، حفظِ مقدار، ذخیره');
  browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, locale: 'fa-IR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
  await browserLogin(page, login.accessToken, { ui: UI });
  const openForm = async (visitId) => {
    await page.goto(`${UI}/app/dashboard?patient=${visitId}`, { waitUntil: 'networkidle' });
    await page.locator('.db-sheet').waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
  };
  await openForm(future.id);
  const sect = page.locator('.db-postop');
  const tabs = sect.locator('.ui-tabs button');
  const active = () => sect.locator('.ui-tabs button[aria-selected="true"]').innerText();
  const tab = (name) => sect.locator('.ui-tabs button', { hasText: name }).click();
  ok('**سه تبِ مرحله از کامپوننتِ مشترکِ Tabs**', (await tabs.count()) === 3 && (await tabs.allInnerTexts()).join('|').includes('قبل از عمل') && (await tabs.allInnerTexts()).join('|').includes('حین عمل') && (await tabs.allInnerTexts()).join('|').includes('بعد از عمل'), (await tabs.allInnerTexts()).join('|'));
  ok('عملِ آینده روی «قبل از عمل» باز می‌شود', (await active()).includes('قبل از عمل'), await active());
  const pre = sect.locator('.db-phase[data-phase="pre"]');
  ok('تبِ قبل: مراقبتِ قبل از عمل + درخواست‌های پیش از عمل', (await pre.innerText()).includes('مراقبت‌های قبل از عمل') && (await pre.innerText()).includes('درخواست‌های پیش از عمل'));
  ok('**درخواستِ آزمایش/تصویربرداری از خودِ فرمِ عمل ممکن است**', (await pre.locator('.db-orders .db-daychip').count()) === 4);
  ok('**شرحِ عمل دیگر در کارتِ بالا نیست**', (await page.locator('.db-formcard .db-report').count()) === 0);
  await pre.locator('.db-careblock').first().locator('textarea').fill(`ناشتاییِ ${tag}`);

  await tab('حین عمل');
  const intra = sect.locator('.db-phase[data-phase="intra"]');
  ok('تبِ حین: شرحِ عمل و ساعت‌ها', (await intra.locator('.db-report textarea').count()) === 1 && (await intra.innerText()).includes('ساعتِ شروع'));
  await intra.locator('.db-report textarea').fill(`یافتهٔ حینِ عمل ${tag}`);

  await tab('بعد از عمل');
  const post = sect.locator('.db-phase[data-phase="post"]');
  ok('تبِ بعد: مراقبتِ بعد، روزهای پیگیری، ویزیتِ پست‌آپ', (await post.innerText()).includes('مراقبت‌های بعد از عمل') && (await post.locator('.db-dayinput').count()) === 1 && (await post.innerText()).includes('اولین مراجعهٔ بعد از عمل'));
  await post.locator('.db-daychip', { hasText: /^روزِ ۷$/ }).click();
  /* روزِ انتخابی فقط وقتی در خط می‌آید که فرمِ پیگیری تعریف شده باشد (وگرنه «ارسال نمی‌شود»)؛
     این‌جا فقط «بیرونِ تب‌ها و همیشه» سنجیده می‌شود — خودِ روز در `postop-flow` سنجیده شده. */
  const planTxt = await sect.locator('.db-postop-plan').innerText();
  ok('خطِ برنامه بیرونِ تب‌ها همیشه دیده می‌شود (هر سه مرحله را خلاصه می‌کند)', (await sect.locator('.db-postop-plan').count()) === 1 && planTxt.includes('پیگیری') && planTxt.includes('مراقبتِ بعد') && planTxt.includes('مراقبتِ قبل'), planTxt.slice(0, 120));

  await tab('قبل از عمل');
  ok('**جابه‌جایی بین تب‌ها مقدار را پاک نمی‌کند**', (await pre.locator('.db-careblock').first().locator('textarea').inputValue()) === `ناشتاییِ ${tag}`);
  await page.locator('.db-submit').click();
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 10000 });
  const saved = (await send(`/visits/${future.id}`)).json;
  ok('**ذخیره هر سه مرحله را با هم نشاند** (شرح، مراقبتِ قبل، روزهای پیگیری)', (saved?.opReport ?? '').includes(tag) && (saved?.preOpCare ?? '').includes(tag) && String(saved?.followUpDays ?? '').includes('7'), JSON.stringify([saved?.opReport, saved?.preOpCare, saved?.followUpDays]));

  console.log('\n۳) تبِ آغازین از زمانِ عمل می‌آید');
  await openForm(past.id);
  ok('عملِ گذشتهٔ بی‌شرح روی «حین عمل» باز می‌شود', (await active()).includes('حین عمل'), await active());
  await page.locator('.db-sheet .db-x').first().click();
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 8000 });
  await send(`/visits/${past.id}`, 'PATCH', { opReport: `شرحِ ثبت‌شده ${tag}` });
  await openForm(past.id);
  ok('عملِ گذشتهٔ شرح‌دار روی «بعد از عمل» باز می‌شود', (await active()).includes('بعد از عمل'), await active());
  await page.locator('.db-sheet .db-x').first().click();
  await page.locator('.db-sheet').waitFor({ state: 'detached', timeout: 8000 });

  console.log('\n۴) نباید بیفتد — فرمِ ویزیت تبِ مرحله ندارد');
  await openForm(clinic.id);
  ok('**فرمِ ویزیت تبِ قبل/حین/بعد ندارد** و برنامهٔ پیام‌هایش سرِ جاست', (await page.locator('.db-postop .ui-tabs').count()) === 0 && (await page.locator('.db-msgplan').count()) === 1);
  ok('هیچ خطای JS/کنسول', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser?.close().catch(() => {});
  for (const v of trash.visits) {
    sql(`DELETE FROM reminders WHERE visit_id=${v}`);
    sql(`DELETE FROM domain_events WHERE visit_id=${v}`);
    await send(`/visits/${v}`, 'DELETE').catch(() => {});
  }
}

console.log(`\nقبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
