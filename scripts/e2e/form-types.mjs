/**
 * فرم‌سازِ **نیمه‌بسته** — کاتالوگِ نوعِ فرم (بازخوردِ مالک ۱۴۰۵/۰۶/۳۰، بستهٔ ۲الف).
 *
 * تصمیمِ مالک: «نیمه‌بسته بذار». تا دیروز پالتِ فرم‌ساز یک آرایهٔ **تخت** در JSX
 * بود و هر چهارده نوعِ باکس روی هر فرمی، بدونِ هیچ نشانه‌ای از اینکه کدام به این
 * فرم می‌خورد؛ و کارتِ فرم «مراجعه» + کلیدِ خامِ انگلیسیِ `surgery` را کنارِ هم
 * می‌گذاشت، نه «فرمِ عمل».
 *
 * ⚠️ **و یک درسِ گران‌تر:** نسخهٔ اولِ همین بسته باکسِ پرداخت را روی فرمِ مراجعه
 * از سرور رد می‌کرد. غلط بود — `resolveLinkRefs` هر فرمی را به یک `IntakeLink`
 * می‌بندد، پس فرمِ مراجعه هم واقعاً پول می‌گیرد. سه سوییتِ رگرسیون
 * (`forms-api`، `forms-validate`، `forms-boxes`) همان لحظه قرمز شدند. پس
 * کاتالوگ **راهنماست نه قفل**، و این سوییت دقیقاً همین را قفل می‌کند.
 *
 *  باید بیفتد:
 *   - `GET /forms/types` کاتالوگ را می‌دهد و هر نوع `label`/`payment`/`boxes`/`approval`/`sections` دارد
 *   - هر فرمِ واقعی نوعِ نام‌دار پیدا می‌کند — با `visit_kind` و بی آن
 *   - مرحلهٔ تأیید به‌ازای نوع فرق می‌کند (ویزیتِ مطب بیمارستان و کارشناس نمی‌خواهد)
 *  نباید بیفتد:
 *   - کاتالوگ هیچ باکسی را **رد** کند — نه پرداخت روی مراجعه، نه چیزِ دیگر
 *   - فرمی به نوعِ سخت‌گیرترِ اشتباه بیفتد (مراجعهٔ بی‌نوع «زیرپرونده» خوانده شود)
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: A, body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'ft' + randomBytes(3).toString('hex');
const trash = [];

try {
  console.log('۱) کاتالوگ از سرور می‌آید');
  const types = (await send('/forms/types')).json;
  ok('`GET /forms/types` فهرست می‌دهد', Array.isArray(types) && types.length >= 7, String(types?.length));
  const byKey = Object.fromEntries((types ?? []).map((t) => [t.key, t]));
  for (const k of ['intake.surgery', 'intake.clinic', 'intake', 'visit.surgery', 'visit.clinic', 'visit', 'record']) {
    ok(`نوعِ «${k}» تعریف شده`, !!byKey[k], Object.keys(byKey).join('،'));
  }
  const shape = (t) => t && typeof t.label === 'string' && typeof t.hint === 'string'
    && Array.isArray(t.boxes) && Array.isArray(t.approval) && Array.isArray(t.sections)
    && ['required', 'optional', 'never'].includes(t.payment);
  ok('هر نوع label/hint/boxes/approval/sections/payment دارد', (types ?? []).every(shape));
  ok('**فرمِ ثبت‌نام «پرداخت‌دار» و فرمِ عمل «معمولاً بی‌پرداخت» برچسب می‌خورد** — تفکیکی که خواسته شد',
    byKey['intake.surgery']?.payment === 'required' && byKey['visit.surgery']?.payment === 'never',
    JSON.stringify([byKey['intake.surgery']?.payment, byKey['visit.surgery']?.payment]));
  ok('مرحلهٔ تأییدِ ویزیتِ مطب بیمارستان و کارشناس نمی‌خواهد، ولی عمل می‌خواهد',
    !byKey['visit.clinic']?.approval.includes('hospitalId')
    && byKey['visit.surgery']?.approval.includes('hospitalId')
    && byKey['visit.surgery']?.approval.includes('techId'),
    JSON.stringify([byKey['visit.clinic']?.approval, byKey['visit.surgery']?.approval]));

  console.log('\n۲) کاتالوگ راهنماست، نه قفل');
  const visitForm = (await send('/forms', 'POST', { key: `v${tag}`, title: 'فرمِ عملِ آزمون', scope: 'visit', visitKind: 'surgery' })).json;
  if (!visitForm?.id) throw new Error('فرمِ مراجعه ساخته نشد: ' + JSON.stringify(visitForm).slice(0, 160));
  trash.push(visitForm.id);
  /* ⚠️ سنجهٔ کلیدیِ همین بسته: نسخهٔ اول این را ۴۰۰ می‌کرد و سه سوییتِ دیگر را شکست. */
  const payOnVisit = await send(`/forms/${visitForm.id}/fields`, 'POST', { key: `pay${tag}`, label: 'پرداخت', type: 'payment' });
  ok('**باکسِ پرداخت روی فرمِ مراجعه پذیرفته می‌شود** — هر فرمی می‌تواند به لینکِ ثبت‌نام بسته شود',
    payOnVisit.status < 300, `${payOnVisit.status} ${payOnVisit.json?.message ?? ''}`);
  for (const [type, label] of [['text', 'متن'], ['date', 'تاریخ'], ['image', 'عکس'], ['rating', 'امتیاز'], ['links', 'لینک']]) {
    const r = await send(`/forms/${visitForm.id}/fields`, 'POST', { key: `${type}${tag}`, label, type });
    ok(`باکسِ «${label}» پذیرفته می‌شود`, r.status < 300, `${r.status} ${r.json?.message ?? ''}`);
  }
  const pay2 = await send(`/forms/${visitForm.id}/fields`, 'POST', { key: `pay2${tag}`, label: 'پرداختِ دوم', type: 'payment' });
  ok('ولی قاعدهٔ **یک** باکسِ پرداخت در هر فرم سرِ جایش است', pay2.status === 400, String(pay2.status));

  console.log('\n۳) هر فرمِ واقعی نوعِ نام‌دار پیدا می‌کند');
  /* ⚠️ سناریوی واقعی: `createForm` برای فرمِ مراجعه `visitKind` را **از کلید**
     می‌سازد، و مالک عمداً می‌تواند نوعِ تازه بسازد («ساختنِ فرم = ساختنِ یک نوعِ
     تازهٔ مراجعه»). پس نوعی می‌آید که در کاتالوگ نیست — و نباید به سخت‌گیرترین
     ردیف بیفتد. نسخهٔ اولِ کاتالوگ همین‌جا «فرمِ زیرپرونده» می‌گفت و سه سوییت
     را شکست. */
  const bare = (await send('/forms', 'POST', { key: `b${tag}`, title: 'نوعِ تازهٔ مراجعه', scope: 'visit' })).json;
  trash.push(bare.id);
  const bareKind = sql(`SELECT coalesce(visit_kind,'NULL') FROM form_defs WHERE id=${bare.id}`);
  ok('نوعِ مراجعهٔ تازه از کلید ساخته شد و در کاتالوگ نیست', !byKey[`visit.${bareKind}`], `visit.${bareKind}`);
  ok('**و به «زیرپرونده» نمی‌افتد** — ردیفِ عمومیِ `visit` برایش هست',
    byKey.visit?.label === 'فرمِ مراجعه', String(byKey.visit?.label));
  ok('ثبت‌نامِ بی‌نوع هم ردیفِ خودش را دارد', byKey.intake?.label === 'ثبت‌نام', String(byKey.intake?.label));

  console.log('\n۴) بخش‌بندی به‌ازای نوع فرق می‌کند');
  ok('فرمِ عمل سه بخشِ قبل/حین/بعد دارد',
    (byKey['visit.surgery']?.sections ?? []).map((x) => x.key).join(',').startsWith('pre,intra,post'),
    JSON.stringify((byKey['visit.surgery']?.sections ?? []).map((x) => x.key)));
  ok('فرمِ زیرپرونده بخشِ پرداخت ندارد',
    !(byKey.record?.sections ?? []).some((x) => x.key === 'payment'));
  ok('و ثبت‌نام دارد', (byKey['intake.surgery']?.sections ?? []).some((x) => x.key === 'payment'));
  ok('دقیقاً یک بخشِ هر نوع «جای فیلدِ دلخواه» است',
    (types ?? []).every((t) => t.sections.filter((x) => x.custom).length === 1));
} finally {
  for (const id of trash) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}

console.log(`\n${pass} سنجه سبز${fails.length ? `، ${fails.length} قرمز` : ''}`);
if (fails.length) { for (const f of fails) console.log('  ✘ ' + f); process.exit(1); }
