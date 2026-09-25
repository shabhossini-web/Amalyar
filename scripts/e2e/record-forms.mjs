/**
 * مرحلهٔ ۷ — **پروندهٔ بیمار**: سیرِ مراجعات، مدارک، و **فرم‌های ضمیمه**.
 *
 * ⚠️ حلقه‌ای که این مرحله می‌بندد: از مرحلهٔ ۴، فرمِ `scope: 'record'` هنگامِ
 * تأیید مراجعه نمی‌سازد و فقط به پرونده می‌چسبد. ولی **هیچ صفحه‌ای نشانش
 * نمی‌داد** — بیمار پر می‌کرد، ادمین تأیید می‌کرد، و داده در
 * `intake_submissions.data` دفن می‌شد. نه خطایی، نه لاگی.
 *
 * اجرا: `node scripts/e2e/record-forms.mjs`
 */
import { captchaFor } from './lib/captcha.mjs';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
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
  const b = String(seed % 1_000_000_000).padStart(9, '0');
  let s = 0; for (let i = 0; i < 9; i++) s += Number(b[i]) * (10 - i);
  const r = s % 11; return b + String(r < 2 ? r : 11 - r);
}
const RUN = Math.floor(Date.now() / 1000) % 100_000_000;
const COLOR_KEYS = ['violet', 'teal', 'amber', 'rose', 'sky', 'lime', 'fuchsia', 'slate'];

/** بازاستفاده نه حذف‌وساخت — فرمی که ثبت‌نام دارد حذفِ سخت نمی‌شود. */
async function ensureForm(key, title, scope) {
  const full = scope === 'visit' ? `visit.${key}` : key;
  const f = (await api('/forms')).json.find((x) => x.key === full);
  if (f) {
    await api(`/forms/${f.id}`, { method: 'PATCH', body: { active: true, title } });
    for (const fl of f.fields.filter((x) => !x.builtin)) await api(`/forms/fields/${fl.id}`, { method: 'DELETE' });
    return (await api(`/forms/${encodeURIComponent(full)}`)).json;
  }
  const made = await api('/forms', { method: 'POST', body: { key, title, scope } });
  if (!made.json?.id) { console.error('فرم ساخته نشد: ' + made.text.slice(0, 200)); process.exit(1); }
  return (await api(`/forms/${encodeURIComponent(full)}`)).json;
}

// فرمِ **زیرپرونده** با دو فیلد، و یک فرمِ **مراجعه** با رنگ
const recForm = await ensureForm('rfSurvey', '[rf] نظرسنجیِ پس از عمل', 'record');
await api(`/forms/${recForm.id}/fields`, { method: 'POST', body: { key: 'rfScore', label: 'رضایت از عمل', type: 'rating' } });
await api(`/forms/${recForm.id}/fields`, { method: 'POST', body: { key: 'rfWord', label: 'حرفِ آخر', type: 'textarea' } });
await api(`/forms/${recForm.id}/fields`, { method: 'POST', body: { key: 'rfBlank', label: 'فیلدِ بی‌پاسخ', type: 'text' } });
const visitForm = await ensureForm('rfVisit', '[rf] ویزیتِ پرونده', 'visit');

const surgeon = (await api('/surgeons')).json?.[0];
const hospital = (await api('/hospitals')).json?.[0];

console.log('\n۱) بیمار با یک مراجعه ساخته می‌شود');
let patientId = 0;
const NID = nid(RUN * 53 + 3);
{
  const made = await api('/visits', {
    method: 'POST',
    body: {
      kind: 'rfVisit', firstName: 'پرونده', lastName: 'دار',
      nationalId: NID, phone: '09120000081',
      surgeonId: surgeon?.id, hospitalId: hospital?.id,
      opDate: new Date().toISOString().slice(0, 10),
    },
  });
  ok('مراجعه ثبت شد', made.status < 300, made.status + ' ' + made.text.slice(0, 180));
  patientId = made.json?.patientId;
  ok('شناسهٔ پرونده برگشت', !!patientId, 'patientId=' + patientId);
}

console.log('\n۲) سیرِ مراجعات رنگ و عنوانِ نوع را از سرور می‌گیرد');
{
  const rec = (await api(`/patients/${patientId}/record`)).json;
  ok('پرونده خوانده شد', !!rec?.code, JSON.stringify(rec)?.slice(0, 160));
  const v = rec?.visits?.[0];
  ok('مراجعه در پرونده هست', !!v, 'visits=' + rec?.visits?.length);
  /* ⚠️ تا دیروز پرونده کلاسِ `k-${kind}`ِ هاردکد می‌گذاشت، پس نوعِ ساخته‌شده
     در فرم‌ساز این‌جا بی‌رنگ بود در حالی که در داشبورد رنگ داشت — یک نوع، دو
     ظاهر، در دو صفحه. */
  ok('عنوانِ نوع از سرور می‌آید', v?.kindTitle === '[rf] ویزیتِ پرونده', 'kindTitle=' + v?.kindTitle);
  ok('رنگِ نوع هم می‌آید', COLOR_KEYS.includes(v?.kindColor), 'kindColor=' + v?.kindColor);

  const dash = (await api(`/visits/${v.id}`)).json;
  /* ادعای اصلیِ «یک نوع، یک ظاهر»: پرونده و داشبورد باید یکی بگویند. */
  ok('رنگِ پرونده و داشبورد یکی است', dash?.kindColor === v?.kindColor,
    `پرونده=${v?.kindColor} داشبورد=${dash?.kindColor}`);
  ok('عنوانِ پرونده و داشبورد هم یکی است', dash?.kindTitle === v?.kindTitle,
    `پرونده=${v?.kindTitle} داشبورد=${dash?.kindTitle}`);
}

console.log('\n۳) هنوز فرمی به پرونده نچسبیده');
{
  const rec = (await api(`/patients/${patientId}/record`)).json;
  ok('آرایهٔ فرم‌ها هست ولی خالی است', Array.isArray(rec?.attachedForms) && rec.attachedForms.length === 0,
    JSON.stringify(rec?.attachedForms)?.slice(0, 120));
  ok('شمارشگر هم صفر است', rec?.counts?.forms === 0, 'forms=' + rec?.counts?.forms);
}

console.log('\n۴) بیمار فرمِ زیرپرونده را پر می‌کند و ادمین تأیید می‌کند');
let subId = 0;
{
  const link = (await api('/intake/links', { method: 'POST', body: { title: '[rf] لینکِ نظرسنجی', amount: 0, formId: recForm.id } })).json;
  ok('لینکِ زیرپرونده ساخته شد', !!link?.token, JSON.stringify(link)?.slice(0, 140));

  const reg = (await api(`/public/intake/link/${link.token}/register`, {
    method: 'POST', auth: false,
    body: { firstName: 'پرونده', lastName: 'دار', nationalId: NID, phone: '09120000081', ...(await captchaFor(API, link.token)) },
  })).json;
  ok('ثبت‌نام روی همان کد ملی انجام شد', !!reg?.token, JSON.stringify(reg)?.slice(0, 140));

  const fill = await api(`/public/intake/form/${reg.token}/fill`, {
    method: 'POST', auth: false,
    body: { values: { rfScore: 5, rfWord: 'همه‌چیز خوب بود' } },
  });
  ok('پاسخ‌ها ذخیره شدند', fill.status < 300, fill.status + ' ' + fill.text.slice(0, 140));

  /* ⚠️ قراردادِ تازه: فرمِ زیرپرونده‌ی رایگان **اصلاً صفِ تأیید ندارد** —
     پرشدن همان نشستن در پرونده است. صفِ تأیید مالِ پول و ساختِ مراجعه است و
     این فرم هیچ‌کدام را ندارد؛ تا دیروز ادمین برای هر نظرسنجی یک مُهرِ خالی
     می‌کوبید (خواستهٔ صریحِ کاربر بود که برداشته شود). */
  ok('پرشدن مستقیم approved شد — بدونِ صف', fill.json?.status === 'approved', 'status=' + fill.json?.status);

  const sub = (await api('/intake/submissions?status=approved')).json.find((x) => x.token === reg.token);
  ok('در فهرستِ ادمین با وضعیتِ تأییدشده هست', !!sub, 'sub=' + !!sub);
  ok('فهرستِ ادمین می‌گوید مراجعه **نمی‌سازد**', sub?.makesVisit === false, 'makesVisit=' + sub?.makesVisit);
  ok('و مراجعه‌ای نساخته', sub?.visitId == null, 'visitId=' + sub?.visitId);
  ok('به همان پرونده اشاره می‌کند', sub?.patient?.id === patientId,
    `${sub?.patient?.id} ≠ ${patientId}`);
  subId = sub?.id;
}

console.log('\n۵) حالا فرم در پرونده **دیده می‌شود** — همان حلقه‌ای که باز بود');
{
  const rec = (await api(`/patients/${patientId}/record`)).json;
  ok('شمارشگرِ فرم‌ها یک شد', rec?.counts?.forms === 1, 'forms=' + rec?.counts?.forms);
  const f = rec?.attachedForms?.[0];
  ok('فرم در فهرست هست', !!f, JSON.stringify(rec?.attachedForms)?.slice(0, 160));
  ok('عنوانِ فرم درست است', f?.formTitle === '[rf] نظرسنجیِ پس از عمل', 'formTitle=' + f?.formTitle);
  ok('رنگِ فرم از پالت است', COLOR_KEYS.includes(f?.formColor), 'formColor=' + f?.formColor);
  ok('تاریخِ ثبت دارد', !!f?.submittedAt, 'submittedAt=' + f?.submittedAt);
  ok('برای ادمین قفل نیست', f?.locked === false, 'locked=' + f?.locked);

  /* ⚠️ برچسبِ هر پاسخ **سمتِ سرور** به مقدارش جوش خورده. اگر کلاینت خودش
     zip می‌کرد، روزی که فیلدی حذف شود پاسخِ یتیم زیرِ برچسبِ فیلدِ بعدی
     می‌نشست — بی‌هیچ خطایی. */
  const byKey = Object.fromEntries((f?.answers ?? []).map((a) => [a.key, a]));
  ok('پاسخِ امتیاز با برچسبش آمد', byKey.rfScore?.label === 'رضایت از عمل', JSON.stringify(byKey.rfScore));
  ok('مقدارِ امتیاز درست است', String(byKey.rfScore?.value) === '5', 'value=' + byKey.rfScore?.value);
  ok('پاسخِ متنی هم با برچسبش آمد', byKey.rfWord?.label === 'حرفِ آخر' && byKey.rfWord?.value === 'همه‌چیز خوب بود',
    JSON.stringify(byKey.rfWord));
  /* فیلدی که بیمار پر نکرده نباید ردیفِ خالی بسازد: فرمِ ده‌فیلدی که سه‌تا
     پر شده، نباید هفت خطِ «—» نشان دهد. */
  ok('فیلدِ بی‌پاسخ ردیف نساخت', byKey.rfBlank === undefined, JSON.stringify(byKey.rfBlank));
  ok('پس دقیقاً دو پاسخ هست', (f?.answers ?? []).length === 2, 'n=' + (f?.answers ?? []).length);
}

console.log('\n۶) فرمِ زیرپرونده مراجعه‌ای به پرونده اضافه نکرد');
{
  const rec = (await api(`/patients/${patientId}/record`)).json;
  ok('تعدادِ مراجعات همان یک ماند', rec?.counts?.visits === 1, 'visits=' + rec?.counts?.visits);
  /* اگر `approve` مثلِ قبل کورکورانه مراجعه می‌ساخت، این عدد ۲ می‌شد و یک
     «جراحی»ِ خیالی در تقویم و گزارشِ مالی می‌نشست. */
}

console.log('\n۷) فرمِ **مراجعه‌ای** در فهرستِ ضمیمه‌ها نمی‌آید');
{
  const rec = (await api(`/patients/${patientId}/record`)).json;
  ok('هیچ ضمیمه‌ای از نوعِ مراجعه نیست',
    (rec?.attachedForms ?? []).every((f) => f.formTitle !== '[rf] ویزیتِ پرونده'),
    (rec?.attachedForms ?? []).map((f) => f.formTitle).join('، '));
}

// ── پاک‌سازی ────────────────────────────────────────────────────────────────
for (const l of (await api('/intake/links')).json.filter((x) => /^\[rf]/.test(x.title))) {
  await api(`/intake/links/${l.id}`, { method: 'PATCH', body: { title: '[rf-old] ' + l.id, active: false } });
}

console.log(`\n${'─'.repeat(58)}\n${pass} ادعا درست`);
if (fails.length) { console.log(`${fails.length} شکست:`); fails.forEach((f) => console.log('  • ' + f)); process.exit(1); }
console.log('همه سبز ✅');
