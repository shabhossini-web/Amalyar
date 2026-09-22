/**
 * **یک وضعیت، یک برچسب — در همهٔ میزها.**
 *
 * بازخوردِ مالک ۱۴۰۵/۰۶/۳۱: «همهٔ داده‌ها … باید منبعشان یکی باشد؛ اگر تو
 * فیلدی تغییر ایجاد شه تو یک میز، تو همه‌جا همون دیتا باید عوض شه.»
 *
 * دیتابیس از اول یکی بود؛ چیزی که یکی نبود **زبانش** بود. هر صفحه نگاشتِ
 * فارسیِ خودش را داشت: یک بیمار در میزِ پذیرش «در مطب» بود و در میزِ پزشک
 * «رسید»؛ یک عمل در داشبورد «کنسل» بود و در اتاقِ عمل «لغو». هیچ تستی
 * نمی‌گرفتش چون هر صفحه **به‌تنهایی** درست بود.
 *
 * پس ادعای این سوییت مقایسهٔ **بینِ endpointها**ست، نه درستیِ یک متن:
 * همان مراجعه و همان نوبت باید در هر مسیری که میزها می‌خوانند، عینِ هم
 * برچسب بخورند. نگهبانِ ایستای `verify-status-labels.js` مکملِ همین است
 * (کلاینت نگاشتِ خودش را برنگرداند).
 */
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — سرور را ری‌استارت کنید'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'sl' + Math.random().toString(36).slice(2, 6);
const today = new Date();
const iso = today.toISOString();
const isoDay = iso.slice(0, 10);
const trash = [];

console.log('۱) کاتالوگِ برچسب‌ها روی `/config` — خوراکِ فیلترها و کشویی‌ها');
const cfg = await get('/config');
const st = cfg?.statuses ?? {};
for (const [group, keys] of [
  ['visit', ['pending', 'done', 'cancelled']],
  ['appointment', ['held', 'confirmed', 'arrived', 'done', 'noshow', 'cancelled']],
  ['note', ['history', 'visit', 'op', 'progress', 'discharge', 'consult']],
  /* سه خانوادهٔ بعدی هر کدام سه تا چهار کپیِ کلاینتی داشتند. */
  ['order', ['draft', 'sent', 'answered', 'in_review', 'reviewed', 'needs_action']],
  ['orderKind', ['lab', 'imaging', 'consult', 'referral']],
  ['reminder', ['pending', 'sending', 'sent', 'simulated', 'failed', 'uncertain', 'cancelled']],
  ['reminderKind', ['next_visit', 'surgery', 'appointment', 'pre_op_care', 'post_op_care', 'follow_up', 'notice', 'dispatch']],
  ['intake', ['pending_fill', 'pending_payment', 'pending_approval', 'approved', 'rejected', 'expired']],
]) {
  const rows = st[group] ?? [];
  const have = rows.map((r) => r.key);
  ok(keys.every((k) => have.includes(k)) && rows.every((r) => /[؀-ۿ]/.test(r.label ?? '')),
    `«${group}» کامل و فارسی است (${have.join('، ')})`, JSON.stringify(rows));
}
/* 🔴 نوعِ `discharge` از بستهٔ ۴ب اضافه شد و یکی از سه کپیِ کلاینتی نداشتش،
   پس خلاصهٔ ترخیص با کلیدِ خام چاپ می‌شد. این ادعا همان را قفل می‌کند. */
ok((st.note ?? []).find((r) => r.key === 'discharge')?.label === 'خلاصهٔ ترخیص',
  '«خلاصهٔ ترخیص» در کاتالوگ هست — کلیدِ خام روی صفحه نمی‌افتد');

console.log('\n۲) همان مراجعه، همان برچسب — در هر مسیری که میزها می‌خوانند');
const surgeon = (await get('/surgeons'))?.[0]
  ?? (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `آزمون${tag}` })).json;
const hospital = (await get('/hospitals'))?.[0]
  ?? (await send('/hospitals', 'POST', { name: `[sl] بیمارستانِ ${tag}` })).json;
const visit = (await send('/visits', 'POST', {
  kind: 'surgery', firstName: 'برچسبِ', lastName: `یکسان${tag}`,
  opDate: iso, surgeonId: surgeon.id, hospitalId: hospital.id,
})).json;
if (!visit?.id) { console.error('مراجعه ساخته نشد:', JSON.stringify(visit)); process.exit(1); }
trash.push(visit.id);

const labelsOf = async () => {
  const [one, record, work, portal] = await Promise.all([
    get(`/visits/${visit.id}`),
    get(`/patients/${visit.patientId}/record`),
    get('/work/today'),
    get('/surgeon/today'),
  ]);
  return {
    'کارتِ مراجعه (`/visits/:id`)': one?.opStatusFa,
    'پروندهٔ بیمار (`/patients/:id/record`)': (record?.visits ?? []).find((v) => v.id === visit.id)?.opStatusFa,
    'صفحهٔ امروز (`/work/today`)': (work?.visits ?? []).find((v) => v.id === visit.id)?.opStatusFa,
    'میزِ پزشک (`/surgeon/today`)': (portal?.day ?? []).find((r) => r.visitId === visit.id)?.opStatusFa,
  };
};

for (const status of ['pending', 'done', 'cancelled']) {
  if (status !== 'pending') {
    /* ⚠️ مسیر و شکلِ بدنه دقیقاً همان چیزی است که داشبورد می‌فرستد
       (`PATCH visits/:id/status` با کلیدِ `opStatus`)؛ لغو هم دلیل می‌خواهد.
       نسخهٔ اولِ همین سوییت `POST`/`status` فرستاد، ۴۰۴ گرفت و چون خطا را
       بلعیده بود، هر سه دور روی `pending` ماند و «سبز»ِ توخالی داد. */
    const r = await send(`/visits/${visit.id}/status`, 'PATCH',
      { opStatus: status, ...(status === 'cancelled' ? { cancelReason: 'other' } : {}) });
    ok(r.status < 300, `وضعیت به «${status}» عوض شد`, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  }
  const seen = await labelsOf();
  const values = Object.values(seen).filter((v) => v != null);
  const uniq = [...new Set(values)];
  /* مراجعهٔ لغوشده از فهرست‌های «امروز» بیرون می‌رود (فیلترِ خودِ آن میزها)،
     پس آن دور سه مسیر دارد نه چهار — و همین درست است. */
  const want = status === 'cancelled' ? 2 : 4;
  ok(values.length >= want && uniq.length === 1,
    `وضعیتِ «${status}» در هر چهار مسیر یک برچسب دارد («${uniq[0] ?? '—'}»)`,
    JSON.stringify(seen));
  ok(uniq[0] === (st.visit ?? []).find((r) => r.key === status)?.label,
    '… و همان چیزی است که کاتالوگِ /config می‌گوید');
}

console.log('\n۳) نوبت — میزِ پذیرش، صفحهٔ امروز و میزِ پزشک یک حرف بزنند');
const appt = (await send('/frontdesk/walk-in', 'POST', { patientId: visit.patientId, date: isoDay })).json;
const apptId = appt?.appointment?.id ?? appt?.id;
ok(!!apptId, 'نوبتِ آزمون ساخته شد', JSON.stringify(appt).slice(0, 160));
await send(`/frontdesk/appointments/${apptId}/status`, 'POST', { status: 'confirmed' });
await send(`/frontdesk/appointments/${apptId}/status`, 'POST', { status: 'arrived' });
const [desk, work2, portal2] = await Promise.all([
  get(`/frontdesk/day?date=${isoDay}`), get('/work/today'), get('/surgeon/today'),
]);
const seenAppt = {
  'میزِ پذیرش': (desk?.rows ?? []).find((r) => r.id === apptId)?.statusLabel,
  'صفحهٔ امروز': (work2?.appointments ?? []).find((a) => a.id === apptId)?.statusFa,
  'میزِ پزشک': (portal2?.appointments ?? []).find((a) => a.id === apptId)?.statusFa,
};
const apptVals = Object.values(seenAppt).filter(Boolean);
ok(apptVals.length === 3 && new Set(apptVals).size === 1,
  `«در مطب» در هر سه میز یکی است («${apptVals[0] ?? '—'}»)`, JSON.stringify(seenAppt));
ok(apptVals[0] === 'در مطب',
  '🔴 و همان واژهٔ سرور است — نه «رسید»ی که کلاینت از خودش می‌ساخت');

console.log('\n۴) سندِ بالینی — برچسب همراهِ خودِ سند');
await send(`/patients/${visit.patientId}/notes`, 'POST', { kind: 'discharge', body: 'هوشیار و برقرار.', visitId: visit.id });
const rec = await get(`/patients/${visit.patientId}/record`);
const note = (rec?.clinicalNotes ?? []).find((n) => n.kind === 'discharge');
ok(note?.kindFa === 'خلاصهٔ ترخیص', `سندِ ترخیص برچسب دارد («${note?.kindFa}»)`, JSON.stringify(note ?? {}).slice(0, 140));
const tpl = await get('/note-templates');
ok(Array.isArray(tpl) && (tpl.length === 0 || tpl.every((r) => !!r.kindFa)),
  'قالب‌های شرح هم برچسبِ نوع دارند');

console.log('\n۵) کپیِ دومِ **سرور** هم شمرده می‌شود');
/* ⚠️ `OP_STATUS_FA` در `live.service` یک نگاشتِ دومِ سروری بود و با
   `OP_LABELS` نمی‌خواند: `cancelled` آن‌جا «لغو شد» بود و این‌جا «لغو». یعنی
   همان عمل در `/visits/:id` و در `/patients/:id/live` دو اسم داشت — و
   نگهبانِ ایستا نمی‌دیدش چون فقط `src` را می‌گشت. */
const liveSeen = async () => {
  const live = await get(`/patients/${visit.patientId}/live`);
  const one = await get(`/visits/${visit.id}`);
  const row = (live?.timeline?.items ?? []).find((i) => i.type === 'visit' && i.refId === visit.id);
  return { live: row?.stateFa ?? null, card: one?.opStatusFa ?? null, kindFa: row?.kindFa ?? null };
};
const seenLive = await liveSeen();
ok(seenLive.live != null && seenLive.live === seenLive.card,
  `⚠️ خطِ زمانِ پرونده و کارتِ مراجعه یک برچسب می‌دهند («${seenLive.card}»)`, JSON.stringify(seenLive));

console.log('\n۶) نامِ نوعِ مراجعه هم از سرور می‌آید، نه از نگاشتِ هاردکدِ کلاینت');
/* ⚠️ `visit-kinds.js` خودش نوشته «پشتیبان است نه منبعِ حقیقت»، ولی کلاینت
   برای نوع‌های هسته‌ای اول همان را می‌دید — پس شرکتی که فرمش را «فرمِ عمل»
   نامیده بود، در یک بخشِ پرونده «عمل جراحی» می‌دید و در بخشِ دیگر «فرمِ عمل». */
const recAll = await get(`/patients/${visit.patientId}/record`);
const recRow = (recAll?.visits ?? []).find((v) => v.id === visit.id);
ok(seenLive.kindFa != null && recRow?.kindTitle != null && seenLive.kindFa === recRow.kindTitle,
  `خطِ زمان و کارتِ پرونده هر دو نامِ فرمِ همین شرکت را می‌دهند («${seenLive.kindFa}»)`,
  JSON.stringify({ timeline: seenLive.kindFa, record: recRow?.kindTitle }));
const stage = (await get(`/patients/${visit.patientId}/live`))?.stage;
const vStep = (stage?.steps ?? []).find((x) => x.key === 'visit');
ok(vStep?.kind == null || vStep?.kindFa === recRow?.kindTitle,
  'نوارِ «الان کجاییم» هم همان نام را می‌گیرد، نه «عمل جراحی»ِ هاردکد',
  JSON.stringify({ step: vStep?.kindFa, record: recRow?.kindTitle }));

console.log('\n' + '─'.repeat(50));
console.log(`قبول: ${pass}   رد: ${fail}`);
for (const id of trash.reverse()) await fetch(API + `/visits/${id}`, { method: 'DELETE', headers: A });
process.exit(fail ? 1 : 0);
