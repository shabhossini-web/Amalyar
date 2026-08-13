/**
 * **میزِ پذیرش و «شروعِ ویزیت»** — `docs/BOOKING.md` مرحلهٔ ۵.
 *
 * چرخهٔ کاملِ یک روزِ مطب: نوبتِ اینترنتی (از ثبت‌نام) + نوبتِ حضوری (منشی)
 * → رسید (در مطب) → شروعِ ویزیت (فرمِ مراجعه از خودِ نوبت) → تمام. به‌علاوه:
 *
 *  • ماشینِ وضعیت صریح است — `done` به عقب برنمی‌گردد، «نیامد» برمی‌گردد.
 *  • بیمارِ «در مطب» جا اشغال می‌کند — وگرنه نفرِ بعدی روی همان اسلات می‌نشست.
 *  • دوبار «شروعِ ویزیت» مراجعهٔ دوم نمی‌سازد.
 *  • حضوریِ منشی از همان مسیرِ ظرفیت می‌گذرد — روزِ پر برای منشی هم پر است.
 */
import { chromium } from 'playwright-core';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const { execSync } = await import('node:child_process');
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const sql = (q) => execSync(`psql "${DB}" -qtAc ${JSON.stringify(q)}`).toString().trim().split('\n')[0];

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — سرور را ری‌استارت کنید'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());
const send = (p, method, body) => fetch(API + p, { method, headers: A, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = Math.random().toString(36).slice(2, 7);
const trash = { rules: [], topics: [], visits: [], appts: [], patients: [] };

/* پاک‌سازیِ اولیه — قاعده و نوبتِ اجرای مرده نباید ماه را شلوغ کند. */
for (const r of await get('/availability/rules')) await fetch(API + `/availability/rules/${r.id}`, { method: 'DELETE', headers: A });
sql('DELETE FROM appointments');

try {
  console.log('۰) برنامهٔ کاری: هر روز ۱۶–۱۸، هر نوبت ۳۰ دقیقه (۴ جا)');
  const topic = (await send('/visit-topics', 'POST', { name: `پذیرشِ ${tag}` })).json;
  trash.topics.push(topic.id);
  for (let w = 0; w < 7; w++) {
    const rule = (await send('/availability/rules', 'POST', {
      weekday: w, startMin: 16 * 60, endMin: 18 * 60, mode: 'slot', slotMinutes: 30, topicIds: [topic.id],
    })).json;
    trash.rules.push(rule.id);
  }

  /* بیمارِ موجود برای نوبتِ حضوری — از مسیرِ عادیِ ثبتِ مراجعه ساخته می‌شود. */
  const [kinds, sur, hos] = await Promise.all([
    get('/forms/visit-kinds'), get('/surgeons'), get('/hospitals'),
  ]);
  const seed = (await send('/visits', 'POST', {
    kind: kinds[0]?.kind, firstName: 'بیمارِ', lastName: `حضوری ${tag}`,
    surgeonId: (sur.rows ?? sur)[0]?.id, hospitalId: (hos.rows ?? hos)[0]?.id,
    opDate: new Date().toISOString(),
  })).json;
  if (!seed?.patientId) { console.error('بیمارِ seed ساخته نشد:', JSON.stringify(seed)); process.exit(1); }
  trash.visits.push(seed.id);
  const patientId = seed.patientId;

  const now = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', timeZone: 'UTC' })
    .formatToParts(new Date());
  const jy = Number(now.find((x) => x.type === 'year').value.replace(/[^\d]/g, ''));
  const jm = Number(now.find((x) => x.type === 'month').value);
  const cal0 = await get(`/availability/month?year=${jy}&month=${jm}`);
  const openDay = cal0.days.find((d) => d.open);
  const slots = openDay.windows[0].slots;

  console.log(`\n۱) منشی نوبتِ حضوری می‌گیرد (${openDay.date})`);
  const w1 = await send('/appointments', 'POST', {
    patientId, date: openDay.date, startMin: slots[0].startMin, topicId: topic.id, note: 'حضوری',
  });
  ok(w1.status < 300, `نوبتِ حضوری ثبت شد (${w1.status})`);
  ok(w1.json?.status === 'confirmed', 'حضوری مستقیم «قطعی» است — پولی در انتظار نیست');
  ok(w1.json?.time === '16:00', `ساعتش برگشت (${w1.json?.time})`);
  trash.appts.push(w1.json.id);

  console.log('\n۲) حضوری از همان مسیرِ ظرفیت می‌گذرد');
  const clash = await send('/appointments', 'POST', { patientId, date: openDay.date, startMin: slots[0].startMin });
  ok(clash.status >= 400, `همان ساعت برای منشی هم بسته است (${clash.status})`);

  console.log('\n۳) نوبت‌های روز در تقویمِ ماه می‌آیند — همان یک fetch');
  const calMonth = await get(`/calendar?year=${jy}&month=${jm}`);
  const [, , jdStr] = openDay.date.split('-');
  void jdStr;
  const dayCell = (calMonth.days ?? []).find((d) => (d.appointments ?? []).some((a) => a.id === w1.json.id));
  ok(!!dayCell, 'روزِ نوبت‌دار در پاسخِ تقویم هست');
  const inCal = dayCell?.appointments.find((a) => a.id === w1.json.id);
  ok(inCal?.fullName?.includes('حضوری'), `با نامِ بیمار (${inCal?.fullName})`);
  ok(inCal?.statusLabel === 'قطعی', `و برچسبِ فارسیِ وضعیت (${inCal?.statusLabel})`);
  ok(Array.isArray(inCal?.next) && inCal.next.includes('arrived'), 'و گذارهای مجاز از سرور می‌آیند');

  console.log('\n۴) رسید → در مطب؛ و بیمارِ در مطب جا اشغال می‌کند');
  const arr = await send(`/appointments/${w1.json.id}/status`, 'POST', { status: 'arrived' });
  ok(arr.json?.status === 'arrived' && arr.json?.statusLabel === 'در مطب', `وضعیت: ${arr.json?.statusLabel}`);
  const calAfter = await get(`/availability/month?year=${jy}&month=${jm}`);
  const dayAfter = calAfter.days.find((d) => d.date === openDay.date);
  ok(dayAfter.windows[0].slots.find((s) => s.startMin === slots[0].startMin)?.taken === true,
    '**اسلاتِ بیمارِ «در مطب» هنوز اشغال است** — رسیدن جا را آزاد نمی‌کند');

  console.log('\n۵) ماشینِ وضعیت صریح است');
  const bad = await send(`/appointments/${w1.json.id}/status`, 'POST', { status: 'held' });
  ok(bad.status >= 400, `«در مطب» به «در انتظارِ پرداخت» برنمی‌گردد (${bad.status})`);
  ok(/نمی‌شود/.test(bad.json?.message ?? ''), `و پیامش گذارِ ممنوع را می‌گوید («${bad.json?.message}»)`);

  console.log('\n۶) شروعِ ویزیت — مراجعه از خودِ نوبت ساخته می‌شود');
  const sv = await send(`/appointments/${w1.json.id}/visit`, 'POST');
  ok(sv.status < 300 && !!sv.json?.visitId, `ویزیت ساخته شد (visit ${sv.json?.visitId})`);
  ok(sv.json?.made === true, 'و تازه ساخته شده، نه پیدا');
  trash.visits.push(sv.json.visitId);
  const v = await get(`/visits/${sv.json.visitId}`);
  ok(String(v.opDate ?? '').slice(0, 10) === openDay.date, `تاریخِ مراجعه = روزِ نوبت (${String(v.opDate).slice(0, 10)})`);
  ok(v.opStartTime === '16:00', `ساعتِ شروع از نوبت آمد (${v.opStartTime})`);
  ok(v.topicId === topic.id, 'موضوعِ نوبت هم روی مراجعه نشست');
  ok(v.patientId === patientId, 'و روی پروندهٔ همان بیمار');

  const sv2 = await send(`/appointments/${w1.json.id}/visit`, 'POST');
  ok(sv2.json?.visitId === sv.json.visitId && sv2.json?.made === false,
    '**کلیکِ دوم مراجعهٔ دوم نمی‌سازد** — همان ویزیت برمی‌گردد');

  console.log('\n۷) تمام شد — و دیگر به عقب برنمی‌گردد');
  const done = await send(`/appointments/${w1.json.id}/status`, 'POST', { status: 'done' });
  ok(done.json?.status === 'done', `وضعیت: ${done.json?.statusLabel}`);
  const back = await send(`/appointments/${w1.json.id}/status`, 'POST', { status: 'arrived' });
  ok(back.status >= 400, '«انجام شد» قفل است');

  console.log('\n۸) «نیامد» جا را آزاد می‌کند و قابلِ برگشت است');
  const w2 = (await send('/appointments', 'POST', { patientId, date: openDay.date, startMin: slots[1].startMin })).json;
  trash.appts.push(w2.id);
  await send(`/appointments/${w2.id}/status`, 'POST', { status: 'noshow' });
  const calNo = await get(`/availability/month?year=${jy}&month=${jm}`);
  ok(calNo.days.find((d) => d.date === openDay.date).windows[0].slots
      .find((s) => s.startMin === slots[1].startMin)?.taken === false,
    'اسلاتِ «نیامد» آزاد شد');
  const undo = await send(`/appointments/${w2.id}/status`, 'POST', { status: 'confirmed' });
  ok(undo.status < 300, 'و «نیامد»ِ اشتباه قابلِ برگشت است');

  console.log('\n۹) فهرستِ روزِ میزِ پذیرش مرتب است');
  const dayList = await get(`/appointments/day?date=${openDay.date}`);
  ok(Array.isArray(dayList) && dayList.length === 2, `دو نوبتِ امروز (${dayList.length})`);
  ok(dayList[0].time <= dayList[1].time, 'به ترتیبِ ساعت');

  console.log('\n۱۰) مرورگر: نوبت در تقویم دیده می‌شود و «بازکردنِ ویزیت» فرم را می‌آورد');
  /* ادعا روی حالتِ دیده‌شده — «API برمی‌گرداند» با «منشی می‌بیند» یکی نیست. */
  const b = await chromium.launch({
    executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const p = await (await b.newContext({ viewport: { width: 480, height: 1000 }, locale: 'fa-IR' })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(UI + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate((t) => localStorage.setItem('amalyar_token', t), login.accessToken);
    await p.goto(UI + '/app/calendar', { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    /* روزِ نوبت‌دار را انتخاب کن — سلولش نشانِ 🕐 دارد. */
    const day = Number(openDay.date && openDay.day) || null;
    void day;
    const cell = p.locator('.jg-cell', { has: p.locator('.cal-appt-dot') }).first();
    ok(await cell.count() === 1, 'سلولِ روزِ نوبت‌دار نشانِ نوبت دارد');
    await cell.click();
    await p.waitForTimeout(900);
    const desk = p.locator('.cal-appts');
    ok(await desk.count() === 1, 'میزِ پذیرشِ روز باز شد');
    const deskText = await desk.innerText();
    ok(deskText.includes('حضوری ' + tag), 'نامِ بیمار روی صفحه است');
    ok(/انجام شد/.test(deskText), `و وضعیتش («انجام شد» بعد از چرخهٔ کامل)`);
    const openBtn = desk.locator('.cal-appt-go').first();
    ok(/بازکردنِ ویزیت/.test(await openBtn.innerText()), 'نوبتِ ویزیت‌دار «بازکردنِ ویزیت» می‌گوید نه «شروع»');
    await openBtn.click();
    await p.waitForTimeout(2500);
    ok(/\/app\/dashboard\?patient=/.test(p.url()), `به داشبورد رفت (${p.url().split('/app')[1]})`);
    ok(await p.locator('.db-sheet').count() === 1, '**و شیتِ همان مراجعه باز شد**');
  } finally {
    console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
    await b.close();
  }
} finally {
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  sql('DELETE FROM appointments');
  for (const id of trash.visits) await fetch(API + `/visits/${id}`, { method: 'DELETE', headers: A });
  for (const id of trash.rules) await fetch(API + `/availability/rules/${id}`, { method: 'DELETE', headers: A });
  for (const id of trash.topics) await fetch(API + `/visit-topics/${id}`, { method: 'DELETE', headers: A });
}
process.exit(fail ? 1 : 0);
