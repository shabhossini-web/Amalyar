/**
 * فرمِ زیرپرونده‌ی رایگان (نظرسنجی) **بدونِ صفِ تأیید** مستقیم در پرونده
 * می‌نشیند — و چرخهٔ نظارت بسته می‌ماند.
 *
 * ⚠️ چرا این درست است: صفِ تأیید برای پول (فیش با چشمِ ادمین بخواند) و
 * ساختِ مراجعه (جراح/تاریخ را ادمین گره بزند) است. فرمِ `scope:'record'`
 * هیچ‌کدام را ندارد — مبلغش از ریشه بسته است (`assertRecordFormHasNoAmount`)
 * و مراجعه هم نمی‌سازد. تا دیروز ادمین برای تک‌تکِ نظرسنجی‌ها مُهرِ خالی
 * می‌کوبید.
 *
 * سه ادعای نگهبانی (هر سه از بازبینیِ خصمانه آمدند):
 * - `autoApproved` باید در فهرستِ ادمین true باشد — یعنی امضای هیچ ادمینی
 *   جعل نشده (تأییدِ دستی این پرچم را نمی‌گیرد).
 * - رکوردِ خودکارتأییدشده باید **ردشدنی** بماند (`reject`) و با رد از
 *   پرونده بیرون برود — وگرنه auto-approve یعنی حذفِ دروازهٔ انسانی بدونِ
 *   ابزارِ جبرانی برای یک نشانیِ عمومی.
 * - مسیرِ تأییدِ **دستی**ِ فرمِ record (با کادرِ پرداخت) هنوز زنده است و
 *   باید همچنان کار کند.
 */
import { randomBytes } from 'node:crypto';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — سرور را ری‌استارت کنید'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const J = { 'Content-Type': 'application/json' };

/* ⚠️ برچسب از `randomBytes` نه از pid: کلیدِ فرم سراسری‌یکتاست و فرمِ
   لینک‌دار فقط soft-delete می‌شود، پس pidِ بازیافتی اجرای بعد را می‌شکست
   (بازبینی گرفتش). تصادفی یعنی هر اجرا قطعاً تمیز شروع می‌کند. */
const tag = 'rd' + randomBytes(3).toString('hex');
const nid = (n) => {
  const base = String(n).padStart(9, '0').slice(-9);
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(base[i]) * (10 - i);
  const r = s % 11;
  return base + String(r < 2 ? r : 11 - r);
};
const seed = parseInt(randomBytes(3).toString('hex'), 16) % 900000 + 100000;

await fetch(API + '/forms', { headers: A }); // seedِ تنبل

const mkForm = async (key, title, scope, withPayment = false) => {
  const f = await fetch(API + '/forms', {
    method: 'POST', headers: A, body: JSON.stringify({ key, title, scope }),
  }).then((r) => r.json());
  if (!f.id) { console.error('فرم ساخته نشد:', JSON.stringify(f)); process.exit(1); }
  await fetch(API + `/forms/${f.id}/fields`, {
    method: 'POST', headers: A,
    body: JSON.stringify({ key: 'overall', label: 'رضایتِ کلی', type: 'rating', required: true }),
  });
  if (withPayment) {
    await fetch(API + `/forms/${f.id}/fields`, {
      method: 'POST', headers: A,
      body: JSON.stringify({ key: 'pay', label: 'پرداخت', type: 'payment', required: false }),
    });
  }
  return f.id;
};

const mkLink = async (title, formId) => {
  const l = await fetch(API + '/intake/links', {
    method: 'POST', headers: A, body: JSON.stringify({ title, amount: 0, formId }),
  }).then((r) => r.json());
  if (!l.id) { console.error('لینک ساخته نشد:', JSON.stringify(l)); process.exit(1); }
  return l;
};

const walk = async (link, code) => {
  const reg = await fetch(API + `/public/intake/link/${link.token}/register`, {
    method: 'POST', headers: J,
    body: JSON.stringify({
      firstName: 'نظرسنجِ', lastName: 'مستقیم', phone: '0913' + code.slice(0, 7), nationalId: code,
      captchaA: 2, captchaB: 5, captchaAnswer: 7,
    }),
  }).then((r) => r.json());
  const res = await fetch(API + `/public/intake/form/${reg.token ?? link.token}/fill`, {
    method: 'POST', headers: J, body: JSON.stringify({ values: { overall: 5 } }),
  }).then((r) => r.json());
  if (!res.status) console.error('   پاسخِ غیرمنتظره:', JSON.stringify(res).slice(0, 200));
  return { reg, res };
};

console.log('۱) لینکِ فرمِ زیرپرونده مبلغ نمی‌پذیرد (کنترلِ پیش‌فرض)');
const fRec = await mkForm(`${tag}sv`, 'نظرسنجیِ آزمون', 'record');
const bad = await fetch(API + '/intake/links', {
  method: 'POST', headers: A, body: JSON.stringify({ title: 'نظرسنجیِ پولی ' + tag, amount: 1000, formId: fRec }),
}).then((r) => r.json());
ok(!bad.id, `لینکِ record با مبلغ رد شد (${(bad.message ?? '').slice(0, 40)}…)`);

console.log('\n۲) نظرسنجی: پر شد → مستقیم approved، بدونِ صف');
const link = await mkLink('نظرسنجی ' + tag, fRec);
const { res } = await walk(link, nid(seed));
ok(res.status === 'approved', `وضعیت approved شد (${res.status})`);
ok(res.makesVisit === false, 'publicView می‌گوید مراجعه نمی‌سازد (پیامِ درستِ صفحهٔ بیمار)');

console.log('\n۳) در دفتر و پرونده درست نشسته است');
const subs = await fetch(API + '/intake/submissions?status=approved', { headers: A }).then((r) => r.json());
const sub = subs.find((x) => x.linkTitle === 'نظرسنجی ' + tag);
ok(!!sub, 'در فهرستِ ادمین با وضعیتِ تأییدشده هست');
ok(sub && sub.visitId == null, 'مراجعه‌ای نساخته');
ok(sub && sub.autoApproved === true, 'پرچمِ autoApproved یعنی امضای هیچ ادمینی جعل نشده');
const rec = sub ? await fetch(API + `/patients/${sub.patient.id}/record`, { headers: A }).then((r) => r.json()) : null;
ok(rec && rec.counts.forms >= 1, `در پرونده نشست (فرم‌ها: ${rec?.counts?.forms})`);
const ans = rec?.attachedForms.find((x) => x.formTitle === 'نظرسنجیِ آزمون');
ok(ans && ans.answers?.some((a) => a.key === 'overall' && Number(a.value) === 5), 'پاسخِ بیمار سرِ جایش است');

console.log('\n۴) چرخهٔ نظارت بسته است: ردِ رکوردِ خودکارتأییدشده');
const rej = await fetch(API + `/intake/submissions/${sub.id}/reject`, {
  method: 'POST', headers: A, body: JSON.stringify({ note: 'ثبتِ آزمایشی — حذف از پرونده' }),
});
ok(rej.status < 300, `reject پذیرفته شد (${rej.status})`);
const rec2 = await fetch(API + `/patients/${sub.patient.id}/record`, { headers: A }).then((r) => r.json());
ok((rec2.attachedForms ?? []).every((x) => x.formTitle !== 'نظرسنجیِ آزمون'), 'و از پروندهٔ بیمار بیرون رفت');

console.log('\n۵) فرمِ ثبت‌نامِ رایگان همچنان به صفِ تأیید می‌رود (مرز)');
const fIn = await mkForm(`${tag}in`, 'ثبت‌نامِ رایگان', 'intake');
const w2 = await walk(await mkLink('ثبت‌نامِ رایگان ' + tag, fIn), nid(seed + 1));
ok(w2.res.status === 'pending_approval', `intakeِ رایگان در صفِ تأیید ماند (${w2.res.status})`);
ok(w2.res.makesVisit !== false, 'و publicView می‌گوید مراجعه می‌سازد');

console.log('\n۶) مسیرِ دستی زنده است: recordِ کادردار → صف → approveِ ادمین');
const fOdd = await mkForm(`${tag}od`, 'نظرسنجیِ کادردار', 'record', true);
const w3 = await walk(await mkLink('کادردار ' + tag, fOdd), nid(seed + 2));
ok(w3.res.status === 'pending_payment', `با کادرِ پرداخت در مسیرِ فیش ماند (${w3.res.status})`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const fd = new FormData();
fd.append('file', new Blob([png], { type: 'image/png' }), 'r.png');
await fetch(`${API}/public/intake/form/${w3.reg.token}/receipt`, { method: 'POST', body: fd });
const q = await fetch(API + '/intake/submissions?status=pending_approval', { headers: A }).then((r) => r.json());
const manual = q.find((x) => x.token === w3.reg.token);
ok(!!manual, 'بعد از فیش در صفِ تأیید نشست');
const app = await fetch(API + `/intake/submissions/${manual?.id}/approve`, {
  method: 'POST', headers: A, body: JSON.stringify({}),
}).then((r) => r.json());
ok(app?.madeVisit === false, `approveِ دستیِ record مراجعه نساخت (${JSON.stringify(app).slice(0, 60)})`);
const after = await fetch(API + '/intake/submissions?status=approved', { headers: A }).then((r) => r.json())
  .then((xs) => xs.find((x) => x.token === w3.reg.token));
ok(after && after.autoApproved === false, 'و تأییدِ دستی پرچمِ autoApproved نمی‌گیرد');
const rejManual = await fetch(API + `/intake/submissions/${manual?.id}/reject`, {
  method: 'POST', headers: A, body: JSON.stringify({ note: 'تست' }),
});
ok(rejManual.status === 400, `تأییدشدهٔ دستی ردشدنی نیست (${rejManual.status})`);

console.log('\n' + '─'.repeat(50));
console.log(`قبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
