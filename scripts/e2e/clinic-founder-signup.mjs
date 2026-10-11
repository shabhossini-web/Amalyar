/**
 * بنیان‌گذارِ مطبی که Worker پیش از اولین ورود «مطب» کرده — پزشکِ کامل، نه نصفه (بازبینیِ ۱۴۰۵/۰۷/۱۹).
 *
 * از وقتی فرمِ «شرکتِ جدید» نوعِ نصب را می‌گیرد، `seedTenantProfile` پیش از هر حسابی `vertical=clinic` می‌نویسد؛ پس
 * شاخهٔ «اولین حسابِ مطب = پزشک»ِ `completeSignup` برای هر مطبِ تازه زنده شد. آن شاخه `jobRole='doctor'` می‌داد ولی
 * تعریفِ جراح نمی‌ساخت — همان نیمه‌کاری که `promoteSoleFounder` و `setJobRole` قبلاً درس گرفته بودند: صاحبِ مطب در
 * کشویِ اجباریِ «پزشک»ِ فرمِ ویزیت (`GET /surgeons`) نبود و اولین ویزیتش ثبت نمی‌شد.
 *
 *  باید بیفتد: اولین ثبت‌نامِ مطب ← سوپرادمینِ فعال + `jobRole=doctor` + تعریفِ جراحِ فعالِ همان شخص + **در `GET /surgeons`**
 *  نباید بیفتد: حسابِ دوم (در انتظار) پزشک نمی‌شود و تعریفِ جراحِ دومی ساخته نمی‌شود
 *
 * دیتابیس باید بی‌حساب باشد؛ زیرِ رانر (`E2E_DB`) خالی می‌شود و بعدش دور ریخته می‌شود — همان الگوی `tenant-seo`.
 */
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://127.0.0.1:3009/api';
const DB = process.env.E2E_DB;
if (!DB) { console.log('E2E_DB لازم است (این سوییت جدولِ حساب‌ها را خالی می‌کند)'); process.exit(1); }
const sql = (q) => execSync(`psql "${DB}" -v ON_ERROR_STOP=1 -qAtc ${JSON.stringify(q)}`, { encoding: 'utf8' }).trim();
sql('TRUNCATE accounts CASCADE');
/* همان ردیفی که `seedTenantProfile('clinic')` پیش از اولین حساب می‌نویسد. */
sql(`INSERT INTO settings (key, value) VALUES ('vertical', 'clinic') ON CONFLICT (key) DO UPDATE SET value = 'clinic'`);

let pass = 0; const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fails.push(m); console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

async function j(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
async function signup(phone, username, firstName) {
  const r1 = await j('/auth/signup/request-otp', { method: 'POST', body: { phone } });
  const code = r1.data?.devCode;
  if (!code) throw new Error(`کدِ آزمایشی نیامد: ${JSON.stringify(r1.data)}`);
  const r2 = await j('/auth/signup/verify-otp', { method: 'POST', body: { phone, code } });
  const signupToken = r2.data?.signupToken;
  if (!signupToken) throw new Error(`نشانِ ثبت‌نام نیامد: ${JSON.stringify(r2.data)}`);
  return j('/auth/signup/complete', { method: 'POST', body: {
    signupToken, firstName, lastName: 'آزمون', username, password: 'Passw0rd!', selfie: 'data:image/png;base64,' + 'A'.repeat(64),
  } });
}

console.log('۱) اولین ثبت‌نامِ مطبِ تازه');
const first = await signup('09120000051', 'clinicfounder', 'بنیان‌گذار');
ok(first.status === 201 || first.status === 200, 'ثبت‌نام پذیرفته شد', `status=${first.status}`);
const login = await j('/auth/login', { method: 'POST', body: { identifier: 'clinicfounder', password: 'Passw0rd!' } });
const token = login.data?.accessToken;
ok(!!token, 'ورود', `status=${login.status}`);
const me = await j('/auth/me', { token });
ok(me.data?.level === 6 && me.data?.status === 'active', 'اولین حساب سوپرادمینِ فعال است');
ok(me.data?.jobRole === 'doctor', 'و در مطب «پزشک» است');
const personId = Number(sql(`SELECT person_id FROM accounts WHERE username = 'clinicfounder'`));
const surgeonRow = sql(`SELECT coalesce(string_agg(id::text || ':' || active::text, ','), '') FROM surgeons WHERE person_id = ${personId}`);
ok(/^\d+:true$/.test(surgeonRow), '**تعریفِ جراحِ فعال برای همان شخص ساخته شد** (هم‌تراکنش با ثبت‌نام)', surgeonRow || 'هیچ');
const surgeons = await j('/surgeons', { token });
const list = Array.isArray(surgeons.data) ? surgeons.data : surgeons.data?.items ?? [];
ok(list.some((s) => s.personId === personId), '**بنیان‌گذار در `GET /surgeons` هست** — کشویِ اجباریِ «پزشک»ِ فرمِ ویزیت خالی نیست', `status=${surgeons.status} n=${list.length}`);

console.log('\n۲) حسابِ دوم — پزشک نمی‌شود');
const second = await signup('09120000052', 'clinicsecond', 'دوم');
ok(second.status === 201 || second.status === 200, 'ثبت‌نامِ دوم پذیرفته شد (در انتظار)', `status=${second.status}`);
ok(sql(`SELECT coalesce(job_role,'-') || '|' || status FROM accounts WHERE username = 'clinicsecond'`) === '-|pending', 'حسابِ دوم نقشِ پزشک نگرفت و در انتظار است');
ok(sql(`SELECT count(*) FROM surgeons s JOIN accounts a ON a.person_id = s.person_id WHERE a.username = 'clinicsecond'`) === '0', 'برای حسابِ دوم تعریفِ جراح ساخته نشد');

console.log(`\nسبز: ${pass}  قرمز: ${fails.length}`);
if (fails.length) process.exit(1);
