/**
 * **نمای اتاقِ عمل** (بستهٔ ۳ب) — `GET/POST /theatre/*`.
 *
 * بازخوردِ مالک ۱۴۰۵/۰۶/۳۰: «وقتی تو اتاق عمل است راحت به اطلاعاتِ لازم دسترسی
 * داشته باشد و بتواند مدیریت کند».
 *
 *  باید بیفتد:
 *   - فهرستِ عمل‌های روز + «کجای چک‌لیستیم» به‌صورتِ عددِ آماده (قانونِ ۱۵)
 *   - کارتِ حینِ عمل: هویت، گروه خونی، سه هشدارِ بالینی، ست، چک‌لیست
 *   - تیکِ چک‌لیست نامِ زننده را نگه می‌دارد؛ برداشتنش سطر را **حذف** می‌کند
 *   - «شروع شد» ساعتِ دیوار را می‌زند و بارِ دوم بازنویسی نمی‌کند
 *  نباید بیفتد:
 *   - **هیچ عددِ مالی** در کارت (همان قاعدهٔ `tech.service.ts`)
 *   - «پایان» پیش از «شروع»
 *   - مرحله/بندِ ساختگی پذیرفته شود
 *   - کارشناسی که این عمل به نامش نیست کارت یا چک‌لیستش را ببیند
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));
const loginAs = (i, p) => fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: i, password: p }) }).then((r) => r.json());
const call = (t) => (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { Authorization: 'Bearer ' + t, ...(b ? { 'Content-Type': 'application/json' } : {}) },
  body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const login = await loginAs(USER, PASS);
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = call(login.accessToken);
const tag = randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const today = new Date().toISOString().slice(0, 10);

try {
  console.log('۱) فهرستِ عمل‌های روز');
  const hospital = (await send('/hospitals')).json?.[0];
  const surgeons = (await send('/surgeons')).json ?? [];
  const surgeonId = surgeons[0]?.id ?? (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `آزمون${tag}` })).json?.id;
  const proc = (await send('/procedure-types')).json?.[0];
  const mk = async (first) => {
    const r = await send('/visits', 'POST', {
      kind: 'surgery', firstName: first, lastName: `تئاتر${tag}`, phone: phone(),
      opDate: new Date().toISOString(), surgeonId,
      ...(hospital ? { hospitalId: hospital.id } : {}), ...(proc ? { procedureTypeId: proc.id } : {}),
    });
    if (!r.json?.id) throw new Error('عمل ساخته نشد: ' + JSON.stringify(r.json).slice(0, 220));
    return r.json;
  };
  const v = await mk('بیمارِ');
  /* دادهٔ بالینی مستقیم روی پرونده — همان چیزی که سرِ میز خوانده می‌شود. */
  sql(`UPDATE patients SET blood_type='O+', allergies='پنی‌سیلین', medications='وارفارین' WHERE id=${v.patientId}`);

  const day = (await send(`/theatre/day?date=${today}`)).json;
  const row = (day?.visits ?? []).find((x) => x.id === v.id);
  ok('عملِ امروز در فهرستِ روز هست', !!row, JSON.stringify((day?.visits ?? []).map((x) => x.id)));
  ok('مرحله‌های چک‌لیست با عنوان و تعدادشان از سرور می‌آیند',
    (day?.stages ?? []).length === 3 && day.stages.every((s) => s.title && s.total > 0), JSON.stringify(day?.stages));
  ok('«کجای چک‌لیستیم» عددِ آماده است، نه آرایه',
    (row?.checklist ?? []).length === 3 && row.checklist.every((c) => c.done === 0 && c.total > 0), JSON.stringify(row?.checklist));

  console.log('\n۲) کارتِ حینِ عمل');
  const card = (await send(`/theatre/visits/${v.id}`)).json;
  ok('هویت و گروه خونی می‌آید', card?.patient?.bloodType === 'O+' && !!card?.patient?.fullName, JSON.stringify(card?.patient));
  ok('**هر سه هشدار همیشه کلید دارند** — «نپرسیده‌ایم» با «نداشت» یکی نیست',
    card?.alerts && 'allergies' in card.alerts && 'chronicConditions' in card.alerts && 'medications' in card.alerts
    && card.alerts.allergies === 'پنی‌سیلین' && card.alerts.chronicConditions === null, JSON.stringify(card?.alerts));
  ok('چک‌لیست با متنِ بندها می‌آید', (card?.checklist ?? []).length === 3 && card.checklist[0].items.length > 0
    && card.checklist[0].items.every((i) => typeof i.label === 'string' && i.checked === false), JSON.stringify(card?.checklist?.[0]?.items?.[0]));
  /* 🔴 ثابتِ اصلیِ این ماژول. `tech.service.ts` هم همین را دارد: دستِ دستکش‌دار
     مبلغ نمی‌بیند. اگر روزی فیلدی اضافه شد که پول می‌آورد، این‌جا قرمز می‌شود. */
  const flat = JSON.stringify(card);
  const money = ['amount', 'paid', 'due', 'globalAmount', 'pricingModel', 'billing', 'charges', 'payments', 'price', 'tariff'];
  ok('🔴 **هیچ عددِ مالی در کارتِ اتاقِ عمل نیست**', money.every((k) => !flat.includes(`"${k}"`)),
    money.filter((k) => flat.includes(`"${k}"`)).join('، '));

  console.log('\n۳) چک‌لیست — امضا، نه یک بولین');
  const stage = card.checklist[0].key; const item = card.checklist[0].items[0].key;
  const after = await send(`/theatre/visits/${v.id}/check`, 'POST', { stage, key: item, checked: true });
  const hit = (after.json?.checklist ?? []).find((s) => s.key === stage)?.items.find((i) => i.key === item);
  ok('تیک می‌نشیند و **نامِ زننده** را نگه می‌دارد', after.status < 300 && hit?.checked === true && !!hit?.by, JSON.stringify(hit));
  ok('… و در دیتابیس یک سطر است', num(`SELECT count(*) FROM safety_checks WHERE visit_id=${v.id} AND stage='${stage}' AND key='${item}'`) === 1);
  const dayAfter = (await send(`/theatre/day?date=${today}`)).json;
  ok('شمارندهٔ فهرستِ روز هم جلو رفت',
    (dayAfter?.visits ?? []).find((x) => x.id === v.id)?.checklist.find((c) => c.key === stage)?.done === 1);
  /* دوبار زدنِ همان بند (دو نفر هم‌زمان) نباید دو سطر بسازد. */
  await send(`/theatre/visits/${v.id}/check`, 'POST', { stage, key: item, checked: true });
  ok('**نباید بیفتد:** تیکِ تکراری سطرِ دوم بسازد', num(`SELECT count(*) FROM safety_checks WHERE visit_id=${v.id}`) === 1);
  await send(`/theatre/visits/${v.id}/check`, 'POST', { stage, key: item, checked: false });
  ok('برداشتنِ تیک سطر را **حذف** می‌کند، نه اینکه false بنویسد',
    num(`SELECT count(*) FROM safety_checks WHERE visit_id=${v.id}`) === 0);
  const badStage = await send(`/theatre/visits/${v.id}/check`, 'POST', { stage: 'nope', key: item, checked: true });
  const badKey = await send(`/theatre/visits/${v.id}/check`, 'POST', { stage, key: 'nope', checked: true });
  ok('**نباید بیفتد:** مرحله یا بندِ ساختگی پذیرفته شود', badStage.status === 400 && badKey.status === 400,
    `${badStage.status}/${badKey.status}`);

  console.log('\n۴) ساعتِ شروع و پایان');
  const early = await send(`/theatre/visits/${v.id}/finish`, 'POST');
  ok('**نباید بیفتد:** «پایان» پیش از «شروع»', early.status === 400, String(early.status));
  const started = await send(`/theatre/visits/${v.id}/start`, 'POST');
  const t1 = started.json?.visit?.opStartTime;
  ok('«شروع شد» ساعتِ دیوار را می‌زند', started.status < 300 && /^\d{2}:\d{2}$/.test(t1 ?? ''), String(t1));
  sql(`UPDATE visits SET op_start_time='01:02' WHERE id=${v.id}`);
  await send(`/theatre/visits/${v.id}/start`, 'POST');
  ok('**نباید بیفتد:** لمسِ دوباره ساعتِ ثبت‌شده را بازنویسی کند', sql(`SELECT op_start_time FROM visits WHERE id=${v.id}`) === '01:02');
  const fin = await send(`/theatre/visits/${v.id}/finish`, 'POST');
  ok('«پایان» بعد از شروع می‌نشیند', fin.status < 300 && /^\d{2}:\d{2}$/.test(fin.json?.visit?.opEndTime ?? ''), String(fin.json?.visit?.opEndTime));

  /* 🔴 وضعیتِ اتاق از **ساعت** می‌آید نه از `opStatus`: عملی که ساعتِ شروع خورده
     «در جریان» است، هرچند `op_status` تا تسویهٔ اداری `pending` می‌ماند. در اولین
     اسکرین‌شات همین «در انتظار» نوشته بود و سرِ میز غلط خوانده می‌شد. */
  ok('وضعیتِ اتاق بعد از پایان «تمام شد» است — حتی با `op_status = pending`',
    fin.json?.visit?.state === 'finished' && fin.json?.visit?.stateFa === 'تمام شد'
    && sql(`SELECT op_status FROM visits WHERE id=${v.id}`) === 'pending',
    JSON.stringify([fin.json?.visit?.state, sql(`SELECT op_status FROM visits WHERE id=${v.id}`)]));
  sql(`UPDATE visits SET op_end_time=NULL WHERE id=${v.id}`);
  ok('… و با شروعِ بی‌پایان «در جریان»', (await send(`/theatre/visits/${v.id}`)).json?.visit?.state === 'running');
  sql(`UPDATE visits SET op_start_time=NULL WHERE id=${v.id}`);
  ok('… و بی‌ساعت «در انتظار»', (await send(`/theatre/visits/${v.id}`)).json?.visit?.state === 'waiting');
  /* 🔴 **ساعتِ شروعِ آینده برنامه است، نه جریان.** مطب ساعتِ برنامه‌ریزی‌شده را در
     همین فیلد می‌نویسد؛ بدونِ این شرط، ساعتِ ۹ صبح عملِ ۲۳:۵۹ هم «در جریان» بود. */
  sql(`UPDATE visits SET op_start_time='23:59' WHERE id=${v.id}`);
  const future = (await send(`/theatre/visits/${v.id}`)).json?.visit;
  ok('**نباید بیفتد:** ساعتِ شروعِ آیندهٔ همین امروز «در جریان» خوانده شود',
    future?.state === 'waiting' || new Date().getHours() === 23, JSON.stringify([future?.state, new Date().getHours()]));
  sql(`UPDATE visits SET op_start_time='00:01' WHERE id=${v.id}`);
  ok('… ولی ساعتِ گذشتهٔ همین امروز «در جریان» است', (await send(`/theatre/visits/${v.id}`)).json?.visit?.state === 'running');
  sql(`UPDATE visits SET op_date=CURRENT_DATE - 2 WHERE id=${v.id}`);
  const past = (await send(`/theatre/day?date=${new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)}`)).json;
  ok('روزِ گذشته با شروعِ بی‌پایان «ناتمام» است، نه «در جریان»',
    (past?.visits ?? []).find((x) => x.id === v.id)?.stateFa === 'ناتمام',
    JSON.stringify((past?.visits ?? []).map((x) => [x.id, x.stateFa])));
  sql(`UPDATE visits SET op_date=CURRENT_DATE, op_start_time=NULL WHERE id=${v.id}`);
  ok('… و فهرستِ روز هم همین برچسب را می‌دهد',
    ((await send(`/theatre/day?date=${today}`)).json?.visits ?? []).find((x) => x.id === v.id)?.stateFa === 'در انتظار');

  console.log('\n۵) دامنهٔ دید — object-authz');
  const other = (await send('/accounts/temporary', 'POST', { firstName: 'کارشناسِ', lastName: `بیگانه${tag}`, phone: phone(), level: 2, jobRole: 'technician', username: `th${tag}` })).json;
  const ol = await loginAs(`th${tag}`, other.temporaryPassword);
  const oApi = call(ol.accessToken);
  const oDay = (await oApi(`/theatre/day?date=${today}`)).json;
  ok('کارشناسی که این عمل به نامش نیست، آن را در فهرست نمی‌بیند',
    !((oDay?.visits ?? []).some((x) => x.id === v.id)), JSON.stringify((oDay?.visits ?? []).map((x) => x.id)));
  ok('**نباید بیفتد:** کارتش را مستقیم بگیرد', (await oApi(`/theatre/visits/${v.id}`)).status === 404);
  ok('**نباید بیفتد:** چک‌لیستش را امضا کند',
    (await oApi(`/theatre/visits/${v.id}/check`, 'POST', { stage, key: item, checked: true })).status === 404);
  /* ولی همان حساب وقتی کارشناسِ عمل شد، می‌بیند — یعنی ۴۰۴ از دامنه بود نه از گارد. */
  sql(`UPDATE visits SET tech_id=${other.account.id} WHERE id=${v.id}`);
  ok('… و به‌محضِ اینکه کارشناسِ همین عمل شد، می‌بیند', (await oApi(`/theatre/visits/${v.id}`)).status === 200);
} finally {
  /* چیزی نمی‌ماند: پاک‌سازی را خودِ رانر با دیتابیسِ تازه انجام می‌دهد. */
}

console.log(`\n${pass} سنجه سبز${fails.length ? `، ${fails.length} قرمز` : ''}`);
if (fails.length) { for (const f of fails) console.log('  ✘ ' + f); process.exit(1); }
