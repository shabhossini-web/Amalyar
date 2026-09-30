/**
 * **چند تشخیص برای یک مراجعه** (بستهٔ ۷ب) — سندِ بسته §۷.۱، سناریوهای A1…A18.
 *
 * مدل: تشخیصِ **اصلی** همان ستونِ `visits.diagnosis_id` است و «سایرین» (رتبهٔ ۲ به
 * بعد) در `visit_other_diagnoses`؛ روی سیم کلیدِ همیشگیِ `diagnosisId` (اصلی) و
 * همزادش `otherDiagnosisIds` (سایرین به ترتیبِ رتبه). تنها نویسندهٔ جدول
 * `visit-coding.ts` است.
 *
 *  باید بیفتد:
 *   - تکرارها بی‌صدا حذف می‌شوند و اصلی هرگز در سایرین نمی‌آید (A1)
 *   - فقط «سایرین» → اولی اصلی می‌شود (A2)؛ کلاینتِ کهنهٔ تک‌انتخابی چیزی را که
 *     نمی‌بیند گم نمی‌کند (A4)
 *   - فیلتر، خروجی، آمار و جستجوی آزاد «در هر رتبه‌ای» — و هر سه یک عدد (A7)
 *   - قالب‌های شرح: اصلی، بعد سایرین، بعد عمومی؛ جستجوی شرح‌ها با تشخیصِ دوم (A12)
 *   - بخشِ پیگیریِ تشخیصِ دوم در همان یک لینک، نه پیامکِ دوم (A13)
 *   - پرامپتِ AI همه را با «(اصلی)» می‌گوید؛ تک‌مورد بایت‌به‌بایت همان دیروز (A14)
 *   - میزِ اتاقِ عمل: «تشخیصِ پیش از عمل» همان فهرستِ ویزیتِ تصمیم، با کدِ ICD (A15)
 *   - ممیزیِ ویرایش و حذف سایرین را دارد (A16)
 *   - در مرورگر: اصلی + «تشخیصِ دیگر» + افزودنِ سریع + «اصلی کن» + حذف، و
 *     بازکردنِ دوباره از ردیفِ داشبورد همان ترتیب (A18)
 *  نباید بیفتد:
 *   - ذخیرهٔ بی‌تغییر ردیفی بنویسد (شناسهٔ ردیف‌ها ثابت؛ A3/A6/A18)
 *   - سقفِ ۱۰، شناسهٔ ناموجود، یا افزودنِ **تازهٔ** غیرفعال پذیرفته شود (A8)
 *   - غیرفعال‌شدنِ تشخیصی که از قبل روی مراجعه است ویرایش را قفل کند (A8)
 *   - «اجباری» با «فقط سایرین» قفل شود، یا پاک‌کردنِ همه از ستاره بگریزد (A9)
 *   - کسی که مالکِ فیلدِ تشخیص نیست سایرین را عوض/جابه‌جا/اضافه کند (A10)
 *   - تعریفی که فقط «سایر» است سخت حذف شود و پیوند گم شود (A11)
 *   - نام یا شمارهٔ بیمار به سرویسِ AI برود (A14)
 *   - ناوردای جدول بشکند (A17)
 *
 * ⚠️ نقش/سطحِ حسابِ آزمون با SQL عوض می‌شود (همان الگوی `role-fields.mjs`) تا
 * ورودِ دوم لازم نشود — سطلِ ورود ۸ بار در ۱۵ دقیقه است. بازگردانی به (سطح ۶،
 * بی‌نقش) هم اول و هم در `finally`.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';
const SHOTS = process.env.E2E_SHOTS ?? null;

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
/* stderr هم لوله می‌شود: سنجه‌هایی که **باید** خطا بدهند (RESTRICT) لاگ را کثیف نکنند. */
const psql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
const sql = (q) => psql(q).split('\n')[0];
const num = (q) => Number(sql(q));
const sqlFails = (q) => { try { psql(q); return false; } catch { return true; } };
const setMe = (role, level) =>
  sql(`UPDATE accounts SET job_role=${role ? `'${role}'` : 'NULL'}, level=${level} WHERE username='${USER}'`);
setMe(null, 6); // اجرای قبلی اگر وسطِ راه مرده باشد

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = (p, m = 'GET', b, auth = true) => fetch(API + p, {
  method: m,
  headers: { ...(auth ? { Authorization: 'Bearer ' + login.accessToken } : {}), ...(b !== undefined ? { 'Content-Type': 'application/json' } : {}) },
  body: b !== undefined ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => same([...(a ?? [])].sort((x, y) => x - y), [...(b ?? [])].sort((x, y) => x - y));
const msgOf = (r) => { const m = r.json?.message; return Array.isArray(m) ? m.join('، ') : String(m ?? JSON.stringify(r.json ?? '')); };
const FA = /[؀-ۿ]/;
const inFuture = (days) => new Date(Date.now() + days * 864e5).toISOString();
const MONEY = ['amount', 'paid', 'due', 'globalAmount', 'pricingModel', 'billing', 'charges', 'payments', 'price', 'tariff'];

/** وضعیتِ کدگذاریِ یک مراجعه از نمای کامل. */
const codingOf = async (id) => {
  const g = (await send(`/visits/${id}`)).json;
  return { p: g?.diagnosisId ?? null, o: g?.otherDiagnosisIds, label: g?.diagnosisLabel ?? null, title: g?.diagnosisTitle ?? null };
};
/** ردیف‌های جدول به شکلِ «تشخیص:رتبه» — همان چیزی که ناوردا رویش است. */
const dbRows = (id) => psql(`SELECT diagnosis_id || ':' || rank FROM visit_other_diagnoses WHERE visit_id=${id} ORDER BY rank`).split('\n').filter(Boolean);
/** شناسهٔ ردیف‌ها — ذخیرهٔ بی‌تغییر نباید حذف-و-ساخت کند. */
const dbIds = (id) => sql(`SELECT coalesce(string_agg(id::text, ',' ORDER BY rank), '') FROM visit_other_diagnoses WHERE visit_id=${id}`);

const trash = { visits: [], dx: [], procs: [], forms: [], templates: [] };
const restore = { fields: [] };
let mock = null;

try {
  console.log('چیدمان: جراح، بیمارستان، تشخیص‌ها، دو فرمِ اختصاصی');
  await send('/forms'); // seedِ تنبلِ قالب‌ها — مثلِ گرم‌کردنِ رانر
  const surgeons = (await send('/surgeons')).json;
  const surgeon = (surgeons?.rows ?? surgeons ?? []).find((s) => s.active !== false)
    ?? (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `چندتشخیص${tag}` })).json;
  const hospitals = (await send('/hospitals')).json;
  const hospital = (hospitals?.rows ?? hospitals ?? []).find((h) => h.active !== false)
    ?? (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;
  ok('جراح و بیمارستان برای فرمِ عمل (نورومانیتورینگ هر دو را اجباری دارد)', !!surgeon?.id && !!hospital?.id);

  const mkDx = async (title, icdCode) => {
    const r = await send('/diagnoses', 'POST', { title, ...(icdCode ? { icdCode } : {}) });
    if (!r.json?.id) throw new Error('تشخیص ساخته نشد: ' + JSON.stringify(r.json).slice(0, 200));
    trash.dx.push(r.json.id);
    return r.json;
  };
  /* عنوان‌ها واژه‌های جدا‌اند تا هیچ‌کدام زیررشتهٔ دیگری نباشد (جستجوی `contains`). */
  const d1 = await mkDx(`دیابت ${tag}`, 'E11.9');
  const d2 = await mkDx(`فشارخون ${tag}`, 'I10');
  const d3 = await mkDx(`آسم ${tag}`);
  const d4 = await mkDx(`میگرن ${tag}`, 'G43.9');
  const d5 = await mkDx(`کم‌خونی ${tag}`);
  const d6 = await mkDx(`صرع ${tag}`);
  await send(`/diagnoses/${d6.id}`, 'PATCH', { active: false });
  const dS = await mkDx(`گواتر ${tag}`);
  const dx11 = await mkDx(`نقرس ${tag}`);
  const dxUnused = await mkDx(`بی‌مصرف ${tag}`);
  const caps = [];
  for (let i = 0; i < 10; i++) caps.push(await mkDx(`سقف${i} ${tag}`));
  const b1 = await mkDx(`سردرد ${tag}`);
  const b2 = await mkDx(`سرگیجه ${tag}`);
  const b3 = await mkDx(`تهوع ${tag}`);
  const L = (...ds) => ds.map((d) => d.title).join('، ');

  /* F1: فرمِ اختصاصی با فیلدِ تشخیصِ روشن و برچسبِ یکتا (مرورگر آن را با برچسب
     پیدا می‌کند). F2: همان، ولی تشخیص «اجباری» — برای A9/A10 جدا تا ستاره و
     مالکیت بقیهٔ سناریوها را آلوده نکند. */
  const K1 = `md${tag}`;
  const K2 = `mq${tag}`;
  const DX1 = `تشخیص‌ها ${tag}`;
  const DX2 = `تشخیصِ اجباری ${tag}`;
  const mkForm = async (key, title) => {
    const f = (await send('/forms', 'POST', { key, title, scope: 'visit' })).json;
    if (!f?.id) throw new Error('فرم ساخته نشد: ' + JSON.stringify(f).slice(0, 200));
    trash.forms.push(f.id);
    return f;
  };
  const f1 = await mkForm(K1, `ویزیتِ چندتشخیصی ${tag}`);
  const f2 = await mkForm(K2, `ویزیتِ تشخیصِ اجباری ${tag}`);
  const f1dx = f1.fields.find((x) => x.key === 'diagnosisId');
  const f2dx = f2.fields.find((x) => x.key === 'diagnosisId');
  ok('فرمِ تازه فیلدِ هسته‌ایِ تشخیص را دارد', !!f1dx?.id && !!f2dx?.id);
  await send(`/forms/fields/${f1dx.id}`, 'PATCH', { active: true, label: DX1 });
  await send(`/forms/fields/${f2dx.id}`, 'PATCH', { active: true, required: true, label: DX2 });

  const base = (kind, last) => ({ kind, firstName: 'بیمارِ', lastName: last, phone: phone(), opDate: new Date().toISOString() });
  const mkVisit = async (body) => {
    const r = await send('/visits', 'POST', body);
    if (r.json?.id) trash.visits.push(r.json.id);
    return r;
  };

  console.log('\nA1) ساخت با تکرار و اصلیِ تکراری در فهرست — بی‌صدا حذف می‌شوند');
  const LAST1 = `چندتشخیص${tag}`;
  const r1 = await mkVisit({ ...base(K1, LAST1), diagnosisId: d1.id, otherDiagnosisIds: [d2.id, d3.id, d2.id, d1.id] });
  const v1 = r1.json;
  ok('۲۰۱', r1.status === 201, `${r1.status} ${msgOf(r1)}`);
  ok('اصلی همان `diagnosisId` است', v1?.diagnosisId === d1.id && v1?.diagnosisTitle === d1.title, JSON.stringify([v1?.diagnosisId, v1?.diagnosisTitle]));
  ok('سایرین بی‌تکرار و بی‌اصلی: [d2, d3]', same(v1?.otherDiagnosisIds, [d2.id, d3.id]), JSON.stringify(v1?.otherDiagnosisIds));
  ok('برچسبِ ترکیبی «d1، d2، d3»', v1?.diagnosisLabel === L(d1, d2, d3), v1?.diagnosisLabel);
  ok('در دیتابیس: (d2, ۲) و (d3, ۳)', same(dbRows(v1.id), [`${d2.id}:2`, `${d3.id}:3`]), JSON.stringify(dbRows(v1.id)));
  const pid1 = v1.patientId;

  console.log('\nA2) فقط «سایرین» — اولی اصلی می‌شود');
  const r2 = await mkVisit({ ...base(K1, `ارتقا${tag}`), otherDiagnosisIds: [d4.id, d5.id] });
  const v2 = r2.json;
  ok('اصلی = d4، سایرین = [d5]', r2.status === 201 && v2?.diagnosisId === d4.id && same(v2?.otherDiagnosisIds, [d5.id]),
    `${r2.status} ${JSON.stringify([v2?.diagnosisId, v2?.otherDiagnosisIds])}`);
  ok('**ناوردا:** اصلیِ ارتقایافته در جدولِ سایرین نیست', same(dbRows(v2.id), [`${d5.id}:2`]), JSON.stringify(dbRows(v2.id)));

  console.log('\nA3) PATCHِ بی‌ربط به کدگذاری — فهرست دست نمی‌خورد');
  const ids3 = dbIds(v1.id);
  const p3 = await send(`/visits/${v1.id}`, 'PATCH', { notes: `یادداشت ${tag}` });
  ok('۲۰۰ و همان فهرست در پاسخ', p3.status === 200 && p3.json?.diagnosisId === d1.id && same(p3.json?.otherDiagnosisIds, [d2.id, d3.id]),
    `${p3.status} ${JSON.stringify(p3.json?.otherDiagnosisIds)}`);
  ok('**نباید بیفتد:** ردیفی بازنویسی شود (شناسه‌ها ثابت)', dbIds(v1.id) === ids3, `${ids3} → ${dbIds(v1.id)}`);

  console.log('\nA4) کلاینتِ کهنهٔ تک‌انتخابی');
  const p4a = await send(`/visits/${v1.id}`, 'PATCH', { diagnosisId: d3.id });
  let c = await codingOf(v1.id);
  ok('`{diagnosisId: d3}` (d3 از سایرین بود) → اصلی d3، سایرین [d2]؛ d1 رفت',
    p4a.status === 200 && c.p === d3.id && same(c.o, [d2.id]), `${p4a.status} ${JSON.stringify(c)}`);
  const p4b = await send(`/visits/${v1.id}`, 'PATCH', { diagnosisId: null });
  c = await codingOf(v1.id);
  ok('`{diagnosisId: null}` → اولیِ سایرین اصلی می‌شود (چیزِ نادیده گم نمی‌شود)',
    p4b.status === 200 && c.p === d2.id && same(c.o, []), `${p4b.status} ${JSON.stringify(c)}`);
  ok('… و جدول خالی شد', dbRows(v1.id).length === 0, JSON.stringify(dbRows(v1.id)));

  console.log('\nA5) `[]` و `null` هر دو فقط سایرین را پاک می‌کنند');
  await send(`/visits/${v1.id}`, 'PATCH', { otherDiagnosisIds: [d1.id, d3.id] });
  const p5a = await send(`/visits/${v1.id}`, 'PATCH', { otherDiagnosisIds: [] });
  c = await codingOf(v1.id);
  ok('`[]` → سایرین خالی، اصلی d2 می‌ماند', p5a.status === 200 && c.p === d2.id && same(c.o, []), JSON.stringify(c));
  await send(`/visits/${v1.id}`, 'PATCH', { otherDiagnosisIds: [d1.id] });
  const p5b = await send(`/visits/${v1.id}`, 'PATCH', { otherDiagnosisIds: null });
  c = await codingOf(v1.id);
  ok('`null` → سایرین خالی، اصلی d2 می‌ماند', p5b.status === 200 && c.p === d2.id && same(c.o, []) && dbRows(v1.id).length === 0, JSON.stringify(c));

  console.log('\nA6) جابه‌جاییِ اصلی و سایر — رتبه‌ها دنبال می‌کنند، ذخیرهٔ تکراری نمی‌نویسد');
  await send(`/visits/${v1.id}`, 'PATCH', { diagnosisId: d1.id, otherDiagnosisIds: [d2.id, d3.id] });
  const swap = { diagnosisId: d2.id, otherDiagnosisIds: [d1.id, d3.id] };
  const p6 = await send(`/visits/${v1.id}`, 'PATCH', swap);
  c = await codingOf(v1.id);
  ok('اصلی d2، سایرین [d1, d3]', p6.status === 200 && c.p === d2.id && same(c.o, [d1.id, d3.id]), JSON.stringify(c));
  ok('رتبه‌ها: (d1, ۲) و (d3, ۳)', same(dbRows(v1.id), [`${d1.id}:2`, `${d3.id}:3`]), JSON.stringify(dbRows(v1.id)));
  const ids6 = dbIds(v1.id);
  const p6b = await send(`/visits/${v1.id}`, 'PATCH', swap);
  ok('**نباید بیفتد:** همان payload دوباره ردیفِ تازه بسازد', p6b.status === 200 && dbIds(v1.id) === ids6, `${ids6} → ${dbIds(v1.id)}`);

  console.log('\nA7) جستجو با تشخیصِ **دوم** — فهرست، خروجی و آمار یک عدد');
  const ids = (rows) => (rows ?? []).map((r) => r.id);
  const L7 = (await send(`/visits?diagnosisId=${d3.id}&pageSize=100`)).json;
  const E7 = (await send(`/visits/export?diagnosisId=${d3.id}`)).json;
  ok('`/visits?diagnosisId=d3` مراجعه‌ای را که d3 سومِ آن است پیدا می‌کند', ids(L7?.rows).includes(v1.id), JSON.stringify(ids(L7?.rows)));
  ok('**نباید بیفتد:** مراجعهٔ بی‌d3 بیاید', !ids(L7?.rows).includes(v2.id));
  ok('خروجی همان شناسه‌ها و همان تعداد', sameSet(ids(L7?.rows), ids(E7?.rows)) && L7?.total === E7?.rows?.length,
    JSON.stringify([ids(L7?.rows), ids(E7?.rows), L7?.total]));
  ok('آمار با هر دو می‌خواند', L7?.stats?.total === L7?.total && E7?.stats?.total === E7?.rows?.length,
    JSON.stringify([L7?.stats?.total, L7?.total, E7?.stats?.total]));
  const Q7 = (await send(`/visits?q=${encodeURIComponent(d3.title)}&pageSize=100`)).json;
  ok('جستجوی آزاد با عنوانِ d3 هم پیدایش می‌کند', ids(Q7?.rows).includes(v1.id), JSON.stringify(ids(Q7?.rows)));
  ok('فیلترِ اصلی همچنان کار می‌کند (d2)', ids((await send(`/visits?diagnosisId=${d2.id}&pageSize=100`)).json?.rows).includes(v1.id));
  const N7 = (await send(`/visits?diagnosisId=${d5.id}&pageSize=100`)).json;
  ok('و d5 (سایرِ مراجعهٔ دیگر) آن یکی را می‌دهد نه این را', ids(N7?.rows).includes(v2.id) && !ids(N7?.rows).includes(v1.id));

  console.log('\nA8) اعتبارسنجی');
  const nine = caps.slice(0, 9).map((d) => d.id);
  const p8a = await send(`/visits/${v1.id}`, 'PATCH', { otherDiagnosisIds: nine });
  ok('مرز: یک اصلی + ۹ دیگر پذیرفته می‌شود', p8a.status === 200 && (await codingOf(v1.id)).o?.length === 9, `${p8a.status} ${msgOf(p8a)}`);
  const p8b = await send(`/visits/${v1.id}`, 'PATCH', { otherDiagnosisIds: caps.map((d) => d.id) });
  ok('**نباید بیفتد:** ۱۰ دیگر — ۴۰۰ با پیامِ فارسی', p8b.status === 400 && FA.test(msgOf(p8b)) && /۱۰|10/.test(msgOf(p8b)), `${p8b.status} ${msgOf(p8b)}`);
  ok('… و چیزی نوشته نشد', dbRows(v1.id).length === 9);
  await send(`/visits/${v1.id}`, 'PATCH', { otherDiagnosisIds: [d1.id, d3.id] });
  const ids8 = dbIds(v1.id);
  const p8c = await send(`/visits/${v1.id}`, 'PATCH', { otherDiagnosisIds: [d1.id, 2147480000] });
  ok('**نباید بیفتد:** شناسهٔ ناموجود — «تشخیص یافت نشد»', [400, 404].includes(p8c.status) && msgOf(p8c).includes('تشخیص یافت نشد'), `${p8c.status} ${msgOf(p8c)}`);
  const p8d = await send(`/visits/${v1.id}`, 'PATCH', { otherDiagnosisIds: [d1.id, d3.id, d6.id] });
  ok('**نباید بیفتد:** افزودنِ **تازهٔ** غیرفعال (d6)', p8d.status === 400 && msgOf(p8d).includes('غیرفعال'), `${p8d.status} ${msgOf(p8d)}`);
  ok('… و هیچ‌کدام چیزی ننوشتند', dbIds(v1.id) === ids8, `${ids8} → ${dbIds(v1.id)}`);
  await send(`/diagnoses/${d3.id}`, 'PATCH', { active: false });
  const p8e = await send(`/visits/${v1.id}`, 'PATCH', { diagnosisId: d2.id, otherDiagnosisIds: [d1.id, d3.id] });
  ok('d3 بعد از پیوستن غیرفعال شد — echo همچنان ۲۰۰', p8e.status === 200, `${p8e.status} ${msgOf(p8e)}`);
  const p8f = await send(`/visits/${v1.id}`, 'PATCH', { diagnosisId: d3.id, otherDiagnosisIds: [d2.id, d1.id] });
  c = await codingOf(v1.id);
  ok('… و اصلی‌کردنِ همان d3 هم ۲۰۰ (غیرفعالِ پیوسته قفل نمی‌کند)', p8f.status === 200 && c.p === d3.id, `${p8f.status} ${msgOf(p8f)}`);
  await send(`/diagnoses/${d3.id}`, 'PATCH', { active: true });
  await send(`/visits/${v1.id}`, 'PATCH', { diagnosisId: d2.id, otherDiagnosisIds: [d1.id, d3.id] });

  console.log('\nA9) ستارهٔ «اجباری» روی فیلدِ تشخیص');
  const LAST9 = `ستاره${tag}`;
  const r9a = await send('/visits', 'POST', base(K2, LAST9));
  ok('**نباید بیفتد:** ثبت بدونِ هیچ تشخیصی', r9a.status === 400, `${r9a.status} ${msgOf(r9a)}`);
  ok('… و پرونده‌ای نیمه‌کاره ساخته نشد', num(`SELECT count(*) FROM patients WHERE last_name='${LAST9}'`) === 0);
  const r9b = await mkVisit({ ...base(K2, LAST9), otherDiagnosisIds: [d4.id] });
  ok('فقط «سایرین» → ۲۰۱ (اولی اصلی شد، پس ستاره راضی است)', r9b.status === 201 && r9b.json?.diagnosisId === d4.id && same(r9b.json?.otherDiagnosisIds, []),
    `${r9b.status} ${msgOf(r9b)}`);
  const p9a = await send(`/visits/${r9b.json.id}`, 'PATCH', { diagnosisId: null, otherDiagnosisIds: [] });
  ok('**نباید بیفتد:** پاک‌کردنِ همه با PATCH — ۴۰۰', p9a.status === 400, `${p9a.status} ${msgOf(p9a)}`);
  ok('… و تشخیص سرِ جایش ماند', (await codingOf(r9b.json.id)).p === d4.id);
  await send(`/visits/${r9b.json.id}`, 'PATCH', { otherDiagnosisIds: [d5.id] });
  const p9b = await send(`/visits/${r9b.json.id}`, 'PATCH', { diagnosisId: null });
  ok('پاک‌کردنِ فقط اصلی وقتی سایر هست → ارتقا، نه ۴۰۰ (قفلِ همیشگیِ forms-validate پیش نمی‌آید)',
    p9b.status === 200 && (await codingOf(r9b.json.id)).p === d5.id, `${p9b.status} ${msgOf(p9b)}`);

  console.log('\nA10) مالکیتِ نقش — «سایرین» مالِ صاحبِ فیلدِ تشخیص است');
  const r10 = await mkVisit({ ...base(K2, `مالکیت${tag}`), diagnosisId: d1.id, otherDiagnosisIds: [d2.id, d3.id] });
  const vq = r10.json;
  ok('مراجعهٔ آزمون ساخته شد (سوپرادمین)', r10.status === 201, `${r10.status} ${msgOf(r10)}`);
  await send(`/forms/fields/${f2dx.id}`, 'PATCH', { roles: ['doctor'] });
  const LAST10 = `منشی${tag}`;
  try {
    setMe('secretary', 5);
    const e1 = await send(`/visits/${vq.id}`, 'PATCH', { diagnosisId: d1.id, otherDiagnosisIds: [d2.id, d3.id] });
    ok('echoی بی‌تغییرِ هر دو کلید → ۲۰۰', e1.status === 200, `${e1.status} ${msgOf(e1)}`);
    const e2 = await send(`/visits/${vq.id}`, 'PATCH', { otherDiagnosisIds: [d2.id] });
    ok('**نباید بیفتد:** منشی سایرین را عوض کند — ۴۰۰ با نامِ فیلد', e2.status === 400 && msgOf(e2).includes(DX2) && msgOf(e2).includes('پزشک'),
      `${e2.status} ${msgOf(e2)}`);
    const e3 = await send(`/visits/${vq.id}`, 'PATCH', { otherDiagnosisIds: [d3.id, d2.id] });
    ok('**نباید بیفتد:** … یا فقط جابه‌جا کند (رتبه دادهٔ بالینی است)', e3.status === 400, `${e3.status} ${msgOf(e3)}`);
    /* «سایه»: مقدارِ تازه در ریشه + کپیِ بی‌تغییرِ قدیمی در `extra` — نسخهٔ قبل فقط
       `extra` را می‌سنجید و از سد می‌گذشت، در حالی که نویسنده ریشه را می‌خواند. */
    const e3b = await send(`/visits/${vq.id}`, 'PATCH', { otherDiagnosisIds: [d2.id], extra: { otherDiagnosisIds: null } });
    ok('**نباید بیفتد:** سایهٔ بی‌تغییر در `extra` سدِ مالکیت را دور نمی‌زند', e3b.status === 400 && msgOf(e3b).includes('پزشک'),
      `${e3b.status} ${msgOf(e3b)}`);
    ok('… و سایرین دست‌نخورده ماند', sql(`SELECT string_agg(diagnosis_id::text, ',' ORDER BY rank) FROM visit_other_diagnoses WHERE visit_id=${vq.id}`) === `${d2.id},${d3.id}`);
    const e4 = await send(`/visits/${vq.id}`, 'PATCH', { diagnosisId: d1.id });
    ok('echoی تک‌کلیدِ کلاینتِ کهنه → ۲۰۰', e4.status === 200, `${e4.status} ${msgOf(e4)}`);
    const e5 = await send(`/visits/${vq.id}`, 'PATCH', { notes: `منشی ${tag}` });
    ok('ویرایشِ بخشِ خودش آزاد است', e5.status === 200, `${e5.status} ${msgOf(e5)}`);
    const e6 = await send('/visits', 'POST', { ...base(K2, LAST10), diagnosisId: d4.id, otherDiagnosisIds: [d5.id] });
    ok('**نباید بیفتد:** ساخت با «سایرینِ» پُر توسطِ غیرمالک', e6.status === 400 && msgOf(e6).includes('پزشک'), `${e6.status} ${msgOf(e6)}`);
    ok('… و چیزی ساخته نشد', num(`SELECT count(*) FROM patients WHERE last_name='${LAST10}'`) === 0);
  } finally {
    setMe(null, 6);
  }
  ok('فهرستِ آن مراجعه دست‌نخورده ماند', same(dbRows(vq.id), [`${d2.id}:2`, `${d3.id}:3`]), JSON.stringify(dbRows(vq.id)));
  await send(`/forms/fields/${f2dx.id}`, 'PATCH', { roles: [] });

  console.log('\nA11) تعریفی که فقط «سایر» است');
  await send(`/visits/${v2.id}`, 'PATCH', { otherDiagnosisIds: [d5.id, dx11.id] });
  const list11 = (await send('/diagnoses')).json ?? [];
  ok('`GET /diagnoses` آن را «به‌کاررفته» می‌شمارد (visitCount = ۱)', list11.find((d) => d.id === dx11.id)?.visitCount === 1,
    JSON.stringify(list11.find((d) => d.id === dx11.id)));
  const del11 = await send(`/diagnoses/${dx11.id}`, 'DELETE');
  ok('حذف → فقط غیرفعال می‌شود', del11.status < 300 && del11.json?.deactivated === true, `${del11.status} ${JSON.stringify(del11.json)}`);
  ok('**نباید بیفتد:** حذفِ خامِ SQL — RESTRICT', sqlFails(`DELETE FROM diagnoses WHERE id=${dx11.id}`)
    && num(`SELECT count(*) FROM diagnoses WHERE id=${dx11.id}`) === 1);
  ok('… و پیوندش روی مراجعه ماند', same((await codingOf(v2.id)).o, [d5.id, dx11.id]));
  const del11b = await send(`/diagnoses/${dxUnused.id}`, 'DELETE');
  ok('شاهد: تعریفِ بی‌استفاده واقعاً حذف می‌شود', del11b.json?.deactivated === false && num(`SELECT count(*) FROM diagnoses WHERE id=${dxUnused.id}`) === 0,
    JSON.stringify(del11b.json));

  console.log('\nA12) قالب‌های شرح و جستجوی شرح‌ها');
  const mkTpl = async (title, extra = {}) => {
    const t = (await send('/note-templates', 'POST', { kind: 'visit', title, body: `متنِ ${title}`, ...extra })).json;
    if (t?.id) trash.templates.push(t.id);
    return t;
  };
  /* عنوان‌ها عمداً برعکسِ ترتیبِ مورد انتظار الفبایی‌اند: ترتیب باید از **امتیاز** بیاید. */
  const tGen = await mkTpl(`الف عمومی ${tag}`);
  const tSec = await mkTpl(`ب دوم ${tag}`, { diagnosisId: d3.id });
  const tPri = await mkTpl(`پ اصلی ${tag}`, { diagnosisId: d2.id });
  const tFor = await mkTpl(`ت بیگانه ${tag}`, { diagnosisId: d5.id });
  const mine = new Set([tGen?.id, tSec?.id, tPri?.id, tFor?.id]);
  const tpls = ((await send(`/patients/${pid1}/note-templates?kind=visit&visitId=${v1.id}`)).json ?? []).filter((t) => mine.has(t.id)).map((t) => t.id);
  ok('ترتیب: اصلی، دوم، عمومی', same(tpls, [tPri?.id, tSec?.id, tGen?.id]), JSON.stringify(tpls));
  ok('**نباید بیفتد:** قالبِ تشخیصی که روی مراجعه نیست', !tpls.includes(tFor?.id));
  const note = (await send(`/patients/${pid1}/notes`, 'POST', { kind: 'visit', visitId: v1.id, body: `شرحِ چندتشخیصی ${tag}` })).json;
  ok('شرحِ ویزیت ثبت شد', !!note?.id, JSON.stringify(note).slice(0, 160));
  const s12 = (await send(`/patients/notes/search?diagnosisId=${d3.id}`)).json ?? [];
  const hit = s12.find((n) => n.id === note?.id);
  ok('`notes/search?diagnosisId=<دوم>` شرح را پیدا می‌کند', !!hit, JSON.stringify(s12.map((n) => n.id)));
  ok('`diagnosisTitle` اصلی است، `diagnosisLabel` ترکیبی', hit?.diagnosisTitle === d2.title && hit?.diagnosisLabel === L(d2, d1, d3),
    JSON.stringify([hit?.diagnosisTitle, hit?.diagnosisLabel]));
  const s12n = (await send(`/patients/notes/search?diagnosisId=${d5.id}`)).json ?? [];
  ok('**شاهدِ منفی:** تشخیصی که روی این مراجعه نیست شرح را نمی‌آورد', !s12n.some((n) => n.id === note?.id));

  console.log('\nA13) پیگیری — بخشِ تشخیصِ دوم در همان یک لینک');
  const pf = (await send('/procedure-types', 'POST', { name: `عملِ پیگیری ${tag}`, followUpDays: '7' })).json;
  trash.procs.push(pf.id);
  const mkRecordForm = async (key, title, fieldKey, role) => {
    const f = (await send('/forms', 'POST', { key, title, scope: 'record' })).json;
    trash.forms.push(f.id);
    await send(`/forms/${f.id}/fields`, 'POST', { key: fieldKey, label: `پرسشِ ${title}` });
    const r = await send(`/forms/${f.id}`, 'PATCH', role);
    return { ...f, patched: r.status };
  };
  const fGen = await mkRecordForm(`g${tag}`, 'پیگیریِ عمومی', 'fuGen', { followUp: 'general' });
  const fDx = await mkRecordForm(`x${tag}`, 'پیگیریِ آسم', 'fuAsthma', { followUp: 'diagnosis', diagnosisId: d3.id });
  const fNeg = await mkRecordForm(`n${tag}`, 'پیگیریِ کم‌خونی', 'fuAnemia', { followUp: 'diagnosis', diagnosisId: d5.id });
  ok('سه نقشِ پیگیری نشست', [fGen, fDx, fNeg].every((f) => f.patched === 200), JSON.stringify([fGen.patched, fDx.patched, fNeg.patched]));
  const r13 = await mkVisit({
    kind: 'surgery', firstName: 'بیمارِ', lastName: `پیگیری${tag}`, phone: phone(),
    opDate: inFuture(2), surgeonId: surgeon.id, hospitalId: hospital.id,
    procedureTypeId: pf.id, diagnosisId: d1.id, otherDiagnosisIds: [d3.id],
  });
  const vf = r13.json;
  ok('جراحی با تشخیصِ دومِ d3 ثبت شد', r13.status === 201, `${r13.status} ${msgOf(r13)}`);
  const extras = sql(`SELECT array_to_string(extra_form_ids, ',') FROM intake_submissions WHERE data->>'followUpVisitId' = '${vf.id}' ORDER BY id LIMIT 1`)
    .split(',').filter(Boolean).map(Number);
  ok('`extraFormIds` بخشِ پیگیریِ تشخیصِ **دوم** را دارد', extras.includes(fDx.id), JSON.stringify(extras));
  ok('**نباید بیفتد:** بخشِ تشخیصی که روی این عمل نیست', !extras.includes(fNeg.id), JSON.stringify(extras));
  const token13 = sql(`SELECT token FROM intake_submissions WHERE data->>'followUpVisitId' = '${vf.id}' ORDER BY id LIMIT 1`);
  const view13 = (await send(`/public/intake/form/${token13}`, 'GET', undefined, false)).json;
  ok('و بیمار پرسشِ آن بخش را پشتِ همان توکن می‌بیند', (view13?.form?.fields ?? []).some((f) => f.key === 'fuAsthma'),
    JSON.stringify((view13?.form?.fields ?? []).map((f) => f.key)));
  ok('یک موجِ پیگیری (روزِ ۷)، نه پیامکِ دوم',
    num(`SELECT count(*) FROM reminders WHERE visit_id=${vf.id} AND kind='follow_up' AND status='pending'`) === 1);
  ok('از هر نوع یادآوری حداکثر یکی',
    num(`SELECT coalesce(max(c), 0) FROM (SELECT count(*) c FROM reminders WHERE visit_id=${vf.id} AND status='pending' GROUP BY kind) t`) === 1);

  console.log('\nA14) AI با transportِ ساختگی');
  const captured = [];
  let mockReply = 'پاسخ';
  mock = http.createServer((req, res) => {
    let data = '';
    req.on('data', (ch) => { data += ch; });
    req.on('end', () => {
      try { captured.push(JSON.parse(data || '{}')); } catch { captured.push({}); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: mockReply } }] }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  await send('/settings', 'PATCH', { values: { ai_base_url: `http://127.0.0.1:${mock.address().port}/v1`, ai_api_key: `key-${tag}`, ai_model: 'mock-1' } });
  const lastMsgs = () => captured[captured.length - 1]?.messages ?? [];
  const PROMPT_MULTI = `تشخیص: ${d2.title} (اصلی)، ${d1.title}، ${d3.title}`;
  const nd = await send('/ai/note-draft', 'POST', { patientId: pid1, visitId: v1.id, kind: 'visit', mode: 'structure', text: 'درد و سرفه از دیروز' });
  const ndUser = lastMsgs()[1]?.content ?? '';
  ok('پیش‌نویسِ شرح: همهٔ تشخیص‌ها، اصلی اول و صریح', nd.status < 300 && ndUser.includes(PROMPT_MULTI), `${nd.status} ${ndUser.slice(0, 200)}`);
  const rs = await send('/ai/record-summary', 'POST', { patientId: pid1 });
  const rsData = lastMsgs()[1]?.content ?? '';
  /* خطِ مراجعه در خلاصهٔ ارجاع برچسبِ ترکیبی است (قاعدهٔ ۸ِ سند)، نه `promptList`. */
  ok('خلاصهٔ ارجاع: خطِ مراجعه تشخیصِ دوم و سوم را دارد', rs.status < 300 && rsData.includes(`تشخیص: ${L(d2, d1, d3)}`), `${rs.status} ${rsData.slice(0, 240)}`);
  const cd = await send('/ai/care-draft', 'POST', { visitId: v1.id });
  const cdUser = lastMsgs()[1]?.content ?? '';
  ok('پیش‌نویسِ مراقبت: همهٔ تشخیص‌ها با «(اصلی)»', cd.status < 300 && cdUser.includes(PROMPT_MULTI), `${cd.status} ${cdUser.slice(0, 200)}`);
  const LASTS = `تک${tag}`;
  const rS = await mkVisit({ ...base(K1, LASTS), diagnosisId: dS.id });
  await send('/ai/note-draft', 'POST', { patientId: rS.json.patientId, visitId: rS.json.id, kind: 'visit', mode: 'structure', text: 'متنِ خام' });
  const sUser = lastMsgs()[1]?.content ?? '';
  ok('تک‌تشخیص: خطِ بافتار بایت‌به‌بایت همان دیروز', sUser.split('\n')[0] === `بافتار: تشخیص: ${dS.title}` && !sUser.includes('(اصلی)'), sUser.split('\n')[0]);
  await send('/ai/care-draft', 'POST', { visitId: rS.json.id });
  const sCare = (lastMsgs()[1]?.content ?? '').split('\n');
  ok('… و در پیش‌نویسِ مراقبت هم `تشخیص: X` خالص', sCare.includes(`تشخیص: ${dS.title}`), JSON.stringify(sCare.slice(0, 3)));
  const everything = JSON.stringify(captured);
  ok('**نباید بیفتد:** نام یا شمارهٔ بیمار به سرویسِ بیرونی برود',
    !everything.includes(LAST1) && !everything.includes(LASTS) && !everything.includes(v1.phone ?? '§') && !everything.includes(rS.json.phone ?? '§'));

  console.log('\nA15) میزِ اتاقِ عمل — عمل از ویزیتِ تصمیم');
  const rD = await mkVisit({ ...base(K1, `تصمیم${tag}`), diagnosisId: d1.id, otherDiagnosisIds: [d2.id, d3.id] });
  const vd = rD.json;
  const rX = await mkVisit({
    kind: 'surgery', patientId: vd.patientId, decidedInVisitId: vd.id, opDate: new Date().toISOString(),
    surgeonId: surgeon.id, hospitalId: hospital.id, diagnosisId: d4.id, otherDiagnosisIds: [d5.id],
  });
  ok('عمل از ویزیتِ تصمیم ساخته شد', rX.status === 201, `${rX.status} ${msgOf(rX)}`);
  const card = (await send(`/theatre/visits/${rX.json.id}`)).json;
  const shape = (list) => (list ?? []).map((d) => [d.title, d.icdCode ?? null, !!d.primary]);
  ok('`decided.diagnoses` = فهرستِ ویزیتِ تصمیم (اصلی اول، با ICD)',
    same(shape(card?.decided?.diagnoses), [[d1.title, 'E11.9', true], [d2.title, 'I10', false], [d3.title, null, false]]),
    JSON.stringify(shape(card?.decided?.diagnoses)));
  ok('`decided.diagnosis` برچسبِ ترکیبیِ همان', card?.decided?.diagnosis === L(d1, d2, d3), card?.decided?.diagnosis);
  ok('`diagnoses`ِ خودِ عمل: d4 (اصلی، G43.9) و d5', same(shape(card?.visit?.diagnoses), [[d4.title, 'G43.9', true], [d5.title, null, false]]),
    JSON.stringify(shape(card?.visit?.diagnoses)));
  ok('هر ردیف کلیدِ `icdCode` را دارد (حتی خالی)', (card?.visit?.diagnoses ?? []).every((d) => 'icdCode' in d));
  ok('`diagnosis`ِ کارت برچسبِ ترکیبی است', card?.visit?.diagnosis === L(d4, d5), card?.visit?.diagnosis);
  const flat15 = JSON.stringify(card ?? {});
  ok('🔴 **هیچ عددِ مالی در کارت نیست**', MONEY.every((k) => !flat15.includes(`"${k}"`)), MONEY.filter((k) => flat15.includes(`"${k}"`)).join('، '));
  const rX2 = await mkVisit({
    kind: 'surgery', patientId: vd.patientId, decidedInVisitId: vd.id, opDate: inFuture(3),
    surgeonId: surgeon.id, hospitalId: hospital.id,
  });
  const gx2 = await codingOf(rX2.json?.id);
  ok('**نباید بیفتد:** تشخیصِ ویزیتِ تصمیم به عمل ارث برسد یا کپی شود', rX2.status === 201 && gx2.p === null && same(gx2.o, []),
    `${rX2.status} ${JSON.stringify(gx2)}`);
  /* بیرون از فهرستِ A ولی همان قرارداد (§۴ ردیف‌های ۱۹ و ۲۱): کارتِ پرونده و
     سندِ بیرونیِ بیمار هم همه را دارند — پاسخ‌های فرم تشخیص را عمداً ندارند. */
  const rec = (await send(`/patients/${pid1}/record`)).json;
  const rv = (rec?.visits ?? []).find((x) => x.id === v1.id);
  ok('پرونده: `diagnosisTitle` اصلی، `diagnosisLabel` ترکیبی، `diagnoses` به ترتیبِ رتبه',
    rv?.diagnosisTitle === d2.title && rv?.diagnosisLabel === L(d2, d1, d3)
    && same((rv?.diagnoses ?? []).map((d) => [d.title, !!d.primary]), [[d2.title, true], [d1.title, false], [d3.title, false]]),
    JSON.stringify([rv?.diagnosisTitle, rv?.diagnosisLabel, rv?.diagnoses]));
  const sumLink = (await send(`/visits/${v1.id}/summary-link`, 'POST')).json;
  const pubSum = (await send(`/public/visit-summary/${sumLink?.token}`, 'GET', undefined, false)).json;
  ok('خلاصهٔ بیمار: تشخیصِ دوم و سوم جا نمی‌افتند', pubSum?.visit?.diagnosisTitle === d2.title
    && pubSum?.visit?.diagnosisLabel === L(d2, d1, d3)
    && same((pubSum?.visit?.diagnoses ?? []).map((d) => d.title), [d2.title, d1.title, d3.title]),
    JSON.stringify(pubSum?.visit ?? pubSum).slice(0, 240));

  console.log('\nA16) ممیزی');
  await send(`/visits/${v1.id}`, 'PATCH', { otherDiagnosisIds: [d3.id, d1.id] });
  const aud = (col) => JSON.parse(sql(`SELECT coalesce(${col}->'otherDiagnosisIds', 'null'::jsonb) FROM audit_events WHERE action='visit.update' AND entity_id='${v1.id}' ORDER BY id DESC LIMIT 1`) || 'null');
  ok('`visit.update`: «قبل» و «بعد» سایرین را دارند', same(aud('before_json'), [d1.id, d3.id]) && same(aud('after_json'), [d3.id, d1.id]),
    JSON.stringify([aud('before_json'), aud('after_json')]));
  await send(`/visits/${v1.id}`, 'PATCH', { otherDiagnosisIds: [d1.id, d3.id] });
  const rDel = await send('/visits', 'POST', { ...base(K1, `حذف${tag}`), diagnosisId: d4.id, otherDiagnosisIds: [d5.id, d1.id] });
  const delId = rDel.json?.id;
  const gone = await send(`/visits/${delId}`, 'DELETE');
  const delBefore = JSON.parse(sql(`SELECT coalesce(before_json->'otherDiagnoses', 'null'::jsonb) FROM audit_events WHERE action='visit.delete' AND entity_id='${delId}' ORDER BY id DESC LIMIT 1`) || 'null');
  ok('`visit.delete`: «قبل» سایرین را با رتبه دارد',
    gone.status < 300 && sameSet((delBefore ?? []).map((o) => o.diagnosisId), [d5.id, d1.id]) && sameSet((delBefore ?? []).map((o) => o.rank), [2, 3]),
    JSON.stringify(delBefore));
  ok('… و ردیف‌ها با مراجعه cascade شدند', num(`SELECT count(*) FROM visit_other_diagnoses WHERE visit_id=${delId}`) === 0);

  console.log('\nA17) ناوردای جدول');
  const inv = num(`SELECT
      (SELECT count(*) FROM visit_other_diagnoses o JOIN visits v ON v.id = o.visit_id WHERE v.diagnosis_id IS NULL OR v.diagnosis_id = o.diagnosis_id)
    + (SELECT count(*) FROM (SELECT visit_id FROM visit_other_diagnoses GROUP BY visit_id HAVING min(rank) <> 2 OR max(rank) <> count(*) + 1) a)`);
  ok('سایرِ برابرِ اصلی، سایرِ بی‌اصلی، رتبهٔ گسسته — هیچ', inv === 0, String(inv));

  console.log('\nA18) مرورگر — موبایل و دسکتاپ، هر دو تم');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const LASTB = `مرورگر${tag}`;
  const rB = await mkVisit({ ...base(K1, LASTB) });
  const vb = rB.json;
  const QUICK = `تازه ${tag}`;
  const open = async (theme, viewport) => {
    const ctx = await browser.newContext({ viewport, locale: 'fa-IR' });
    await ctx.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* حالتِ ناشناس */ } }, theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const patches = [];
    page.on('request', (r) => {
      if (r.method() !== 'PATCH' || !/\/visits\/\d+$/.test(new URL(r.url()).pathname)) return;
      let body = null;
      try { body = r.postDataJSON(); } catch { /* بدنهٔ غیرJSON */ }
      patches.push({ path: new URL(r.url()).pathname, body });
    });
    await browserLogin(page, login.accessToken);
    return { ctx, page, errors, patches };
  };
  const dxNodeOf = (page) => page.locator('.db-sheet .db-builtins > div').filter({ has: page.locator('.db-field > span', { hasText: DX1 }) });
  const chipIds = (node) => node.locator('[data-coding-chip]').evaluateAll((els) => els.map((e) => Number(e.dataset.id)));
  const choose = async (page, btn, title) => {
    await btn.click();
    const panel = page.locator('.pk-panel');
    await panel.waitFor({ state: 'visible', timeout: 6000 });
    if (await panel.locator('.pk-search').count()) await panel.locator('.pk-search').fill(title);
    await panel.locator('.pk-item', { hasText: title }).first().click();
    await panel.waitFor({ state: 'detached', timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(250);
  };
  const saveAndWait = async (page, visitId) => {
    const resp = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith(`/visits/${visitId}`), { timeout: 15000 });
    await page.locator('.db-sheet button.db-submit[type="submit"]').click();
    return resp.then((r) => r.status()).catch(() => 0);
  };
  const noHScroll = (page) => page.evaluate(() => {
    const d = document.documentElement;
    const sheet = document.querySelector('.db-sheet');
    return d.scrollWidth - d.clientWidth <= 1 && (!sheet || sheet.scrollWidth - sheet.clientWidth <= 1);
  });
  /* selectِ بومی فقط در همین دو جا معنا دارد؛ بقیهٔ فرم موضوعِ `pick-ui.mjs` است. */
  const NATIVE = '.db-sheet .db-selrow select, .db-sheet .cc select';
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/multi-diagnosis-${name}.png`, fullPage: false }).catch(() => {}); };

  try {
    /* ── جریانِ کامل روی موبایلِ ۳۹۰ با تمِ تیره ── */
    const m = await open('dark', { width: 390, height: 844 });
    let quickId = null;
    try {
      await m.page.goto(`${UI}/app/dashboard?patient=${vb.id}`, { waitUntil: 'networkidle' });
      await m.page.waitForTimeout(1500);
      let node = dxNodeOf(m.page);
      ok('فیلدِ تشخیص در فرم هست', await node.count() === 1);
      ok('بی‌اصلی، ردیفِ «سایرین» اصلاً رندر نمی‌شود', await node.locator('[data-coding-chips]').count() === 0);
      await choose(m.page, node.locator('.db-selrow .pk-btn'), b1.title);
      ok('با انتخابِ اصلی، «+ تشخیصِ دیگر» آمد', await node.locator('[data-coding-add]').count() === 1);
      await choose(m.page, node.locator('[data-coding-add] .pk-btn'), b2.title);
      await choose(m.page, node.locator('[data-coding-add] .pk-btn'), b3.title);
      ok('دو بار «تشخیصِ دیگر» → دو چیپ به ترتیب', same(await chipIds(node), [b2.id, b3.id]), JSON.stringify(await chipIds(node)));
      await node.locator('[data-coding-new]').click();
      await node.locator('[data-coding-quick] input').fill(QUICK);
      await node.locator('[data-coding-quick] button', { hasText: 'ثبت' }).click();
      await m.page.waitForTimeout(1500);
      quickId = ((await send('/diagnoses')).json ?? []).find((d) => d.title === QUICK)?.id ?? null;
      if (quickId) trash.dx.push(quickId);
      ok('افزودنِ سریع تعریف ساخت و به ته فهرست چسباند', !!quickId && same(await chipIds(node), [b2.id, b3.id, quickId]), JSON.stringify(await chipIds(node)));
      ok('بجِ «اصلی» کنارِ برچسب (بیش از یکی)', await node.locator('.cc-badge').count() === 1);
      await node.locator(`[data-coding-chip][data-id="${b3.id}"] [data-coding-primary]`).click();
      await m.page.waitForTimeout(300);
      ok('«اصلی کن» جابه‌جا کرد: اصلیِ قبلی اولینِ سایرین شد',
        (await node.locator('.db-selrow .pk-btn').innerText()).includes(b3.title) && same(await chipIds(node), [b1.id, b2.id, quickId]),
        JSON.stringify(await chipIds(node)));
      await node.locator(`[data-coding-chip][data-id="${b2.id}"] [data-coding-remove]`).click();
      await m.page.waitForTimeout(300);
      ok('حذفِ چیپ', same(await chipIds(node), [b1.id, quickId]), JSON.stringify(await chipIds(node)));
      ok('**بدونِ selectِ بومی** (انتخابگرِ اصلی و چیپ‌ها)', await m.page.locator(NATIVE).count() === 0);
      ok('**بدونِ اسکرولِ افقی در ۳۹۰**', await noHScroll(m.page));
      await shot(m.page, 'edit-390-dark');
      const st = await saveAndWait(m.page, vb.id);
      const body = m.patches[m.patches.length - 1]?.body ?? {};
      ok('ذخیره ۲۰۰ و بدنه: اصلی + همزاد', st === 200 && body.diagnosisId === b3.id && same(body.otherDiagnosisIds, [b1.id, quickId]),
        `${st} ${JSON.stringify({ d: body.diagnosisId, o: body.otherDiagnosisIds })}`);
      const g18 = await codingOf(vb.id);
      ok('روی سرور نشست', g18.p === b3.id && same(g18.o, [b1.id, quickId]), JSON.stringify(g18));

      /* بازکردنِ دوباره از **ردیفِ فهرستِ داشبورد** — نه از دیپ‌لینک. */
      await m.page.goto(`${UI}/app/dashboard`, { waitUntil: 'networkidle' });
      await m.page.waitForTimeout(1200);
      await m.page.locator('.db-search input').fill(LASTB);
      await m.page.waitForTimeout(1800);
      /* کارت (موبایل) یا ردیفِ جدول (دسکتاپ، global-04) — `.db-code` و `.db-open` در هر دو هست. */
      const cardRow = m.page.locator(':is(.db-card, .db-row)').filter({ has: m.page.locator('.db-code', { hasText: vb.code }) });
      ok('ردیفِ همین مراجعه در فهرستِ داشبورد', await cardRow.count() === 1);
      /* صفحه‌کلید، نه کلیکِ مختصاتی: مرکزِ کارت روی موبایل ممکن است روی لینکِ
         نام (پرونده) بیفتد — `card-targets.mjs` همین دو مقصد را جدا می‌سنجد. */
      await cardRow.locator('.db-open').press('Enter');
      await m.page.waitForTimeout(1800);
      node = dxNodeOf(m.page);
      ok('بازکردنِ دوباره از ردیف: همان اصلی و همان ترتیب',
        (await node.locator('.db-selrow .pk-btn').innerText()).includes(b3.title) && same(await chipIds(node), [b1.id, quickId]),
        JSON.stringify(await chipIds(node)));
      const ids18 = dbIds(vb.id);
      m.patches.length = 0;
      const st2 = await saveAndWait(m.page, vb.id);
      const body2 = m.patches[m.patches.length - 1]?.body ?? {};
      ok('ذخیرهٔ دست‌نخورده همان سایرین را می‌فرستد', st2 === 200 && same(body2.otherDiagnosisIds, [b1.id, quickId]) && body2.diagnosisId === b3.id,
        `${st2} ${JSON.stringify(body2.otherDiagnosisIds)}`);
      ok('… و دیتابیس دست نخورد (شناسهٔ ردیف‌ها ثابت)', dbIds(vb.id) === ids18, `${ids18} → ${dbIds(vb.id)}`);
      ok('بدونِ خطای JS (موبایل)', m.errors.length === 0, m.errors[0]);
    } finally {
      await m.ctx.close();
    }

    /* ── ماتریسِ نما: دو اندازه × دو تم ── */
    for (const [theme, viewport] of [['light', { width: 390, height: 844 }], ['dark', { width: 1280, height: 900 }], ['light', { width: 1280, height: 900 }]]) {
      const v = await open(theme, viewport);
      try {
        await v.page.goto(`${UI}/app/dashboard?patient=${vb.id}`, { waitUntil: 'networkidle' });
        await v.page.waitForTimeout(1500);
        const node = dxNodeOf(v.page);
        const tag18 = `${theme}·${viewport.width}`;
        ok(`${tag18}: تمِ درخواستی روی صفحه`, (await v.page.evaluate(() => document.documentElement.dataset.theme)) === theme);
        ok(`${tag18}: دو چیپ به همان ترتیب`, same(await chipIds(node), [b1.id, quickId]), JSON.stringify(await chipIds(node)));
        const box = await node.locator('[data-coding-chip]').first().boundingBox();
        ok(`${tag18}: چیپ دیده می‌شود و لمس‌پذیر است (≥۳۶px)`, !!box && box.height >= 36, JSON.stringify(box));
        const legible = await node.locator('[data-coding-chip] .cc-name').first().evaluate((el) => {
          /* فقط `rgb()/rgba()`؛ رنگی که مرورگر به فضای دیگری (oklch/color()) برگرداند سنجیدنی نیست، نه «سیاه». */
          const rgb = (s) => (/^rgba?\(/.test(s) ? (s.match(/[\d.]+/g) ?? []).map(Number) : null);
          const lum = ([r, g, b]) => [r, g, b].map((x) => { const c = x / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
            .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
          const fg = rgb(getComputedStyle(el).color);
          if (!fg) return null;
          if (fg.length >= 4 && fg[3] === 0) return 0; // متنِ شفاف — نامرئی
          let n = el.parentElement;
          let bg = null;
          while (n) {
            const c = rgb(getComputedStyle(n).backgroundColor);
            if (!c) return null;
            if (c.length >= 3 && (c.length < 4 || c[3] >= 0.9)) { bg = c; break; }
            n = n.parentElement;
          }
          if (!bg) return null; // پس‌زمینهٔ شیشه‌ای/گرادیان — نسبت سنجیدنی نیست
          const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          return (a + 0.05) / (b + 0.05);
        });
        ok(`${tag18}: متنِ چیپ خواناست (نه شفاف، کنتراست ≥۳ اگر سنجیدنی)`, legible === null || legible >= 3, String(legible));
        ok(`${tag18}: بدونِ selectِ بومی و بدونِ اسکرولِ افقی`,
          await v.page.locator(NATIVE).count() === 0 && await noHScroll(v.page));
        await shot(v.page, `${theme}-${viewport.width}`);
        ok(`${tag18}: بدونِ خطای JS`, v.errors.length === 0, v.errors[0]);
      } finally {
        await v.ctx.close();
      }
    }

    /* ── نقشِ قفل‌شده: فقط‌خواندنی، و PATCH هیچ‌کدام از دو کلید را نمی‌فرستد ── */
    await send(`/forms/fields/${f1dx.id}`, 'PATCH', { roles: ['doctor'] });
    const ids18b = dbIds(vb.id);
    const lk = await open('dark', { width: 1280, height: 900 });
    try {
      setMe('secretary', 5);
      await lk.page.goto(`${UI}/app/dashboard?patient=${vb.id}`, { waitUntil: 'networkidle' });
      await lk.page.waitForTimeout(1600);
      const node = dxNodeOf(lk.page);
      ok('قفل: گرهِ تشخیص داخلِ fieldsetِ غیرفعال', await node.locator('fieldset.db-rolebox[disabled]').count() === 1);
      ok('قفل: دکمه‌های چیپ و «افزودن» بی‌اثرند',
        await node.locator('[data-coding-remove], [data-coding-primary], [data-coding-add] .pk-btn').evaluateAll((els) => els.length > 0 && els.every((e) => e.matches(':disabled'))));
      const st3 = await saveAndWait(lk.page, vb.id);
      const body3 = lk.patches[lk.patches.length - 1]?.body ?? {};
      ok('ذخیره با نقشِ منشی ۲۰۰', st3 === 200, String(st3));
      ok('**نباید بیفتد:** PATCH کلیدِ اصلی یا همزاد را بفرستد', body3 && !('diagnosisId' in body3) && !('otherDiagnosisIds' in body3),
        JSON.stringify(Object.keys(body3 ?? {})));
      ok('… و فهرست دست نخورد', dbIds(vb.id) === ids18b && (await codingOf(vb.id)).p === b3.id);
      ok('بدونِ خطای JS (نقشِ قفل)', lk.errors.length === 0, lk.errors[0]);
    } finally {
      setMe(null, 6);
      await lk.ctx.close();
      await send(`/forms/fields/${f1dx.id}`, 'PATCH', { roles: [] });
    }

    /* ── عملِ آمده از ویزیتِ تصمیم: جعبهٔ «همین‌ها» ── */
    const sForm = (await send('/forms/visit.surgery')).json;
    const sDx = sForm?.fields?.find((x) => x.key === 'diagnosisId');
    if (sDx?.id) {
      restore.fields.push({ id: sDx.id, active: sDx.active });
      await send(`/forms/fields/${sDx.id}`, 'PATCH', { active: true });
    }
    const sp = await open('dark', { width: 1280, height: 900 });
    try {
      await sp.page.goto(`${UI}/app/dashboard?patient=${rX2.json.id}`, { waitUntil: 'networkidle' });
      await sp.page.waitForTimeout(1800);
      /* عملِ آینده روی زبانهٔ «قبل از عمل» باز می‌شود؛ تشخیص در زبانهٔ «مشخصات» است (بازبینیِ UX، surgery-10). */
      await sp.page.locator('.db-sheet .db-phasetabs button').first().click();
      const copy = sp.page.locator('[data-coding-copy]');
      ok('فرمِ عمل جعبهٔ «تشخیصِ ویزیتِ تصمیم» را نشان می‌دهد', await copy.count() === 1);
      ok('… با برچسبِ کاملِ آن ویزیت', (await copy.innerText().catch(() => '')).includes(d1.title) && (await copy.innerText().catch(() => '')).includes(d3.title));
      await copy.locator('button', { hasText: 'همین‌ها' }).click();
      await sp.page.waitForTimeout(500);
      const node = sp.page.locator('.db-sheet .db-builtins > div').filter({ has: sp.page.locator('[data-coding-chips="diagnosis"]') });
      ok('«همین‌ها» فهرست را کپی کرد: اصلی d1، سایرین [d2, d3]',
        (await node.locator('.db-selrow .pk-btn').innerText().catch(() => '')).includes(d1.title) && same(await chipIds(node), [d2.id, d3.id]),
        JSON.stringify(await chipIds(node)));
      ok('جعبه بعد از کپی کنار رفت', await sp.page.locator('[data-coding-copy]').count() === 0);
      const st4 = await saveAndWait(sp.page, rX2.json.id);
      const gs = await codingOf(rX2.json.id);
      ok('و ذخیره همان را روی عمل نشاند', st4 === 200 && gs.p === d1.id && same(gs.o, [d2.id, d3.id]), `${st4} ${JSON.stringify(gs)}`);
      ok('بدونِ خطای JS (فرمِ عمل)', sp.errors.length === 0, sp.errors[0]);
    } finally {
      await sp.ctx.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  setMe(null, 6);
  if (mock) {
    mock.close();
    await send('/settings', 'PATCH', { values: { ai_base_url: '', ai_api_key: '', ai_model: '' } }).catch(() => {});
  }
  for (const f of restore.fields) await send(`/forms/fields/${f.id}`, 'PATCH', { active: f.active }).catch(() => {});
  /* ⚠️ اول مراجعه‌ها: پیوندهای «سایر» با آن‌ها cascade می‌شوند و بعد تعریف‌ها
     واقعاً حذف‌شدنی‌اند (وگرنه فقط غیرفعال می‌شوند). */
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.templates) await send(`/note-templates/${id}`, 'DELETE').catch(() => {});
  /* نقشِ پیگیری **پیش از حذف** برداشته می‌شود (درسِ postop-flow): فرمِ رهاشده
     پایهٔ پیگیریِ سوییت‌های دیگر می‌شد. */
  for (const id of trash.forms) await send(`/forms/${id}`, 'PATCH', { followUp: null }).catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs) await send(`/procedure-types/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.dx) await send(`/diagnoses/${id}`, 'DELETE').catch(() => {});
}

console.log(`\n${pass} سنجه سبز${fails.length ? `، ${fails.length} قرمز` : ''}`);
if (fails.length) { for (const f of fails) console.log('  ✘ ' + f); process.exit(1); }
