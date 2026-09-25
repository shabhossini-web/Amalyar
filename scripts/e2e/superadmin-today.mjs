/**
 * سوپرادمینِ بی‌محدودیت در «امروز» و صفِ کار (قانونِ ۲۹، خواستهٔ مالک ۱۴۰۵/۰۷/۰۳) —
 * سرورِ زنده + مرورگرِ واقعی.
 *
 * مالک «امروز» را باز کرد و هیچ کاری ندید: صفِ پیش‌فرض «مالِ من + صفِ نقشِ من» بود و
 * سوپرادمین نقشِ شغلی ندارد. برای دیدن یا انجامِ کارِ دیگران باید پروفایل عوض می‌کرد.
 *
 *  باید بیفتد:
 *   - `GET /work/today` برای سوپرادمین `team: true` و کارِ همه: کارِ شخصِ دیگر، صفِ نقش،
 *     بی‌مسئول — هر ردیف با `ownerLabel` از سرور؛ دسته‌های `owners` با شمار و `filter`ِ
 *     آماده که جمعشان همان «کارِ بازِ تیم» است
 *   - فیلترهای `owner` / `ownerRole` همان دسته را از سرور می‌دهند؛ `sort=overdue` عقب‌افتاده اول
 *   - رابط: «کارهای تیم»، تب‌های «مالِ کیست»، برچسبِ مالک روی ردیفِ دیگران و نه روی ردیفِ خودش
 *   - «انجام شد» روی کارِ کارشناس: مالک همان کارشناس می‌ماند، `completed_by` و ممیزی به نامِ سوپرادمین
 *   - «واگذاری» کارِ صفِ پزشک به کارشناس از خودِ ردیف — در دیتابیس و ممیزی
 *   - زنگ و «کارهای من» همان نمای تیم را دارند (`?owner=` همان دسته را باز می‌کند)
 *  نباید بیفتد:
 *   - کارشناسِ سطح ۲ و ادمینِ سطح ۵: `team` ندارند، کارِ دیگران را نمی‌بینند، فیلترِ کارِ
 *     دیگری و فهرستِ واگذاری ۴۰۳ با پیامِ فارسی، و بستنِ کارِ دیگری ۴۰۳
 *   - ادمینِ سطح ۵ با شناسهٔ کسِ دیگر در `owner` (حتی با `scope=all`) ۴۰۳ می‌گیرد؛ کارشناس
 *     نامِ مالکِ تازه‌ای (`ownerName`) روی ردیف‌هایش نمی‌گیرد
 *   - کارِ خودِ بیمار در صفِ تیم نمی‌آید و به کارکنان واگذار نمی‌شود؛ هیچ خطای JS/کنسول
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { browserLogin } from './lib/browser-login.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));
const fa = (s) => /[؀-ۿ]/.test(String(s ?? ''));

const loginAs = (identifier, password) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
}).then((r) => r.json());
const call = (token) => (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const login = await loginAs(process.env.E2E_USER ?? 'admin', process.env.E2E_PASS ?? 'test1234');
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
if (login.user?.level !== 6) { console.error(`این سوییت سوپرادمین می‌خواهد (سطحِ ${login.user?.level})`); process.exit(1); }
const send = call(login.accessToken);
const adminId = login.user.id;
const tag = 'sa' + randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const trash = { accounts: [] };

/* حساب از همان مسیرِ واقعیِ «کاربران ← حسابِ موقت». */
const makeAccount = async (user, lastName, level, jobRole) => {
  const made = (await send('/accounts/temporary', 'POST', { firstName: 'آزمونِ', lastName: `${lastName} ${tag}`, phone: phone(), level, jobRole, username: `${user}${tag}` })).json;
  if (!made?.account?.id) throw new Error('حساب ساخته نشد: ' + JSON.stringify(made).slice(0, 160));
  trash.accounts.push(made.account.id);
  const session = await loginAs(`${user}${tag}`, made.temporaryPassword);
  if (!session.accessToken) throw new Error('ورودِ حسابِ آزمایشی نشد');
  return { id: made.account.id, name: made.account.displayName, token: session.accessToken, api: call(session.accessToken) };
};
const idsOf = (rows) => (Array.isArray(rows) ? rows : []).map((w) => w.id);
const pastIso = (h) => new Date(Date.now() - h * 3600e3).toISOString();

let browser;
try {
  console.log('۰) داده: کارشناس (سطح ۲)، ادمینِ سطح ۵، و پنج کار با پنج مالکِ متفاوت');
  const tech = await makeAccount('tq', 'کارشناس', 2, 'technician');
  const boss = await makeAccount('bq', 'ادمین', 5, 'secretary');
  /* A: کارِ خودِ کارشناس (از حسابِ خودش). B: صفِ پزشک. C: بی‌مسئول و عقب‌افتاده. D: کارِ خودِ سوپرادمین. P: کارِ خودِ بیمار.
     اولویتِ ۳ (سقف) تا روی دیتابیسِ غیرتازه هم (`--no-isolate`) بالای فهرستِ دوازده‌تاییِ «امروز» بنشینند. */
  const A = (await tech.api('/work', 'POST', { title: `تماسِ کارشناس ${tag}`, priority: 3, dueAt: pastIso(1) })).json?.id;
  const B = (await send('/work', 'POST', { title: `بررسیِ صفِ پزشک ${tag}`, ownerRole: 'doctor', priority: 3 })).json?.id;
  const C = num(`INSERT INTO work_items(type, state, performer, title, priority, due_at, idempotency_key, created_at, updated_at)
    VALUES ('manual','open','human','کارِ بی‌مسئول ${tag}', 3, now()-interval '2 hours', 'manual:${tag}:none', now(), now()) RETURNING id`);
  const D = (await send('/work', 'POST', { title: `یادداشتِ مدیر ${tag}`, priority: 3 })).json?.id;
  const P = num(`INSERT INTO work_items(type, state, performer, title, owner_role, idempotency_key, created_at, updated_at)
    VALUES ('upload_result','open','human','کارِ بیمار ${tag}','patient','manual:${tag}:patient', now(), now()) RETURNING id`);
  ok('پنج کار ساخته شد', [A, B, C, D, P].every((x) => Number.isInteger(x) && x > 0), JSON.stringify([A, B, C, D, P]));

  console.log('\n۱) API — سوپرادمین: صفِ تیم با «مالِ کیست»');
  const t = (await send('/work/today')).json;
  const row = (id) => (t?.work ?? []).find((w) => w.id === id);
  ok('`team: true` از سرور', t?.team === true, JSON.stringify(t?.team));
  ok('**کارِ کارشناس، صفِ پزشک، بی‌مسئول و کارِ خودش همه در «امروز»ِ اوست**', [A, B, C, D].every((id) => !!row(id)), JSON.stringify(idsOf(t?.work)));
  ok('**نباید بیفتد:** کارِ خودِ بیمار در صفِ تیم نیست', !row(P) && !(t?.owners ?? []).some((o) => o.key === 'r:patient'));
  ok('برچسبِ مالک از سرور: نامِ کارشناس / «صفِ پزشک» / «بی‌مسئول»',
    row(A)?.ownerLabel === tech.name && row(B)?.ownerLabel === 'صفِ پزشک' && row(C)?.ownerLabel === 'بی‌مسئول',
    JSON.stringify([row(A)?.ownerLabel, row(B)?.ownerLabel, row(C)?.ownerLabel]));
  ok('`mine` فقط روی کارِ خودش، و `canAssign` روی کارهای باز', row(D)?.mine === true && row(A)?.mine === false && [A, B, C, D].every((id) => row(id)?.canAssign === true));
  const owners = t?.owners ?? [];
  const techFacet = owners.find((o) => o.key === `p:${tech.id}`);
  ok('دستهٔ کارشناس با نام، شمار و `filter`ِ آماده', techFacet?.label === tech.name && techFacet.count >= 1 && techFacet.filter?.owner === tech.id, JSON.stringify(techFacet));
  ok('دستهٔ «صفِ پزشک» و «بی‌مسئول» هم هست', owners.some((o) => o.key === 'r:doctor' && o.label === 'صفِ پزشک') && owners.some((o) => o.key === 'none' && o.label === 'بی‌مسئول'), JSON.stringify(owners.map((o) => o.key)));
  const counts = (await send('/work/counts')).json;
  ok('جمعِ دسته‌ها = چیپِ «کارِ بازِ تیم» = شمارِ زنگ', owners.reduce((s, o) => s + o.count, 0) === t.brief.work && counts?.total === t.brief.work && counts?.team === true,
    `${owners.reduce((s, o) => s + o.count, 0)} / ${t?.brief?.work} / ${counts?.total}`);

  const byTech = (await send(`/work?scope=inbox&owner=${tech.id}`)).json;
  ok('`owner=<کارشناس>` فقط کارِ او را می‌دهد', Array.isArray(byTech) && byTech.length >= 1 && byTech.every((w) => w.ownerAccountId === tech.id) && idsOf(byTech).includes(A), JSON.stringify(idsOf(byTech)));
  const docQ = (await send('/work?scope=inbox&owner=none&ownerRole=doctor')).json;
  ok('`owner=none&ownerRole=doctor` = صفِ پزشکِ برنداشته', Array.isArray(docQ) && idsOf(docQ).includes(B) && docQ.every((w) => w.ownerRole === 'doctor' && w.ownerAccountId == null));
  const bad = await send('/work?owner=abc');
  ok('`owner` نامعتبر ۴۰۰ با پیامِ فارسی', bad.status === 400 && fa(bad.json?.message), `${bad.status} ${JSON.stringify(bad.json?.message)}`);
  const late = (await send('/work?scope=inbox&limit=8&sort=overdue')).json ?? [];
  const firstFresh = late.findIndex((w) => !w.overdue);
  ok('`sort=overdue`: عقب‌افتاده‌ها اول (زنگِ نمای تیم)', late.length > 0 && late[0].overdue === true && (firstFresh < 0 || late.slice(firstFresh).every((w) => !w.overdue)), JSON.stringify(late.map((w) => [w.id, w.overdue])));
  /* «فردا» و «توقف» روی کارِ بی‌مسئولی که مالِ او نیست — همان عملیاتِ صاحبِ کار، ممیزی به نامِ خودش. */
  const until = new Date(Date.now() + 20 * 3600e3).toISOString();
  const snz = await send(`/work/${C}`, 'PATCH', { action: 'snooze', until });
  const blk = await send(`/work/${C}`, 'PATCH', { action: 'block', reason: `منتظرِ تماس ${tag}` });
  ok('«فردا» و «توقف» روی کارِ بی‌مسئول برای سوپرادمین کار می‌کند', snz.status === 200 && snz.json?.state === 'open' && blk.status === 200 && blk.json?.state === 'blocked', `${snz.status} ${blk.status}`);
  ok('… و هر دو با actor = سوپرادمین ممیزی شدند', num(`SELECT count(*) FROM audit_events WHERE entity_id='${C}' AND action IN ('work.snooze','work.block') AND actor_id=${adminId}`) === 2);
  const people = (await send('/work/assignees')).json;
  ok('فهرستِ واگذاری: کارشناس با نقش، و خودش اول', Array.isArray(people) && people[0]?.me === true && people.some((p) => p.id === tech.id && p.label.includes(tech.name) && p.label.includes('کارشناس')), JSON.stringify((people ?? []).slice(0, 4)));
  /* کارِ خودِ بیمار با `NOT_PATIENT` از هر صفِ کارکنان بیرون است؛ واگذاری‌اش یعنی کاری که هیچ‌کس نمی‌بیند. */
  const pRows = (await send('/work?scope=all&ownerRole=patient&type=upload_result&limit=300')).json;
  const pRow = (Array.isArray(pRows) ? pRows : []).find((w) => w.id === P);
  ok('«با کارِ بیماران»: کارِ بیمار برچسبِ «خودِ بیمار» دارد و `canAssign` ندارد', pRow?.ownerLabel === 'خودِ بیمار' && pRow?.canAssign === false, JSON.stringify([pRow?.ownerLabel, pRow?.canAssign]));
  const pAssign = await send(`/work/${P}`, 'PATCH', { action: 'assign', accountId: tech.id });
  ok('**نباید بیفتد:** کارِ خودِ بیمار به کارکنان واگذار نمی‌شود (۴۰۰ فارسی، دیتابیس دست‌نخورده)',
    pAssign.status === 400 && fa(pAssign.json?.message) && sql(`SELECT coalesce(owner_account_id::text, 'null') FROM work_items WHERE id=${P}`) === 'null', `${pAssign.status}`);

  console.log('\n۲) API — نباید بیفتد: سطحِ پایین‌تر هیچ چیزِ تازه‌ای نمی‌بیند');
  const tt = (await tech.api('/work/today')).json;
  ok('کارشناس: `team` ندارد و دسته‌ای نمی‌گیرد', tt?.team === false && (tt?.owners ?? []).length === 0, JSON.stringify([tt?.team, tt?.owners]));
  ok('کارشناس فقط کارِ خودش را می‌بیند — نه صفِ پزشک، نه بی‌مسئول، نه کارِ مدیر', idsOf(tt?.work).includes(A) && ![B, C, D].some((id) => idsOf(tt?.work).includes(id)), JSON.stringify(idsOf(tt?.work)));
  ok('… و برچسبِ «مالِ کیست» و نامِ مالک روی ردیف‌هایش `null` است (رابطش عوض نمی‌شود، نامِ تازه‌ای نمی‌گیرد)',
    (tt?.work ?? []).length > 0 && (tt?.work ?? []).every((w) => w.ownerLabel === null && w.ownerName === null && w.canAssign === false));
  const tc = (await tech.api('/work/counts')).json;
  ok('شمارِ زنگِ کارشناس همان «من + صفِ نقشِ من» است', tc?.team === false && tc.total === tc.mine + tc.role, JSON.stringify(tc));
  const peek = await tech.api(`/work?owner=${adminId}`);
  ok('فیلترِ کارِ کسِ دیگر برای کارشناس ۴۰۳ با پیامِ فارسی', peek.status === 403 && fa(peek.json?.message), `${peek.status} ${JSON.stringify(peek.json?.message)}`);
  const tp = await tech.api('/work/assignees');
  ok('فهرستِ واگذاری برای کارشناس ۴۰۳ با پیامِ فارسی', tp.status === 403 && fa(tp.json?.message), `${tp.status}`);
  const steal = await tech.api(`/work/${D}`, 'PATCH', { action: 'done' });
  ok('کارشناس کارِ مدیر را نمی‌بندد (۴۰۳)', steal.status === 403 && sql(`SELECT state FROM work_items WHERE id=${D}`) === 'open', `${steal.status}`);
  const bt = (await boss.api('/work/today')).json;
  ok('ادمینِ سطح ۵: `team` ندارد و کارِ دیگران در «امروز»ش نیست', bt?.team === false && ![A, B, C, D].some((id) => idsOf(bt?.work).includes(id)), JSON.stringify(idsOf(bt?.work)));
  ok('فهرستِ واگذاری برای ادمینِ سطح ۵ هم ۴۰۳', (await boss.api('/work/assignees')).status === 403);
  /* شناسهٔ بیگانه فقط برای سوپرادمین معنی دارد — ادمینِ ۵ حتی با `scope=all` (که خودش دارد) ۴۰۳ می‌گیرد. */
  const bPeek = await boss.api(`/work?scope=all&owner=${tech.id}`);
  const bRole = await boss.api('/work?ownerRole=doctor');
  ok('**نباید بیفتد:** فیلترِ کارِ کسِ دیگر / صفِ نقشِ دیگر برای ادمینِ سطح ۵ هم ۴۰۳ با پیامِ فارسی',
    bPeek.status === 403 && fa(bPeek.json?.message) && bRole.status === 403, `${bPeek.status} ${bRole.status}`);
  const bc = (await boss.api('/work/counts?owners=1')).json;
  ok('ادمینِ سطح ۵: `counts?owners=1` نه `team` می‌دهد نه دسته', bc?.team === false && bc?.owners === undefined, JSON.stringify(bc));

  console.log('\n۳) مرورگر — «امروز»ِ سوپرادمین');
  browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const newPage = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, locale: 'fa-IR' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    /* نشانیِ پاسخِ ۴xx/۵xx هم ثبت می‌شود — «Failed to load resource» به‌تنهایی نمی‌گوید کدام درخواست. */
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 160)); });
    await browserLogin(page, token, { ui: UI });
    return page;
  };
  const page = await newPage(login.accessToken);
  await page.goto(UI + '/app', { waitUntil: 'networkidle' });
  await page.locator('.td-hello').waitFor({ timeout: 15000 });
  ok('عنوانِ بخش «کارهای تیم» است', (await page.locator('#td-work-h').innerText()).trim() === 'کارهای تیم');
  ok('چیپِ خلاصه «کارِ بازِ تیم» می‌گوید', (await page.locator('.td-chips li').first().innerText()).includes('کارِ بازِ تیم'));
  await page.locator('.td-owners').waitFor({ timeout: 8000 });
  ok('تب‌های «مالِ کیست» با نامِ کارشناس', (await page.locator('.td-owners button', { hasText: tech.name }).count()) === 1);
  const rowEl = (id) => page.locator(`.wk-row[data-work-id="${id}"]`);
  await rowEl(A).waitFor({ timeout: 8000 });
  /* فهرستِ افرادِ «واگذاری» جدا از خودِ صفحه می‌آید؛ تا نیامده ردیف‌ها برچسبِ ساده‌اند. */
  await rowEl(D).locator('.wk-assign').waitFor({ timeout: 8000 }).catch(() => {});
  const ownerOf = async (id) => (await rowEl(id).locator('[data-owner]').count()) ? rowEl(id).locator('[data-owner]').first().getAttribute('data-owner') : null;
  ok('**ردیفِ کارِ کارشناس برچسبِ نامِ او را دارد**', (await ownerOf(A)) === tech.name, String(await ownerOf(A)));
  ok('ردیفِ صفِ پزشک «صفِ پزشک» و ردیفِ بی‌مسئول «بی‌مسئول»', (await ownerOf(B)) === 'صفِ پزشک' && (await ownerOf(C)) === 'بی‌مسئول');
  ok('**نباید بیفتد:** ردیفِ خودِ سوپرادمین برچسبِ مالک ندارد (فقط کنشِ «واگذاری»)', (await ownerOf(D)) === null && (await rowEl(D).locator('.wk-assign.is-self').count()) === 1);

  await page.locator('.td-owners button', { hasText: tech.name }).click();
  const onlyTech = await page.waitForFunction(({ a, b, name }) => {
    const rows = [...document.querySelectorAll('.td-sec .wk-row')];
    return rows.length > 0 && rows.some((r) => r.dataset.workId === String(a)) && !rows.some((r) => r.dataset.workId === String(b))
      && rows.every((r) => r.querySelector('[data-owner]')?.getAttribute('data-owner') === name);
  }, { a: A, b: B, name: tech.name }, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('**تبِ کارشناس فقط کارهای او را از سرور می‌آورد**', onlyTech);
  await page.locator('.td-owners button').first().click();
  await rowEl(B).waitFor({ timeout: 8000 });

  await rowEl(A).locator('.wk-btn.primary').click();
  await rowEl(A).waitFor({ state: 'detached', timeout: 8000 });
  const doneRow = sql(`SELECT state || '|' || owner_account_id || '|' || completed_by_id FROM work_items WHERE id=${A}`);
  ok('**«انجام شد» روی کارِ کارشناس: بسته شد، مالک همان کارشناس، بستن به نامِ سوپرادمین**', doneRow === `done|${tech.id}|${adminId}`, doneRow);
  ok('… و ممیزی با actor = سوپرادمین', num(`SELECT count(*) FROM audit_events WHERE action='work.done' AND entity_id='${A}' AND actor_id=${adminId}`) === 1);

  await rowEl(B).locator('.wk-assign .pk-btn').click();
  await page.locator('.pk-panel').waitFor({ timeout: 8000 });
  ok('پنلِ «واگذاری به…» باز شد و کارشناس در آن هست', (await page.locator('.pk-panel .pk-item', { hasText: tech.name }).count()) === 1);
  await page.locator('.pk-panel .pk-item', { hasText: tech.name }).click();
  const moved = await page.waitForFunction(({ b, name }) => document.querySelector(`.wk-row[data-work-id="${b}"] [data-owner]`)?.getAttribute('data-owner') === name,
    { b: B, name: tech.name }, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('**«واگذاری» از خودِ ردیف: برچسب همان لحظه نامِ کارشناس شد**', moved);
  ok('… در دیتابیس به نامِ کارشناس است', num(`SELECT owner_account_id FROM work_items WHERE id=${B}`) === tech.id);
  ok('… و ممیزیِ واگذاری با actor = سوپرادمین', num(`SELECT count(*) FROM audit_events WHERE action='work.assign' AND entity_id='${B}' AND actor_id=${adminId}`) === 1);

  console.log('\n۴) زنگ و «کارهای من» — همان نمای تیم');
  const total = (await send('/work/counts')).json?.total;
  await page.waitForFunction((n) => document.querySelector('#wb-btn .wb-badge')?.dataset.count === String(n), total, { timeout: 8000 }).catch(() => {});
  ok('شمارِ زنگ = «کارِ بازِ تیم»ِ سرور', (await page.locator('#wb-btn .wb-badge').getAttribute('data-count')) === String(total), String(total));
  await page.locator('#wb-btn').click();
  await page.locator('.wb-menu .wk-row').first().waitFor({ timeout: 8000 });
  ok('کشوی زنگ «کارهای تیم» است و ردیفِ کارشناس برچسبِ او را دارد',
    (await page.locator('.wb-menu .wb-head b').innerText()).trim() === 'کارهای تیم'
      && (await page.locator(`.wb-menu .wk-row[data-work-id="${B}"] [data-owner]`).getAttribute('data-owner').catch(() => null)) === tech.name);
  await page.keyboard.press('Escape');

  await page.goto(`${UI}/app/work?owner=${encodeURIComponent(`p:${tech.id}`)}`, { waitUntil: 'networkidle' });
  await page.locator('.wk-owners').waitFor({ timeout: 10000 });
  ok('تبِ دامنه «همهٔ تیم» است', (await page.locator('.wk-tabs button', { hasText: 'همهٔ تیم' }).count()) === 1);
  const listOk = await page.waitForFunction(({ b, name }) => {
    const rows = [...document.querySelectorAll('.wk-page .wk-row')];
    return rows.some((r) => r.dataset.workId === String(b)) && rows.every((r) => r.querySelector('[data-owner]')?.getAttribute('data-owner') === name);
  }, { b: B, name: tech.name }, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('**`?owner=` همان دسته را باز می‌کند: فقط کارهای کارشناس**', listOk);
  ok('تبِ فعالِ «مالِ کیست» همان کارشناس است', (await page.locator('.wk-owners button[aria-selected="true"]').innerText()).includes(tech.name));

  console.log('\n۵) مرورگر — نباید بیفتد: کارشناس همان صفحهٔ همیشگی را می‌بیند');
  const tpage = await newPage(tech.token);
  await tpage.goto(UI + '/app', { waitUntil: 'networkidle' });
  await tpage.locator('.td-hello').waitFor({ timeout: 15000 });
  await tpage.locator(`.wk-row[data-work-id="${B}"]`).waitFor({ timeout: 8000 }).catch(() => {});
  ok('عنوانِ بخش «کارهای من»، بی‌تبِ «مالِ کیست»', (await tpage.locator('#td-work-h').innerText()).trim() === 'کارهای من' && (await tpage.locator('.td-owners').count()) === 0);
  ok('کارِ واگذارشده به او در فهرستش هست، بی‌برچسبِ مالک و بی‌«واگذاری»',
    (await tpage.locator(`.wk-row[data-work-id="${B}"]`).count()) === 1 && (await tpage.locator('[data-owner], .wk-assign').count()) === 0);
  ok('کارِ بی‌مسئول و کارِ مدیر در «امروز»ِ او نیست', (await tpage.locator(`.wk-row[data-work-id="${C}"], .wk-row[data-work-id="${D}"]`).count()) === 0);

  console.log('\n۶) سلامتِ صفحه');
  ok('هیچ خطای JS/کنسول', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  ok('اجرای سوییت بی‌استثنا', false, String(e?.stack ?? e).slice(0, 300));
} finally {
  await browser?.close().catch(() => {});
  sql(`DELETE FROM work_items WHERE title LIKE '%${tag}%' OR idempotency_key LIKE 'manual:${tag}:%'`);
  if (trash.accounts.length) {
    const acc = trash.accounts.join(',');
    sql(`DELETE FROM account_sessions WHERE account_id IN (${acc})`);
    sql(`DELETE FROM people WHERE id IN (SELECT person_id FROM accounts WHERE id IN (${acc}))`);
  }
}

console.log(`\nقبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
