/**
 * بازیابیِ رمز با کدِ پیامکی (بازبینیِ UX، بندِ ۱۹) — روی سرورِ زندهٔ محلی (NODE_ENV=test، پیامکِ ساختگی).
 *
 *   node scripts/e2e/password-reset.mjs          (E2E_API پیش‌فرض http://localhost:3101/api)
 *
 * ادعاها:
 *  - شمارش‌ناپذیر: درخواستِ کد برای نامِ کاربری/موبایلِ ناموجود همان پاسخِ حسابِ موجود است ({ok, ttl})،
 *    درخواستِ دوباره در پنجرهٔ یک‌دقیقه‌ای «کمی صبر کنید» نمی‌دهد، و همهٔ شکست‌های تأیید یک پیام دارند
 *  - حسابِ در انتظارِ تأیید کد نمی‌گیرد (بی‌صدا) و تأییدش همان خطای عام را می‌دهد
 *  - کدِ درست ← رمزِ تازه؛ همهٔ نشست‌های قبلی باطل؛ رمزِ قبلی رد، رمزِ تازه قبول؛ کد یک‌بارمصرف
 *  - خطاهای سنجش فارسی‌اند (قانونِ ۸)؛ سقفِ نرخ برای شناسهٔ ناموجود هم می‌خورد (۴۲۹ فارسی)
 *
 * ⚠️ سقفِ نرخ در حافظهٔ سرور است (۱۰ درخواستِ کد در ۱۵ دقیقه برای هر IP): اجرای دوباره روی همان
 * سرور در کمتر از ۱۵ دقیقه ممکن است ۴۲۹ بگیرد — سرور را از نو بالا بیاورید.
 */
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (extra ? ` — ${extra}` : '')); } };

/** جارِ کوکیِ کوچک (مثلِ cookie-auth.mjs) — برای سنجشِ باطل‌شدنِ نشستِ قبلی. */
class Jar {
  constructor() { this.c = new Map(); }
  absorb(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim());
      const [k, ...v] = pair.split('=');
      if (attrs.some((a) => /^max-age=0$/i.test(a))) { this.c.delete(k); continue; }
      this.c.set(k, v.join('='));
    }
  }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join('; '); }
}
const call = async (path, { method = 'POST', body, jar, bearer } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (jar) headers.Cookie = jar.header();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  jar?.absorb(res);
  return { status: res.status, json: await res.json().catch(() => null) };
};
const msg = (r) => [].concat(r.json?.message ?? '').join('، ');
const keys = (o) => JSON.stringify(Object.keys(o ?? {}).sort());
const run = String(Date.now()).slice(-6);
const SELFIE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** حسابِ تازه از مسیرِ واقعیِ ثبت‌نام (OTPِ ساختگی)؛ `approve` ← فعال با سطحِ ۲. */
async function newAccount(tag, adminBearer, approve = true) {
  const phone = `0936${run}${tag}`.slice(0, 11).padEnd(11, '0');
  const username = `e2ereset${tag}${run}`;
  const otp = await call('/auth/signup/request-otp', { body: { phone } });
  const ver = await call('/auth/signup/verify-otp', { body: { phone, code: otp.json?.devCode } });
  const done = await call('/auth/signup/complete', { body: {
    signupToken: ver.json?.signupToken, firstName: 'آزمونی', lastName: 'بازیابی', username, password: 'old-pass-1', selfie: SELFIE,
  } });
  const id = done.json?.user?.id;
  if (id && approve) await call(`/accounts/${id}/approve`, { body: { level: 2 }, bearer: adminBearer });
  return { id, phone, username };
}

console.log('۰) آماده‌سازی: مدیر + حسابِ فعال + حسابِ در انتظار');
const admin = await call('/auth/login', { body: { identifier: 'admin', password: 'test1234' } });
ok(admin.status < 300 && !!admin.json?.accessToken, `ورودِ مدیر (${admin.status})`);
const acc = await newAccount('1', admin.json?.accessToken);
const pending = await newAccount('2', admin.json?.accessToken, false);
ok(!!acc.id && !!pending.id, 'دو حسابِ آزمونی ساخته شد');
const jarA = new Jar();
const oldLogin = await call('/auth/login', { body: { identifier: acc.username, password: 'old-pass-1', remember: false }, jar: jarA });
ok(oldLogin.status < 300, `ورود با رمزِ قبلی پیش از بازیابی (${oldLogin.status})`);

console.log('\n۱) شمارش‌ناپذیری: پاسخِ درخواستِ کد');
const ghost = await call('/auth/password/request-otp', { body: { identifier: `nobody${run}` } });
const ghostPhone = await call('/auth/password/request-otp', { body: { identifier: `0999${run}0` } });
ok(ghost.status < 300 && ghost.json?.ok === true && !ghost.json?.devCode, 'نامِ کاربریِ ناموجود ← {ok:true} بی‌کد و بی‌خطا', JSON.stringify(ghost.json));
ok(ghostPhone.status < 300 && keys(ghostPhone.json) === keys(ghost.json), 'موبایلِ ناموجود ← همان پاسخ');
const real = await call('/auth/password/request-otp', { body: { identifier: acc.username } });
ok(real.status < 300 && /^\d{6}$/.test(real.json?.devCode ?? ''), 'حسابِ فعال ← کد (devCodeِ محیطِ آزمون)', JSON.stringify(real.json));
const { devCode: _dev, ...realShape } = real.json ?? {};
ok(keys(realShape) === keys(ghost.json) && realShape.ttl === ghost.json?.ttl, 'بی devCode، پاسخِ حسابِ موجود و ناموجود هم‌شکل است');
const again = await call('/auth/password/request-otp', { body: { identifier: acc.username } });
ok(again.status < 300 && keys(again.json) === keys(ghost.json) && !/صبر/.test(msg(again)),
  'درخواستِ دوباره در پنجرهٔ یک‌دقیقه‌ای «کمی صبر کنید» نمی‌دهد (آن پیام فقط برای حسابِ موجود بود)');
const pend = await call('/auth/password/request-otp', { body: { identifier: pending.username } });
ok(pend.status < 300 && !pend.json?.devCode && keys(pend.json) === keys(ghost.json), 'حسابِ در انتظارِ تأیید ← همان پاسخ و بی‌کد');

console.log('\n۲) شکست‌ها: یک پیام، فارسی');
const wrongCode = String((Number(real.json?.devCode ?? 0) + 1) % 1_000_000).padStart(6, '0');
const wrong = await call('/auth/password/reset', { body: { identifier: acc.username, code: wrongCode, password: 'new-pass-2' } });
const ghostReset = await call('/auth/password/reset', { body: { identifier: `nobody${run}`, code: '123456', password: 'new-pass-2' } });
const pendReset = await call('/auth/password/reset', { body: { identifier: pending.username, code: '123456', password: 'new-pass-2' } });
ok(wrong.status === 400 && /کدِ تأیید/.test(msg(wrong)), `کدِ غلط ← ۴۰۰ فارسی («${msg(wrong)}»)`);
ok(ghostReset.status === 400 && msg(ghostReset) === msg(wrong), 'شناسهٔ ناموجود ← **همان** پیامِ کدِ غلط');
ok(pendReset.status === 400 && msg(pendReset) === msg(wrong), 'حسابِ در انتظار ← همان پیام');
const shortPw = await call('/auth/password/reset', { body: { identifier: acc.username, code: real.json?.devCode, password: '123' } });
ok(shortPw.status === 400 && /رمزِ تازه/.test(msg(shortPw)), `رمزِ کوتاه ← ۴۰۰ فارسی («${msg(shortPw)}»)`);
const badFmt = await call('/auth/password/reset', { body: { identifier: acc.username, code: '12ab', password: 'new-pass-2' } });
ok(badFmt.status === 400 && /۶ رقم/.test(msg(badFmt)), `کدِ نادرست‌شکل ← ۴۰۰ فارسی («${msg(badFmt)}»)`);

console.log('\n۳) کدِ درست ← رمزِ تازه، نشست‌های قبلی باطل');
const reset = await call('/auth/password/reset', { body: { identifier: acc.username, code: real.json?.devCode, password: 'new-pass-2' } });
ok(reset.status < 300 && reset.json?.ok === true, `بازیابی (${reset.status})`, msg(reset));
const meOld = await call('/auth/me', { method: 'GET', jar: jarA });
ok(meOld.status === 401, `نشستِ پیش از بازیابی باطل شد (${meOld.status})`);
const loginOld = await call('/auth/login', { body: { identifier: acc.username, password: 'old-pass-1' } });
ok(loginOld.status === 401, `رمزِ قبلی رد می‌شود (${loginOld.status})`);
const loginNew = await call('/auth/login', { body: { identifier: acc.phone, password: 'new-pass-2' } });
ok(loginNew.status < 300, `رمزِ تازه با موبایل پذیرفته می‌شود (${loginNew.status})`);
const reuse = await call('/auth/password/reset', { body: { identifier: acc.username, code: real.json?.devCode, password: 'new-pass-3' } });
ok(reuse.status === 400 && msg(reuse) === msg(wrong), 'کد یک‌بارمصرف است — همان پیامِ عام');

console.log('\n۴) سقفِ نرخ برای شناسهٔ ناموجود هم');
const probe = `ratelimit${run}`;
const codes = [];
for (let i = 0; i < 4; i++) codes.push(await call('/auth/password/request-otp', { body: { identifier: probe } }));
ok(codes.slice(0, 3).every((r) => r.status < 300) && codes[3].status === 429 && /زیاد/.test(msg(codes[3])),
  `سه درخواست ← سپس ۴۲۹ فارسی (${codes.map((r) => r.status).join('،')})`);

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
