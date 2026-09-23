/**
 * پرسشِ امنیتیِ ثبت‌نام **سمتِ سرور** + سقفِ نرخ (تصمیمِ مالک، ۱۴۰۵/۰۷/۰۱: «کپچای واقعی»).
 * Real HTTP + Nest + Prisma + PGlite (`intake-captcha-local.mjs`). Only against an isolated local database.
 *
 * تا دیروز مرورگر خودش دو عدد را انتخاب می‌کرد و سرور فقط `a + b = پاسخ` را می‌سنجید؛ یک اسکریپت
 * با `1 + 1 = 2` ثبت‌نام می‌ساخت. قاعده‌ها در `server/src/patients/intake-captcha.ts`؛ صفحه را
 * `intake-captcha-ui.mjs` می‌سنجد.
 *
 *  باید بیفتد:
 *   - عددهای انتخابیِ مرورگر (`captchaA/B`) دیگر پذیرفته نمی‌شوند
 *   - پاسخِ غلط نشان را می‌سوزاند — همان نشان با پاسخِ درست هم رد می‌شود
 *   - نشانِ لینکِ دیگر، منقضی، دستکاری‌شده یا تکراری رد می‌شود
 *   - پرسش فقط برای لینکِ معتبر و فعال ساخته می‌شود
 *   - سقفِ نرخِ ثبت‌نام و پرسش به‌ازای نشانی؛ جعلِ خانهٔ اولِ `X-Forwarded-For` از سطل بیرون نمی‌برد
 *  نباید بیفتد:
 *   - غلطِ کدِ ملی نشان را نمی‌سوزاند (بیمار پرسش را دوباره جواب نمی‌دهد)
 *   - نشانیِ دیگر سطلِ خودش را دارد
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { captchaFor } from './lib/captcha.mjs';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { UsedChallenges, openChallenge, renderChallenge, sealChallenge, verifyChallenge } = require('./dist/patients/intake-captcha.js');

const API = process.env.E2E_API, DB = process.env.E2E_DB, SECRET = process.env.JWT_SECRET;
if (![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'cp' + randomBytes(3).toString('hex');
let count = 0, auth, seed = Number.parseInt(randomBytes(3).toString('hex'), 16);
const ok = (v, label, detail = '') => { assert.ok(v, `${label}${detail ? ' — ' + detail : ''}`); console.log('PASS ' + ++count + ' ' + label); };
const msg = (r) => JSON.stringify(r.data?.message ?? r.data);
async function api(path, body, method = body ? 'POST' : 'GET', token = auth, headers = {}) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
function nid(n) {
  const base = String(n % 1_000_000_000).padStart(9, '0');
  let sum = 0; for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
  const r = sum % 11; return base + String(r < 2 ? r : 11 - r);
}
const person = () => ({ firstName: 'بیمارِ', lastName: 'پرسش', nationalId: nid(++seed * 7919), phone: '0912' + String(1000000 + (++seed % 8999999)) });

try {
  auth = (await api('/auth/login', { identifier: 'admin', password: 'test1234' })).data.accessToken;
  assert.ok(auth, 'ورود');

  console.log('۰) نشان و تصویر (خالص)');
  const used = new UsedChallenges();
  const now = Date.now();
  const tok = sealChallenge(SECRET, { s: 'L1', a: 7, e: now + 60_000 });
  const o = openChallenge(SECRET, tok);
  ok(o?.a === 7 && o.s === 'L1' && o.e === now + 60_000, 'نشان با رازِ سرور باز می‌شود', JSON.stringify(o));
  ok(openChallenge('another-secret-that-is-long-enough-xx', tok) === null, 'با رازِ دیگر باز نمی‌شود');
  const [iv, ct, t] = tok.split('.');
  const flipped = [iv, Buffer.from(ct, 'base64url').map((b, i) => (i === 0 ? b ^ 1 : b)).toString('base64url'), t].join('.');
  ok(openChallenge(SECRET, flipped) === null && openChallenge(SECRET, 'x.y.z') === null && openChallenge(SECRET, 42) === null, 'نشانِ دستکاری‌شده/خراب باز نمی‌شود');
  ok(verifyChallenge(SECRET, used, 'L1', tok, 6, now) === 'wrong', 'پاسخِ غلط ← wrong');
  ok(verifyChallenge(SECRET, used, 'L1', tok, 7, now) === 'stale', '**همان نشان با پاسخِ درست هم رد می‌شود** — یک‌بار سنجیده می‌شود');
  ok(verifyChallenge(SECRET, used, 'L2', sealChallenge(SECRET, { s: 'L1', a: 7, e: now + 60_000 }), 7, now) === 'stale', 'نشانِ لینکِ دیگر ← stale');
  ok(verifyChallenge(SECRET, used, 'L1', sealChallenge(SECRET, { s: 'L1', a: 7, e: now - 1 }), 7, now) === 'stale', 'نشانِ منقضی ← stale');
  const good = sealChallenge(SECRET, { s: 'L1', a: 7, e: now + 60_000 });
  ok(verifyChallenge(SECRET, used, 'L1', good, ' 7 ', now) === 'ok' && verifyChallenge(SECRET, used, 'L1', good, 7, now) === 'stale', 'درست ← ok؛ تکرار ← stale');
  const png = renderChallenge(3, 5);
  ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.readUInt32BE(16) === 360 && png.readUInt32BE(20) === 128 && png[25] === 0,
    'تصویر PNGِ خاکستریِ ۳۶۰×۱۲۸ است');
  ok(!renderChallenge(3, 5).equals(png), 'هر بار تصویرِ دیگری (چرخش، موج، نویز)');

  await db.setting.upsert({ where: { key: 'vertical' }, create: { key: 'vertical', value: 'ionm' }, update: { value: 'ionm' } });
  const mk = async (title) => { const r = await api('/intake/links', { title: title + tag, amount: 0 }); assert.ok(r.status < 300, msg(r)); return r.data.token; };
  const L = await mk('پرسش '), L2 = await mk('دیگر ');
  const reg = (token, body, headers) => api(`/public/intake/link/${token}/register`, body, 'POST', null, headers);

  console.log('\n۱) ساختِ پرسش');
  let r = await api(`/public/intake/link/${L}/captcha`, undefined, 'GET', null);
  const opened = openChallenge(SECRET, r.data?.challenge);
  ok(r.status === 200 && /^data:image\/png;base64,/.test(r.data.image) && opened?.s === L && opened.a >= 2 && opened.a <= 18,
    'لینکِ معتبر: تصویر + نشانِ بسته به همین لینک، پاسخ ۲ تا ۱۸', `${r.status} ${JSON.stringify(opened)}`);
  ok(!JSON.stringify(r.data).includes(`"${opened.a}"`) && !('answer' in r.data) && !('a' in r.data), 'پاسخ در پاسخِ HTTP نیست');
  r = await api(`/public/intake/link/nope${tag}/captcha`, undefined, 'GET', null);
  ok(r.status === 404, 'لینکِ ناموجود ← ۴۰۴', String(r.status));
  const off = await mk('خاموش ');
  await db.intakeLink.update({ where: { token: off }, data: { active: false } });
  r = await api(`/public/intake/link/${off}/captcha`, undefined, 'GET', null);
  ok(r.status === 403, 'لینکِ غیرفعال ← ۴۰۳', String(r.status));

  console.log('\n۲) ثبت‌نام');
  r = await reg(L, { ...person(), captchaA: 1, captchaB: 1, captchaAnswer: 2 });
  ok(r.status === 400 && /پرسشِ امنیتی/.test(msg(r)), '**عددهای انتخابیِ مرورگر دیگر پذیرفته نمی‌شوند**', `${r.status} ${msg(r)}`);
  let c = await captchaFor(API, L);
  r = await reg(L, { ...person(), captchaToken: c.captchaToken, captchaAnswer: c.captchaAnswer + 1 });
  ok(r.status === 422 && /درست نیست/.test(msg(r)), 'پاسخِ غلط ← ۴۲۲', `${r.status} ${msg(r)}`);
  r = await reg(L, { ...person(), ...c });
  ok(r.status === 422 && /منقضی/.test(msg(r)), '**پاسخِ غلط نشان را سوزاند** — همان نشان با پاسخِ درست هم رد', `${r.status} ${msg(r)}`);
  c = await captchaFor(API, L);
  r = await reg(L2, { ...person(), ...c });
  ok(r.status === 422, 'نشانِ لینکِ دیگر رد می‌شود', `${r.status} ${msg(r)}`);
  r = await reg(L, { ...person(), captchaToken: sealChallenge(SECRET, { s: L, a: 5, e: Date.now() - 1000 }), captchaAnswer: 5 });
  ok(r.status === 422 && /منقضی/.test(msg(r)), 'نشانِ منقضی رد می‌شود', `${r.status} ${msg(r)}`);
  c = await captchaFor(API, L);
  r = await reg(L, { ...person(), nationalId: '1111111111', ...c });
  ok(r.status === 400 && /کدِ ملی/.test(msg(r)), 'کدِ ملیِ نامعتبر ← ۴۰۰ (پیش از پرسش)', `${r.status} ${msg(r)}`);
  r = await reg(L, { ...person(), ...c });
  ok(r.status === 201 && r.data?.token, '**غلطِ کدِ ملی نشان را نسوزاند** — همان پاسخ پذیرفته شد', `${r.status} ${msg(r)}`);
  r = await reg(L, { ...person(), ...c });
  ok(r.status === 422, 'نشانِ مصرف‌شده دوباره پذیرفته نمی‌شود', `${r.status} ${msg(r)}`);

  console.log('\n۳) سقفِ نرخ');
  const ipA = { 'X-Forwarded-For': '10.9.0.1' }, ipB = { 'X-Forwarded-For': '10.9.0.2' };
  /* بدنهٔ خوش‌فرم با نشانِ جعلی — همان چیزی که یک اسکریپت می‌فرستد (بدنهٔ بدشکل را `ValidationPipe`
     پیش از سرویس رد می‌کند و کاری به دیتابیس نمی‌رسد). */
  const junk = () => ({ ...person(), captchaToken: 'x.y.z', captchaAnswer: 7 });
  for (let i = 0; i < 30; i++) await reg(L, junk(), ipA);
  r = await reg(L, junk(), ipA);
  ok(r.status === 429, '**سیویکمین تلاش در ده دقیقه ← ۴۲۹** (تلاشِ غلط هم شمرده می‌شود)', String(r.status));
  r = await reg(L, junk(), { 'X-Forwarded-For': '1.2.3.4, 10.9.0.1' });
  ok(r.status === 429, '**جعلِ خانهٔ اولِ X-Forwarded-For از سطل بیرون نمی‌برد**', String(r.status));
  r = await reg(L, junk(), ipB);
  ok(r.status === 422, 'نشانیِ دیگر سطلِ خودش را دارد', String(r.status));
  for (let i = 0; i < 60; i++) await api(`/public/intake/link/${L}/captcha`, undefined, 'GET', null, { 'X-Forwarded-For': '10.9.1.1' });
  r = await api(`/public/intake/link/${L}/captcha`, undefined, 'GET', null, { 'X-Forwarded-For': '10.9.1.1' });
  ok(r.status === 429, 'ساختِ پرسش هم سقف دارد (هر تصویر CPU است)', String(r.status));

  console.log(`\n${count} سنجه سبز`);
} finally {
  await db.$disconnect().catch(() => undefined);
}
