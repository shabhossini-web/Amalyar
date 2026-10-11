/**
 * بازگردانی روی سرورِ تازه — `server/src/scripts/rehost-tenants.ts` روی دیتابیسِ مرکزیِ واقعی (بازبینیِ ۱۴۰۵/۰۷/۱۹).
 *
 * نشانیِ دیتابیسِ هر شرکت (با میزبانِ Postgres) رمزشده در `tenants.database_url_encrypted` است؛ پس از بازگردانی روی
 * Postgresِ تازه، بی‌این ابزار همهٔ شرکت‌ها به سرورِ مرده وصل می‌شدند. میزبانِ «تازه» این‌جا همان Postgres است با نامی
 * دیگر (`localhost` ↔ `127.0.0.1`)، پس اتصال واقعاً سنجیده می‌شود.
 *
 *  باید بیفتد: پیش‌نمایش هیچ چیز نمی‌نویسد · میزبانِ دردسترس‌نبوده (درگاهِ غلط) حتی با `--apply` دست نمی‌خورد ·
 *              `--apply` نشانی را عوض می‌کند و شرکت همچنان باز می‌شود · کلیدِ رمزنگاریِ دیگر «رمزگشایی نشد» و بی‌تغییر
 *  نباید بیفتد: خروجی هرگز نشانیِ کامل یا رمزِ نقش را چاپ نمی‌کند · برگشت به میزبانِ اول همه را مثلِ قبل می‌کند
 */
import { spawnSync, execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.E2E_API ?? 'http://127.0.0.1:3009/api';
const CTRL = process.env.E2E_CTRL_DB;
const CONTROL_URL = process.env.CONTROL_DATABASE_URL;
if (!CTRL || !CONTROL_URL || !process.env.TENANT_DATABASE_ENCRYPTION_KEY) {
  console.log('E2E_CTRL_DB و CONTROL_DATABASE_URL و TENANT_DATABASE_ENCRYPTION_KEY لازم است'); process.exit(1);
}

let pass = 0; const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fails.push(m); console.log('  ✘ ' + m + (d ? ' — ' + String(d).slice(0, 500) : '')); } };
const sql = (q) => execSync(`psql "${CTRL}" -v ON_ERROR_STOP=1 -qAtc ${JSON.stringify(q)}`, { encoding: 'utf8' }).trim();
const enc = () => sql("SELECT string_agg(slug || '=' || database_url_encrypted, ' ' ORDER BY slug) FROM tenants");
const tool = (args = [], env = {}) => {
  const r = spawnSync('node', [resolve(root, 'server/dist/scripts/rehost-tenants.js'), ...args], {
    cwd: resolve(root, 'server'), encoding: 'utf8', env: { ...process.env, PROVISIONING_DATABASE_URL: '', ...env },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const leaks = (out) => /postgres(ql)?:\/\//.test(out) || /:[^@\s/]+@/.test(out);

const u = new URL(CONTROL_URL);
const port = u.port || '5432';
const first = `${u.hostname}:${port}`;
const other = `${u.hostname === 'localhost' ? '127.0.0.1' : 'localhost'}:${port}`;
const before = enc();
const n = Number(sql('SELECT count(*) FROM tenants'));
console.log(`شرکت‌ها: ${n} · میزبانِ فعلی ${first} · میزبانِ «تازه» ${other}`);

console.log('\n۱) پیش‌نمایش');
let r = tool([], { TARGET_DATABASE_HOST: other });
ok(r.code === 0 && (r.out.match(/وصل شد \(هنوز نوشته نشده\)/g) ?? []).length === n, `هر ${n} شرکت با میزبانِ تازه وصل شد`, r.out);
ok(enc() === before, '**پیش‌نمایش هیچ چیز ننوشت**');
ok(!leaks(r.out), 'خروجی نشانیِ کامل یا رمز ندارد', r.out);

console.log('\n۲) میزبانِ دردسترس‌نبوده — حتی با --apply دست نمی‌خورد');
r = tool(['--apply'], { TARGET_DATABASE_HOST: `${other.split(':')[0]}:5999` });
ok(r.code === 1 && /وصل نشد/.test(r.out) && /دست نخورد/.test(r.out), 'کدِ ۱ و «دست نخورد»', r.out);
ok(enc() === before, '**هیچ نشانی‌ای به میزبانِ مرده نوشته نشد**');

console.log('\n۳) کلیدِ رمزنگاریِ دیگر');
r = tool([], { TARGET_DATABASE_HOST: other, TENANT_DATABASE_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
ok(r.code === 1 && /رمزگشایی نشد/.test(r.out) && /TENANT_DATABASE_ENCRYPTION_KEY/.test(r.out), 'می‌گوید کلید همان مقدارِ قبلی نیست', r.out);
ok(enc() === before, 'بی‌تغییر');

console.log('\n۴) نوشتن — و شرکت همچنان باز می‌شود');
r = tool(['--apply'], { TARGET_DATABASE_HOST: other });
ok(r.code === 0 && new RegExp(`${n} شرکت به ${other.replace(/[.]/g, '\\.')} برگشت`).test(r.out), 'نوشته شد', r.out);
ok(enc() !== before, 'نشانیِ رمزشده عوض شد');
ok(!leaks(r.out), 'خروجی نشانیِ کامل یا رمز ندارد');
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }) });
ok(login.status === 200 || login.status === 201, '**شرکت پس از تغییرِ نشانی باز می‌شود** (ورود)', String(login.status));
r = tool([], { TARGET_DATABASE_HOST: other });
ok(r.code === 0 && (r.out.match(/از قبل روی/g) ?? []).length === n, 'اجرای دوباره: «از قبل روی» میزبانِ تازه (idempotent)', r.out);

console.log('\n۵) برگشت به میزبانِ اول');
r = tool(['--apply'], { TARGET_DATABASE_HOST: first });
ok(r.code === 0, 'برگشت نوشته شد', r.out);
r = tool([], { TARGET_DATABASE_HOST: first });
ok((r.out.match(/از قبل روی/g) ?? []).length === n, 'همه دوباره روی میزبانِ اول‌اند', r.out);

console.log(`\nسبز: ${pass}  قرمز: ${fails.length}`);
if (fails.length) process.exit(1);
