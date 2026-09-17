/**
 * «از همان ثبت، پیشنهادِ نوبت» (#46) — ویزیتِ بعدی ← نوبتِ واقعی:
 *
 * - `GET /appointments/suggest`: باز/بسته، ظرفیتی/اسلاتی، جاهای آزاد،
 *   نوبتِ فعالِ خودِ بیمار، و `scheduled` (fail-softِ نصبِ بی‌برنامه).
 * - ثبت از **همان مسیرِ walkIn** — ظرفیت و اسلات محترم می‌مانند.
 * - ضدِ پیامکِ دوبله: نوبتِ همان روز → next_visit خاموش؛ لغو/نیامدِ نوبت →
 *   next_visit دوباره کاشته می‌شود؛ ویرایشِ ویزیت با نوبتِ فعال → دوبله نمی‌کارد.
 * - مرورگر: ویرایشِ ویزیت با «ویزیتِ بعدی» → پنجرهٔ پیشنهاد → ثبتِ نوبت.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'nb' + randomBytes(3).toString('hex');
const iso = (d) => d.toISOString().slice(0, 10);
const jstr = (d) => {
  const parts = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).formatToParts(d);
  const g = (t) => parts.find((x) => x.type === t).value.replace(/[^\d]/g, '');
  return `${g('year')}/${g('month')}/${g('day')}`;
};

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — ' + JSON.stringify(login)); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());

/* قاعده‌های فعالِ دیگر (به‌جامانده از suiteهای دیگر) ظرفیتِ روز را غیرقطعی
   می‌کنند — موقتاً خاموش، در پایان برگردانده می‌شوند. */
const prevActive = execSync(`psql "${DB}" -qtA`, { input: 'SELECT id FROM availability_rules WHERE active = true' })
  .toString().trim().split('\n').filter(Boolean);
if (prevActive.length) sql(`UPDATE availability_rules SET active=false WHERE id IN (${prevActive.join(',')})`);

const D7 = new Date(Date.now() + 7 * 864e5); // هفتهٔ بعد، ظرفیتی
const D8 = new Date(Date.now() + 8 * 864e5); // اسلاتی
const wd = (d) => (d.getUTCDay() + 1) % 7;

/* نوبت‌های به‌جامانده روی همین دو روز، ظرفیت و شمارهٔ صف را غیرقطعی می‌کنند. */
sql(`DELETE FROM reminders WHERE appointment_id IN (SELECT id FROM appointments WHERE date IN ('${iso(D7)}','${iso(D8)}'))`);
sql(`DELETE FROM appointments WHERE date IN ('${iso(D7)}','${iso(D8)}')`);

const trash = { forms: [], visits: [], rules: [], appts: [], excs: [] };

try {
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ نوبت', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  /* کاتالوگِ builtin با خواندنِ فهرست backfill می‌شود؛ «ویزیتِ بعدی» برای
     نوعِ سفارشی پیش‌فرض خاموش است — برای آزمونِ مرورگر روشنش می‌کنیم. */
  await send('/forms', 'GET');
  const vdef = (await send(`/forms/${encodeURIComponent(vform.key)}`, 'GET')).json;
  const nvField = (vdef?.fields ?? []).find((x) => x.key === 'nextVisitDate');
  if (!nvField?.id) { console.error('فیلدِ ویزیتِ بعدی در کاتالوگ نیست: ' + JSON.stringify(vdef?.fields?.map((x) => x.key))); process.exit(1); }
  await send(`/forms/fields/${nvField.id}`, 'PATCH', { active: true });
  const r1 = (await send('/availability/rules', 'POST', { weekday: wd(D7), startMin: 960, endMin: 1200, mode: 'capacity', capacity: 2 })).json;
  trash.rules.push(r1.id);
  const r2 = (await send('/availability/rules', 'POST', { weekday: wd(D8), startMin: 960, endMin: 1080, mode: 'slot', slotMinutes: 30 })).json;
  trash.rules.push(r2.id);

  const mkVisit = async (last, phone, next) => {
    const v = (await send('/visits', 'POST', {
      kind: tag, firstName: 'بیمارِ', lastName: last, phone,
      opDate: new Date().toISOString(), ...(next ? { nextVisitDate: next } : {}),
    })).json;
    if (!v?.id) { console.error('ویزیت ساخته نشد: ' + JSON.stringify(v)); process.exit(1); }
    trash.visits.push(v.id);
    return v;
  };

  console.log('۱) suggest — روزِ ظرفیتی');
  const vA = await mkVisit('نوبت‌خواه', '09120000801', iso(D7));
  let sug = await get(`/appointments/suggest?patientId=${vA.patientId}&date=${iso(D7)}`);
  ok(sug.scheduled === true && sug.open === true && sug.mode === 'capacity', `باز و ظرفیتی (${sug.mode})`);
  ok(sug.free === 2 && sug.existing === null, `دو جای آزاد، بدونِ نوبتِ قبلی (${sug.free})`);
  ok(Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${vA.id} AND kind='next_visit' AND status='pending'`)) === 1,
    'یادآوریِ «ویزیتِ بعدی» کاشته شده');

  console.log('\n۲) ثبتِ نوبت از همان مسیرِ حضوری');
  const b1 = await send('/appointments', 'POST', { patientId: vA.patientId, date: iso(D7) });
  ok(b1.status === 201 || b1.status === 200, `نوبت ثبت شد (${b1.status})`);
  trash.appts.push(b1.json.id);
  ok(b1.json.status === 'confirmed' && b1.json.seq === 1, `قطعی با شمارهٔ صف (${b1.json.seq})`);
  ok(Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${vA.id} AND kind='next_visit' AND status='pending'`)) === 0,
    '**next_visit خاموش شد — پیامکِ دوبله نمی‌رود**');
  ok(Number(sql(`SELECT count(*) FROM reminders WHERE appointment_id=${b1.json.id} AND kind='appointment' AND status='pending'`)) === 1,
    'یادآوریِ خودِ نوبت کاشته شد');
  sug = await get(`/appointments/suggest?patientId=${vA.patientId}&date=${iso(D7)}`);
  ok(!!sug.existing && sug.existing.id === b1.json.id, '**suggest نوبتِ موجود را برمی‌گرداند (دوباره نگیر)**');
  ok(sug.free === 1, `ظرفیت یکی کم شد (${sug.free})`);

  console.log('\n۳) پر شدن و بسته بودن');
  const vB = await mkVisit('دومی', '09120000802', null);
  const b2 = await send('/appointments', 'POST', { patientId: vB.patientId, date: iso(D7) });
  trash.appts.push(b2.json.id);
  const vC = await mkVisit('سومی', '09120000803', null);
  sug = await get(`/appointments/suggest?patientId=${vC.patientId}&date=${iso(D7)}`);
  ok(sug.open === false && sug.free === 0, 'روزِ پر برای نفرِ سوم بسته است');
  const b3 = await send('/appointments', 'POST', { patientId: vC.patientId, date: iso(D7) });
  ok(b3.status === 400, `walkIn هم روزِ پر را رد می‌کند (${b3.status})`);

  console.log('\n۴) لغو ← یادآوریِ ویزیتِ بعدی برمی‌گردد');
  await send(`/appointments/${b1.json.id}/status`, 'POST', { status: 'cancelled', cancelReason: 'other' });
  ok(Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${vA.id} AND kind='next_visit' AND status='pending'`)) === 1,
    '**لغوِ نوبت، next_visit را دوباره می‌کارد**');
  sug = await get(`/appointments/suggest?patientId=${vA.patientId}&date=${iso(D7)}`);
  ok(sug.existing === null && sug.free === 1, 'نوبتِ لغوشده نه «موجود» است نه جا اشغال می‌کند');

  console.log('\n۵) ویرایشِ ویزیت با نوبتِ فعال، دوبله نمی‌کارد');
  const b4 = await send('/appointments', 'POST', { patientId: vA.patientId, date: iso(D7) });
  trash.appts.push(b4.json.id);
  await send(`/visits/${vA.id}`, 'PATCH', { nextVisitDate: iso(D7) });
  ok(Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${vA.id} AND kind='next_visit' AND status='pending'`)) === 0,
    '**هم‌گام‌سازیِ دوباره با نوبتِ فعال next_visit نمی‌کارد**');

  console.log('\n۶) روزِ اسلاتی');
  sug = await get(`/appointments/suggest?patientId=${vB.patientId}&date=${iso(D8)}`);
  ok(sug.mode === 'slot' && Array.isArray(sug.slots) && sug.slots.length === 4, `چهار اسلاتِ ۳۰ دقیقه (${sug.slots?.length})`);
  ok(sug.slots.every((s) => !s.taken), 'همه آزادند');
  const s1 = await send('/appointments', 'POST', { patientId: vB.patientId, date: iso(D8), startMin: 960 });
  trash.appts.push(s1.json.id);
  ok(s1.json.time === '16:00', `نوبتِ ساعت‌دار ثبت شد (${s1.json.time})`);
  sug = await get(`/appointments/suggest?patientId=${vC.patientId}&date=${iso(D8)}`);
  ok(sug.slots.find((s) => s.startMin === 960)?.taken === true, 'اسلاتِ گرفته‌شده «پر» گزارش می‌شود');
  const s2 = await send('/appointments', 'POST', { patientId: vC.patientId, date: iso(D8), startMin: 960 });
  ok(s2.status === 400, `همان اسلات برای نفرِ بعد رد می‌شود (${s2.status})`);

  console.log('\n۷) تعطیلیِ اعلام‌شده');
  const exc = (await send('/availability/exceptions', 'POST', { date: iso(D8), closed: true })).json;
  trash.excs.push(exc.id);
  sug = await get(`/appointments/suggest?patientId=${vC.patientId}&date=${iso(D8)}`);
  ok(sug.open === false && sug.closed === true, 'روزِ تعطیل «بسته» گزارش می‌شود');
  await send(`/availability/exceptions/${exc.id}`, 'DELETE');
  trash.excs.length = 0;

  console.log('\n۸) مرورگر — از فرمِ ویزیت تا نوبت');
  /* D7 الان پر است (b2 + b4) — یکی آزاد می‌شود تا پنجرهٔ مرورگر «جای آزاد» ببیند. */
  await send(`/appointments/${b4.json.id}/status`, 'POST', { status: 'cancelled', cancelReason: 'other' });
  const vD = await mkVisit('مرورگری', '09120000804', null);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + '/login');
    await page.waitForTimeout(900);
    await page.fill('input[name="identifier"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app**', { timeout: 15000 });

    await page.goto(BASE + `/app/dashboard?patient=${vD.id}`);
    await page.waitForTimeout(2500);
    ok(await page.locator('.db-sheet .db-sheet-head b').count() >= 1, 'شیتِ ویرایش با دیپ‌لینک باز شد');

    const jd = page.locator('.jd-wrap', { has: page.locator('span:has-text("ویزیتِ بعدی")') }).locator('input');
    await jd.fill(jstr(D7));
    await jd.blur();
    await page.locator('.db-sheet button.db-submit:has-text("ذخیرهٔ تغییرات")').click();
    await page.waitForTimeout(2200);

    const nvb = page.locator('.db-nvb');
    ok(await nvb.count() === 1, '**پنجرهٔ پیشنهادِ نوبت بعد از ذخیره باز شد**');
    ok((await nvb.innerText()).includes('جای آزاد'), 'ظرفیتِ آزادِ روز را می‌گوید');
    await nvb.locator('button:has-text("ثبتِ نوبت")').click();
    await page.waitForTimeout(1500);
    ok((await nvb.innerText()).includes('ثبت شد'), 'ثبتِ موفق در همان پنجره');
    const cnt = sql(`SELECT count(*) FROM appointments a JOIN visits v ON v.patient_id=a.patient_id WHERE v.id=${vD.id} AND a.date='${iso(D7)}' AND a.status='confirmed'`);
    ok(Number(cnt) === 1, '**نوبتِ واقعی در دفترِ نوبت‌ها نشست**');
    trash.appts.push(Number(sql(`SELECT a.id FROM appointments a JOIN visits v ON v.patient_id=a.patient_id WHERE v.id=${vD.id} AND a.date='${iso(D7)}' ORDER BY a.id DESC LIMIT 1`)));
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  for (const id of trash.excs) await send(`/availability/exceptions/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.appts.filter(Boolean)) sql(`DELETE FROM reminders WHERE appointment_id=${id}`) && sql(`DELETE FROM appointments WHERE id=${id}`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.rules) await send(`/availability/rules/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM patients WHERE phone IN ('09120000801','09120000802','09120000803','09120000804')`);
  if (prevActive.length) sql(`UPDATE availability_rules SET active=true WHERE id IN (${prevActive.join(',')})`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
