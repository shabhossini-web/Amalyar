/**
 * احرازِ کوکیِ HttpOnly + CSRF + چندحسابیِ سمتِ سرور — روی سرورِ زندهٔ محلی.
 *
 * ادعاها:
 *  - ورودِ مرورگری کوکیِ HttpOnly می‌گذارد و توکن برای کلاینتِ Bearer هم برمی‌گردد
 *  - با کوکی، GET بدونِ CSRF می‌گذرد ولی POST بدونِ هدرِ CSRF ۴۰۳ می‌گیرد؛ با هدر می‌گذرد
 *  - Bearer بدونِ CSRF مجاز است (کلاینتِ غیرمرورگری)
 *  - دو ورودِ «به خاطر بسپار» → /auth/accounts هر دو را می‌دهد؛ /auth/switch حسابِ فعال را عوض می‌کند
 *  - خروجِ حسابِ فعال به حسابِ بعدی می‌افتد؛ logout-all همه را باطل و کوکی‌ها را پاک می‌کند
 *  - نشستِ باطل‌شده با کوکیِ قدیمی ۴۰۱ است
 *  - ورودِ بدونِ remember کوکیِ نشستِ مرورگر می‌گذارد (بدونِ Max-Age) و در مجموعه نمی‌نشیند
 */
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

/** جارِ کوکیِ کوچک — مثلِ مرورگر: هر Set-Cookie جایگزینِ قبلیِ هم‌نام؛ Max-Age=0 حذف. */
class Jar {
  constructor() { this.c = new Map(); this.meta = new Map(); }
  absorb(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim());
      const [k, ...v] = pair.split('=');
      const a = Object.fromEntries(attrs.map((x) => { const [n, ...r] = x.split('='); return [n.toLowerCase(), r.join('=') || true]; }));
      if (a['max-age'] === '0' || (a.expires && new Date(a.expires) < new Date())) { this.c.delete(k); this.meta.delete(k); continue; }
      this.c.set(k, v.join('=')); this.meta.set(k, a);
    }
  }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join('; '); }
  get(k) { return this.c.get(k) ?? null; }
}

const call = async (jar, path, { method = 'GET', body, csrf = true, bearer } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (jar) headers.Cookie = jar.header();
  if (jar && csrf && jar.get('amalyar_csrf')) headers['X-CSRF-Token'] = jar.get('amalyar_csrf');
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  jar?.absorb(res);
  return { status: res.status, json: await res.json().catch(() => null), res };
};

// ── ورودِ مرورگری ──────────────────────────────────────────────
const jar = new Jar();
const login = await call(jar, '/auth/login', { method: 'POST', body: { identifier: 'admin', password: 'test1234', remember: true } });
ok(login.status === 201 || login.status === 200, `ورود ${login.status}`);
ok(!!jar.get('amalyar_session') && jar.meta.get('amalyar_session')?.httponly === true, 'کوکیِ نشست HttpOnly گذاشته شد');
ok(!!jar.get('amalyar_sessions') && jar.meta.get('amalyar_sessions')?.httponly === true, 'کوکیِ مجموعهٔ چندحسابی HttpOnly گذاشته شد');
ok(!!jar.get('amalyar_csrf') && !jar.meta.get('amalyar_csrf')?.httponly, 'کوکیِ CSRF خواندنی است');
ok(jar.meta.get('amalyar_session')?.samesite?.toLowerCase() === 'lax', 'SameSite=Lax');
ok(!!jar.meta.get('amalyar_session')?.['max-age'], 'با «به خاطر بسپار» کوکی ماندگار است (Max-Age)');
ok(typeof login.json?.accessToken === 'string', 'توکن برای کلاینتِ Bearer هم در بدنه برمی‌گردد');
const bearer = login.json.accessToken;

// ── کوکی: خواندن آزاد، نوشتن فقط با CSRF ────────────────────────
const me = await call(jar, '/auth/me');
ok(me.status === 200 && me.json?.username === 'admin', 'GET /auth/me با کوکی (بدونِ هدر) کار می‌کند');
const noCsrf = await call(jar, '/auth/profile', { method: 'PATCH', body: { firstName: 'مدیر' }, csrf: false });
ok(noCsrf.status === 403, `PATCH با کوکی و بدونِ CSRF رد می‌شود (${noCsrf.status})`);
const withCsrf = await call(jar, '/auth/profile', { method: 'PATCH', body: { firstName: 'مدیر' } });
ok(withCsrf.status === 200, `همان PATCH با هدرِ CSRF می‌گذرد (${withCsrf.status})`);
const badCsrf = await fetch(API + '/auth/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: jar.header(), 'X-CSRF-Token': 'wrong' }, body: '{"firstName":"x"}' });
ok(badCsrf.status === 403, 'نشانِ غلط رد می‌شود');

// ── Bearer بدونِ CSRF (اسکریپت‌ها) ─────────────────────────────
const viaBearer = await call(null, '/auth/profile', { method: 'PATCH', body: { firstName: 'مدیر' }, bearer });
ok(viaBearer.status === 200, 'Bearer بدونِ CSRF مجاز است');

// ── چندحسابی: حسابِ دوم ─────────────────────────────────────────
// حسابِ دوم از مسیرِ واقعیِ ثبت‌نام (OTPِ stub در NODE_ENV=test) + تأییدِ سوپرادمین.
const uname = 'e2esecond';
let secondReady = false;
{
  const probe = await call(null, '/auth/login', { method: 'POST', body: { identifier: uname, password: 'test1234' } });
  if (probe.status < 300) secondReady = true;
  else {
    // شمارهٔ تازه در هر اجرا — محدودیتِ ۳ کد در ۱۵ دقیقه به‌ازای هر شماره.
    const phone = `0912${String(Date.now()).slice(-7)}`;
    const otp = await call(null, '/auth/signup/request-otp', { method: 'POST', body: { phone } });
    const code = otp.json?.devCode;
    if (!code) console.log('  ⚠ request-otp:', otp.status, JSON.stringify(otp.json)?.slice(0, 120));
    if (code) {
      const ver = await call(null, '/auth/signup/verify-otp', { method: 'POST', body: { phone, code } });
      const selfie = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const done = await call(null, '/auth/signup/complete', { method: 'POST', body: { signupToken: ver.json?.signupToken, firstName: 'حسابِ', lastName: 'دوم', username: uname, password: 'test1234', selfie } });
      const id = done.json?.user?.id;
      if (!id) console.log('  ⚠ complete:', done.status, JSON.stringify(done.json)?.slice(0, 160));
      if (id) {
        const appr = await call(null, `/accounts/${id}/approve`, { method: 'POST', body: { level: 5 }, bearer });
        if (appr.status >= 300) console.log('  ⚠ approve:', appr.status, JSON.stringify(appr.json)?.slice(0, 120));
        secondReady = appr.status < 300;
      }
    }
  }
  ok(secondReady, 'حسابِ دوم آماده است (ثبت‌نام + تأیید)');
}
const second = await call(jar, '/auth/login', { method: 'POST', body: { identifier: uname, password: 'test1234', remember: true } });
if (second.status >= 300) {
  console.log('  ⚠ ورودِ حسابِ دوم ممکن نشد — بخشِ چندحسابی با همان حسابِ اول ادامه می‌یابد:', second.json?.message);
}
const accounts = await call(jar, '/auth/accounts');
ok(accounts.status === 200 && Array.isArray(accounts.json), 'GET /auth/accounts فهرست می‌دهد');
const ids = (accounts.json ?? []).map((a) => a.id);
const active = (accounts.json ?? []).find((a) => a.active);
ok(!!active, 'یکی از حساب‌ها فعال است');
if (ids.length >= 2) {
  const other = (accounts.json).find((a) => !a.active);
  const sw = await call(jar, '/auth/switch', { method: 'POST', body: { accountId: other.id } });
  ok(sw.status === 201 || sw.status === 200, `سوییچ به حسابِ دیگر (${sw.status})`);
  const me2 = await call(jar, '/auth/me');
  ok(me2.json?.id === other.id, 'حسابِ فعال بعد از سوییچ عوض شد');
  const swNoCsrf = await call(jar, '/auth/switch', { method: 'POST', body: { accountId: active.id }, csrf: false });
  ok(swNoCsrf.status === 403, 'سوییچ بدونِ CSRF رد می‌شود');
  // خروجِ حسابِ فعال → به حسابِ بعدی می‌افتد
  const out = await call(jar, '/auth/logout', { method: 'POST', body: {} });
  ok(out.json?.next?.id && out.json.next.id !== other.id, 'خروجِ حسابِ فعال، حسابِ بعدی را فعال می‌کند');
  const me3 = await call(jar, '/auth/me');
  ok(me3.status === 200 && me3.json?.id === out.json.next.id, 'کوکیِ تازه به حسابِ بعدی اشاره می‌کند');
} else {
  console.log('  ⚠ فقط یک حساب — ادعاهای سوییچ رد نشد، اجرا نشد');
}

// ── نشستِ باطل‌شده ────────────────────────────────────────────
const stale = new Jar(); stale.c = new Map(jar.c); stale.meta = new Map(jar.meta);
const all = await call(jar, '/auth/logout-all', { method: 'POST' });
ok(all.status === 201 || all.status === 200, 'logout-all');
ok(!jar.get('amalyar_session') && !jar.get('amalyar_sessions'), 'کوکی‌ها بعد از logout-all پاک شدند');
const dead = await call(stale, '/auth/me');
ok(dead.status === 401, 'کوکیِ قدیمی بعد از ابطال ۴۰۱ است');
const deadBearer = await call(null, '/auth/me', { bearer });
ok(deadBearer.status === 401, 'Bearerِ همان نشست هم باطل شده');

// ── ورودِ بدونِ remember ───────────────────────────────────────
const tmp = new Jar();
await call(tmp, '/auth/login', { method: 'POST', body: { identifier: 'admin', password: 'test1234', remember: false } });
ok(!!tmp.get('amalyar_session') && !tmp.meta.get('amalyar_session')?.['max-age'], 'بدونِ remember کوکیِ نشستِ مرورگر است (بی‌Max-Age)');
ok(!tmp.get('amalyar_sessions'), 'ورودِ موقت در مجموعهٔ چندحسابی نمی‌نشیند');
await call(tmp, '/auth/logout', { method: 'POST', body: {} });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
