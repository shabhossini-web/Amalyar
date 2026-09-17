/**
 * W3.1 — پروندهٔ زنده (§۴.۳ سند):
 * - `GET /patients/:id/live` به چهار پرسش جواب می‌دهد: الان کجاییم · چه شده · چه مانده · نوبتِ کیست
 * - نوار **دقیقاً یک** گامِ جاری دارد و گامِ ردشده حذف نمی‌شود (شکلِ نوار برای همه یکی)
 * - خطِ زمان شش منبع را یک‌جا و نزولی می‌دهد؛ ردیفی که مقصد ندارد کلیک‌پذیر نیست
 * - «نباید بیفتد»: شرحِ جایگزین‌شده · مدرکِ حذف‌شده · سفارشِ بررسی‌شده در «باز» ·
 *   مبلغِ اقلام روی مراجعهٔ توافقی · شرحِ بالینی برای کاربرِ بی‌دسترسی · پروندهٔ کارشناسِ دیگر ·
 *   **سفارشِ بالینی برای سطحی که `/orders` به او نمی‌دهد** · بریدنِ بی‌صدای یک منبع ·
 *   کلیدِ خامِ نقش در رابطِ فارسی · متنِ نامرئی در تمِ روشن
 * - سازگاری با W1.2: وضعیتِ `in_review` از همین حالا «بازِ» شمرده می‌شود
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
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'lv' + randomBytes(3).toString('hex');
const trash = { visits: [], forms: [], accounts: [] };
let pid = -1;

try {
  const form = (await send('/forms', 'POST', { key: tag, title: `ویزیتِ ${tag}`, scope: 'visit' })).json;
  trash.forms.push(form.id);
  /* دو مراجعه: قدیمیِ انجام‌شده + تازهٔ در انتظار. */
  const v1 = (await send('/visits', 'POST', {
    kind: tag, firstName: 'زهراِ', lastName: `زنده${tag}`, phone: '09120000917',
    opDate: new Date(Date.now() - 40 * 864e5).toISOString(),
  })).json;
  trash.visits.push(v1.id);
  pid = num(`SELECT patient_id FROM visits WHERE id=${v1.id}`);
  const v2 = (await send('/visits', 'POST', { kind: tag, patientId: pid, opDate: new Date().toISOString() })).json;
  trash.visits.push(v2.id);
  sql(`UPDATE visits SET op_status='done' WHERE id=${v1.id}`);
  sql(`UPDATE patients SET allergies='پنی‌سیلین', insurer='تأمین اجتماعی', blood_type='O+' WHERE id=${pid}`);

  /* مالی: v1 مدلِ توافقی با اقلامِ گران‌تر، v2 عادی. جمعِ درست = ۱٬۰۰۰٬۰۰۰ + ۵۰۰٬۰۰۰ */
  await send(`/visits/${v1.id}/charges`, 'POST', { title: 'اقلام', unitPrice: 9000000 });
  sql(`UPDATE visits SET pricing_model='global', global_amount=1000000 WHERE id=${v1.id}`);
  await send(`/visits/${v2.id}/charges`, 'POST', { title: 'ویزیت', unitPrice: 500000 });

  /* سفارش‌ها: باز · بررسی‌شده (نباید) · in_review (سازگاریِ W1.2) */
  const oOpen = (await send('/orders/imaging', 'POST', { patientId: pid, visitId: v1.id, modalities: ['MRI'] })).json;
  const oDone = (await send('/orders/lab', 'POST', { patientId: pid, visitId: v1.id, tests: ['CBC'] })).json;
  const oRev = (await send('/orders/consult', 'POST', { patientId: pid, visitId: v2.id, specialty: 'قلب' })).json;
  sql(`UPDATE imaging_orders SET status='answered' WHERE id=${oOpen.id}`);
  sql(`UPDATE lab_orders SET status='reviewed' WHERE id=${oDone.id}`);
  sql(`UPDATE consult_orders SET status='in_review' WHERE id=${oRev.id}`);

  /* شرح: زنده + جایگزین‌شده (نباید بیاید) */
  const nLive = num(`INSERT INTO clinical_notes(patient_id, visit_id, kind, body, author_name, created_at) VALUES (${pid}, ${v1.id}, 'visit', 'شرحِ زنده', 'دکتر الف', now()-interval '39 days') RETURNING id`);
  num(`INSERT INTO clinical_notes(patient_id, visit_id, kind, body, author_name, created_at, replaced_at) VALUES (${pid}, ${v1.id}, 'visit', 'متنِ کهنه', 'دکتر الف', now()-interval '40 days', now()) RETURNING id`);

  /* مدرک: زنده + حذف‌شده (نباید بیاید) */
  const dLive = num(`INSERT INTO documents(patient_id, visit_id, category, title, file_name, mime_type, size, sha256, created_at) VALUES (${pid}, ${v1.id}, 'lab', 'برگهٔ آزمایش', 'a.pdf', 'application/pdf', 10, '${tag}a', now()-interval '20 days') RETURNING id`);
  num(`INSERT INTO documents(patient_id, category, title, file_name, mime_type, size, sha256, created_at, deleted_at) VALUES (${pid}, 'other', 'مدرکِ حذف‌شده', 'b.pdf', 'application/pdf', 10, '${tag}b', now()-interval '19 days', now()) RETURNING id`);

  /* نوبتِ پیشِ رو + یادآوری */
  const ap = num(`INSERT INTO appointments(patient_id, date, start_min, status, created_at, updated_at) VALUES (${pid}, current_date + 3, 600, 'confirmed', now(), now()) RETURNING id`);
  num(`INSERT INTO reminders(patient_id, visit_id, kind, due_at, text, status, created_at, updated_at) VALUES (${pid}, ${v1.id}, 'follow_up', now()-interval '10 days', 'یادآوریِ پیگیری', 'sent', now(), now()) RETURNING id`);

  /* ۴۱ مدرک: از سقفِ همان منبع (۴۰) رد می‌شود ولی جمعِ ادغام‌شده زیرِ سقفِ کل
     (۸۰) می‌ماند — دقیقاً حالتی که قبلاً `truncated:false` می‌گرفت. */
  sql(`INSERT INTO documents(patient_id, category, title, file_name, mime_type, size, sha256, created_at)
       SELECT ${pid}, 'other', 'انبوه ' || g, 'x.pdf', 'application/pdf', 10, '${tag}m' || g, now() - interval '30 days' - (g || ' hours')::interval
       FROM generate_series(1, 41) g`);

  /* یک کارِ باز و عقب‌افتاده روی همین بیمار */
  const wk = num(`INSERT INTO work_items(type, state, title, patient_id, visit_id, owner_role, due_at, idempotency_key, blocked_reason, created_at, updated_at) VALUES ('review_result', 'blocked', 'بررسیِ نتیجهٔ MRI', ${pid}, ${v1.id}, 'doctor', now()-interval '2 days', '${tag}-w1', 'نتیجه ناخواناست', now(), now()) RETURNING id`);

  console.log('۱) الان کجاییم');
  const live = (await send(`/patients/${pid}/live`, 'GET')).json;
  ok(live?.patient?.code, `پاسخ آمد (${live?.patient?.code})`);
  const cur = live.stage.steps.filter((s) => s.state === 'current');
  ok(cur.length === 1, `**نباید بیفتد:** بیش از یک گامِ جاری (${cur.length} گام «${cur.map((s) => s.title).join('، ')}»)`);
  ok(live.stage.key === cur[0]?.key && live.stage.title === cur[0]?.title, 'عنوانِ نوار همان گامِ جاری است');
  ok(live.stage.steps.length === 6 && live.stage.steps.some((s) => s.state === 'skipped'),
    '**نباید بیفتد:** گامِ ردشده از نوار حذف شود (شکلِ نوار باید برای همه یکی بماند)');
  ok(live.stage.steps[0].state === 'done' && live.stage.steps.find((s) => s.key === 'visit').state !== 'todo',
    'گام‌های گذشته «انجام‌شده»اند');
  /* قانون ۲۴: واژهٔ حوزه‌ای جای خالی است و کلاینت پُرش می‌کند. */
  ok(JSON.stringify(live.stage).includes('{visit}'), 'سرور واژهٔ حوزه‌ای را جای خالی می‌گذارد، نه هاردکد');

  console.log('\n۲) چه مانده');
  ok(live.nextWork?.id === wk, 'کارِ بعدی همان کارِ باز است');
  ok(live.nextWork.overdue === true && live.nextWork.blockedReason === 'نتیجه ناخواناست', 'عقب‌افتادگی و مانع از لایهٔ کار می‌آیند');
  ok(live.nextWork.ownerRoleFa === 'پزشک',
    `**نباید بیفتد:** کلیدِ خامِ نقش به رابطِ فارسی برسد (ownerRoleFa=${live.nextWork.ownerRoleFa})`);
  ok(live.upcoming.length === 1 && live.upcoming[0].id === ap && live.upcoming[0].time === '10:00',
    `نوبتِ پیشِ رو با ساعتِ مشتق (${live.upcoming[0]?.time})`);
  const openIds = live.openOrders.map((o) => `${o.kind}:${o.status}`);
  ok(openIds.includes('imaging:answered'), 'سفارشِ پاسخ‌آمده «باز» است');
  ok(openIds.includes('consult:in_review'), 'سازگاریِ W1.2: وضعیتِ in_review از حالا «باز» شمرده می‌شود');
  ok(!openIds.some((k) => k.startsWith('lab:')), '**نباید بیفتد:** سفارشِ بررسی‌شده در «باز» بماند');
  ok(live.openOrders.find((o) => o.kind === 'imaging').awaitingReview === true
    && live.openOrders.find((o) => o.kind === 'imaging').summary === 'MRI', 'خلاصه و «منتظرِ بررسی» سمتِ سرور مشتق شدند');

  console.log('\n۳) مالی — جمع به‌ازای هر مراجعه');
  ok(live.billing.total === 1500000,
    `**نباید بیفتد:** اقلامِ مراجعهٔ توافقی جمعِ کل را باد کند (کل=${live.billing.total}، انتظار ۱۵۰۰۰۰۰)`);
  ok(live.billing.due === live.billing.total - live.billing.paid && live.billing.itemsTotal === 9500000,
    'مانده مشتق است و جمعِ اقلام هم جدا برمی‌گردد');

  console.log('\n۴) چه شده — خطِ زمان');
  const types = new Set(live.timeline.items.map((i) => i.type));
  ok(['visit', 'appointment', 'order', 'document', 'note', 'reminder'].every((t) => types.has(t)),
    `هر شش منبع در یک خط جمع شدند (${[...types].join('، ')})`);
  const at = live.timeline.items.map((i) => new Date(i.at).getTime());
  ok(at.every((v, i) => i === 0 || at[i - 1] >= v), 'نزولی مرتب است (تازه‌ترین بالا)');
  const ids = live.timeline.items.map((i) => i.id);
  ok(ids.includes(`note:${nLive}`) && !live.timeline.items.some((i) => i.type === 'note' && i.title === 'متنِ کهنه'),
    '**نباید بیفتد:** شرحِ جایگزین‌شده در خطِ زمان بیاید');
  ok(ids.includes(`document:${dLive}`) && !live.timeline.items.some((i) => i.title === 'مدرکِ حذف‌شده'),
    '**نباید بیفتد:** مدرکِ حذف‌شده در خطِ زمان بیاید');
  const appt = live.timeline.items.find((i) => i.type === 'appointment');
  ok(appt.visitId === null, 'نوبتِ بی‌مراجعه مقصدی ندارد (سرور دروغ نمی‌سازد)');
  ok(live.timeline.truncated === true && live.timeline.total < 80,
    `**نباید بیفتد:** بریدنِ یک منبع بی‌صدا بماند — جمع زیرِ سقفِ کل است (${live.timeline.total}) ولی مدارک سقف خورده‌اند`);
  ok(live.timeline.items.filter((i) => i.type === 'document').length === 40,
    'سقفِ هر منبع واقعاً اعمال شد (۴۰ مدرک)');

  console.log('\n۵) دامنهٔ دید');
  /* ⚠️ ماژولِ پرونده در seedِ پیش‌فرض از سطحِ ادمین (۵) باز است، پس شاخهٔ
     object-authz («فقط مراجعهٔ خودم») با حسابِ سطح‌۲ اصلاً **صدا زده نمی‌شود** —
     گاردِ Feature زودتر ۴۰۳ می‌دهد. برای سنجیدنِ خودِ آن شاخه، سقفِ ماژول
     موقتاً پایین می‌آید و در `finally` برمی‌گردد. بدونِ این کار تست فقط
     گاردِ بیرونی را می‌سنجید و خیالمان راحت می‌شد که دامنهٔ دید تست شده. */
  sql(`UPDATE features SET min_level=2 WHERE key='dashboard'`);
  const made = (await send('/accounts/temporary', 'POST', {
    firstName: 'کارشناسِ', lastName: `بیرونی ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
    level: 2, jobRole: 'technician', username: `l${tag}`,
  })).json;
  if (made?.account?.id) {
    trash.accounts.push(made.account.id);
    const tl = await fetch(API + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: `l${tag}`, password: made.temporaryPassword }),
    }).then((r) => r.json());
    const res = await fetch(`${API}/patients/${pid}/live`, { headers: { Authorization: 'Bearer ' + tl.accessToken } });
    ok(res.status === 404, `**نباید بیفتد:** کارشناسی که هیچ مراجعهٔ این بیمار را ندارد پرونده را ببیند (${res.status}؛ ۴۰۴ نه ۴۰۳ — وجودِ پرونده هم نباید لو برود)`);
    /* حالا مراجعه را به او بدهیم: دسترسی باز می‌شود ولی شرحِ بالینی نه. */
    sql(`UPDATE visits SET tech_id=${made.account.id} WHERE id=${v1.id}`);
    const mine = await fetch(`${API}/patients/${pid}/live`, { headers: { Authorization: 'Bearer ' + tl.accessToken } }).then((r) => r.json());
    ok(mine?.patient?.id === pid && mine.clinicalVisible === false, 'کارشناسِ همان مراجعه پرونده را می‌بیند ولی لایهٔ بالینی بسته است');
    ok(!mine.timeline.items.some((i) => i.type === 'note'),
      '**نباید بیفتد:** شرحِ بالینی از درِ خطِ زمان به کاربرِ بی‌دسترسی برسد');
    /* `GET /orders` با `@MinLevel(TECH_ADMIN)` بسته است؛ پروندهٔ زنده با
       `patients.read` باز است. اگر این‌جا گیت نباشد، همان داده از درِ دیگر
       بیرون می‌رود. */
    const ordersRes = await fetch(`${API}/orders?patientId=${pid}`, { headers: { Authorization: 'Bearer ' + tl.accessToken } });
    ok(ordersRes.status >= 400, `مرجعِ مقایسه: /orders به این سطح بسته است (${ordersRes.status})`);
    ok(mine.ordersVisible === false && mine.openOrders.length === 0,
      '**نباید بیفتد:** سفارشِ بالینی از درِ پروندهٔ زنده به سطحی برسد که /orders به او نمی‌دهد');
    ok(!mine.timeline.items.some((i) => i.type === 'order'),
      '**نباید بیفتد:** نامِ آزمایش/مودالیته از درِ خطِ زمان لو برود');
    ok(mine.stage.steps.find((s2) => s2.key === 'results').state === 'skipped'
      && /دسترسی/.test(mine.stage.steps.find((s2) => s2.key === 'results').detail),
      'گامِ «نتیجه‌ها» برای این سطح «بی‌دسترسی» می‌گوید، نه «سفارشی نیست» (دروغِ آرام‌بخش ممنوع)');
    sql(`UPDATE visits SET tech_id=NULL WHERE id=${v1.id}`);
  } else { ok(false, 'حسابِ آزمایشی ساخته نشد'); }
  sql(`UPDATE features SET min_level=5 WHERE key='dashboard'`);

  console.log('\n۶) روی صفحه');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1180, height: 1500 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  try {
    await browserLogin(page, login.accessToken, { ui: UI });
    await page.goto(`${UI}/app/patients/${pid}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.rc-stage', { timeout: 15000 });

    ok(await page.locator('.rc-step.is-current').count() === 1, 'روی صفحه هم دقیقاً یک گام روشن است');
    const body = await page.locator('.df').innerText();
    ok(!body.includes('{visit}'),
      '**نباید بیفتد:** جای خالیِ واژه (`{visit}`) خام روی صفحه دیده شود');
    ok(/مراجع/.test(await page.locator('.rc-stage').innerText()),
      'واژهٔ حوزه از `useTerms()` پُر شد (حوزهٔ پیش‌فرض: مراجعه)');
    ok(await page.locator('.rc-id').count() === 1 && await page.locator('.rc-id input, .rc-id select').count() === 0,
      '**نباید بیفتد:** کارتِ هویت فیلدِ ویرایش داشته باشد (هویت فقط‌خواندنی است)');
    ok(await page.locator('.rc-next-main').count() === 1 && /بررسیِ نتیجهٔ MRI/.test(await page.locator('.rc-next-main').innerText()),
      'کارتِ «کارِ بعدی» با عنوانِ همان کار');
    ok(/نتیجه ناخواناست/.test(await page.locator('.rc-next-main').innerText()), 'مانع روی کارت نوشته شده');
    ok(await page.locator('.rc-next-main .wk-row').count() === 1
      && /بررسیِ نتیجه/.test(await page.locator('.rc-next-main .wk-type').innerText()),
      'کارت همان `WorkRow`ِ زنگ و «کارهای من» است (نوعِ کار هم برچسب دارد)');
    ok(await page.locator('.rc-next-main .wk-btn.primary').count() === 1,
      '**نباید بیفتد:** کارتِ کارِ بعدی بدونِ «دکمهٔ اصلی» بماند (§۴.۳ بندِ ۳)');
    ok(/به‌عهدهٔ پزشک/.test(await page.locator('.rc-next-main').innerText()),
      'مالکِ کار فارسی نوشته شده');
    ok(await page.locator('.rc-tl-row').count() >= 6, 'خطِ زمان رندر شد');
    ok(await page.locator('.rc-tl-row.is-link a[href*="/app/dashboard?patient="]').count() > 0, 'ردیفِ مراجعه‌دار به فرمِ همان مراجعه لینک دارد');
    const dead = page.locator('.rc-tl-row:not(.is-link)');
    ok(await dead.count() > 0 && await dead.first().locator('a, button').count() === 0,
      '**نباید بیفتد:** ردیفِ بی‌مقصد دکمه‌نما باشد (در به دیوار)');

    /* تب‌ها ثانویه‌اند: پیش‌فرض دیگر فرمِ ویرایش نیست. */
    ok(await page.locator('.rc-form input[name], .pf-field input').count() === 0
      || await page.locator('.rc-body').innerText().then((t) => !/ذخیرهٔ پرونده/.test(t)),
      '**نباید بیفتد:** تبِ پیش‌فرض فرمِ ویرایش باشد');
    await page.getByRole('tab', { name: /مشخصات/ }).click();
    await page.waitForTimeout(250);
    ok(/ذخیرهٔ پرونده/.test(await page.locator('.rc-body').innerText()), 'ویرایش یک اقدام است و با تبِ «مشخصات» باز می‌شود');

    await page.getByRole('tab', { name: /مراجعات/ }).click();
    await page.waitForTimeout(200);
    execSync(`mkdir -p ${SHOTS}`);
    await page.screenshot({ path: `${SHOTS}/w3-1-live-dark.png`, fullPage: false });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/w3-1-live-light.png`, fullPage: false });
    ok(true, `اسکرین‌شاتِ هر دو تم در ${SHOTS}`);

    /* ⚠️ اسکرین‌شات چشم می‌خواهد و رگرسیون را نمی‌گیرد. کنتراست را **می‌سنجیم**:
       نامِ بیمار رنگِ ارثیِ صفحه را می‌گیرد و هشدارِ حساسیت رنگِ معناییِ قرمز را —
       هر دو تا امروز در تمِ روشن سفیدِ روی سفید بودند. */
    const contrast = await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => {
          const x = Number(v) / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      /* ⚠️ لایهٔ کم‌آلفا را باید **ترکیب** کرد: `rgba(239,68,68,.12)` روی سفید
         صورتیِ کم‌رنگ است، نه قرمز. نسخهٔ اولِ همین تابع آلفا را دور می‌ریخت و
         زمینه را قرمزِ تیره می‌خواند — یعنی سنجه خودش دروغ می‌گفت. */
      const rgba = (c) => {
        const n = (c || '').match(/[\d.]+/g) || [];
        return [Number(n[0] || 0), Number(n[1] || 0), Number(n[2] || 0), n[3] === undefined ? 1 : Number(n[3])];
      };
      const bgOf = (el) => {
        const layers = [];
        for (let n = el; n; n = n.parentElement) {
          const [r, g, b, a] = rgba(getComputedStyle(n).backgroundColor);
          if (a > 0) { layers.push([r, g, b, a]); if (a >= 1) break; }
        }
        let out = [255, 255, 255];
        for (const [r, g, b, a] of layers.reverse()) {
          out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
        }
        return `rgb(${out.join(',')})`;
      };
      const ratio = (el) => {
        if (!el) return null;
        const a = lum(getComputedStyle(el).color), b = lum(bgOf(el));
        return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
      };
      return { name: ratio(document.querySelector('.df-head h1')), alert: ratio(document.querySelector('.rc-alert')) };
    });
    ok(contrast.name >= 4.5, `**نباید بیفتد:** نامِ بیمار در تمِ روشن محو شود (کنتراست ${contrast.name})`);
    ok(contrast.alert >= 4.5, `**نباید بیفتد:** هشدارِ حساسیت در تمِ روشن محو شود (کنتراست ${contrast.alert})`);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

    ok(errors.length === 0, `بدونِ خطای جاوااسکریپت و بدونِ پاسخِ ≥۴۰۰ (${errors.length})${errors.length ? ' — ' + errors[0].slice(0, 160) : ''}`);

    console.log('\n۷) اقدامِ «مراجعهٔ جدید»');
    await page.locator('.rc-act.is-main').click();
    await page.waitForURL(/\/app\/dashboard/, { timeout: 10000 });
    await page.waitForTimeout(700);
    ok(!/patient=/.test(page.url()), '**نباید بیفتد:** نامِ بیمار یا شناسه‌اش در URL بنشیند (از router state می‌رود)');
    ok(await page.locator('.db-steps').count() === 1, 'شیتِ مراجعهٔ جدید باز شد');
    /* پیش‌پرشده یعنی از گامِ ۳ شروع می‌کند؛ برای دیدنِ چیپِ بیمار به گامِ ۱ برمی‌گردیم. */
    await page.locator('.db-steps li button').first().click();
    await page.waitForTimeout(250);
    ok(await page.locator('.db-picked').isVisible() && /زنده/.test(await page.locator('.db-picked').innerText()),
      'فرمِ مراجعهٔ جدید با همان بیمار پیش‌پر شد');
  } finally { await browser.close().catch(() => {}); }
} finally {
  sql(`UPDATE features SET min_level=5 WHERE key='dashboard'`);
  if (pid > 0) {
    sql(`DELETE FROM work_items WHERE patient_id=${pid}`);
    sql(`DELETE FROM reminders WHERE patient_id=${pid}`);
    sql(`DELETE FROM appointments WHERE patient_id=${pid}`);
    sql(`DELETE FROM documents WHERE patient_id=${pid}`);
    sql(`DELETE FROM clinical_notes WHERE patient_id=${pid}`);
    for (const t of ['imaging_orders', 'lab_orders', 'consult_orders', 'referral_orders']) sql(`DELETE FROM ${t} WHERE patient_id=${pid}`);
  }
  for (const v of trash.visits.reverse()) await send(`/visits/${v}`, 'DELETE').catch(() => {});
  for (const f of trash.forms) await send(`/forms/${f}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    sql(`DELETE FROM account_sessions WHERE account_id=${id}`);
    sql(`DELETE FROM accounts WHERE id=${id}`);
  }
}
console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
