/**
 * مرحلهٔ ۴ — تأیید بر اساسِ **kindِ فرم**.
 *
 * ⚠️ باگی که این مرحله می‌بندد کاملاً بی‌صدا بود: `approve()` هیچ‌وقت `kind` را
 * به `createVisit` نمی‌داد، پس **هر** ثبت‌نامِ تأییدشده یک مراجعهٔ «جراحی»
 * می‌شد — حتی وقتی لینک فرمِ «پیگیری» داشت. هیچ خطایی نمی‌داد؛ فقط نوعِ غلط در
 * تقویم و گزارش.
 *
 * اجرا: `node scripts/e2e/approve-kind.mjs`
 */
const API = 'http://localhost:3101/api';
let TOKEN = '';
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch { /* غیرJSON */ }
  return { status: r.status, json, text: t };
}

TOKEN = (await api('/auth/login', { method: 'POST', body: { identifier: 'admin', password: 'test1234' } })).json?.accessToken;
if (!TOKEN) { console.error('ورود نشد'); process.exit(1); }

function nid(seed) {
  const base = String(seed % 1_000_000_000).padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
  const r = sum % 11;
  return base + String(r < 2 ? r : 11 - r);
}
const RUN = Math.floor(Date.now() / 1000) % 100_000_000;

/* ⚠️ ادمین هنگامِ تأیید **جراح/بیمارستان/تاریخ** را انتخاب می‌کند — این‌ها
   فیلدهای builtinِ فرمِ مراجعه‌اند و بیمار نمی‌بیندشان. آزمون هم باید همان
   کار را بکند، وگرنه ۴۰۰ می‌گیرد و آن ۴۰۰ **درست** است. */
/* جراح از `Person` ساخته می‌شود، پس نام و نامِ خانوادگیِ جدا می‌خواهد — نه `name`. */
const surgeon = (await api('/surgeons')).json?.[0]
  ?? (await api('/surgeons', { method: 'POST', body: { firstName: 'جراحِ', lastName: 'آزمون' } })).json;
const hospital = (await api('/hospitals')).json?.[0]
  ?? (await api('/hospitals', { method: 'POST', body: { name: '[ak] بیمارستانِ آزمون' } })).json;
const APPROVE = {
  surgeonId: surgeon?.id, hospitalId: hospital?.id,
  opDate: new Date().toISOString().slice(0, 10),
  registerPayment: false,
};
/** شمارِ کلِ مراجعات — برای سنجشِ «هیچ مراجعه‌ای ساخته نشد». */
const visitCount = async () => ((await api('/visits?page=1')).json?.rows?.length ?? -1)
  + ((await api('/visits?page=2')).json?.rows?.length ?? 0);

// ── آماده‌سازیِ تکرارپذیر ───────────────────────────────────────────────────
for (const l of (await api('/intake/links')).json.filter((x) => /^\[ak]/.test(x.title))) {
  await api(`/intake/links/${l.id}`, { method: 'PATCH', body: { title: '[ak-old] ' + l.id, active: false, formId: 0, bankAccountId: 0 } });
}

/**
 * فرمِ آزمون — **بازاستفاده، نه حذف‌وساخت**.
 *
 * ⚠️ اجرای قبلی با فرمِ مراجعه یک **مراجعهٔ واقعی** ثبت می‌کند، و از آن به بعد
 * `removeForm` فرم را فقط **خاموش** می‌کند (قاعدهٔ خودِ سرویس: موجودیتِ
 * استفاده‌شده حذفِ سخت نمی‌شود). پس `POST /forms` با همان کلید ۴۰۰ می‌گرفت،
 * `form.id` برابرِ undefined می‌شد، و ادعاها بدونِ سنجیدنِ چیزی قرمز می‌شدند.
 */
async function ensureForm(key, title, scope) {
  const full = scope === 'visit' ? `visit.${key}` : key;
  let f = (await api('/forms')).json.find((x) => x.key === full);
  if (f) {
    await api(`/forms/${f.id}`, { method: 'PATCH', body: { active: true, title } });
    for (const fl of f.fields.filter((x) => !x.builtin)) {
      await api(`/forms/fields/${fl.id}`, { method: 'DELETE' });
    }
    return (await api(`/forms/${encodeURIComponent(full)}`)).json;
  }
  const made = await api('/forms', { method: 'POST', body: { key, title, scope } });
  if (!made.json?.id) { console.error('فرم ساخته نشد: ' + made.text.slice(0, 200)); process.exit(1); }
  return made.json;
}

// فرمِ **مراجعه** با نوعِ «پیگیری»، و فرمِ **زیرپرونده**
const visitForm = await ensureForm('akformFollow', '[ak] پیگیری', 'visit');
await api(`/forms/${visitForm.id}/fields`, { method: 'POST', body: { key: 'akNote', label: 'یادداشتِ بیمار', type: 'text' } });
const recForm = await ensureForm('akformSurvey', '[ak] نظرسنجیِ آزمون', 'record');
await api(`/forms/${recForm.id}/fields`, { method: 'POST', body: { key: 'akScore', label: 'امتیاز', type: 'rating' } });

console.log('\n۱) هر سه محدوده پشتِ لینک پذیرفته می‌شوند');
{
  const o = (await api('/intake/link-options')).json;
  ok('فرمِ مراجعه در فهرست هست', o.forms.some((f) => f.id === visitForm.id), o.forms.map((f) => f.title).join('،'));
  ok('فرمِ زیرپرونده هم هست', o.forms.some((f) => f.id === recForm.id));
  ok('makesVisit برای مراجعه true است', o.forms.find((f) => f.id === visitForm.id)?.makesVisit === true);
  ok('makesVisit برای زیرپرونده false است', o.forms.find((f) => f.id === recForm.id)?.makesVisit === false);
  ok('visitKind برمی‌گردد', o.forms.find((f) => f.id === visitForm.id)?.visitKind === 'akformFollow',
    'visitKind=' + o.forms.find((f) => f.id === visitForm.id)?.visitKind);
}

console.log('\n۲) فرمِ زیرپرونده نمی‌تواند مبلغ داشته باشد');
{
  const bad = await api('/intake/links', { method: 'POST', body: { title: '[ak] بد', amount: 50000, formId: recForm.id } });
  ok('لینکِ زیرپرونده با مبلغ رد می‌شود', bad.status === 400, 'status=' + bad.status + ' ' + bad.text.slice(0, 120));
  ok('پیام توضیح می‌دهد چرا', /دفترِ مالی|زیرپرونده/.test(bad.text), bad.text.slice(0, 160));

  // و برعکس: گذاشتنِ مبلغ روی لینکی که از قبل فرمِ زیرپرونده دارد
  const okLink = (await api('/intake/links', { method: 'POST', body: { title: '[ak] زیرپرونده', amount: 0, formId: recForm.id } })).json;
  const patched = await api(`/intake/links/${okLink.id}`, { method: 'PATCH', body: { amount: 90000 } });
  ok('افزودنِ مبلغِ بعدی هم رد می‌شود', patched.status === 400, 'status=' + patched.status);
}

console.log('\n۳) فرمِ مراجعه → مراجعه‌ای با نوعِ **همان فرم** ساخته می‌شود');
{
  const link = (await api('/intake/links', { method: 'POST', body: { title: '[ak] لینکِ پیگیری', amount: 120000, formId: visitForm.id } })).json;
  const reg = (await api(`/public/intake/link/${link.token}/register`, {
    method: 'POST', auth: false,
    body: { firstName: 'کاظم', lastName: 'پیگیر', nationalId: nid(RUN * 17 + 3), phone: '09120000031', captchaA: 1, captchaB: 2, captchaAnswer: 3 },
  })).json;
  await api(`/public/intake/form/${reg.token}/fill`, { method: 'POST', auth: false, body: { values: { akNote: 'حالم بهتر است' } } });

  // فیش، تا به pending_approval برسد
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'r.png');
  await fetch(`${API}/public/intake/form/${reg.token}/receipt`, { method: 'POST', body: fd });

  const sub = (await api('/intake/submissions?status=pending_approval')).json.find((x) => x.token === reg.token);
  ok('ثبت‌نام در صفِ تأیید است', !!sub, 'sub=' + !!sub);
  ok('فهرستِ ادمین می‌گوید مراجعه می‌سازد', sub?.makesVisit === true, 'makesVisit=' + sub?.makesVisit);
  ok('نامِ فرم در فهرست هست', sub?.formTitle === '[ak] پیگیری', 'formTitle=' + sub?.formTitle);

  const app = await api(`/intake/submissions/${sub.id}/approve`, { method: 'POST', body: APPROVE });
  ok('تأیید انجام شد', app.status < 300, app.status + ' ' + app.text.slice(0, 160));
  ok('مراجعه ساخته شد', !!app.json?.visitId, JSON.stringify(app.json));

  const visit = (await api(`/visits/${app.json.visitId}`)).json;
  /* ⚠️ ادعای اصلیِ کلِ مرحله: نوعِ مراجعه از فرم آمده، نه «surgery»ِ پیش‌فرض. */
  ok('نوعِ مراجعه از فرم آمد، نه surgery', visit?.kind === 'akformFollow', 'kind=' + visit?.kind);
  ok('پاسخِ فیلدِ دلخواه به extra رسید', visit?.extra?.akNote === 'حالم بهتر است', JSON.stringify(visit?.extra));
  ok('کلیدهای ثابتِ ثبت‌نام در extra نریختند', visit?.extra?.nationalId === undefined && visit?.extra?.firstName === undefined,
    JSON.stringify(visit?.extra));
}

console.log('\n۴) فرمِ زیرپرونده → **هیچ مراجعه‌ای** ساخته نمی‌شود');
{
  const link = (await api('/intake/links', { method: 'POST', body: { title: '[ak] لینکِ نظرسنجی', amount: 0, formId: recForm.id } })).json;
  const reg = (await api(`/public/intake/link/${link.token}/register`, {
    method: 'POST', auth: false,
    body: { firstName: 'سارا', lastName: 'نظرده', nationalId: nid(RUN * 23 + 11), phone: '09120000032', captchaA: 2, captchaB: 2, captchaAnswer: 4 },
  })).json;
  const visitsBefore = await visitCount();
  /* ⚠️ قراردادِ تازه: فرمِ زیرپرونده‌ی رایگان صفِ تأیید ندارد — پرشدن همان
     approved است و هیچ approveی از سمتِ ادمین صدا زده نمی‌شود. صفِ تأیید
     مالِ پول و ساختِ مراجعه است و این فرم هیچ‌کدام را ندارد. */
  const fill = await api(`/public/intake/form/${reg.token}/fill`, { method: 'POST', auth: false, body: { values: { akScore: 5 } } });
  ok('پرشدن مستقیم approved شد — بدونِ صف', fill.json?.status === 'approved', 'status=' + fill.json?.status);

  const sub = (await api('/intake/submissions?status=approved')).json.find((x) => x.token === reg.token);
  ok('در فهرستِ ادمین با وضعیتِ تأییدشده هست', !!sub);
  ok('فهرستِ ادمین می‌گوید مراجعه نمی‌سازد', sub?.makesVisit === false, 'makesVisit=' + sub?.makesVisit);

  const visitsAfter = await visitCount();
  ok('شمارِ مراجعات تکان نخورد', visitsBefore > 0 && visitsAfter === visitsBefore, `${visitsBefore} → ${visitsAfter}`);

  const after = (await api('/intake/submissions?status=approved')).json.find((x) => x.token === reg.token);
  ok('وضعیت approved شد', after?.status === 'approved', 'status=' + after?.status);
  ok('ولی به مراجعه‌ای وصل نیست', !after?.visitId, 'visitId=' + after?.visitId);
  ok('پاسخِ نظرسنجی در پرونده ماند', after?.data?.akScore === 5, 'akScore=' + after?.data?.akScore);
}

console.log('\n۵) لینکِ بدونِ فرم همان رفتارِ قبلی را دارد');
{
  const link = (await api('/intake/links', { method: 'POST', body: { title: '[ak] بی‌فرم', amount: 0 } })).json;
  const reg = (await api(`/public/intake/link/${link.token}/register`, {
    method: 'POST', auth: false,
    body: { firstName: 'قدیم', lastName: 'کاربر', nationalId: nid(RUN * 29 + 5), phone: '09120000033', captchaA: 3, captchaB: 3, captchaAnswer: 6 },
  })).json;
  await api(`/public/intake/form/${reg.token}/fill`, { method: 'POST', auth: false, body: { procedure: 'عملِ آزمایشی' } });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'r.png');
  await fetch(`${API}/public/intake/form/${reg.token}/receipt`, { method: 'POST', body: fd });

  const sub = (await api('/intake/submissions?status=pending_approval')).json.find((x) => x.token === reg.token);
  ok('makesVisit پیش‌فرض true است', sub?.makesVisit === true, 'makesVisit=' + sub?.makesVisit);
  const app = await api(`/intake/submissions/${sub.id}/approve`, { method: 'POST', body: APPROVE });
  ok('مراجعه ساخته شد', !!app.json?.visitId, JSON.stringify(app.json)?.slice(0, 160));
  const visit = (await api(`/visits/${app.json.visitId}`)).json;
  ok('نوعش همان پیش‌فرضِ قبلی (surgery) ماند', visit?.kind === 'surgery', 'kind=' + visit?.kind);
}

console.log('\n──────────────────────────────');
console.log(`قبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
