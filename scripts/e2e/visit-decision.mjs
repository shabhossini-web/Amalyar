/**
 * ساماندهیِ ویزیت (#61):
 *
 * - چهار موضوعِ استانداردِ ویزیت (اولیه/پره‌آپ/پست‌آپ/پیگیریِ درمان) seed شده‌اند.
 * - «فرمِ پیگیری» از فهرستِ ساختِ مراجعه برداشته شده، ولی مراجعاتِ ثبت‌شده با
 *   همان نوع هنوز خوانده و ویرایش می‌شوند (داده دست‌نخورده).
 * - تصمیمِ درمانی روی مراجعه ثبت می‌شود (چندتایی) و مقدارِ نامعتبر رد می‌شود.
 * - مرورگر: ردیفِ تصمیم در فرمِ ویزیت هست و در فرمِ عمل نیست؛ «کاندیدای
 *   جراحی» موضوع را پره‌آپ می‌کند و بعد از ذخیره فرمِ عملِ همان بیمار باز می‌شود.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const PHONE = '09120000961';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'vd' + randomBytes(3).toString('hex');
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
  console.log('۱) موضوع‌های استانداردِ ویزیت');
  const topics = (await send('/visit-topics', 'GET')).json ?? [];
  const names = topics.map((t) => t.name);
  for (const want of ['ویزیتِ اولیه', 'پره‌آپ', 'پست‌آپ', 'پیگیریِ درمان']) {
    ok(names.some((n) => n.includes(want)), `موضوعِ «${want}» هست`);
  }

  console.log('\n۲) «فرمِ پیگیری» از فهرستِ ساخت برداشته شده');
  const kinds = (await send('/forms/visit-kinds', 'GET')).json ?? [];
  ok(!kinds.some((k) => k.kind === 'followup'),
    `**نوعِ «پیگیری» در فهرستِ ساختِ مراجعه نیست** (${kinds.map((k) => k.kind).join('، ')})`);
  ok(kinds.some((k) => k.kind === 'surgery'), 'نوعِ عمل سرِ جایش است');
  /* مراجعهٔ قدیمیِ پیگیری باید هنوز خوانده و ویرایش شود. */
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ تصمیم', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const legacy = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'قدیمی', phone: PHONE, opDate: new Date().toISOString(),
  })).json;
  trash.visits.push(legacy.id);
  sql(`UPDATE visits SET kind='followup' WHERE id=${legacy.id}`);
  const readBack = await send(`/visits/${legacy.id}`, 'GET');
  ok(readBack.status === 200 && readBack.json?.kind === 'followup',
    '**مراجعهٔ قدیمیِ «پیگیری» هنوز خوانده می‌شود (داده دست‌نخورده)**');
  ok((await send(`/visits/${legacy.id}`, 'PATCH', { notes: 'ویرایشِ قدیمی' })).status === 200,
    'و هنوز ویرایش می‌شود');

  console.log('\n۳) ثبتِ تصمیمِ درمانی');
  const v = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'تصمیم', phone: PHONE,
    opDate: new Date().toISOString(), decisions: ['lab', 'consult'],
  })).json;
  trash.visits.push(v.id);
  ok(Array.isArray(v?.decisions) && v.decisions.includes('lab') && v.decisions.includes('consult'),
    `**تصمیمِ چندتایی روی مراجعه نشست** (${(v?.decisions ?? []).join('، ')})`);
  const upd = await send(`/visits/${v.id}`, 'PATCH', { decisions: ['surgery'] });
  ok(upd.status === 200 && upd.json?.decisions?.length === 1 && upd.json.decisions[0] === 'surgery',
    'ویرایشِ تصمیم جایگزین می‌شود');
  const bad = await send(`/visits/${v.id}`, 'PATCH', { decisions: ['xyz'] });
  ok(bad.status === 400, `تصمیمِ نامعتبر رد می‌شود (${bad.status})`);
  ok((await send(`/visits/${v.id}`, 'PATCH', { decisions: [] })).json?.decisions?.length === 0,
    'خالی‌کردنِ تصمیم ممکن است');

  console.log('\n۴) مرورگر — ردیفِ تصمیم و مسیرِ کاندیدای جراحی');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1150, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + '/login');
    await page.waitForTimeout(900);
    await page.fill('input[name="identifier"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app**', { timeout: 15000 });

    /* ویزیت (نه عمل) → ردیفِ تصمیم هست. */
    await page.goto(BASE + `/app/dashboard?patient=${v.id}`);
    await page.waitForTimeout(2500);
    const dec = page.locator('.db-decide');
    ok(await dec.count() === 1, '**تصمیم در فرمِ ویزیت هست**');
    /* از بستهٔ زیرفرم‌ها (۱۴۰۵/۰۷/۰۳) تصمیم یک کشوییِ چندتایی است، نه ردیفِ چیپ؛ چهار
       تصمیمِ «درخواست» (آزمایش، تصویربرداری، مشاوره، ارجاع) در آن نیستند — جایشان
       زیرفرمِ «درخواستِ پاراکلینیک» است و ثبتِ خودِ سفارش کلیدش را می‌گذارد.
       ⚠️ تعداد از `/config.statuses.decision` می‌آید نه عددِ ثابت. */
    await dec.locator('[data-act="decision-open"]').click();
    const opts = dec.locator('.vf-opt');
    const cfgAll = (await send('/config', 'GET')).json?.statuses?.decision ?? [];
    const cfgDec = cfgAll.filter((d) => !d.order).length;
    ok(cfgDec >= 6 && await opts.count() === cfgDec, `همهٔ تصمیم‌های غیرِ درخواستیِ سرور نشان داده شد (${await opts.count()}/${cfgDec})`);
    ok(await dec.locator('.vf-opt[data-decision="lab"]').count() === 0, 'تصمیمِ درخواستی (آزمایش) در کشو نیست');
    ok(await dec.locator('.vf-opt.sep[data-decision="none"]').count() === 1, '«فعلاً نیاز به پیگیریِ بعدی نیست» جدا و انحصاری است');
    await dec.locator('.vf-opt[data-decision="surgery"]').click();
    await dec.locator('.vf-opt[data-decision="none"]').click();
    ok(await dec.locator('[data-decision-tag]').count() === 1 && await dec.locator('[data-decision-tag="none"]').count() === 1,
      '**گزینهٔ انحصاری بقیه را پاک کرد**');
    await dec.locator('.vf-opt[data-decision="surgery"]').click();
    ok(await dec.locator('[data-decision-tag="none"]').count() === 0 && await dec.locator('[data-decision-tag="surgery"]').count() === 1,
      'و انتخابِ دوباره آن را برداشت');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok(await page.locator('.db-sheet').count() === 1 && await dec.locator('.vf-dd-panel').count() === 0,
      'Escape فقط کشو را بست، نه شیتِ مراجعه را');
    ok((await dec.locator('.db-decide-hint').first().innerText()).includes('فرمِ عمل'),
      '**راهنمای «بعد از ذخیره فرمِ عمل باز می‌شود» دیده شد**');
    /* ذخیره → همان ویزیت پره‌آپ می‌شود و **فرمِ عملِ همان بیمار** باز می‌شود. */
    await page.locator('.db-submit').click();
    await page.waitForTimeout(3000);
    const savedDec = sql(`SELECT array_to_string(decisions, ',') FROM visits WHERE id=${v.id}`);
    ok(savedDec.includes('surgery'), `**تصمیمِ «کاندیدای جراحی» ذخیره شد** (${savedDec})`);
    const topicName = sql(`SELECT t.name FROM visits v JOIN visit_topics t ON t.id=v.topic_id WHERE v.id=${v.id}`);
    ok((topicName ?? '').includes('پره‌آپ'), `**موضوعِ ویزیت خودکار پره‌آپ شد** (${topicName || '—'})`);
    const opSheet = page.locator('.db-sheet');
    ok(await opSheet.count() === 1, '**فرمِ عمل بلافاصله باز شد**');
    ok(await page.locator('.db-postop').count() === 1, 'و برنامهٔ مراقبتِ فرمِ عمل داخلش هست');
    ok(await page.locator('.db-decide').count() === 0, 'در فرمِ عمل تصمیم نیست');
    await page.locator('.db-sheet .db-x').click();
    await page.waitForTimeout(800);

    /* فرمِ عمل → ردیفِ تصمیم نباید باشد (تصمیم مالِ ویزیت است). */
    const opVisit = (await send('/visits', 'POST', {
      kind: tag, firstName: 'بیمارِ', lastName: 'عملی', phone: PHONE, opDate: new Date().toISOString(),
    })).json;
    trash.visits.push(opVisit.id);
    sql(`UPDATE visits SET kind='surgery' WHERE id=${opVisit.id}`);
    await page.goto(BASE + `/app/dashboard?patient=${opVisit.id}`);
    await page.waitForTimeout(2500);
    ok(await page.locator('.db-decide').count() === 0, '**در فرمِ عمل تصمیم نیست**');
    ok(await page.locator('.db-postop').count() === 1, 'و به‌جایش برنامهٔ مراقبت هست');
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE phone='${PHONE}')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'PATCH', { followUp: null }).catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM patients WHERE phone='${PHONE}' AND id NOT IN (SELECT patient_id FROM visits)`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
