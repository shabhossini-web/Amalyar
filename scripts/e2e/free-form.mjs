/**
 * فرمی که پول ندارد نباید فیش بخواهد.
 *
 * ⚠️ باگی که این آزمون نگهبانش است: `fill()` بی‌قید وضعیت را
 * `pending_payment` می‌گذاشت، چون اولین مصرف‌کننده‌اش ثبت‌نامِ
 * نورومانیتورینگ بود و آن همیشه پول داشت. ولی همان لینک‌ساز «پیگیری» و
 * «نظرسنجی» هم می‌سازد که مبلغشان صفر است؛ بیمار پشتِ «در انتظارِ فیش» گیر
 * می‌کرد و باید عکسِ فیشی می‌فرستاد که وجود نداشت.
 *
 * مرزِ دقیق هم سنجیده می‌شود: فرمی که کادرِ پرداخت **دارد** ولی مبلغش صفر
 * است عمداً همچنان فیش می‌خواهد — آن یک خطای پیکربندی است نه فرمِ رایگان.
 */
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

/* شناسه‌ها از pid می‌آیند تا آزمون بارِ دوم به دادهٔ اجرای قبلی نخورد. */
const tag = String(process.pid).slice(-5);

/** کدِ ملیِ معتبرِ ساختگی (رقمِ کنترلِ استاندارد). */
const nid = (n) => {
  const base = String(n).padStart(9, '0').slice(-9);
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(base[i]) * (10 - i);
  const r = s % 11;
  return base + String(r < 2 ? r : 11 - r);
};
const seed = Number(tag) * 7 + 100000;

const mkForm = async (key, title, withPayment) => {
  const f = await fetch(API + '/forms', {
    method: 'POST', headers: A, body: JSON.stringify({ key, title, scope: 'intake' }),
  }).then((r) => r.json());
  if (!f.id) { console.error('فرم ساخته نشد:', JSON.stringify(f)); process.exit(1); }
  await fetch(API + `/forms/${f.id}/fields`, {
    method: 'POST', headers: A,
    body: JSON.stringify({ key: 'q1', label: 'نظرِ شما', type: 'text', required: false }),
  });
  if (withPayment) {
    await fetch(API + `/forms/${f.id}/fields`, {
      method: 'POST', headers: A,
      body: JSON.stringify({ key: 'pay', label: 'پرداخت', type: 'payment', required: false }),
    });
  }
  return f.id;
};

const mkLink = async (title, amount, formId) => {
  const l = await fetch(API + '/intake/links', {
    method: 'POST', headers: A, body: JSON.stringify({ title, amount, formId }),
  }).then((r) => r.json());
  if (!l.id) { console.error('لینک ساخته نشد:', JSON.stringify(l)); process.exit(1); }
  return l;
};

/** مسیرِ واقعیِ بیمار: ثبت‌نام از لینک، سپس پر کردنِ فرم. */
const walk = async (link, code) => {
  const reg = await fetch(API + `/public/intake/link/${link.token}/register`, {
    method: 'POST', headers: J,
    body: JSON.stringify({
      firstName: 'آزمونِ', lastName: 'رایگان', phone: '0912' + code.slice(0, 7), nationalId: code,
      captchaA: 3, captchaB: 4, captchaAnswer: 7,
    }),
  }).then((r) => r.json());
  const res = await fetch(API + `/public/intake/form/${reg.token ?? link.token}/fill`, {
    method: 'POST', headers: J, body: JSON.stringify({ values: { q1: 'خوب بود' } }),
  }).then((r) => r.json());
  if (!res.status) console.error('   پاسخِ غیرمنتظره:', JSON.stringify(res).slice(0, 200));
  return res;
};

console.log('۱) لینکِ پولی → همچنان فیش می‌خواهد');
const paid = await walk(await mkLink(`پولی ${tag}`, 2_000_000, await mkForm(`t${tag}paid`, 'پولی', false)), nid(seed));
ok(paid.status === 'pending_payment', `وضعیت pending_payment شد (${paid.status})`);
ok(paid.payable === 2_000_000, `قابلِ پرداخت درست است (${paid.payable})`);

console.log('\n۲) نظرسنجیِ رایگان → مستقیم به صفِ تأیید');
const free = await walk(await mkLink(`نظرسنجی ${tag}`, 0, await mkForm(`t${tag}free`, 'نظرسنجی', false)), nid(seed + 1));
ok(free.status === 'pending_approval', `وضعیت pending_approval شد (${free.status})`);
ok(free.status !== 'pending_payment', 'پشتِ «در انتظارِ فیش» گیر نکرد');
ok(free.payable === 0, 'و قابلِ پرداختش صفر است');

console.log('\n۳) مرز: رایگان **ولی** با کادرِ پرداخت → عمداً فیش می‌خواهد');
const odd = await walk(await mkLink(`کادردار ${tag}`, 0, await mkForm(`t${tag}odd`, 'رایگانِ کادردار', true)), nid(seed + 2));
ok(odd.status === 'pending_payment', `وضعیت pending_payment ماند (${odd.status})`);

console.log('\n' + '─'.repeat(50));
console.log(`قبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
