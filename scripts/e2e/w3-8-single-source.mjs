/**
 * W3.8 — دو نیمه، هر دو دربارهٔ «یک بار ورود، یک منبع»:
 *   U7 «یک فیلد، یک نویسنده» — ساعتِ حضورِ کارشناس (بخشِ ۱..۹)
 *   U3 «ورودِ دوبارهٔ ثبت‌نام» — پیشنهادِ جراح/عمل هنگامِ تأیید (بخشِ ۱۰..۱۲)
 *
 * ── U7 ──
 *
 * تصمیمِ مالک ۱۴۰۵/۰۶/۲۶: ساعتِ حضور مالِ «آن کارشناس، در آن بیمارستان، در آن
 * روز» است نه مالِ یک بیمار — پس **فقط** از برنامهٔ چینش (`hospital_duties`)
 * می‌آید، و انتسابِ کارشناس در فرمِ مراجعه خودکار در همان برنامه می‌نشیند.
 *
 * تا امروز سه رابط مستقل می‌نوشتندش (فرمِ مراجعه، شیتِ ساعتِ کارشناس، برنامهٔ
 * چینش) و واگرا می‌شدند؛ نشانه‌اش گزینهٔ «— هنوز در برنامه حضور نیست» در تابلو بود.
 *
 * «نباید بیفتد»:
 *   فرم یا شیتِ ساعت بتوانند `techArriveTime` را مستقیم بنویسند ·
 *   ثبتِ بیمارِ تازه ساعتِ حضورِ ثبت‌شدهٔ برنامه را عقب/جلو ببرد ·
 *   مراجعهٔ بدونِ ساعتِ عمل هنگامِ انتسابِ کارشناس **رد** شود ·
 *   برداشتنِ کارشناس ساعتِ حضورِ یتیم را جا بگذارد ·
 *   عوض‌شدنِ بیمارستان در همان ویرایش، ردیفِ حضورِ بیمارستانِ قبلی را بخواند
 *
 * ── U3 ──
 * بیمار نامِ جراح و نوعِ عمل را **متن** می‌نویسد؛ تا امروز فقط بیمارستان تطبیق
 * داده می‌شد و ادمین آن دو را از کشویی دوباره انتخاب می‌کرد. اگر نمی‌کرد، متنِ
 * آزاد روی مراجعه می‌ماند و بعداً «یکسان‌سازیِ نام‌ها» لازم می‌شد.
 *
 * «نباید بیفتد»:
 *   متنِ **مبهم** (دو گزینهٔ نزدیک) پیشنهاد بگیرد — پیشنهادِ اشتباه از نبودِ
 *   پیشنهاد بدتر است · سرور جراح/نوعِ عمل را **خودکار** بچسباند (تصمیم با آدم است)
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
const okStatus = (s) => s >= 200 && s < 300;

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'ss' + randomBytes(3).toString('hex');
const ISO = new Date().toISOString().slice(0, 10);
const trash = { visits: [], forms: [], hospitals: [], accounts: [], surgeons: [], types: [], subs: [], links: [] };
let techId = 0, hosp = 0, hosp2 = 0;

/** ساعتِ حضورِ ثبت‌شده روی ردیفِ برنامه (یا `-` اگر ردیفی نیست). */
const duty = (h) => sql(`SELECT coalesce(max(arrive_time),'-') FROM hospital_duties
  WHERE date='${ISO}' AND hospital_id=${h} AND tech_id=${techId}`);
const arriveOf = (v) => sql(`SELECT coalesce(tech_arrive_time,'-') FROM visits WHERE id=${v}`);

try {
  /* ⚠️ کارشناس را **خودمان** می‌سازیم، نه از حالتِ محیط: نصبِ محلی فقط
     سوپرادمین دارد، و تستی که به تعریف‌های موجود تکیه کند روی ماشینِ دیگری
     چیزِ دیگری می‌سنجد. سطحِ ۲..۴ و `active` همان شرطی است که `save()` می‌سنجد. */
  const tech = (await send('/accounts/temporary', 'POST', {
    firstName: 'کارشناسِ', lastName: `چینش ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
    level: 2, jobRole: 'technician', username: `t${tag}`,
  })).json;
  techId = tech?.account?.id ?? 0;
  if (!techId) { console.error('کارشناس ساخته نشد', tech); process.exit(1); }
  trash.accounts.push(techId);

  const mkHospital = async (name) => {
    const r = await send('/hospitals', 'POST', { name });
    if (!r.json?.id) { console.error('بیمارستان ساخته نشد', r); process.exit(1); }
    trash.hospitals.push(r.json.id);
    return r.json.id;
  };
  hosp = await mkHospital(`بیمارستانِ ${tag}`);
  hosp2 = await mkHospital(`بیمارستانِ دومِ ${tag}`);

  const form = (await send('/forms', 'POST', { key: tag, title: `عملِ ${tag}`, scope: 'visit' })).json;
  if (form?.id) trash.forms.push(form.id);
  const mkVisit = async (body) => {
    const r = await send('/visits', 'POST', { kind: tag, ...body });
    if (!r.json?.id) { console.error('مراجعه ساخته نشد', r.json); process.exit(1); }
    trash.visits.push(r.json.id);
    return r.json;
  };

  console.log('۱) ثبتِ مراجعه با کارشناس → ردیفِ حضور خودکار ساخته می‌شود');
  const v1 = await mkVisit({
    firstName: 'سمیهٔ', lastName: `چینش${tag}`, phone: '09120000931',
    hospitalId: hosp, techId, opDate: `${ISO}T00:00:00.000Z`, opStartTime: '09:30',
  });
  ok(duty(hosp) === '09:30', `ردیفِ حضور با ساعتِ عمل ساخته شد (${duty(hosp)})`);
  ok(arriveOf(v1.id) === '09:30', 'ساعتِ حضورِ مراجعه از همان ردیف آمد');

  console.log('۲) تابلوی چینش دیگر «هنوز در برنامه حضور نیست» نمی‌گوید');
  const board = (await send(`/dispatch/roster?date=${ISO}`, 'GET')).json;
  const group = (board?.hospitals ?? []).find((h) => h.hospitalId === hosp);
  ok(!!group, 'بیمارستان در تابلو هست');
  ok((group?.duties ?? []).some((d) => d.techId === techId), 'کارشناس در فهرستِ حضورِ همان بیمارستان است');
  ok((group?.visits ?? []).some((v) => v.id === v1.id && v.techId === techId), 'مراجعه هم به همان کارشناس وصل است');

  console.log('۳) برنامه حرفِ آخر را می‌زند — بیمارِ بعدی عقبش نمی‌برد');
  const v2 = await mkVisit({
    patientId: num(`SELECT patient_id FROM visits WHERE id=${v1.id}`),
    hospitalId: hosp, techId, opDate: `${ISO}T00:00:00.000Z`, opStartTime: '14:00',
  });
  /* 🔴 نباید بیفتد: ردیفِ ۰۹:۳۰ با بیمارِ ۱۴:۰۰ بازنویسی شود. */
  ok(duty(hosp) === '09:30', 'ساعتِ ثبت‌شدهٔ برنامه دست‌نخورده ماند');
  ok(arriveOf(v2.id) === '09:30', 'بیمارِ دوم همان ساعتِ برنامه را گرفت، نه ساعتِ عملِ خودش');

  console.log('۴) فرم و شیتِ ساعت دیگر نمی‌توانند ساعتِ حضور را بنویسند');
  const forced = await send(`/visits/${v1.id}`, 'PATCH', { techArriveTime: '05:00' });
  ok(okStatus(forced.status), `درخواست رد نشد، فقط نادیده گرفته شد (${forced.status})`);
  ok(arriveOf(v1.id) === '09:30', '🔴 فرم ساعتِ حضور را عوض نکرد');
  const forcedTimes = await send(`/visits/${v1.id}/times`, 'PATCH', { techArriveTime: '06:00', opStartTime: '10:15' });
  ok(okStatus(forcedTimes.status), `شیتِ ساعت پذیرفته شد (${forcedTimes.status})`);
  ok(arriveOf(v1.id) === '09:30', '🔴 شیتِ ساعت هم ساعتِ حضور را عوض نکرد');
  ok(sql(`SELECT op_start_time FROM visits WHERE id=${v1.id}`) === '10:15', 'ولی ساعتِ عمل را درست نوشت');

  console.log('۵) مراجعهٔ بدونِ ساعتِ عمل — انتساب رد نمی‌شود');
  const v3 = await mkVisit({
    patientId: num(`SELECT patient_id FROM visits WHERE id=${v1.id}`),
    hospitalId: hosp2, techId, opDate: `${ISO}T00:00:00.000Z`,
  });
  /* 🔴 نباید بیفتد: فرم به‌خاطرِ این قاعده شکست بخورد. */
  ok(num(`SELECT tech_id FROM visits WHERE id=${v3.id}`) === techId, 'کارشناس نشست');
  ok(duty(hosp2) === '-', 'ردیفِ حضور ساخته نشد (ساعتی برای ساختنش نبود)');
  ok(arriveOf(v3.id) === '-', 'و ساعتِ حضورِ ساختگی هم ننشست');

  console.log('۶) همان مراجعه با ساعتِ عمل → ردیف ساخته می‌شود');
  ok(okStatus((await send(`/visits/${v3.id}`, 'PATCH', { opStartTime: '07:45' })).status), 'ویرایش پذیرفته شد');
  ok(duty(hosp2) === '07:45', `ردیفِ حضورِ بیمارستانِ دوم ساخته شد (${duty(hosp2)})`);
  ok(arriveOf(v3.id) === '07:45', 'ساعتِ حضور نشست');

  console.log('۷) برداشتنِ کارشناس، ساعتِ حضور را هم می‌برد');
  ok(okStatus((await send(`/visits/${v3.id}`, 'PATCH', { techId: null })).status), 'ویرایش پذیرفته شد');
  /* 🔴 نباید بیفتد: ساعتِ حضورِ یتیم روی کارت بماند. */
  ok(arriveOf(v3.id) === '-', 'ساعتِ حضور پاک شد');
  ok(duty(hosp2) === '07:45', 'ولی ردیفِ برنامه سرِ جایش ماند (کارشناس آن روز آن‌جاست)');

  console.log('۸) عوض‌شدنِ بیمارستان با مقادیرِ **نهایی** سنجیده می‌شود');
  const v4 = await mkVisit({
    patientId: num(`SELECT patient_id FROM visits WHERE id=${v1.id}`),
    hospitalId: hosp, techId, opDate: `${ISO}T00:00:00.000Z`, opStartTime: '11:00',
  });
  ok(arriveOf(v4.id) === '09:30', 'اول ساعتِ بیمارستانِ اول را دارد');
  ok(okStatus((await send(`/visits/${v4.id}`, 'PATCH', { hospitalId: hosp2 })).status), 'بیمارستان عوض شد');
  /* 🔴 نباید بیفتد: ردیفِ حضورِ بیمارستانِ **قبلی** خوانده شود. */
  ok(arriveOf(v4.id) === '07:45', `ساعتِ حضور به برنامهٔ بیمارستانِ تازه رفت (${arriveOf(v4.id)})`);

  console.log('۹) رکوردِ واگرای قدیمی با اولین ذخیره درست می‌شود');
  sql(`UPDATE visits SET tech_arrive_time='23:59' WHERE id=${v4.id}`);
  ok(arriveOf(v4.id) === '23:59', 'واگرایی کاشته شد');
  ok(okStatus((await send(`/visits/${v4.id}`, 'PATCH', { notes: `خودترمیمیِ ${tag}` })).status), 'یک ذخیرهٔ ساده');
  ok(arriveOf(v4.id) === '07:45', 'ساعت به مقدارِ برنامه برگشت');

  console.log('۱۰) U3 — متنِ یکتای بیمار خودش تطبیق می‌خورد');
  const surgeon = (await send('/surgeons', 'POST', { firstName: 'پرویزِ', lastName: `نوروزیان${tag}` })).json;
  if (surgeon?.id) trash.surgeons.push(surgeon.id);
  const proc = (await send('/procedure-types', 'POST', { name: `دیسککتومیِ ${tag}` })).json;
  if (proc?.id) trash.types.push(proc.id);

  const submit = (data) => num(`INSERT INTO intake_submissions(token, status, amount, data, expires_at, created_at, updated_at)
    VALUES ('${tag}${Math.random().toString(36).slice(2, 8)}', 'pending_approval', 0,
            '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb, now() + interval '30 days', now(), now()) RETURNING id`);

  const sub = submit({
    hospitalName: `بیمارستان ${tag}`,
    surgeonName: `دکتر نوروزیان${tag}`,          // «دکتر» نویزِ شناخته‌شدهٔ normalizeName است
    procedure: `دیسککتومیِ ${tag}`,
  });
  trash.subs.push(sub);
  const refs = (await send(`/intake/submissions/${sub}/refs`, 'GET')).json;
  ok(refs?.hospital?.id === hosp, `بیمارستان تطبیق خورد (${refs?.hospital?.source})`);
  ok(refs?.surgeon?.id === surgeon.id, `جراح تطبیق خورد (${refs?.surgeon?.source}) — تا امروز اصلاً پیشنهاد نمی‌شد`);
  ok(refs?.procedure?.id === proc.id, `نوعِ عمل تطبیق خورد (${refs?.procedure?.source})`);
  /* 🔴 نباید بیفتد: خواندنِ پیشنهاد چیزی بنویسد. `matchIntakeRefs` فقط می‌خواند —
     اگر روزی تصمیم را روی ثبت‌نام ذخیره کرد، این دو سنجه اول می‌افتند. */
  ok(sql(`SELECT coalesce((data->>'surgeonId'),'-') FROM intake_submissions WHERE id=${sub}`) === '-',
    'خواندنِ پیشنهاد چیزی روی ثبت‌نام ننوشت');
  ok((await send(`/intake/submissions/${sub}/refs`, 'GET')).json?.surgeon?.id === surgeon.id,
    'و بارِ دوم همان جواب را می‌دهد');

  console.log('۱۱) متنِ مبهم پیشنهاد نمی‌گیرد');
  const twin = (await send('/surgeons', 'POST', { firstName: 'پرویندختِ', lastName: `نوروزیان${tag}` })).json;
  if (twin?.id) trash.surgeons.push(twin.id);
  const vague = submit({ surgeonName: `نوروزیان${tag}` });   // حالا با **دو** جراح یکسان مچ می‌شود
  trash.subs.push(vague);
  const vagueRefs = (await send(`/intake/submissions/${vague}/refs`, 'GET')).json;
  /* 🔴 نباید بیفتد: یکی از دو هم‌نام خودسرانه انتخاب شود. */
  ok(!vagueRefs?.surgeon, 'با دو گزینهٔ هم‌امتیاز هیچ جراحی پیشنهاد نشد');
  ok(vagueRefs?.procedure === null && vagueRefs?.hospital === null, 'فیلدِ نانوشته هم پیشنهادی ندارد');

  console.log('۱۲) یکتایی روی **کلِ فهرست** سنجیده می‌شود، نه فقط برنده');
  /* 🔴 نباید بیفتد: ثبت‌نامی که دیروز پیشنهادِ یکتا داشت، بعد از اضافه‌شدنِ یک
     هم‌نام همان پیشنهاد را نگه دارد. پیشنهاد عکسِ لحظه‌ایِ فهرست است، نه چیزی
     که یک‌بار حساب و ذخیره شود — و همین است که «اشتباه نچسباند» را تضمین می‌کند. */
  const afterTwin = (await send(`/intake/submissions/${sub}/refs`, 'GET')).json;
  ok(!afterTwin?.surgeon, 'با آمدنِ جراحِ هم‌نام، پیشنهادِ قبلی هم پس گرفته شد');
  ok(afterTwin?.hospital?.id === hosp, 'ولی بیمارستانِ دقیق سرِ جایش ماند');

  console.log('۱۳) رابطِ تأیید — کشویی از قبل پر است و برچسب راست می‌گوید');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const nid = () => { const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
      const c = d.reduce((a, x, i) => a + x * (10 - i), 0) % 11; return d.join('') + String(c < 2 ? c : 11 - c); };
    const link = (await send('/intake/links', 'POST', { title: `لینکِ ${tag}`, amount: 120000, formId: form.id })).json;
    trash.links.push(link.id);
    const reg = await fetch(`${API}/public/intake/link/${link.token}/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'مهسا', lastName: `ثبت‌نام${tag}`, nationalId: nid(), phone: '09120000941', captchaA: 1, captchaB: 2, captchaAnswer: 3 }),
    }).then((r) => r.json());
    await fetch(`${API}/public/intake/form/${reg.token}/fill`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: {} }),
    });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'r.png');
    await fetch(`${API}/public/intake/form/${reg.token}/receipt`, { method: 'POST', body: fd });
    /* همان چیزی که بیمار **متن** می‌نویسد — فرمِ عمومی کشوییِ جراح ندارد.
       ⚠️ نامِ **کامل** عمداً: بخشِ ۱۱ یک جراحِ هم‌نامِ فامیل ساخته، پس «نوروزیان»
       به‌تنهایی دیگر یکتا نیست و درست هم همین است که پیشنهاد نشود. این‌جا
       حالتِ `exact` سنجیده می‌شود — همان که برچسبش یک‌بار غلط بود. */
    sql(`UPDATE intake_submissions SET data = data || '{"surgeonName":"دکتر پرویزِ نوروزیان${tag}"}'::jsonb WHERE token='${reg.token}'`);
    trash.subs.push(Number(sql(`SELECT id FROM intake_submissions WHERE token='${reg.token}'`)));

    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const noise = [];
    page.on('console', (m) => { if (m.type() === 'error') noise.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) noise.push(`${r.status()} ${r.url()}`); });
    await browserLogin(page, login.accessToken, { ui: UI });
    await page.goto(`${UI}/app/intake`, { waitUntil: 'networkidle' });
    await page.locator('.ia-list > *').filter({ hasText: `ثبت‌نام${tag}` }).first().locator('.ia-ok').first().click();
    await page.waitForSelector('.ia-grid', { timeout: 8000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/w3-8-intake-approve.png` });

    const notes = await page.locator('.ia-grid .ia-note').allInnerTexts();
    /* ⚠️ روی **نام** مچ می‌شود نه برچسب: برچسب با حوزه فرق می‌کند («پزشک» در
       مطب) و سنجه‌ای که واژهٔ یک حوزه را هاردکد کند، بی‌صدا قرمز می‌ماند —
       همان چیزی که سرِ `appointments-day` اتفاق افتاد. */
    const surgeonNote = notes.find((n) => n.includes(`نوروزیان${tag}`)) ?? '';
    ok(!!surgeonNote, `یادداشتِ جراح آمد — ${surgeonNote || '—'}`);
    /* 🔴 نباید بیفتد: مچِ ماشین «ثبت‌شدهٔ خودِ بیمار» برچسب بخورد. این یکی با
       نگاه‌کردن به اسکرین‌شات پیدا شد، نه با سنجهٔ API. */
    ok(!surgeonNote.includes('ثبت‌شدهٔ خودِ بیمار'), 'و خودش را جای انتخابِ بیمار جا نمی‌زند');
    /* این فرم فقط کنترلِ جراح را دارد (حوزهٔ مطب). */
    ok(!notes.some((n) => n.startsWith('نوعِ عمل')), 'یادداشتِ فیلدِ بی‌کنترل نیامد');

    const picked = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.ia-field, label')].find((n) => n.textContent.trim().startsWith('جراح'));
      const sel = el?.querySelector('select') ?? el?.parentElement?.querySelector('select');
      return sel ? sel.options[sel.selectedIndex]?.text ?? '' : null;
    });
    ok((picked ?? '').includes(`نوروزیان${tag}`), `کشویی جراح از قبل پر است: ${picked} — ادمین دوباره انتخاب نمی‌کند`);
    ok(noise.length === 0, `بدونِ خطای کنسول/شبکه${noise.length ? ' — ' + noise.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
  }
} finally {
  for (const id of trash.subs) sql(`DELETE FROM intake_submissions WHERE id=${id}`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const h of trash.hospitals) sql(`DELETE FROM hospital_duties WHERE hospital_id=${h}`);
  for (const h of trash.hospitals) await send(`/hospitals/${h}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.links) await send(`/intake/links/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.types) await send(`/procedure-types/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.surgeons) await send(`/surgeons/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    sql(`DELETE FROM account_sessions WHERE account_id=${id}`);
    sql(`DELETE FROM accounts WHERE id=${id}`);
  }
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
