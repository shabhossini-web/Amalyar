/**
 * صفحهٔ «امروز» — هشدارِ مشخص و کلیک‌پذیر + عکسِ مشاورهٔ بیمار روی ردیفِ کار
 * (بازخوردِ مالک ۱۴۰۵/۰۶/۲۹، بستهٔ ۳) — سرورِ زنده + مرورگرِ واقعی.
 *
 *  باید بیفتد:
 *   - ردیفِ کارِ «بررسیِ نتیجهٔ مشاوره» عکسی را که بیمار فرستاده **همان‌جا** نشان دهد
 *     (`attachments` از سرور) و کلیک روی عکس شیتِ همان سفارش را باز کند
 *   - هر نمونهٔ نمای استثنا نامِ بیمار را بگوید؛ کارِ بی‌مسئولِ گره‌خورده به سفارش و
 *     نتیجهٔ بررسی‌نشده دکمه باشند و شیتِ همان سفارش را باز کنند
 *   - «بررسی شد» از شیت، ردیفِ کار را **همان لحظه** بردارد (نه یک دقیقه بعد با worker)
 *     و هشدارِ «نتیجهٔ بررسی‌نشده» را هم
 *   - «پردازشِ صف» رویدادِ گیرکرده را پردازش کند و کارتش برود
 *  نباید بیفتد:
 *   - دکمهٔ «پردازشِ صف» بدونِ `canProcess` سرور رندر نشود؛ هیچ خطای JS/کنسول
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
const num = (q) => Number(sql(q));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const H = { Authorization: 'Bearer ' + login.accessToken };
const send = (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const tag = 'tp' + randomBytes(3).toString('hex');
const trash = { visits: [], events: [], work: [], subs: [] };

const answerWithPhoto = async (token) => {
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'consult.png');
  await fetch(`${API}/public/order/${token}/files`, { method: 'POST', body: fd });
  return fetch(`${API}/public/order/${token}/answer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '', link: '', user: '', pass: '' }),
  }).then((r) => r.json());
};

let browser;
try {
  console.log('۱) داده: ویزیت + مشاورهٔ پاسخ‌داده با عکس → کارِ «بررسیِ نتیجه» به نامِ من');
  const kinds = (await send('/forms/visit-kinds')).json ?? [];
  if (!kinds.some((k) => (k.kind ?? k.key) === 'clinic')) await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  const visit = (await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'سارا', lastName: `امروزی${tag}`, phone: '09120000967', opDate: new Date().toISOString(),
  })).json;
  ok('ویزیت ساخته شد', !!visit?.id, JSON.stringify(visit).slice(0, 120));
  trash.visits.push(visit.id);
  const pid = visit.patientId;
  const fullName = `سارا امروزی${tag}`;

  const c1 = (await send('/orders/consult', 'POST', { patientId: pid, visitId: visit.id, specialty: 'قلب', note: tag })).json;
  await send(`/orders/consult/${c1.id}/send`, 'POST');
  const ans = await answerWithPhoto(c1.token);
  ok('مشاوره با عکس پاسخ داده شد', ans?.status === 'answered', JSON.stringify(ans).slice(0, 120));
  await send('/work/process', 'POST');
  const all = (await send('/work?scope=all&limit=300')).json ?? [];
  const rw = (Array.isArray(all) ? all : []).find((w) => w.type === 'review_result' && w.refType === 'consult_order' && w.refId === c1.id);
  ok('کارِ «بررسیِ نتیجه» برای مشاوره ساخته شد', !!rw?.id);
  /* ادمینِ e2e نقشِ شغلی ندارد، پس صفِ «پزشک» در inboxش نیست — به نامِ خودش می‌شود. */
  await send(`/work/${rw.id}`, 'PATCH', { action: 'assign', accountId: login.user.id });
  trash.work.push(rw.id);

  /* استثناها: کارِ بی‌مسئولِ کهنهٔ گره‌خورده به همین مشاوره، نتیجهٔ ۷۲ساعتهٔ
     بررسی‌نشده، ثبت‌نامِ نیمه‌کاره، و یک رویدادِ گیرکرده (بدونِ قاعده تا پردازشش کارِ تازه نسازد). */
  const unowned = num(`INSERT INTO work_items(type, state, performer, title, owner_role, idempotency_key, patient_id, visit_id, ref_type, ref_id, created_at, updated_at)
    VALUES ('call_patient','open','human','تماسِ رهاشده ${tag}','secretary','manual:${tag}:old',${pid},${visit.id},'consult_order',${c1.id}, now()-interval '30 hours', now()-interval '30 hours') RETURNING id`);
  trash.work.push(unowned);
  const c2 = (await send('/orders/consult', 'POST', { patientId: pid, visitId: visit.id, specialty: 'ریه', note: tag })).json;
  await send(`/orders/consult/${c2.id}/send`, 'POST');
  await answerWithPhoto(c2.token);
  sql(`UPDATE consult_orders SET updated_at=now()-interval '72 hours' WHERE id=${c2.id}`);
  const sub = num(`INSERT INTO intake_submissions(token, status, amount, discount_amount, data, expires_at, patient_id, reviewed_at, created_at, updated_at)
    VALUES ('${tag}half', 'approved', 0, 0, '{}'::jsonb, now()+interval '10 days', ${pid}, now(), now(), now()) RETURNING id`);
  trash.subs.push(sub);
  const stuck = num(`INSERT INTO domain_events(type, patient_id, visit_id, at) VALUES ('e2e.noop', ${pid}, ${visit.id}, now()-interval '3 hours') RETURNING id`);
  trash.events.push(stuck);

  console.log('\n۲) پاسخِ `GET /work/today` — هر چیزی می‌گوید مالِ کیست');
  const t0 = (await send('/work/today')).json;
  const row0 = t0?.work?.find((w) => w.id === rw.id);
  ok('کارِ بررسی در فهرستِ امروز است', !!row0, JSON.stringify((t0?.work ?? []).map((w) => [w.id, w.type])).slice(0, 160));
  ok('… با عکسِ بیمار به‌عنوانِ ضمیمه (`attachments`)', row0?.attachments?.length === 1 && row0.attachmentCount === 1 && /^image\//.test(row0.attachments[0].mimeType), JSON.stringify(row0?.attachments));
  const ex = t0?.exceptions;
  const exUn = ex?.unowned?.items?.find((w) => w.id === unowned);
  ok('کارِ بی‌مسئول نامِ بیمار و مقصدِ سفارش را دارد', exUn?.patient?.fullName === fullName && exUn.refType === 'consult_order' && exUn.refId === c1.id, JSON.stringify(exUn));
  const exUr = ex?.unreviewed?.items?.find((o) => o.id === c2.id && o.refType === 'consult_order');
  ok('نتیجهٔ بررسی‌نشده نامِ بیمار و نوعِ سفارش را دارد', exUr?.patient?.fullName === fullName && exUr.kind === 'consult', JSON.stringify(exUr));
  const exHalf = ex?.halfApproved?.items?.find((i) => i.id === sub);
  ok('تأییدِ نیمه‌کاره نامِ بیمار را دارد', exHalf?.patient?.fullName === fullName, JSON.stringify(exHalf));
  const exSt = ex?.stuckEvents?.items?.find((e) => e.id === stuck);
  ok('رویدادِ گیرکرده نامِ بیمار را دارد', exSt?.patient?.fullName === fullName, JSON.stringify(exSt));
  ok('سرور می‌گوید ادمین می‌تواند صف را پردازش کند (`canProcess`)', t0?.canProcess === true);
  ok('**نباید بیفتد:** شیءِ استثناها همگن می‌ماند (فقط `{count, items}`) — سوییتِ `w2-5` رویش حساب می‌کند', Object.values(ex ?? {}).every((v) => v && typeof v === 'object' && 'count' in v && Array.isArray(v.items)));

  console.log('\n۳) مرورگر — عکس روی ردیفِ کار و پاپ‌آپ‌ها');
  browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, locale: 'fa-IR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
  await browserLogin(page, login.accessToken, { ui: UI });
  await page.goto(`${UI}/app`, { waitUntil: 'networkidle' });
  await page.locator('.td-hello').waitFor({ timeout: 15000 });
  const row = page.locator(`.wk-row[data-work-id="${rw.id}"]`);
  await row.waitFor({ timeout: 10000 });
  ok('عنوانِ کار دکمه است (مقصد: سفارش)', (await row.locator('.wk-open').count()) === 1);
  const thumbUp = await page.waitForFunction((id) => {
    const i = document.querySelector(`.wk-row[data-work-id="${id}"] .wk-docs img`);
    return !!i && i.naturalWidth > 0;
  }, rw.id, { timeout: 10000 }).then(() => true).catch(() => false);
  ok('**عکسِ مشاورهٔ بیمار روی خودِ ردیفِ کار دیده می‌شود**', thumbUp);
  await row.locator('.wk-doc').first().click();
  await page.locator('.od-sheet').waitFor({ timeout: 8000 });
  const sheetThumb = await page.waitForFunction(() => { const i = document.querySelector('.od-doc-thumb img'); return !!i && i.naturalWidth > 0; }, null, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('کلیک روی عکس شیتِ همان مشاوره را با عکس باز کرد', sheetThumb && (await page.locator('.od-sheet').innerText()).includes('مشاوره'));
  await page.locator('.od-sheet .db-x').click();
  await page.locator('.od-sheet').waitFor({ state: 'detached', timeout: 8000 });

  console.log('\n۴) نمای استثنا — نام دارد و کلیک می‌شود');
  await page.locator('.td-ex').waitFor({ timeout: 8000 });
  const unBtn = page.locator('.td-ex-card', { hasText: 'کارِ بی‌مسئول' }).locator('button.td-ex-btn', { hasText: `تماسِ رهاشده ${tag}` });
  ok('کارِ بی‌مسئول دکمه است و نامِ بیمار را نشان می‌دهد', (await unBtn.count()) === 1 && (await unBtn.innerText()).includes(fullName), await unBtn.count() ? await unBtn.innerText() : 'نیست');
  await unBtn.click();
  await page.locator('.od-sheet').waitFor({ timeout: 8000 });
  ok('… و شیتِ سفارشِ گره‌خورده باز شد', (await page.locator('.od-sheet').innerText()).includes('مشاوره'));
  await page.locator('.od-sheet .db-x').click();
  await page.locator('.od-sheet').waitFor({ state: 'detached', timeout: 8000 });

  const urCard = page.locator('.td-ex-card', { hasText: 'نتیجهٔ بررسی‌نشده' });
  const urBtn = urCard.locator('button.td-ex-btn', { hasText: fullName });
  ok('نتیجهٔ بررسی‌نشده دکمه است با نامِ بیمار و نوعِ سفارش', (await urBtn.count()) >= 1 && (await urBtn.first().innerText()).includes('مشاوره'), await urBtn.count() ? await urBtn.first().innerText() : 'نیست');
  await urBtn.first().click();
  await page.locator('.od-sheet').waitFor({ timeout: 8000 });
  await page.locator('.od-review textarea').fill('نرمال');
  await page.getByRole('button', { name: 'بررسی شد', exact: true }).click();
  await page.locator('.od-sheet').waitFor({ state: 'detached', timeout: 8000 });
  await page.waitForFunction((name) => ![...document.querySelectorAll('.td-ex-card')].some((c) => c.innerText.includes('نتیجهٔ بررسی‌نشده') && c.innerText.includes(name)), fullName, { timeout: 8000 }).catch(() => {});
  ok('**بعد از بررسی، هشدارِ همان بیمار از نمای استثنا رفت**', (await urCard.locator('button.td-ex-btn', { hasText: fullName }).count()) === 0);
  ok('سفارش در سرور «بررسی‌شده» است', (await send(`/orders?patientId=${pid}`)).json?.find((o) => o.kind === 'consult' && o.id === c2.id)?.status === 'reviewed');

  const halfCard = page.locator('.td-ex-card', { hasText: 'تأییدِ نیمه‌کاره' });
  ok('تأییدِ نیمه‌کاره نامِ بیمار را نشان می‌دهد و به ثبت‌نام‌ها لینک است', (await halfCard.locator('a', { hasText: fullName }).count()) >= 1);

  console.log('\n۵) رویدادِ گیرکرده → «پردازشِ صف»');
  const stCard = page.locator('.td-ex-card', { hasText: 'رویدادِ پردازش‌نشده' });
  ok('کارتِ رویداد نامِ بیمار و دکمهٔ پردازش دارد', (await stCard.locator('.td-ex-who', { hasText: fullName }).count()) >= 1 && (await stCard.locator('.td-ex-act').count()) === 1);
  await stCard.locator('.td-ex-act').click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.td-ex-card')].some((c) => c.innerText.includes('رویدادِ پردازش‌نشده')), null, { timeout: 8000 }).catch(() => {});
  ok('رویداد پردازش شد و کارتش رفت', sql(`SELECT processed_at IS NOT NULL FROM domain_events WHERE id=${stuck}`) === 't' && (await stCard.count()) === 0);

  console.log('\n۶) «بررسی شد» از ردیفِ کار → ردیف همان لحظه می‌رود');
  await row.locator('.wk-open').click();
  await page.locator('.od-sheet').waitFor({ timeout: 8000 });
  await page.locator('.od-review textarea').fill('بررسی شد — نرمال');
  await page.getByRole('button', { name: 'بررسی شد', exact: true }).click();
  await page.locator('.od-sheet').waitFor({ state: 'detached', timeout: 8000 });
  await row.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  ok('**ردیفِ کار بدونِ انتظار برای worker برداشته شد**', (await row.count()) === 0);
  ok('… و در سرور بسته است (نه با پردازشگر)', sql(`SELECT state FROM work_items WHERE id=${rw.id}`) === 'done');

  console.log('\n۷) گیتِ «پردازشِ صف» و سلامتِ صفحه');
  const made = (await send('/accounts/temporary', 'POST', {
    firstName: 'سوپروایزرِ', lastName: `آزمون ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
    level: 4, jobRole: 'secretary', username: `s${tag}`,
  })).json;
  if (made?.account?.id) {
    trash.accounts = [made.account.id];
    const tl = await fetch(API + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: `s${tag}`, password: made.temporaryPassword }),
    }).then((r) => r.json());
    const sup = await fetch(API + '/work/today', { headers: { Authorization: 'Bearer ' + tl.accessToken } }).then((r) => r.json());
    ok('**نباید بیفتد:** سوپروایزر نمای استثنا را می‌بیند ولی `canProcess` ندارد (مجوزِ سوپرادمین)', sup?.sections?.exceptions === true && sup.canProcess === false, JSON.stringify(sup?.canProcess));
  } else { ok(false, `حسابِ آزمایشی ساخته نشد: ${JSON.stringify(made).slice(0, 110)}`); }
  ok('هیچ خطای JS/کنسول', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser?.close().catch(() => {});
  sql(`DELETE FROM work_items WHERE id IN (${trash.work.join(',') || -1}) OR idempotency_key LIKE 'manual:${tag}:%'`);
  sql(`DELETE FROM intake_submissions WHERE token LIKE '${tag}%'`);
  sql(`DELETE FROM domain_events WHERE id IN (${trash.events.join(',') || -1})`);
  for (const v of trash.visits) {
    sql(`DELETE FROM work_items WHERE visit_id=${v}`);
    sql(`DELETE FROM domain_events WHERE visit_id=${v}`);
    await send(`/visits/${v}`, 'DELETE').catch(() => {});
  }
  for (const id of trash.accounts ?? []) {
    sql(`DELETE FROM account_sessions WHERE account_id=${id}`);
    sql(`DELETE FROM accounts WHERE id=${id}`);
  }
}

console.log(`\nقبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
