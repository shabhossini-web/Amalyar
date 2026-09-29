/**
 * دلیلِ لغو (تصمیمِ مالک ۱۴۰۵/۰۶/۲۶) — لغو بی‌سؤال ثبت نمی‌شود و بیمار خبر می‌گیرد.
 *
 * - لغوِ **مراجعه** و لغوِ **نوبت** هر دو دلیل می‌خواهند؛ دلیل از فهرستِ بسته می‌آید
 * - یادداشتِ داخلی ذخیره می‌شود ولی **هرگز** در متنِ پیامک نمی‌آید
 * - متنِ پیامکِ نوبت و مراجعه یکی نیست (دو گروهِ بیمار، دو معنا)
 * - فهرست از `/config` می‌آید — تنها چیزی که هر سه صفحهٔ لغو می‌خوانند
 *
 * «نباید بیفتد» — چیزی که اگر بیفتد این بسته از نبودش بدتر است:
 *   گذارِ غیرِ لغو (`done`، `held→confirmed`) دلیل بخواهد ·
 *   بازگرداندن از لغو دلیلِ کهنه را نگه دارد ·
 *   لغوِ دوباره روی مراجعهٔ لغوشده دلیلِ ثبت‌شده را پاک کند یا پیامکِ دوم بفرستد ·
 *   یادداشتِ داخلی به دستِ بیمار برسد ·
 *   متنِ خامِ دلیل (`patient`) در پاسخِ `/config` لو برود
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

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const okStatus = (s) => s >= 200 && s < 300;   // POST در Nest ۲۰۱ می‌دهد، PATCH ۲۰۰
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'cx' + randomBytes(3).toString('hex');
const ISO = new Date().toISOString().slice(0, 10);
const NOTE = `یادداشتِ داخلیِ ${tag} — بیمار تلفنی اطلاع داد`;
const trash = { visits: [], appts: [], forms: [] };
let pid = -1;

try {
  /* ⚠️ نوعِ مراجعه را **خودمان** می‌سازیم: `surgery` روی نصبِ واقعی جراح و
     بیمارستانِ اجباری دارد و تستی که به تعریف‌های موجودِ ماشین تکیه کند، روی
     ماشینِ دیگری چیزِ دیگری می‌سنجد. */
  const form = (await send('/forms', 'POST', { key: tag, title: `لغوِ ${tag}`, scope: 'visit' })).json;
  if (form?.id) trash.forms.push(form.id);
  const v = (await send('/visits', 'POST', {
    kind: tag, firstName: 'زهرایِ', lastName: `لغو${tag}`, phone: '09120000927',
    opDate: new Date().toISOString(),
  })).json;
  if (!v?.id) { console.error('مراجعه ساخته نشد', v); process.exit(1); }
  trash.visits.push(v.id);
  pid = num(`SELECT patient_id FROM visits WHERE id=${v.id}`);
  const notices = () => num(`SELECT count(*) FROM reminders WHERE patient_id=${pid} AND kind='notice'`);

  console.log('۱) فهرستِ دلیل‌ها از /config');
  const cfg = (await send('/config', 'GET')).json;
  const list = cfg?.cancelReasons ?? [];
  ok(Array.isArray(list) && list.length >= 4, `فهرست آمد (${list.length} دلیل)`);
  ok(list.every((r) => r.key && r.label), 'هر دلیل کلید و برچسب دارد');
  const doctor = list.find((r) => r.key === 'doctor');
  ok(!!doctor?.sms?.visit && !!doctor?.sms?.appointment, 'نمونهٔ پیامک برای هر دو نوع هست');
  ok(doctor.sms.visit !== doctor.sms.appointment, 'متنِ نوبت و مراجعه یکی نیست');
  ok(doctor.sms.appointment.includes('نوبتِ شما'), 'متنِ نوبت از «نوبت» حرف می‌زند');
  /* «سایر» عمداً متنِ دلیل ندارد — بیمار پیامِ بی‌دلیل می‌گیرد، نه «به دلیلِ سایر». */
  const other = list.find((r) => r.key === 'other');
  ok(!!other && !other.sms.visit.includes('به دلیلِ'), '«سایر» دلیلی به بیمار نمی‌گوید');
  /* 🔴 نباید بیفتد: تکهٔ خامِ متنِ بیمار بیرونِ جمله فرستاده شود. */
  ok(list.every((r) => !('patient' in r)), 'تکهٔ خامِ متنِ بیمار در پاسخ نیست');

  console.log('۲) لغوِ مراجعه — دلیل اجباری است');
  const bare = await send(`/visits/${v.id}/status`, 'PATCH', { opStatus: 'cancelled' });
  ok(bare.status === 400, `بدونِ دلیل رد شد (${bare.status})`);
  ok(String(bare.json?.message ?? '').includes('دلیل'), 'پیامِ خطا فارسی و دربارهٔ دلیل است');
  ok(sql(`SELECT op_status FROM visits WHERE id=${v.id}`) !== 'cancelled', 'وضعیت دست‌نخورده ماند');
  ok(notices() === 0, 'پیامکی فرستاده نشد');

  const bogus = await send(`/visits/${v.id}/status`, 'PATCH', { opStatus: 'cancelled', cancelReason: 'whatever' });
  ok(bogus.status === 400, `دلیلِ خارج از فهرست رد شد (${bogus.status})`);

  console.log('۳) گذارِ غیرِ لغو دلیل نمی‌خواهد');
  const done = await send(`/visits/${v.id}/status`, 'PATCH', { opStatus: 'done' });
  ok(okStatus(done.status), `تمام‌شده بدونِ دلیل پذیرفته شد (${done.status})`);
  ok(sql(`SELECT coalesce(cancel_reason,'-') FROM visits WHERE id=${v.id}`) === '-', 'دلیلی ننوشت');
  ok(notices() === 0, 'پیامکی نفرستاد');

  console.log('۴) لغو با دلیل');
  const cancelled = await send(`/visits/${v.id}/status`, 'PATCH',
    { opStatus: 'cancelled', cancelReason: 'doctor', cancelNote: NOTE });
  ok(okStatus(cancelled.status), `پذیرفته شد (${cancelled.status})`);
  ok(sql(`SELECT cancel_reason FROM visits WHERE id=${v.id}`) === 'doctor', 'دلیل ذخیره شد');
  ok(sql(`SELECT cancel_note FROM visits WHERE id=${v.id}`) === NOTE, 'یادداشتِ داخلی ذخیره شد');
  ok(notices() === 1, 'یک پیامکِ اطلاع ثبت شد');
  const text = sql(`SELECT text FROM reminders WHERE patient_id=${pid} AND kind='notice' ORDER BY id DESC LIMIT 1`);
  ok(text.includes('مراجعهٔ شما'), 'متن از مراجعه حرف می‌زند، نه نوبت');
  /* 🔴 نباید بیفتد (بازبینیِ UX، clinic-daily-12): تاریخِ ISOِ میلادی («2026-09-30») در پیامکِ بیمار. */
  ok(!/\d{4}-\d{2}-\d{2}/.test(text), 'تاریخِ پیامک شمسی و فارسی است، نه ISOِ میلادی');
  /* 🔴 نباید بیفتد: یادداشتِ داخلی به دستِ بیمار برسد. */
  ok(!text.includes(tag), 'یادداشتِ داخلی در پیامک نیامد');

  console.log('۵) لغوِ دوباره — بی‌اثر، نه ویرانگر');
  const again = await send(`/visits/${v.id}/status`, 'PATCH', { opStatus: 'cancelled' });
  ok(okStatus(again.status), `روی لغوشده دوباره دلیل نمی‌خواهد (${again.status})`);
  ok(sql(`SELECT cancel_reason FROM visits WHERE id=${v.id}`) === 'doctor', 'دلیلِ ثبت‌شده پاک نشد');
  ok(notices() === 1, 'پیامکِ دوم نرفت');

  console.log('۶) بازگشت از لغو، دلیل را هم پاک می‌کند');
  const back = await send(`/visits/${v.id}/status`, 'PATCH', { opStatus: 'pending' });
  ok(okStatus(back.status), `برگشت پذیرفته شد (${back.status})`);
  ok(sql(`SELECT coalesce(cancel_reason,'-') FROM visits WHERE id=${v.id}`) === '-', 'دلیل پاک شد');
  ok(sql(`SELECT coalesce(cancel_note,'-') FROM visits WHERE id=${v.id}`) === '-', 'یادداشت پاک شد');

  console.log('۷) لغوِ نوبت — همان قاعده، متنِ دیگر');
  const mk = (status) => num(
    `INSERT INTO appointments(patient_id, date, start_min, status, created_at, updated_at)
     VALUES (${pid}, '${ISO}', ${600 + Math.floor(Math.random() * 200)}, '${status}', now(), now()) RETURNING id`);
  const a1 = mk('confirmed'); trash.appts.push(a1);
  const aBare = await send(`/appointments/${a1}/status`, 'POST', { status: 'cancelled' });
  ok(aBare.status === 400, `نوبت بدونِ دلیل رد شد (${aBare.status})`);
  ok(sql(`SELECT status FROM appointments WHERE id=${a1}`) === 'confirmed', 'وضعیتِ نوبت دست‌نخورده ماند');

  /* 🔴 نباید بیفتد: گذارِ عادیِ نوبت هم دلیل بخواهد. */
  const a2 = mk('held'); trash.appts.push(a2);
  const conf = await send(`/appointments/${a2}/status`, 'POST', { status: 'confirmed' });
  ok(okStatus(conf.status), `قطعی‌کردنِ نوبت بدونِ دلیل پذیرفته شد (${conf.status})`);

  const before = notices();
  const aOk = await send(`/appointments/${a1}/status`, 'POST',
    { status: 'cancelled', cancelReason: 'hospital', cancelNote: NOTE });
  ok(okStatus(aOk.status), `لغوِ نوبت با دلیل پذیرفته شد (${aOk.status})`);
  ok(sql(`SELECT cancel_reason FROM appointments WHERE id=${a1}`) === 'hospital', 'دلیلِ نوبت ذخیره شد');
  ok(sql(`SELECT cancel_note FROM appointments WHERE id=${a1}`) === NOTE, 'یادداشتِ نوبت ذخیره شد');
  ok(notices() === before + 1, 'پیامکِ لغوِ نوبت ثبت شد');
  const aText = sql(`SELECT text FROM reminders WHERE patient_id=${pid} AND kind='notice' ORDER BY id DESC LIMIT 1`);
  ok(aText.includes('نوبتِ شما'), 'متنِ نوبت از «نوبت» حرف می‌زند');
  ok(!/\d{4}-\d{2}-\d{2}/.test(aText) && /[۰-۹]+ (فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند) [۰-۹]{4}/.test(aText),
    `تاریخِ پیامکِ نوبت شمسی و فارسی است (${aText.slice(0, 60)}…)`);
  ok(!aText.includes(tag), 'یادداشتِ داخلی در پیامکِ نوبت نیامد');

  console.log('۸) میزِ پذیرش همان دلیل را رد می‌کند (مسیرِ سومِ لغو)');
  const a3 = mk('confirmed'); trash.appts.push(a3);
  const dBare = await send(`/frontdesk/appointments/${a3}/status`, 'POST', { status: 'cancelled' });
  ok(dBare.status === 400, `میز بدونِ دلیل رد کرد (${dBare.status})`);
  const dOk = await send(`/frontdesk/appointments/${a3}/status`, 'POST',
    { status: 'cancelled', cancelReason: 'patient' });
  ok(okStatus(dOk.status), `میز با دلیل پذیرفت (${dOk.status})`);
  ok(sql(`SELECT cancel_reason FROM appointments WHERE id=${a3}`) === 'patient', 'دلیل از مسیرِ میز هم نشست');
  /* یادداشت اختیاری است — نبودش نباید رشتهٔ تهی بنویسد. */
  ok(sql(`SELECT coalesce(cancel_note,'-') FROM appointments WHERE id=${a3}`) === '-', 'یادداشتِ نداده NULL ماند، نه رشتهٔ تهی');

  console.log('۹) رابط — پنجره در داشبورد');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const noise = [];
    page.on('console', (m) => { if (m.type() === 'error') noise.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) noise.push(`${r.status()} ${r.url()}`); });
    await browserLogin(page, login.accessToken, { ui: UI });

    const vUi = (await send('/visits', 'POST', {
      kind: tag, patientId: pid, opDate: new Date().toISOString(),
    })).json;
    trash.visits.push(vUi.id);

    await page.goto(`${UI}/app/dashboard?q=${tag}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.db-statuspick', { timeout: 15000 });
    /* ⚠️ برچسبِ دکمه از `/config.statuses.visit` می‌آید، نه از یک رشتهٔ ثابت
       این‌جا. نسخهٔ قبلی «کنسل» را می‌گشت — همان واژهٔ کلاینتیِ قدیمی که با
       «لغو»ِ سرور نمی‌خواند و بستهٔ «یک وضعیت، یک برچسب» برش داشت. سوییتی که
       رشته را پین کند، همان واگرایی را دوباره تثبیت می‌کند. */
    const cancelFa = ((await send('/config')).json?.statuses?.visit ?? [])
      .find((r) => r.key === 'cancelled')?.label;
    ok(!!cancelFa, `برچسبِ «لغو» از /config آمد («${cancelFa}»)`);
    await page.locator('.db-statuspick button', { hasText: cancelFa }).first().click();
    await page.waitForSelector('.cr-sheet', { timeout: 5000 });
    ok(true, 'پنجرهٔ دلیل باز شد');
    ok(await page.locator('.cr-reason').count() === list.length, 'همهٔ دلیل‌ها رندر شدند');
    /* 🔴 نباید بیفتد: ثبتِ لغو بدونِ انتخابِ دلیل کلیک‌پذیر باشد — سرور ۴۰۰ می‌دهد
       و کاربر یک خطای بی‌دلیل می‌بیند به‌جای یک دکمهٔ صریحاً غیرفعال. */
    ok(await page.locator('.cr-btn.danger').isDisabled(), 'تا دلیل انتخاب نشود دکمه غیرفعال است');
    ok(await page.locator('.cr-sms').count() === 0, 'پیش‌نمایش پیش از انتخاب نیست');

    await page.locator('.cr-reason', { hasText: 'تعویقِ پزشک' }).click();
    await page.waitForSelector('.cr-sms', { timeout: 3000 });
    ok((await page.locator('.cr-sms').innerText()).includes('مراجعهٔ شما'), 'پیش‌نمایشِ داشبورد از مراجعه می‌گوید');

    /* ⚠️ «دیده می‌شود؟» را `getComputedStyle` جواب نمی‌دهد — لایه‌های کم‌آلفا باید
       روی هم نشانده شوند. هر دو تم سنجیده می‌شوند (قانون ۲۳). */
    const probe = () => page.evaluate(() => {
      const px = (c) => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d);
        const v = getComputedStyle(d).color; d.remove();
        const m = v.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
      const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
      const lum = (c) => { const g = (u) => { u /= 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * g(c.r) + 0.7152 * g(c.g) + 0.0722 * g(c.b); };
      const stack = (el) => { let bg = px(getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#000');
        const chain = []; for (let n = el; n; n = n.parentElement) chain.unshift(n);
        for (const n of chain) { const c = px(getComputedStyle(n).backgroundColor); if (c.a > 0) bg = over(c, bg); } return bg; };
      const ratio = (sel) => { const el = document.querySelector(sel); if (!el) return 0;
        const L1 = lum(over(px(getComputedStyle(el).color), stack(el.parentElement))), L2 = lum(stack(el));
        return Math.round((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) * 100) / 100; };
      return { head: ratio('.cr-head h3'), sms: ratio('.cr-sms'), note: ratio('.cr-note span'), btn: ratio('.cr-btn.danger') };
    });
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(220);
      const r = await probe();
      await page.screenshot({ path: `${SHOTS}/cancel-reason-${theme}.png` });
      for (const [k, v] of Object.entries(r)) ok(v >= 4.5, `تمِ ${theme === 'dark' ? 'تیره' : 'روشن'}: ${k} = ${v}`);
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

    await page.locator('.cr-note textarea').fill(NOTE);
    await page.locator('.cr-btn.danger').click();
    await page.waitForSelector('.cr-sheet', { state: 'detached', timeout: 8000 });
    ok(sql(`SELECT cancel_reason FROM visits WHERE id=${vUi.id}`) === 'doctor', 'دلیل از رابط در دیتابیس نشست');
    ok(sql(`SELECT cancel_note FROM visits WHERE id=${vUi.id}`) === NOTE, 'یادداشت از رابط نشست');
    ok(sql(`SELECT op_status FROM visits WHERE id=${vUi.id}`) === 'cancelled', 'وضعیت لغو شد');

    console.log('۱۰) رابط — میزِ پذیرش همان پنجره را با متنِ نوبت می‌دهد');
    const aUi = mk('confirmed'); trash.appts.push(aUi);
    await page.goto(`${UI}/app/frontdesk`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`.fd-card[data-appt="${aUi}"]`, { timeout: 15000 });
    await page.locator(`.fd-card[data-appt="${aUi}"] .fd-btn.danger`).click();
    await page.waitForSelector('.cr-sheet', { timeout: 5000 });
    await page.locator('.cr-reason', { hasText: 'تعویقِ پزشک' }).click();
    await page.waitForSelector('.cr-sms', { timeout: 3000 });
    /* 🔴 نباید بیفتد: پنجرهٔ مشترک همه‌جا متنِ **مراجعه** را نشان دهد — نوبت و
       مراجعه دو چیزند و بیمار دو پیامِ متفاوت می‌گیرد. */
    const deskSms = await page.locator('.cr-sms').innerText();
    ok(deskSms.includes('نوبتِ شما'), 'پیش‌نمایشِ میز از نوبت می‌گوید');
    ok(!deskSms.includes('مراجعهٔ شما'), 'و متنِ مراجعه را نشان نمی‌دهد');

    await page.locator('.cr-btn.danger').click();
    await page.waitForSelector('.cr-sheet', { state: 'detached', timeout: 8000 });
    ok(sql(`SELECT status FROM appointments WHERE id=${aUi}`) === 'cancelled', 'نوبت از میز لغو شد');
    ok(sql(`SELECT cancel_reason FROM appointments WHERE id=${aUi}`) === 'doctor', 'دلیلِ نوبت از رابط نشست');
    ok(noise.length === 0, `بدونِ خطای کنسول/شبکه${noise.length ? ' — ' + noise.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
  }
} finally {
  for (const id of trash.appts) sql(`DELETE FROM appointments WHERE id=${id}`);
  if (pid > 0) sql(`DELETE FROM reminders WHERE patient_id=${pid}`);
  for (const id of trash.visits) await send(`/visits/${id}`, "DELETE").catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, "DELETE").catch(() => {});
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
