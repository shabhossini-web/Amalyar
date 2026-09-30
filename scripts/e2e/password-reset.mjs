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
 *  - PF2: سطلِ سقفِ نرخ به‌ازای نشانیِ واقعی (تهِ X-Forwarded-For) و جدا برای هر شرکت
 *  - PF3: «ادامه با موبایلِ» ثبت‌نامِ بیمار منتظرِ درگاهِ پیامک نمی‌ماند (درونِ فرایند)
 *  - PF4: بودجهٔ حدسِ کد به‌ازای حساب است نه متنِ تایپ‌شده، و شمارشِ تلاش اتمی است
 *  - PF5: درخواستِ کدِ بازیابی بیرون از محیطِ آزمون منتظرِ یافتنِ حساب نمی‌ماند (درونِ فرایند)
 *  - PF6: بازیابی پس‌کی‌های حساب را هم پاک می‌کند و تعدادشان را می‌گوید
 *  - PF7: ثبت‌نامِ بیمار برای بمبارانِ پیامکیِ یک شماره به کار نمی‌آید (سقفِ بی‌صدا به‌ازای شماره و لینک)
 *  - PF10: متنِ پیامکِ بازیابی می‌گوید کد را به هیچ‌کس ندهید؛ خطِ آخرِ WebOTP سرِ جایش (درونِ فرایند)
 *  - PF11: هشِ کد HMAC با رازِ سرور است نه SHA-256ِ بی‌کلید (جدولِ otp_codes)
 *  - PF12: «لینک به … پیامک شد» شمارهٔ پرونده را به کسی که شمارهٔ دیگری تایپ کرده نشان نمی‌دهد
 *
 * ⚠️ سقفِ نرخ در حافظهٔ سرور است (۱۰ درخواستِ کد در ۱۵ دقیقه برای هر IP): اجرای دوباره روی همان
 * سرور در کمتر از ۱۵ دقیقه ممکن است ۴۲۹ بگیرد — سرور را از نو بالا بیاورید.
 */
import { execSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { captchaFor } from './lib/captcha.mjs';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
/* دیتابیسِ همان شرکت — فقط برای چیدنِ حالتی که از بیرون ساختنی نیست (مثلِ صفرکردنِ تلاش‌های یک کد). */
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const sql = (q) => execSync(`psql "${DB}" -qtAc ${JSON.stringify(q)}`).toString().trim();
const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
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
/* شرکتِ دوم روی همان API (میزبانِ دیگر) — `bootstrap-env.mjs` همین میزبان را ثبت می‌کند. */
const API_B = process.env.E2E_API_B ?? API.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/])/, `//${process.env.E2E_HOST_B ?? '127.0.0.2'}`);
const call = async (path, { method = 'POST', body, jar, bearer, ip, base = API } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (jar) headers.Cookie = jar.header();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  /* نشانیِ بازدیدکننده همان‌طور که Traefik می‌فرستد (تهِ `X-Forwarded-For`) — هر بخش سطلِ IPِ خودش. */
  if (ip) headers['X-Forwarded-For'] = ip;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
/* `E2E_ADMIN_TOKEN` (اختیاری): روی دیتابیسِ مشترک هر ورودِ تازهٔ مدیر یک نشست می‌سازد و از دهمی به بعد قدیمی‌ترین
   نشستِ **دیگران** باطل می‌شود؛ با این توکن آزمون اصلاً /auth/login مدیر را صدا نمی‌زند. CI دیتابیسِ تازه دارد. */
const admin = process.env.E2E_ADMIN_TOKEN
  ? { status: 200, json: { accessToken: process.env.E2E_ADMIN_TOKEN } }
  : await call('/auth/login', { body: { identifier: 'admin', password: 'test1234' } });
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
/* PF11: هشِ کد در دیتابیس با کلید است — شش رقم با SHA-256ِ بی‌کلید از یک دامپِ دیتابیس در کسری از ثانیه برمی‌گشت. */
const stored = sql(`SELECT code_hash FROM otp_codes WHERE phone = '${acc.phone}' AND purpose = 'password-reset' AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`);
const keyed = createHmac('sha256', process.env.JWT_SECRET ?? '').update(`password-reset:${acc.phone}:${real.json?.devCode}`).digest('hex');
ok(stored === keyed && stored !== createHash('sha256').update(String(real.json?.devCode)).digest('hex'),
  'PF11: هشِ کد HMAC(رازِ سرور، هدف:شماره:کد) است نه SHA-256ِ خامِ کد', stored.slice(0, 12));
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
/* PF6: پس‌کیِ ثبت‌شدهٔ همین حساب — کسی که رمز را دزدیده بود ممکن است اثر انگشتِ خودش را هم ثبت کرده باشد. */
sql(`INSERT INTO webauthn_credentials (account_id, cred_id, public_key, name) VALUES (${acc.id}, 'e2e-pf6-${run}', 'AAAA', 'آزمونی')`);
const reset = await call('/auth/password/reset', { body: { identifier: acc.username, code: real.json?.devCode, password: 'new-pass-2' } });
ok(reset.status < 300 && reset.json?.ok === true, `بازیابی (${reset.status})`, msg(reset));
const leftKeys = Number(sql(`SELECT count(*) FROM webauthn_credentials WHERE account_id = ${acc.id}`));
ok(leftKeys === 0 && reset.json?.passkeysRemoved === 1, `PF6: پس‌کی‌های حساب با بازیابی پاک شدند (مانده: ${leftKeys}، گزارش: ${reset.json?.passkeysRemoved})`);
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

console.log('\n۵) PF2 — سقفِ نرخِ بازیابی به‌ازای نشانیِ واقعی و جدا برای هر شرکت');
/* پشتِ Traefik همهٔ درخواست‌ها یک `req.ip` دارند؛ سطلِ ۱۰تاییِ IP روی آن یعنی ده درخواستِ هر کسی بازیابی را
   برای همه قفل می‌کرد. ۱۱ بازدیدکنندهٔ جدا (هرکدام شناسهٔ خودش) ← هیچ‌کدام ۴۲۹ نمی‌گیرد. */
const crowd = [];
for (let i = 1; i <= 11; i++) crowd.push(await call('/auth/password/request-otp', { body: { identifier: `crowd${i}x${run}` }, ip: `10.61.${i}.1` }));
ok(crowd.every((r) => r.status < 300), `۱۱ نشانیِ جدا ← بی ۴۲۹ (${crowd.map((r) => r.status).join('،')})`);
/* خانهٔ اولِ X-Forwarded-For را خودِ فرستنده می‌نویسد — جعلش سطلِ تازه نمی‌دهد (سنجهٔ منفی). */
const spoof = [];
for (let i = 1; i <= 11; i++) spoof.push(await call('/auth/password/request-otp', { body: { identifier: `spoof${i}x${run}` }, ip: `1.2.3.${i}, 10.62.0.1` }));
ok(spoof.slice(0, 10).every((r) => r.status < 300) && spoof[10].status === 429, `جعلِ خانهٔ اول از سطلِ ۱۰تایی بیرون نمی‌برد (${spoof.map((r) => r.status).join('،')})`);
/* سطلِ شناسه مالِ همان شرکت است: «admin» در هر شرکت یک حسابِ دیگر است. */
const tid = `tenant${run}`;
const inA = [];
for (let i = 0; i < 4; i++) inA.push(await call('/auth/password/request-otp', { body: { identifier: tid }, ip: '10.63.0.1' }));
const inB = await call('/auth/password/request-otp', { body: { identifier: tid }, ip: '10.63.0.1', base: API_B }).catch((e) => ({ status: 0, json: { message: e.message } }));
ok(inA[3].status === 429 && inB.status < 300, `شناسهٔ پرشده در شرکتِ الف، شرکتِ ب را قفل نمی‌کند (الف: ${inA.map((r) => r.status).join('،')} · ب: ${inB.status})`, msg(inB));

console.log('\n۶) PF4 — بودجهٔ حدسِ کد به‌ازای حساب، نه متنِ تایپ‌شده');
/* نامِ کاربری و موبایلِ یک حساب دو سطلِ جدا بودند: ۸ حدس با یکی، ۸ حدسِ دیگر با دیگری. */
const guess = await newAccount('7', bearer);
const gReq = await call('/auth/password/request-otp', { body: { identifier: guess.username }, ip: '10.64.0.1' });
const gCode = gReq.json?.devCode;
const gBad = String((Number(gCode ?? 0) + 1) % 1_000_000).padStart(6, '0');
const tries = [];
for (let i = 0; i < 8; i++) {
  tries.push(await call('/auth/password/reset', { body: { identifier: guess.username, code: gBad, password: 'guess-pass-1' }, ip: '10.64.0.1' }));
}
ok(tries.every((r) => r.status === 400 && msg(r) === msg(wrong)), `هشت حدسِ غلط با نامِ کاربری ← همه همان پیامِ عام (${tries.map((r) => r.status).join('،')})`);
/* کد پس از پنج حدس مُرده است؛ زنده‌اش می‌کنیم تا **فقط** بودجهٔ حساب بتواند حدسِ نهم را نگه دارد. */
sql(`UPDATE otp_codes SET attempts = 0 WHERE phone = '${guess.phone}' AND purpose = 'password-reset' AND consumed_at IS NULL`);
const ninth = await call('/auth/password/reset', { body: { identifier: guess.phone, code: gCode, password: 'guess-pass-1' }, ip: '10.64.0.1' });
ok(ninth.status === 400 && msg(ninth) === msg(wrong), `حدسِ نهم با موبایلِ همان حساب — حتی با کدِ درست — رد می‌شود (${ninth.status})`, msg(ninth));

console.log('\n۷) PF7 و PF12 — پیامکِ «لینکِ ادامه» پس از ثبت‌نامِ بیمار');
/** کدِ ملیِ معتبر (رقمِ کنترلی) — هر اجرا کدهای خودش. */
const nid = (seed) => {
  const base = String(seed % 1_000_000_000).padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
  return base + String(sum % 11 < 2 ? sum % 11 : 11 - (sum % 11));
};
/* یک لینک بس است: هر بیمارِ تازه ثبت‌نام (و توکنِ) خودش را می‌گیرد، و بیمارِ تکراری همان ثبت‌نامِ باز را. */
const link = (await call('/intake/links', { body: { title: `آزمونی PF7 ${run}`, amount: 0 }, bearer })).json;
const register = async (link, who) => call(`/public/intake/link/${link.token}/register`, {
  body: { firstName: 'آزمونی', ...who, ...(await captchaFor(API, link.token)) }, ip: '10.66.0.1',
});
const notices = async (phone) => { await later(400); return Number(sql(`SELECT count(*) FROM reminders WHERE phone = '${phone}' AND kind = 'notice'`)); };
/* PF12 — پرونده با شمارهٔ P ساخته شده؛ کسی کدِ ملی و نامِ خانوادگیِ درست را با شمارهٔ دیگری تایپ می‌کند. پیامک
   به شمارهٔ **پرونده** می‌رود (درست)، ولی پاسخ نباید چهار رقمِ اول و سه رقمِ آخرِ آن را به او نشان دهد. */
const recPhone = `0939${run}3`;
const recNid = nid(Number(run) * 10 + 1);
const own = await register(link, { lastName: 'پرونده‌دار', nationalId: recNid, phone: recPhone });
ok(own.status < 300 && own.json?.linkSmsTo === `${recPhone.slice(0, 4)}…${recPhone.slice(-3)}`, `شمارهٔ تایپ‌شده همان شمارهٔ پرونده ← پوشیده‌اش (${own.status} «${own.json?.linkSmsTo}»)`, msg(own));
const other = await register(link, { lastName: 'پرونده‌دار', nationalId: recNid, phone: `0938${run}2` });
ok(other.status < 300 && other.json?.linkSmsTo === 'شمارهٔ ثبت‌شده در پرونده', `PF12: شمارهٔ دیگر ← «شمارهٔ ثبت‌شده در پرونده»، نه ${recPhone.slice(0, 4)}… (${other.status} «${other.json?.linkSmsTo}»)`, msg(other));
/* PF7 — سه بیمارِ تازه، یک شماره: سقفِ «یک پیامک در ده دقیقه» فقط به‌ازای ثبت‌نام بود، پس هر ثبت‌نام یک
   پیامکِ دیگر به همان شماره می‌فرستاد. سقفِ تازه: دو پیامک در ساعت به هر شماره، بی‌صدا. */
const bombed = `0937${run}1`;
const shots = [];
for (let i = 0; i < 3; i++) shots.push(await register(link, { lastName: `بمباران${i}`, nationalId: nid(Number(run) * 10 + 5 + i), phone: bombed }));
ok(shots.every((r) => r.status < 300), `سه ثبت‌نام پذیرفته شد — سقف بی‌صداست (${shots.map((r) => r.status).join('،')})`);
const sent = await notices(bombed);
ok(sent === 2 && shots[2].json?.linkSmsTo == null, `PF7: پیامکِ سوم به همان شماره نرفت (رفته: ${sent}؛ پاسخِ سوم: «${shots[2].json?.linkSmsTo}»)`);
await call(`/intake/links/${link.id}`, { method: 'PATCH', body: { active: false }, bearer });

console.log('\n۸) سقفِ نرخ برای شناسهٔ ناموجود هم');
const probe = `ratelimit${run}`;
const codes = [];
for (let i = 0; i < 4; i++) codes.push(await call('/auth/password/request-otp', { body: { identifier: probe } }));
ok(codes.slice(0, 3).every((r) => r.status < 300) && codes[3].status === 429 && /زیاد/.test(msg(codes[3])),
  `سه درخواست ← سپس ۴۲۹ فارسی (${codes.map((r) => r.status).join('،')})`);

/* ── درونِ فرایند: چیزهایی که سرورِ زنده در NODE_ENV=test نشانشان نمی‌دهد ─────────────────────────────
   آزمونِ زنده کد را از پاسخ می‌گیرد (devCode)، پس در محیطِ آزمون سرور عمداً منتظرِ کارش می‌ماند. رفتارِ
   production (پاسخِ فوری، کارِ جداشده) این‌جا با خودِ کلاس‌های بیلدشده و دیتابیس/درگاهِ ساختگی سنجیده می‌شود. */
console.log('\n۹) درونِ فرایند (NODE_ENV=production، دیتابیس و درگاهِ ساختگی)');
const { createRequire } = await import('node:module');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
requireServer('reflect-metadata');
const { IntakeService } = requireServer('./dist/patients/intake.service.js');
const { RateLimitService } = requireServer('./dist/common/rate-limit.service.js');
const timed = async (fn) => { const t0 = performance.now(); const r = await fn(); return { r, ms: performance.now() - t0 }; };
const inEnv = (env) => async (fn) => {
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  try { return await fn(); } finally { if (was === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = was; }
};
const inProd = inEnv('production');
const inTest = inEnv('test');

/** IntakeService با دیتابیس و درگاهِ ساختگی — فقط همان چیزهایی که «ادامه با موبایل» و لینکِ ادامه لازم دارند. */
function fakeIntake({ open = true, smsDelay = 0, smsFail = false, recordPhone = '09120000000' } = {}) {
  const seen = { created: [], deleted: [], sent: [], reminders: 0 };
  const prisma = {
    intakeLink: { findUnique: async () => ({ id: 7, token: 'tok', active: true }) },
    intakeSubmission: { findFirst: async () => (open ? { id: 1, token: 'sub' } : null) },
    patient: { findFirst: async () => ({ phone: recordPhone }) },
    reminder: { create: async () => { seen.reminders++; return {}; } },
    otpCode: {
      findFirst: async () => null,
      create: async ({ data }) => { seen.created.push(data); return { id: 99, ...data }; },
      deleteMany: async ({ where }) => { seen.deleted.push(where); return { count: 1 }; },
    },
  };
  const deliver = async (to) => {
    seen.sent.push(to);
    await later(smsDelay);
    if (smsFail) throw new Error('درگاهِ ساختگی نپذیرفت');
    return { sent: true, stub: false };
  };
  const sms = { sendOtp: deliver, send: deliver };
  const tenant = { current: () => ({ tenantId: 't-in', hostname: 'in.test' }), require: () => ({ tenantId: 't-in', hostname: 'in.test' }) };
  const settings = { sms: async () => ({ formSendText: 'فرمِ {title}: {link}' }) };
  const svc = new IntakeService(prisma, undefined, undefined, undefined, undefined, undefined, undefined,
    sms, tenant, undefined, undefined, undefined, settings, undefined, new RateLimitService());
  return { svc, seen };
}

{
  /* PF3 — «ادامه با موبایل»: پاسخ منتظرِ درگاهِ پیامک نمی‌ماند، پس زمانش نمی‌گوید ثبت‌نامِ بازی هست یا نه. */
  const slow = fakeIntake({ open: true, smsDelay: 600 });
  const none = fakeIntake({ open: false });
  const a = await inProd(() => timed(() => slow.svc.resumeRequest('tok', '09120000001', '10.70.0.1')));
  const b = await inProd(() => timed(() => none.svc.resumeRequest('tok', '09120000002', '10.70.0.2')));
  ok(a.ms < 200, `PF3: ثبت‌نامِ باز + درگاهِ کند (۶۰۰ms) ← پاسخ در ${Math.round(a.ms)}ms`);
  ok(JSON.stringify(a.r) === JSON.stringify(b.r), 'PF3: پاسخِ «ثبت‌نامِ باز هست» و «نیست» یکی است', `${JSON.stringify(a.r)} / ${JSON.stringify(b.r)}`);
  await later(700);
  ok(slow.seen.created.length === 1 && slow.seen.sent.length === 1, 'PF3: کد در پس‌زمینه ساخته و پیامک شد');
  const broken = fakeIntake({ open: true, smsFail: true });
  await inProd(() => broken.svc.resumeRequest('tok', '09120000003', '10.70.0.3'));
  await later(60);
  ok(broken.seen.deleted.length === 1, 'PF3: پیامکِ نرفته ← کدش پاک شد (کدِ بعدی پشتِ پنجرهٔ یک‌دقیقه‌ای گیر نمی‌کند)');
}

{
  /* PF7 — سقفِ روزانهٔ لینک: ۱۵۱ ثبت‌نامِ ساختگی (هر کدام شماره و توکنِ خودش) روی یک لینک ← ۱۵۰ پیامک. */
  let n = 0;
  const box = fakeIntake({ recordPhone: '' });
  box.svc.prisma.patient.findFirst = async () => ({ phone: `0912${String(++n).padStart(7, '0')}` });
  const shown = [];
  for (let i = 1; i <= 151; i++) shown.push(await box.svc.sendContinueLink(1, `tok-${i}`, 'فرم', 7, `0912${String(i).padStart(7, '0')}`));
  await later(30);
  ok(box.seen.sent.length === 150 && shown[150] === null, `PF7: سقفِ روزانهٔ لینک — ۱۵۰ پیامک از ۱۵۱ ثبت‌نام (${box.seen.sent.length})، و پاسخِ آخری ادعای «پیامک شد» ندارد`);
}

/** AuthService روی یک دیتابیسِ درون‌حافظه‌ایِ کوچک — فقط جدول‌هایی که بازیابیِ رمز می‌خواند و می‌نویسد. */
const { AuthService } = requireServer('./dist/auth/auth.service.js');
const { JwtService } = requireServer('@nestjs/jwt');
process.env.JWT_SECRET ??= 'in-process-only-secret-with-more-than-32-chars';
const cond = (v, c) => {
  if (c === undefined) return true;
  if (c === null) return v === null || v === undefined;
  if (c instanceof Date || typeof c !== 'object') return v === c;
  if ('gt' in c) return v > c.gt;
  if ('lt' in c) return v < c.lt;
  return true;
};
const matches = (o, w) => Object.entries(w ?? {}).every(([k, c]) => cond(o[k], c));
function fakeAuth({ findDelay = 0, smsDelay = 0 } = {}) {
  const db = { otps: [], sent: [], passwords: [], passkeysDeleted: [], barrier: null };
  const account = {
    id: 41, username: 'inproc', status: 'active', level: 2, passwordHash: '$2a$12$fixture', jobRole: null,
    phoneVerifiedAt: new Date(), verificationDueAt: null, personId: 9,
    person: { id: 9, firstName: 'آزمونی', lastName: 'درون', phone: '09129990041', phoneScope: 'primary' },
  };
  let seq = 0;
  const otpCode = {
    findFirst: async ({ where }) => {
      const hit = db.otps.filter((o) => matches(o, where)).sort((a, b) => b.id - a.id)[0];
      const snapshot = hit ? { ...hit } : null; // خواندن مثلِ دیتابیس: عکسِ همان لحظه
      if (db.barrier) await db.barrier();
      return snapshot;
    },
    create: async ({ data }) => { const row = { id: ++seq, attempts: 0, consumedAt: null, createdAt: new Date(), ...data }; db.otps.push(row); return { ...row }; },
    update: async ({ where, data }) => { const o = db.otps.find((x) => x.id === where.id); if (data.attempts?.increment) o.attempts += data.attempts.increment; return { ...o }; },
    updateMany: async ({ where, data }) => {
      const rows = db.otps.filter((o) => matches(o, where));
      for (const o of rows) { if (data.attempts?.increment) o.attempts += data.attempts.increment; if (data.consumedAt) o.consumedAt = data.consumedAt; }
      return { count: rows.length };
    },
    deleteMany: async ({ where }) => { const before = db.otps.length; db.otps = db.otps.filter((o) => !matches(o, where)); return { count: before - db.otps.length }; },
  };
  const prisma = {
    otpCode,
    account: {
      findFirst: async ({ where }) => {
        await later(findDelay);
        const ids = (where?.OR ?? []).map((w) => w.username ?? w.person?.phone);
        return ids.includes(account.username) || ids.includes(account.person.phone) ? { ...account } : null;
      },
      update: async ({ data }) => { if (data.passwordHash) db.passwords.push(data.passwordHash); return { ...account }; },
    },
    session: { updateMany: async () => ({ count: 1 }) },
    webauthnCredential: { deleteMany: async ({ where }) => { db.passkeysDeleted.push(where); return { count: 2 }; } },
  };
  prisma.$transaction = async (fn) => fn(prisma);
  const sms = {
    sendOtp: async (phone, code, host, purpose) => { db.sent.push({ phone, code, host, purpose }); await later(smsDelay); return { sent: false, stub: true }; },
  };
  const tenant = { current: () => ({ tenantId: 't-in', hostname: 'in.test' }), require: () => ({ tenantId: 't-in', hostname: 'in.test' }) };
  const svc = new AuthService(prisma, new JwtService({ secret: process.env.JWT_SECRET }), sms, new RateLimitService(), tenant);
  return { svc, db, account };
}

{
  /* PF4 — شمارشِ تلاش اتمی: دو حدسِ هم‌زمان روی کدی که یک تلاش بیشتر ندارد. هر دو «۴ تلاش» را خوانده‌اند؛
     بی‌افزایشِ اتمی، دومی (با کدِ درست) هم مقایسه می‌شد — حدسِ ششم روی کدِ پنج‌تلاشی. */
  const { svc, db, account } = fakeAuth();
  const issued = await inTest(() => svc.requestPasswordReset(account.username, '10.80.0.1'));
  const code = issued?.devCode;
  ok(/^\d{6}$/.test(code ?? ''), 'PF4: کدِ درونِ فرایند صادر شد (محیطِ test)');
  db.otps.at(-1).attempts = 4;
  let waiting = [];
  db.barrier = () => new Promise((r) => { waiting.push(r); if (waiting.length === 2) { waiting.forEach((f) => f()); waiting = []; } });
  const other = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  const [a, b] = await Promise.allSettled([
    svc.resetPassword({ identifier: account.username, code: other, password: 'race-pass-1' }, { ip: '10.80.0.2' }),
    svc.resetPassword({ identifier: account.person.phone, code, password: 'race-pass-1' }, { ip: '10.80.0.3' }),
  ]);
  db.barrier = null;
  ok(a.status === 'rejected' && b.status === 'rejected' && db.passwords.length === 0,
    `PF4: حدسِ ششمِ هم‌زمان حتی با کدِ درست رد شد (${a.status}/${b.status}، رمزِ نوشته‌شده: ${db.passwords.length})`, b.reason?.message);
  ok(db.otps.at(-1).attempts <= 5, `PF4: شمارندهٔ تلاش از سقف رد نشد (${db.otps.at(-1).attempts})`);
}

{
  /* PF5 — درخواستِ کد: پاسخ منتظرِ یافتنِ حساب و ساختنِ کد نمی‌ماند؛ زمانش نمی‌گوید حساب هست یا نه. */
  const { svc, db, account } = fakeAuth({ findDelay: 300 });
  const hit = await inProd(() => timed(() => svc.requestPasswordReset(account.username, '10.81.0.1')));
  const miss = await inProd(() => timed(() => svc.requestPasswordReset(`nobody-in-${run}`, '10.81.0.1')));
  ok(hit.ms < 100 && miss.ms < 100, `PF5: پاسخِ حسابِ موجود ${Math.round(hit.ms)}ms و ناموجود ${Math.round(miss.ms)}ms — دیتابیسِ کند (۳۰۰ms) پشتِ پاسخ نیست`);
  ok(JSON.stringify(hit.r) === JSON.stringify(miss.r) && !hit.r?.devCode, 'PF5: هر دو پاسخ یکی و بی‌کد');
  await later(450);
  ok(db.otps.length === 1 && db.sent.length === 1, 'PF5: کد در پس‌زمینه ساخته و پیامک شد (فقط برای حسابِ موجود)');
  ok(db.sent[0]?.purpose === 'password-reset', `PF10: کدِ بازیابی با هدفِ خودش به درگاه می‌رود (${db.sent[0]?.purpose})`);
}

{
  /* PF10 — متنِ پیامکِ بازیابی: «به هیچ‌کس، حتی پشتیبانی، ندهید» + خطِ آخرِ WebOTP؛ کدِ ثبت‌نام همان متنِ قبلی. */
  const { SmsService } = requireServer('./dist/sms/sms.service.js');
  const env = { key: process.env.MELI_API_KEY, from: process.env.MELI_FROM, fetch: globalThis.fetch };
  const texts = [];
  process.env.MELI_API_KEY = 'in-process-key'; process.env.MELI_FROM = 'in-process-line';
  globalThis.fetch = async (_url, init) => { texts.push(JSON.parse(init.body).text); return { ok: true, status: 200, json: async () => ({ recIds: [3741437414] }) }; };
  try {
    await inTest(() => new SmsService().sendOtp('09121234567', '123456', 'clinic.amalyar.com', 'password-reset'));
    await inTest(() => new SmsService().sendOtp('09121234567', '654321', 'clinic.amalyar.com'));
  } finally {
    globalThis.fetch = env.fetch;
    if (env.key === undefined) delete process.env.MELI_API_KEY; else process.env.MELI_API_KEY = env.key;
    if (env.from === undefined) delete process.env.MELI_FROM; else process.env.MELI_FROM = env.from;
  }
  const [resetText, signupText] = texts;
  ok(/کدِ بازیابیِ رمزِ عمل‌یار: 123456/.test(resetText ?? '') && /حتی پشتیبانی، ندهید/.test(resetText ?? '') && /درخواست نکرده‌اید/.test(resetText ?? ''),
    'PF10: پیامکِ بازیابی می‌گوید کدِ چیست و آن را به هیچ‌کس ندهید', JSON.stringify(resetText));
  ok((resetText ?? '').endsWith('\n@clinic.amalyar.com #123456') && (signupText ?? '').endsWith('\n@clinic.amalyar.com #654321') && /کد تأیید شما 654321/.test(signupText ?? ''),
    'PF10: خطِ آخرِ WebOTP در هر دو سرِ جایش؛ پیامکِ ثبت‌نام همان متنِ قبلی');
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
