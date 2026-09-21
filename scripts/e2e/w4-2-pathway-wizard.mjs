/**
 * W4.2 گامِ ۲ — ویزاردِ ساختِ الگو + «عدمِ پاسخ»ِ واقعی.
 *
 * معیارِ پذیرشِ سند: «مدیرِ مجاز **بدونِ کد** یک الگوی محدود بسازد، **بیازماید**،
 * **اعمال** کند».
 *
 * «نباید بیفتد»:
 *   ویزارد بتواند الگویی منتشر کند که سرور ردش می‌کند (دو اعتبارسنجی) ·
 *   «آزمون» چیزی بنویسد · گامِ سررسیده پیش از موعدِ «عدمِ پاسخ» کار بسازد ·
 *   گامِ بستهٔ دورهٔ بسته کار بسازد · بستنِ گام کارِ پیگیری‌اش را باز بگذارد ·
 *   sweepِ دوباره کارِ دوم بسازد
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { browserLogin } from './lib/browser-login.mjs';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.E2E_SHOTS ?? 'docs/plan/shots';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));
const okStatus = (s) => s >= 200 && s < 300;

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'wz' + randomBytes(3).toString('hex');
const trash = { visits: [], forms: [], templates: [] };
let pid = 0, tpl = 0;

try {
  console.log('۱) «عدمِ پاسخ» واقعاً کارِ پیگیری می‌سازد');
  tpl = num(`INSERT INTO pathway_templates(key, title, builtin, active, created_at, updated_at)
    VALUES ('w-${tag}', 'الگوی ${tag}', false, true, now(), now()) RETURNING id`);
  trash.templates.push(tpl);
  await send(`/pathway/templates/${tpl}/publish`, 'POST', {
    steps: [{ key: 'visit', title: `ویزیتِ ${tag}`, offsetDays: 0, ownerRole: 'nurse', escalateDays: 3 }],
  });
  const form = (await send('/forms', 'POST', { key: tag, title: `عملِ ${tag}`, scope: 'visit' })).json;
  if (form?.id) trash.forms.push(form.id);
  const v = (await send('/visits', 'POST', {
    kind: tag, firstName: 'ژالهِ', lastName: `ویزارد${tag}`, phone: '09120000971',
    opDate: new Date().toISOString(),
  })).json;
  if (!v?.id) { console.error('مراجعه ساخته نشد', v); process.exit(1); }
  trash.visits.push(v.id);
  pid = num(`SELECT patient_id FROM visits WHERE id=${v.id}`);

  const ep = (await send('/pathway/episodes', 'POST', { patientId: pid, templateId: tpl })).json;
  const stepId = ep.steps[0].id;
  const works = () => num(`SELECT count(*) FROM work_items WHERE idempotency_key='pathway_step:pathway_step:${stepId}'`);

  /* 🔴 نباید بیفتد: گامی که تازه سررسیده، پیش از موعدِ «عدمِ پاسخ» کار بسازد. */
  sql(`UPDATE episode_steps SET due_at = now() - interval '1 day' WHERE id=${stepId}`);
  await send('/work/process', 'POST');
  ok(works() === 0, 'یک روز بعد از موعد (و «عدمِ پاسخ» ۳ روز) هنوز کاری نیست');

  sql(`UPDATE episode_steps SET due_at = now() - interval '5 days' WHERE id=${stepId}`);
  await send('/work/process', 'POST');
  ok(works() === 1, `پس از گذشتنِ ۳ روز کارِ پیگیری ساخته شد (${works()})`);
  ok(sql(`SELECT owner_role FROM work_items WHERE idempotency_key='pathway_step:pathway_step:${stepId}'`) === 'nurse',
    'مسئولِ کار همان نقشِ گام است، نه نقشِ ثابت');
  /* 🔴 نباید بیفتد: sweepِ دوباره کارِ دوم بسازد. */
  await send('/work/process', 'POST');
  ok(works() === 1, 'sweepِ دوباره کارِ دوم نساخت');

  console.log('۲) بستنِ گام کارِ پیگیری‌اش را هم می‌بندد');
  await send(`/pathway/steps/${stepId}`, 'PATCH', { status: 'done' });
  await send('/work/process', 'POST');
  ok(sql(`SELECT state FROM work_items WHERE idempotency_key='pathway_step:pathway_step:${stepId}'`) === 'done',
    'کارِ پیگیری بسته شد — وگرنه کسی دنبالِ گامی می‌گشت که انجام شده');

  console.log('۳) گامِ بازِ دورهٔ **بسته** کار نمی‌سازد');
  const ep2 = (await send('/pathway/episodes', 'POST', { patientId: pid, templateId: tpl })).json;
  const step2 = ep2.steps[0].id;
  sql(`UPDATE episode_steps SET due_at = now() - interval '9 days' WHERE id=${step2}`);
  await send(`/pathway/episodes/${ep2.id}/close`, 'POST', { status: 'cancelled' });
  await send('/work/process', 'POST');
  /* 🔴 نباید بیفتد: دوره‌ای که عمداً نیمه‌کاره بسته شده، کارِ پیگیری بسازد. */
  ok(num(`SELECT count(*) FROM work_items WHERE idempotency_key='pathway_step:pathway_step:${step2}'`) === 0,
    'گامِ بازِ دورهٔ بسته‌شده کارِ پیگیری نساخت');

  /* 🔴 نباید بیفتد: کارِ پیگیریِ **ساخته‌شده** بعد از بستنِ دوره باز بماند.
     `patchStep` روی دورهٔ بسته ۴۰۳ می‌دهد، پس مسئولِ آن کار از هیچ راهی
     نمی‌تواند تمامش کند — کارِ بی‌راهِ خروج از نبودنِ کار بدتر است. */
  const ep3 = (await send('/pathway/episodes', 'POST', { patientId: pid, templateId: tpl })).json;
  const step3 = ep3.steps[0].id;
  const k3 = `pathway_step:pathway_step:${step3}`;
  sql(`UPDATE episode_steps SET due_at = now() - interval '9 days' WHERE id=${step3}`);
  await send('/work/process', 'POST');
  ok(sql(`SELECT state FROM work_items WHERE idempotency_key='${k3}'`) === 'open',
    'کارِ پیگیری برای دورهٔ فعال ساخته شد');
  await send(`/pathway/episodes/${ep3.id}/close`, 'POST', { status: 'done' });
  await send('/work/process', 'POST');
  ok(sql(`SELECT state FROM work_items WHERE idempotency_key='${k3}'`) === 'done',
    '**نباید بیفتد:** بستنِ دوره کارِ پیگیریِ ساخته‌شده را باز بگذارد');
  ok(sql(`SELECT status FROM episode_steps WHERE id=${step3}`) === 'pending',
    'و گام همچنان «باز» مانده — بستنِ دوره گام را انجام‌شده نمی‌کند (قاعدهٔ ۶)');

  console.log('۴) ویزارد — ساختن، آزمودن، اعمال (معیارِ پذیرشِ سند)');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const noise = [];
    page.on('console', (m) => { if (m.type() === 'error') noise.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) noise.push(`${r.status()} ${r.url()}`); });
    await browserLogin(page, login.accessToken, { ui: UI });
    await page.goto(`${UI}/app/pathways`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.pw-card', { timeout: 15000 });
    ok(true, 'صفحهٔ مسیرِ درمان باز شد');

    const card = page.locator('.pw-card').filter({ hasText: `الگوی ${tag}` }).first();
    await card.getByRole('button', { name: 'ویرایش و انتشار' }).click();
    await page.waitForSelector('.pw-wiz', { timeout: 8000 });
    ok(await page.locator('.pw-step').count() === 1, 'گامِ نسخهٔ منتشرشده بارگذاری شد، نه صفحهٔ سفید');

    /* مرحلهٔ ۲ — گامِ تازه */
    await page.getByRole('button', { name: 'مرحلهٔ تازه' }).click();
    const boxes = page.locator('.pw-step');
    await boxes.nth(1).locator('input').first().fill(`پیگیریِ ${tag}`);
    await boxes.nth(1).locator('select').selectOption('doctor');
    ok(await boxes.count() === 2, 'مرحلهٔ دوم اضافه شد');

    /* مرحلهٔ ۳ — زمان */
    await page.getByRole('tab', { name: /۳ · زمان/ }).click();
    await page.locator('.pw-step').nth(1).locator('input[type=number]').fill('14');

    /* مرحلهٔ ۴ — پیامک */
    await page.getByRole('tab', { name: /۴ · اطلاع‌رسانی/ }).click();
    await page.locator('.pw-step').nth(1).locator('textarea').fill(`پیامِ پیگیریِ ${tag}`);

    /* مرحلهٔ ۵ — آزمون */
    const remBefore = num('SELECT count(*) FROM reminders');
    await page.getByRole('button', { name: 'آزمون با بیمارِ ساختگی' }).click();
    await page.waitForSelector('.pw-prev li', { timeout: 8000 });
    const rows = await page.locator('.pw-prev li').count();
    ok(rows === 2, `پیش‌نمایش هر دو مرحله را نشان داد (${rows})`);
    ok((await page.locator('.pw-prev').innerText()).includes(`پیامِ پیگیریِ ${tag}`), 'متنِ پیامک در پیش‌نمایش دیده می‌شود');
    /* 🔴 نباید بیفتد: «آزمون» چیزی بنویسد. */
    ok(num('SELECT count(*) FROM reminders') === remBefore, 'آزمون هیچ یادآوری‌ای نساخت');
    /* 🔴 نباید بیفتد: نوارِ مرحله بگوید کجاییم و بدنه چیزِ دیگری نشان دهد.
       دکمهٔ «آزمون» خودش به مرحلهٔ ۵ می‌برد، پس نشانگر هم باید برود — وگرنه
       کاربر فکر می‌کند هنوز در مرحلهٔ ۴ است و «بعدی» را می‌زند. */
    const activeTab = await page.locator('[role="tab"][aria-selected="true"]').innerText();
    ok(activeTab.includes('۵'), `نوارِ مرحله روی «۵ · آزمون» است (${activeTab.trim()})`);
    /* ⚠️ قرصِ لغزانِ نوارِ تب هنوز در حالِ حرکت است؛ بدونِ این مکث اسکرین‌شاتِ
       ثبت‌شده یک فریمِ میانِ انیمیشن می‌شود و آدم را به‌غلط دنبالِ باگِ چیدمان
       می‌فرستد (یک‌بار فرستاد). */
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}/w4-2-wizard.png` });

    /* مرحلهٔ ۶ — اعمال */
    await page.getByRole('tab', { name: /۶ · اعمال/ }).click();
    await page.getByRole('button', { name: /انتشارِ نسخهٔ/ }).click();
    await page.waitForSelector('.pw-toast', { timeout: 8000 });
    ok(num(`SELECT max(version) FROM pathway_versions WHERE template_id=${tpl}`) === 2, 'نسخهٔ ۲ منتشر شد');
    const published = JSON.parse(sql(`SELECT steps::text FROM pathway_versions WHERE template_id=${tpl} AND version=2`));
    ok(published.length === 2, 'هر دو مرحله منتشر شدند');
    ok(published[1].offsetDays === 14 && published[1].notify === `پیامِ پیگیریِ ${tag}` && published[1].ownerRole === 'doctor',
      'زمان، پیام و مسئولِ مرحلهٔ تازه درست نشستند');
    /* 🔴 نباید بیفتد: دورهٔ در جریان با انتشار عوض شود — قاعدهٔ W4.1، از راهِ ویزارد. */
    ok(num(`SELECT count(*) FROM episode_steps WHERE episode_id=${ep.id}`) === 1,
      'دورهٔ در جریان همان یک گام را دارد، نه دو تا');
    ok(noise.length === 0, `بدونِ خطای کنسول/شبکه${noise.length ? ' — ' + noise.slice(0, 3).join(' | ') : ''}`);

    /* 🔴 نباید بیفتد: کلیدِ مرحلهٔ تازه با مرحله‌ای که هست یکی شود.
       دنبالهٔ کاملاً عادیِ «افزودن، افزودن، حذفِ وسطی، افزودن» با شمارشِ سادهٔ
       `length + 1` دوباره همان کلید را می‌ساخت و سرور با ۴۰۰ ردش می‌کرد —
       خطایی که کاربر از رابط هیچ راهی برای رفعش ندارد، چون کلید اصلاً
       نمایش داده نمی‌شود. */
    await page.locator('.pw-card').filter({ hasText: `الگوی ${tag}` }).first()
      .getByRole('button', { name: 'ویرایش و انتشار' }).click();
    await page.waitForSelector('.pw-wiz', { timeout: 8000 });
    const add = page.getByRole('button', { name: 'مرحلهٔ تازه' });
    await add.click();
    await page.locator('.pw-step').nth(2).locator('input').first().fill(`الفِ ${tag}`);
    await add.click();
    await page.locator('.pw-step').nth(3).locator('input').first().fill(`بِ ${tag}`);
    await page.locator('.pw-step').nth(2).getByRole('button', { name: 'حذفِ مرحله' }).click();
    await add.click();
    await page.locator('.pw-step').nth(3).locator('input').first().fill(`جِ ${tag}`);
    await page.getByRole('tab', { name: /۶ · اعمال/ }).click();
    await page.getByRole('button', { name: /انتشارِ نسخهٔ/ }).click();
    let v3 = null;
    for (let i = 0; i < 20 && !v3; i++) {
      const row = sql(`SELECT steps::text FROM pathway_versions WHERE template_id=${tpl} AND version=3`);
      if (row) v3 = JSON.parse(row); else await page.waitForTimeout(400);
    }
    const keys = (v3 ?? []).map((x) => x.key);
    ok(v3?.length === 4 && new Set(keys).size === 4,
      `**نباید بیفتد:** افزودن/حذف/افزودن کلیدِ تکراری بسازد (${keys.join('، ') || 'نسخهٔ ۳ منتشر نشد'})`);
  } finally {
    await browser.close();
  }

  console.log('۵) 🔴 ویزارد نمی‌تواند چیزی بفرستد که سرور ردش می‌کند');
  const bad = await send('/pathway/preview', 'POST', { steps: [{ key: 'x', title: '', offsetDays: 0 }] });
  ok(bad.status === 400, `آزمون هم از همان اعتبارسنجی رد می‌شود (${bad.status})`);
} finally {
  if (pid) {
    sql(`DELETE FROM work_items WHERE patient_id=${pid}`);
    sql(`DELETE FROM domain_events WHERE patient_id=${pid}`);
    sql(`DELETE FROM reminders WHERE patient_id=${pid}`);
    sql(`DELETE FROM episodes WHERE patient_id=${pid}`);
  }
  for (const id of trash.templates) sql(`DELETE FROM pathway_templates WHERE id=${id}`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
