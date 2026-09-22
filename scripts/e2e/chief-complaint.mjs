/**
 * **شکایتِ اولیه یک داده است، نه دو کپی** (بستهٔ ۴الف).
 *
 * بازخوردِ مالک ۱۴۰۵/۰۶/۳۱: «شکایتِ اولیهٔ بیمار تو ویزیت‌ها باید حتماً باشه، و
 * عمل‌هایی که از ویزیتی که تصمیم به عمل شده حتماً باید شکایتِ اولیه ثبت شه» و
 * «همهٔ اینها باید منبعِ دیتاشون برای بیمار یکی باشه».
 *
 * پس ادعای اصلیِ این آزمون این نیست که «مقدار ذخیره شد» — این است که مقدار
 * **یکی** است: اصلاحِ شکایت در ویزیت باید همان لحظه در عمل هم دیده شود.
 * کپیِ زمانِ ساخت این آزمون را رد می‌کند، و همین تفاوت کلِ بسته است.
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
const send = (p, method, body) => fetch(API + p, { method, headers: A, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'cc' + Math.random().toString(36).slice(2, 6);
const today = new Date().toISOString();

/* نوعِ «ویزیت» در حوزهٔ پیش‌فرضِ e2e (نورومانیتورینگ) وجود ندارد و نبودنِ فرم
   یعنی ۴۰۰. همان کاری که `desk-day` می‌کند: اگر نبود، ساخته می‌شود — عوض‌کردنِ
   حوزه برای این آزمون لازم نیست، چون ارث‌بری به `kind` ربطی ندارد. */
const kinds = (await get('/forms/visit-kinds')) ?? [];
const madeForm = kinds.some((k) => (k.kind ?? k.key) === 'clinic')
  ? null
  : (await send('/forms', 'POST', { key: 'clinic', title: `ویزیت${tag}`, scope: 'visit' })).json;
/* فرمِ عمل جراح و بیمارستان را اجباری می‌کند — مثلِ بقیهٔ سوییت‌ها از موجودها
   استفاده می‌کنیم و اگر نبود می‌سازیم. */
const surgeon = (await get('/surgeons'))?.[0]
  ?? (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `آزمون${tag}` })).json;
const hospital = (await get('/hospitals'))?.[0]
  ?? (await send('/hospitals', 'POST', { name: `[cc] بیمارستانِ ${tag}` })).json;

const created = [];
const newVisit = async (body) => {
  const r = await send('/visits', 'POST', {
    opDate: today, surgeonId: surgeon.id, hospitalId: hospital.id, ...body,
  });
  if (!r.json?.id) { console.error('مراجعه ساخته نشد:', r.status, JSON.stringify(r.json)); process.exit(1); }
  created.push(r.json.id);
  return r.json;
};

console.log('۱) شکایتِ اولیه در ویزیت — ستون است نه `extra`');
const visit = await newVisit({
  kind: 'clinic', firstName: 'شکایتِ', lastName: `اولیه${tag}`,
  chiefComplaint: 'ضعفِ پای چپ', decisions: ['surgery'],
});
let fresh = await get(`/visits/${visit.id}`);
ok(fresh.chiefComplaint === 'ضعفِ پای چپ', `در ویزیت ذخیره شد («${fresh.chiefComplaint}»)`);
ok(fresh.chiefComplaintOwn === 'ضعفِ پای چپ', 'و مقدارِ خودِ ویزیت است، نه ارثی');
ok(fresh.extra?.chiefComplaint === undefined, '**در `extra` ننشسته** — دو نسخه از یک داده ساخته نشد');

console.log('\n۲) عملی که از همین ویزیت درآمده — ارث، نه کپی');
const op = await newVisit({
  kind: 'surgery', patientId: visit.patientId, decidedInVisitId: visit.id,
  /* کلاینتِ واقعی همین کار را می‌کند: مقدارِ مشتق را همان‌طور که گرفته پس
     می‌فرستد. نباید کپی شود. */
  chiefComplaint: 'ضعفِ پای چپ',
});
fresh = await get(`/visits/${op.id}`);
ok(fresh.chiefComplaint === 'ضعفِ پای چپ', `شکایتِ عمل پر است («${fresh.chiefComplaint}»)`);
ok(fresh.chiefComplaintOwn === null, '**و کپی نشده** — متنِ عینِ ارث ذخیره نمی‌شود');
ok(fresh.chiefComplaintFrom?.visitId === visit.id, `منبعش همان ویزیت است (${fresh.chiefComplaintFrom?.visitId})`);

console.log('\n۳) اصلاح در ویزیت ← همان لحظه در عمل (ادعای «منبعِ یکی»)');
await send(`/visits/${visit.id}`, 'PATCH', { chiefComplaint: 'ضعفِ پیش‌روندهٔ پای چپ' });
fresh = await get(`/visits/${op.id}`);
ok(fresh.chiefComplaint === 'ضعفِ پیش‌روندهٔ پای چپ',
  `**شکایتِ عمل با ویزیت عوض شد** («${fresh.chiefComplaint}») — کپی این را رد می‌کرد`);

console.log('\n۴) ذخیرهٔ دوبارهٔ عمل بدونِ تغییر، ارث را نمی‌شکند');
await send(`/visits/${op.id}`, 'PATCH', { chiefComplaint: fresh.chiefComplaint });
fresh = await get(`/visits/${op.id}`);
ok(fresh.chiefComplaintOwn === null, 'هنوز ارثی است، نه کپی');
await send(`/visits/${visit.id}`, 'PATCH', { chiefComplaint: 'ضعفِ هر دو پا' });
ok((await get(`/visits/${op.id}`)).chiefComplaint === 'ضعفِ هر دو پا', 'و هنوز ویزیت را دنبال می‌کند');

console.log('\n۵) متنِ متفاوت روی عمل = استثنا، و ویزیت دیگر رویش اثر ندارد');
await send(`/visits/${op.id}`, 'PATCH', { chiefComplaint: 'بی‌اختیاریِ ادرار، اورژانسی' });
fresh = await get(`/visits/${op.id}`);
ok(fresh.chiefComplaintOwn === 'بی‌اختیاریِ ادرار، اورژانسی', 'متنِ خودِ عمل ثبت شد');
ok(fresh.chiefComplaintFrom === null, 'و دیگر «ارثی» علامت نمی‌خورد');
await send(`/visits/${visit.id}`, 'PATCH', { chiefComplaint: 'متنِ تازهٔ ویزیت' });
ok((await get(`/visits/${op.id}`)).chiefComplaint === 'بی‌اختیاریِ ادرار، اورژانسی',
  '**استثنا با اصلاحِ ویزیت پاک نمی‌شود**');

console.log('\n۶) خالی‌کردنِ متنِ عمل ← برگشت به ارث');
await send(`/visits/${op.id}`, 'PATCH', { chiefComplaint: '' });
fresh = await get(`/visits/${op.id}`);
ok(fresh.chiefComplaintOwn === null && fresh.chiefComplaint === 'متنِ تازهٔ ویزیت',
  `دوباره از ویزیت می‌خواند («${fresh.chiefComplaint}»)`);

console.log('\n۷) پیوند فقط داخلِ همان پرونده — وگرنه نشتِ دادهٔ بالینی');
const other = await newVisit({ kind: 'clinic', firstName: 'بیمارِ', lastName: `دیگر${tag}`, chiefComplaint: 'سردرد' });
const leak = await send('/visits', 'POST', {
  kind: 'surgery', patientId: visit.patientId, opDate: today, decidedInVisitId: other.id,
});
if (leak.json?.id) created.push(leak.json.id);
ok(leak.status === 400, `ویزیتِ بیمارِ دیگر به‌عنوانِ «ویزیتِ تصمیم» رد می‌شود (${leak.status})`);

console.log('\n۸) عملِ بی‌ویزیت شکایتِ خودش را دارد');
const lone = await newVisit({
  kind: 'surgery', patientId: visit.patientId, chiefComplaint: 'کمردردِ مزمن',
});
fresh = await get(`/visits/${lone.id}`);
ok(fresh.chiefComplaintOwn === 'کمردردِ مزمن' && fresh.chiefComplaintFrom === null,
  'ذخیره شد و ارثی علامت نخورد');

console.log('\n۹) پروندهٔ بیمار — ستون‌شدن نباید شکایت را از پرونده غیب کند');
/* 🔴 رگرسیونی که همین بسته می‌توانست بسازد: `answersOf` و تبِ شرح‌ها فقط از
   `extra` می‌خواندند، پس مقداری که به ستون رفت از کارتِ مراجعه و از تبِ
   «شرح‌ها» ناپدید می‌شد — دقیقاً همان چیزی که ستون‌کردن قرار بود درستش کند. */
const rec = await get(`/patients/${visit.patientId}/record`);
const recVisit = (rec?.visits ?? []).find((x) => x.id === visit.id);
const recOp = (rec?.visits ?? []).find((x) => x.id === op.id);
ok((recVisit?.answers ?? []).some((a) => a.key === 'chiefComplaint' && a.value === 'متنِ تازهٔ ویزیت'),
  'شکایت در پاسخ‌های کارتِ ویزیتِ پرونده هست',
  JSON.stringify((recVisit?.answers ?? []).map((a) => [a.key, a.value])));
ok((recOp?.answers ?? []).some((a) => a.key === 'chiefComplaint' && a.value === 'متنِ تازهٔ ویزیت'),
  '**و روی عمل هم دیده می‌شود، ارثی از همان ویزیت**',
  JSON.stringify((recOp?.answers ?? []).map((a) => [a.key, a.value])));
ok((rec?.visitTexts ?? []).some((t) => t.visitId === visit.id && t.body === 'متنِ تازهٔ ویزیت'),
  'و در تبِ «شرح‌ها»ی پرونده هم می‌آید — همان مسیرِ دومی که فقط `extra` می‌خواند',
  JSON.stringify((rec?.visitTexts ?? []).map((t) => [t.visitId, t.label])));

console.log('\n' + '─'.repeat(50));
console.log(`قبول: ${pass}   رد: ${fail}`);
for (const id of created.reverse()) await fetch(API + `/visits/${id}`, { method: 'DELETE', headers: A });
if (madeForm?.id) await fetch(API + `/forms/${madeForm.id}`, { method: 'DELETE', headers: A });
process.exit(fail ? 1 : 0);
