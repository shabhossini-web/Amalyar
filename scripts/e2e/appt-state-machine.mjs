/**
 * **یک ماشینِ وضعیت برای نوبت — در هر میزی که بازش می‌کنی.**
 *
 * بازخوردِ مالک ۱۴۰۵/۰۶/۳۱: «تو میز منشی وقتی می‌زنیم مریض رسید، دیگه نمی‌شه
 * زد شروع ویزیت و گم می‌شه، و این قسمت با قسمتِ پزشک همپوشانی داره و یکسان
 * بودنِ دیتابیس‌ها واجب ه تو کلِ پروژه.»
 *
 * دیتابیس از اول یکی بود. چیزی که یکی نبود **قاعده** بود — «آیا این نوبت را
 * می‌شود شروع کرد؟» سه جا از نو نوشته شده بود و هر سه فرق داشتند:
 *
 *   `FrontDeskService.start()`      امروز + نه `held` + نه لغو/نیامد   ✅
 *   `Calendar.jsx`                  فقط نه لغو/نیامد                   ❌
 *   `POST /appointments/:id/visit`  فقط نه لغو                         ❌
 *
 * پس تقویم برای نوبتِ **پول‌نداده** هم دکمهٔ «شروعِ ویزیت» می‌داد، و چون
 * مسیرِ سرورش هم شرط نداشت آن دکمه واقعاً کار می‌کرد: مراجعه‌ای واقعی از
 * بیماری که هنوز پرداخت نکرده بود ساخته می‌شد.
 *
 * ⚠️ **ولی «فقط امروز» جزوِ قاعدهٔ مشترک نیست و نباید باشد** — این را نسخهٔ
 * اولِ همین بسته اشتباه گرفت و یک رفتارِ عمدی را شکست: نوبتی که برای مراجعهٔ
 * هفتهٔ بعد گرفته شده و بیمار زودتر آمده، با «شروع» تاریخِ مراجعه‌اش امروز
 * می‌شود («تاریخِ حضورِ واقعی»)، و `w1-5-appointment-visit-link` با فیکسچرِ
 * +۷ روز دقیقاً همین را تضمین می‌کند. «فقط امروز» قاعدهٔ **تختهٔ میزِ پذیرش**
 * است، چون آن یک تختهٔ یک‌روزه است و کلیک روی ردیفِ دیروز اشتباه است نه
 * تصمیم. پس بندِ ۳ هر دو در را جدا می‌سنجد.
 *
 * ادعای این سوییت مقایسهٔ **بینِ مسیرها**ست، نه درستیِ یکی از آن‌ها: همان
 * نوبت باید در هر مسیری که میزها می‌خوانند عینِ هم جواب بدهد، و هر دری که
 * به سرور باز می‌شود همان قفل را داشته باشد. نگهبانِ ایستای
 * `verify-state-machine.js` مکملِ همین است (کلاینت قاعده‌اش را ننویسد).
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { toJalaali } from '../../src/lib/jalali.js';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — سرور را ری‌استارت کنید'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const get = (p) => send(p, 'GET').then((r) => r.json);

const tag = 'sm' + randomBytes(3).toString('hex');
const trash = [];
let code = 1;

try {
  /* نوعِ `clinic` لازم است: `startVisit` همان را می‌سازد و اگر نباشد اولین
     نوعِ غیرِ `surgery` را برمی‌دارد — یعنی تکیه به حالتِ محیط. */
  const kinds = await get('/forms/visit-kinds');
  if (!Array.isArray(kinds) || !kinds.some((k) => k.kind === 'clinic')) {
    await send('/forms', 'POST', { key: 'clinic', title: `ویزیتِ ${tag}`, scope: 'visit' });
  }

  const v0 = (await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'ماشینِ', lastName: `وضعیت${tag}`, phone: '09120000931',
    opDate: new Date().toISOString(),
  })).json;
  if (!v0?.id) { console.error('مراجعهٔ پایه ساخته نشد:', JSON.stringify(v0)); process.exit(1); }
  trash.push(v0.id);
  const pid = num(`SELECT patient_id FROM visits WHERE id=${v0.id}`);

  /* ⚠️ «امروز» را از خودِ سرور می‌گیریم، نه از ساعتِ این اسکریپت: سرور روزِ
     **مطب** (`Asia/Tehran`) را می‌سنجد و کانتینرِ CI روی UTC است. بینِ ۰۰:۰۰
     تا ۰۳:۳۰ تهران این دو یک روز فرق دارند و سوییت بی‌دلیل قرمز می‌شد. */
  const guess = new Date().toISOString().slice(0, 10);
  const next = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const ISO = (await get(`/frontdesk/day?date=${guess}`))?.isToday ? guess
    : (await get(`/frontdesk/day?date=${next}`))?.isToday ? next : guess;
  const mk = (status, date) => num(
    `INSERT INTO appointments(patient_id, date, start_min, status, created_at, updated_at)
     VALUES (${pid}, '${date}', ${540 + Math.floor(Math.random() * 400)}, '${status}', now(), now()) RETURNING id`);
  const aHeld = mk('held', ISO);
  const aConf = mk('confirmed', ISO);
  const aNo = mk('noshow', ISO);
  const aSoon = num(
    `INSERT INTO appointments(patient_id, date, start_min, status, created_at, updated_at)
     VALUES (${pid}, '${ISO}'::date + 3, 600, 'confirmed', now(), now()) RETURNING id`);

  console.log('۱) `canStart` و علتش همراهِ هر ردیف می‌آیند');
  const deskRows = (await get(`/frontdesk/day?date=${ISO}`))?.rows ?? [];
  const deskOf = (id) => deskRows.find((r) => r.id === id);
  ok(deskOf(aConf)?.canStart === true && deskOf(aConf)?.startHint === null,
    'نوبتِ قطعیِ امروز: شروع می‌شود و علتی ندارد');
  ok(deskOf(aHeld)?.canStart === false && /قطعی/.test(deskOf(aHeld)?.startHint ?? ''),
    `در-انتظارِ-پرداخت نمی‌شود و **می‌گوید چرا** («${deskOf(aHeld)?.startHint}»)`);
  /* 🔴 دکمهٔ خاموشِ بی‌توضیح همان‌قدر بد است که دکمهٔ غلط: کاربر فکر می‌کند
     صفحه خراب است. `startHint` برای همین کنارِ `canStart` نشست. */
  ok(deskOf(aNo)?.canStart === false && (deskOf(aNo)?.startHint ?? '').length > 0,
    '«نیامد» هم علتِ خودش را دارد، نه دکمه‌ای که بی‌صدا غیب شود');

  console.log('\n۲) همان نوبت، همان جواب — در هر مسیری که میزها می‌خوانند');
  /* تبدیل فقط با `src/lib/jalali.js` (قانون ۱۴) — نه `Intl`ِ دستیِ دوم. */
  const [gy, gm, gd] = ISO.split('-').map(Number);
  const { jy, jm } = toJalaali(gy, gm, gd);
  /* ⚠️ نوبتِ «سه روزِ آینده» ممکن است به ماهِ شمسیِ **بعد** بیفتد (امروز
     می‌تواند ۳۱ شهریور باشد). تقویم ماه‌به‌ماه است، پس اگر فقط ماهِ جاری را
     بخوانیم آن ردیف اصلاً در پاسخ نیست و ادعای `canStart === false` با
     `undefined` سبز/قرمزِ بی‌معنا می‌دهد. هر دو ماه خوانده می‌شود. */
  const soonIso = sql(`SELECT date::text FROM appointments WHERE id=${aSoon}`);
  const [sy, sm, sd] = soonIso.split('-').map(Number);
  const soonJ = toJalaali(sy, sm, sd);
  const months = [[jy, jm], ...(soonJ.jy === jy && soonJ.jm === jm ? [] : [[soonJ.jy, soonJ.jm]])];
  const [apptDay, cals, one] = await Promise.all([
    get(`/appointments/day?date=${ISO}`),
    Promise.all(months.map(([y, m]) => get(`/calendar?year=${y}&month=${m}`))),
    get(`/frontdesk/appointments/${aConf}`),
  ]);
  const calAppts = cals.flatMap((c) => (c?.days ?? []).flatMap((d) => d.appointments ?? []));
  const seen = {
    'میزِ پذیرش (`/frontdesk/day`)': deskOf(aConf)?.canStart,
    'برنامهٔ نوبت‌ها (`/appointments/day`)': (apptDay ?? []).find((r) => r.id === aConf)?.canStart,
    'تقویمِ عمل‌ها (`/calendar`)': calAppts.find((r) => r.id === aConf)?.canStart,
    'پاپ‌آپِ نوبت (`/frontdesk/appointments/:id`)': one?.canStart,
  };
  const vals = Object.values(seen).filter((v) => v !== undefined);
  ok(vals.length === 4 && new Set(vals).size === 1 && vals[0] === true,
    'نوبتِ قطعیِ امروز در هر چهار مسیر `canStart: true` است', JSON.stringify(seen));

  const heldSeen = [
    deskOf(aHeld)?.canStart,
    (apptDay ?? []).find((r) => r.id === aHeld)?.canStart,
    calAppts.find((r) => r.id === aHeld)?.canStart,
    (await get(`/frontdesk/appointments/${aHeld}`))?.canStart,
  ];
  ok(heldSeen.length === 4 && heldSeen.every((v) => v === false),
    '🔴 و نوبتِ پول‌نداده در هر چهار مسیر `false` — تقویم قبلاً این یکی را دکمه می‌کرد',
    JSON.stringify(heldSeen));
  const soonRow = calAppts.find((r) => r.id === aSoon);
  ok(soonRow != null && soonRow.canStart === false,
    '🔴 نوبتِ سه روزِ آینده هم در تقویم دکمه نمی‌گیرد (تاریخِ مراجعه بازنویسی می‌شد)',
    JSON.stringify(soonRow ?? { یافت_نشد: soonIso }));
  ok(Array.isArray(calAppts.find((r) => r.id === aConf)?.nextOptions),
    'ردیفِ تقویم `nextOptions` دارد — دیگر برچسبِ اقدام را خودش نمی‌سازد');

  console.log('\n۳) درِ دوم همان قفل را دارد — نه فقط دکمه خاموش است');
  /* 🔴 دقیقاً همین بود که دکمهٔ غلطِ تقویم را از «بی‌اثر» به **خراب‌کننده**
     تبدیل می‌کرد: مسیرِ مستقیمِ سرور هیچ‌کدام از شرط‌ها را نداشت. */
  const heldDirect = await send(`/appointments/${aHeld}/visit`, 'POST');
  ok(heldDirect.status === 400 && /قطعی/.test(heldDirect.json?.message ?? ''),
    `**نباید بیفتد:** نوبتِ پول‌نداده از مسیرِ مستقیمِ API شروع شود (${heldDirect.status})`,
    JSON.stringify(heldDirect.json));
  const soonDesk = await send(`/frontdesk/appointments/${aSoon}/start`, 'POST');
  ok(soonDesk.status === 400 && /امروز/.test(soonDesk.json?.message ?? ''),
    `**نباید بیفتد:** نوبتِ روزِ دیگر از **تختهٔ** میزِ پذیرش شروع شود (${soonDesk.status})`,
    JSON.stringify(soonDesk.json));
  ok(sql(`SELECT date::text FROM appointments WHERE id=${aSoon}`) === soonIso,
    'و تاریخِ خودِ نوبت در هیچ مسیری دست نمی‌خورد', soonIso);
  const noDirect = await send(`/appointments/${aNo}/visit`, 'POST');
  ok(noDirect.status === 400, '**نباید بیفتد:** نوبتِ «نیامد» شروع شود');

  console.log('\n۴) پاپ‌آپِ نوبت — دکمه‌ها از سرور، و «نیامد» راهِ برگشت دارد');
  const noRow = await get(`/frontdesk/appointments/${aNo}`);
  ok(noRow?.statusLabel && noRow.status === 'noshow', `پاپ‌آپ ردیفِ کامل می‌گیرد («${noRow?.statusLabel}»)`);
  /* 🔴 باگِ واقعی: پاپ‌آپ دکمه‌هایش را با
     `!['done','cancelled','noshow'].includes(st)` می‌ساخت، پس بیماری که منشی
     اشتباهی «نیامد» زده بود از پروندهٔ بیمار و میزِ پزشک **هیچ راهِ برگشتی**
     نداشت — در حالی که سرور `noshow → confirmed` را از اول مجاز می‌دانست. */
  ok((noRow?.nextOptions ?? []).some((o) => o.status === 'confirmed'),
    '🔴 «نیامد» در `nextOptions` راهِ برگشت دارد — پاپ‌آپ قبلاً همه را قفل می‌کرد',
    JSON.stringify(noRow?.nextOptions));
  const back = await send(`/frontdesk/appointments/${aNo}/status`, 'POST', { status: 'confirmed' });
  ok(back.status < 300 && back.json?.status === 'confirmed',
    `… و واقعاً برمی‌گردد (${back.status})`, JSON.stringify(back.json).slice(0, 120));
  const doneRow = await get(`/frontdesk/appointments/${aConf}`);
  ok(Array.isArray(doneRow?.nextOptions) && doneRow.nextOptions.every((o) => o.label && /[؀-ۿ]/.test(o.label)),
    'هر گزینه برچسبِ **اقدام**ِ فارسی دارد (فعل، نه صفتِ وضعیت)');

  console.log('\n۵) «بازکردن» با «شروع» یکی نیست');
  const started = await send(`/frontdesk/appointments/${aConf}/start`, 'POST');
  ok(started.status < 300 && started.json?.visitId, `شروع شد (${started.status})`);
  const afterStart = await get(`/frontdesk/appointments/${aConf}`);
  ok(afterStart?.visitId === started.json?.visitId && afterStart?.status === 'arrived',
    'نوبت به مراجعه وصل شد و «در مطب» است');
  if (started.json?.visitId && started.json.visitId !== v0.id) trash.push(started.json.visitId);
  /* مراجعهٔ شروع‌شده باید در هر تاریخی **باز** شود؛ قفل فقط برای «شروع» است.
     یکی‌گرفتنِ این دو یعنی بیمارِ دیروز دیگر پرونده‌اش باز نمی‌شود. */
  sql(`UPDATE appointments SET date = '${ISO}'::date - 5 WHERE id=${aConf}`);
  const reopen = await send(`/appointments/${aConf}/visit`, 'POST');
  ok(reopen.status < 300 && reopen.json?.visitId === started.json?.visitId && reopen.json?.made === false,
    `**نباید بیفتد:** «بازکردنِ» مراجعهٔ روزِ دیگر هم قفل شود (${reopen.status})`,
    JSON.stringify(reopen.json));

  code = fail ? 1 : 0;
} finally {
  for (const id of trash.reverse()) await fetch(API + `/visits/${id}`, { method: 'DELETE', headers: A }).catch(() => {});
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
}
process.exit(code);
