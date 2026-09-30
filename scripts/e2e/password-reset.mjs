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
 * بازبینیِ امنیتیِ بستهٔ P (بستهٔ PF) — هر بخش سنجه‌ای است که **بی‌اصلاح قرمز** می‌شد:
 *  - PF1: شمارهٔ کسی که حساب دارد از «تعاریف» (جراح/راننده) عوض نمی‌شود (۴۰۳)، و سوپرادمین کدِ پیامکی نمی‌گیرد
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

/** حسابِ تازه از مسیرِ واقعیِ ثبت‌نام (OTPِ ساختگی)؛ `approve` ← فعال با سطحِ ۲ (یا `level`). */
async function newAccount(tag, adminBearer, approve = true, { phone: fixedPhone, level = 2 } = {}) {
  const phone = fixedPhone ?? `0936${run}${tag}`.slice(0, 11).padEnd(11, '0');
  const username = `e2ereset${tag}${run}`;
  const otp = await call('/auth/signup/request-otp', { body: { phone } });
  const ver = await call('/auth/signup/verify-otp', { body: { phone, code: otp.json?.devCode } });
  const done = await call('/auth/signup/complete', { body: {
    signupToken: ver.json?.signupToken, firstName: 'آزمونی', lastName: 'بازیابی', username, password: 'old-pass-1', selfie: SELFIE,
  } });
  const id = done.json?.user?.id;
  if (id && approve) await call(`/accounts/${id}/approve`, { body: { level }, bearer: adminBearer });
  return { id, phone, username, personId: done.json?.user?.personId };
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

console.log('\n۴) PF1 — تصاحبِ حساب با عوض‌کردنِ تلفن در «تعاریف» بسته است');
const bearer = admin.json?.accessToken;
const LOCKED = 'شمارهٔ کسی که حسابِ کاربری دارد فقط از «مدیریتِ کاربران» عوض می‌شود.';
const attacker = `0935${run}7`;
/* الف) جراحِ متصل به حساب — همان شکلِ بنیان‌گذارِ مطب (`promoteSoleFounder`): نقشِ «پزشک» ← تعریفِ جراح روی همان Person. */
const doc = await newAccount('3', bearer);
await call(`/accounts/${doc.id}/job-role`, { body: { jobRole: 'doctor' }, bearer });
const sg = ((await call('/surgeons', { method: 'GET', bearer })).json ?? []).find((x) => x.personId === doc.personId);
ok(!!sg, 'حسابِ پزشک یک تعریفِ جراح دارد');
const hijack = await call(`/surgeons/${sg?.id}`, { method: 'PATCH', body: { phone: attacker }, bearer });
ok(hijack.status === 403 && msg(hijack) === LOCKED, `شمارهٔ جراحِ صاحبِ حساب از «تعاریف» عوض نمی‌شود (${hijack.status} «${msg(hijack)}»)`);
const sgAfter = ((await call('/surgeons', { method: 'GET', bearer })).json ?? []).find((x) => x.id === sg?.id);
ok(sgAfter?.phone === doc.phone, 'شماره سرِ جایش ماند');
const stolen = await call('/auth/password/request-otp', { body: { identifier: attacker } });
ok(!stolen.json?.devCode, 'شمارهٔ مهاجم کدِ بازیابیِ آن حساب را نمی‌گیرد');
/* فرمِ «تعاریف» همهٔ فیلدها را می‌فرستد: همان شماره + فیلدِ دیگر باید مثلِ قبل ذخیره شود (سنجهٔ منفی). */
const sameSave = await call(`/surgeons/${sg?.id}`, { method: 'PATCH', body: { phone: doc.phone, specialty: 'آزمونی' }, bearer });
ok(sameSave.status < 300 && sameSave.json?.specialty === 'آزمونی', `ذخیرهٔ هم‌شماره (فیلدهای دیگر) رد نمی‌شود (${sameSave.status})`);
/* جراحِ بی‌حساب همچنان شماره‌اش عوض می‌شود — نگهبان فقط صاحبانِ حساب را می‌گیرد (سنجهٔ منفی). */
const bare = await call('/surgeons', { body: { firstName: 'آزمونی', lastName: `بی‌حساب${run}`, phone: `0934${run}1` }, bearer });
const bareEdit = await call(`/surgeons/${bare.json?.id}`, { method: 'PATCH', body: { phone: `0934${run}2` }, bearer });
ok(bareEdit.status < 300 && bareEdit.json?.phone === `0934${run}2`, `شمارهٔ جراحِ بی‌حساب عوض می‌شود (${bareEdit.status})`);
/* ب) رانندهٔ تعریف‌شده که بعد با همان شماره ثبت‌نام کرده (Personِ مشترک). */
const drvPhone = `0933${run}5`;
const drv = await call('/transport-staff', { body: { firstName: 'آزمونی', lastName: 'راننده', phone: drvPhone, role: 'driver' }, bearer });
await newAccount('5', bearer, true, { phone: drvPhone });
const drvHijack = await call(`/transport-staff/${drv.json?.id}`, { method: 'PATCH', body: { phone: attacker }, bearer });
ok(drvHijack.status === 403 && msg(drvHijack) === LOCKED, `شمارهٔ رانندهٔ صاحبِ حساب هم (${drvHijack.status})`);
/* ج) سوپرادمین بازیابیِ فقط‌پیامکی ندارد — همان پاسخِ بی‌صدا، بی‌کد. */
const boss = await newAccount('6', bearer, true, { level: 6 });
const bossReq = await call('/auth/password/request-otp', { body: { identifier: boss.username } });
ok(bossReq.status < 300 && !bossReq.json?.devCode && keys(bossReq.json) === keys(ghost.json), 'سوپرادمین ← همان پاسخِ ناموجود، بی‌کد');
const bossReset = await call('/auth/password/reset', { body: { identifier: boss.phone, code: '123456', password: 'new-pass-2' } });
ok(bossReset.status === 400 && msg(bossReset) === msg(wrong), 'و تأییدش همان پیامِ عام');
await call(`/accounts/${boss.id}/reject`, { body: {}, bearer }); // سوپرادمینِ آزمونی فعال نماند

console.log('\n۵) سقفِ نرخ برای شناسهٔ ناموجود هم');
const probe = `ratelimit${run}`;
const codes = [];
for (let i = 0; i < 4; i++) codes.push(await call('/auth/password/request-otp', { body: { identifier: probe } }));
ok(codes.slice(0, 3).every((r) => r.status < 300) && codes[3].status === 429 && /زیاد/.test(msg(codes[3])),
  `سه درخواست ← سپس ۴۲۹ فارسی (${codes.map((r) => r.status).join('،')})`);

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
