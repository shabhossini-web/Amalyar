/**
 * **دستیار با بافتارِ نوعِ عمل و تشخیص** (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳: «وقتی می‌زنیم با AI بنویسد
 * باید نسبت به نوعِ عمل و تشخیص بنویسد که نمی‌نویسد»). سمتِ API، با سرویسِ AIِ ساختگی؛ رابط در
 * `surgery-subform-phases-ui.mjs`.
 *
 *  باید بیفتد:
 *   - پیش‌نویسِ مراقبتِ **فرمِ ثبت‌نشده** (بی‌مراجعه) با شناسه‌های فرم: نامِ عمل و تشخیص در پیام،
 *     قالبِ همان مرحلهٔ عملِ اصلی پایه، و دستورِ «پیش از عمل» برای مرحلهٔ قبل
 *   - مراقبتِ «بعد»: قالبِ بعد از عمل + شرحِ عملِ خودِ فرم
 *   - فرم مقدم بر مراجعهٔ ذخیره‌شده (عملِ تازه‌انتخاب در پیام است، عملِ ذخیره‌شده نه)
 *   - متنی که کاربر تا این‌جا نوشته همراه می‌رود
 *   - دستیارِ کادرها (text-draft): خطِ «بافتار» با عمل و تشخیص؛ `care` دستورِ مراقبتِ پیامکی را می‌دهد
 *   - شرح‌نویس (note-draft): شناسه‌های فرم بر عملِ ذخیره‌شدهٔ مراجعه مقدم‌اند
 *  نباید بیفتد:
 *   - فرمِ بی‌بافتار یا بدنهٔ خالی «مراقبتِ عمومی» بگیرد (۴۰۰)
 *   - کاربرِ زیرِ سوپروایزر از شرحِ عملِ مراجعه‌ای که نمی‌بیند پیش‌نویس بگیرد
 *   - بدنهٔ کهنهٔ `{visitId}` رفتارش عوض شود (قالبِ بعد از عمل، عمل و تشخیصِ مراجعه)
 *   - کادری که بیرونِ فرمِ مراجعه است (بی‌بافتار) خطِ «بافتار» بگیرد
 *   - شناسهٔ غیرعددی پذیرفته شود
 *   - نام یا شمارهٔ بیمار به سرویسِ بیرونی برود
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const PHONE = '0912' + String(Math.floor(1e6 + Math.random() * 9e6));

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};

const tag = 'ac' + randomBytes(3).toString('hex');
let mockReply = 'جواب';
const captured = [];
const mock = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    captured.push({ body: JSON.parse(data || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: mockReply } }] }));
  });
});
await new Promise((r) => mock.listen(3199, '127.0.0.1', r));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m = 'GET', b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const setAi = (values) => send('/settings', 'PATCH', { values });
const msg = (r) => String(r?.json?.message ?? '');
/** آخرین درخواستِ رسیده به سرویسِ AI — [system, user]. */
const last = () => {
  const m = captured[captured.length - 1]?.body?.messages ?? [];
  return [String(m[0]?.content ?? ''), String(m[1]?.content ?? '')];
};

const trash = { visits: [], procs: [], diags: [], accounts: [] };

try {
  console.log('۱) چیدمان: دو نوعِ عمل با قالب، یک تشخیص، یک عملِ ذخیره‌شده');
  await setAi({ ai_base_url: 'http://127.0.0.1:3199/v1', ai_api_key: `key-${tag}`, ai_model: 'mock-1' });
  const pA = (await send('/procedure-types', 'POST', {
    name: `عملِ الف ${tag}`, preOpCare: `از نیمه‌شب ناشتا باشید ${tag}`, postOpCare: `پانسمان را خشک نگه دارید ${tag}`,
  })).json;
  const pB = (await send('/procedure-types', 'POST', { name: `عملِ ب ${tag}`, preOpCare: `قطعِ آسپرین طبقِ دستور ${tag}` })).json;
  const dx = (await send('/diagnoses', 'POST', { title: `تشخیصِ ${tag}` })).json;
  trash.procs.push(pA?.id, pB?.id);
  trash.diags.push(dx?.id);
  const surgeon = (await send('/surgeons')).json?.[0] ?? (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `بافتار${tag}` })).json;
  const hospital = (await send('/hospitals')).json?.[0] ?? (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;
  const vr = await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'بیمارِ', lastName: `بافتار${tag}`, phone: PHONE,
    opDate: new Date(Date.now() + 3 * 864e5).toISOString(), surgeonId: surgeon?.id, hospitalId: hospital?.id,
    procedureTypeId: pA?.id, diagnosisId: dx?.id,
  });
  const V = vr.json;
  if (V?.id) trash.visits.push(V.id);
  ok('تعریف‌ها و عملِ ذخیره‌شده ساخته شدند', [pA, pB, dx].every((x) => x?.id) && vr.status === 201, `${vr.status} ${msg(vr)}`);

  console.log('\n۲) مراقبتِ «قبل از عمل» از فرمِ ثبت‌نشده');
  mockReply = `- از شب قبل ناشتا باشید. [${tag}]`;
  let r = await send('/ai/care-draft', 'POST', { phase: 'pre', procedureTypeIds: [pB.id], diagnosisIds: [dx.id] });
  let [sys, usr] = last();
  ok('**پیش‌نویس بی‌مراجعه برگشت** (فرمِ ثبت‌نشده)', r.status < 300 && (r.json?.text ?? '').includes(`[${tag}]`), `${r.status} ${msg(r)}`);
  ok('**نامِ عمل و تشخیصِ فرم در پیام است**', usr.includes(`نوعِ عمل: ${pB.name}`) && usr.includes(`تشخیص: ${dx.title}`), usr.slice(0, 200));
  ok('دستورِ «پیش از عمل» (آمادگی، ناشتایی)', sys.includes('مراقبت‌های پیش از عمل') && sys.includes('ناشتایی'), sys.slice(0, 200));
  ok('**قالبِ «قبل از عمل»ِ همان عمل پایه است**', sys.includes(`قطعِ آسپرین طبقِ دستور ${tag}`) && !sys.includes(`ناشتا باشید ${tag}`), sys.slice(-300));
  ok('نامِ دارو و دوز اختراع نشود («طبقِ دستورِ پزشک»)', sys.includes('طبقِ دستورِ پزشک'));

  console.log('\n۳) مراقبتِ «بعد از عمل» — چند عمل، شرحِ خودِ فرم');
  r = await send('/ai/care-draft', 'POST', {
    phase: 'post', procedureTypeIds: [pA.id, pB.id], diagnosisIds: [dx.id], opReport: `شرحِ فرم: بخیهٔ جذبی ${tag}`,
  });
  [sys, usr] = last();
  ok('پیش‌نویسِ «بعد» برگشت', r.status < 300, `${r.status} ${msg(r)}`);
  ok('**همهٔ عمل‌ها، اصلی اول و صریح**', usr.includes(`نوعِ عمل: ${pA.name} (اصلی)، ${pB.name}`), usr.split('\n')[0]);
  ok('**پایه: قالبِ «بعد»ِ عملِ اصلی**', sys.includes(`پانسمان را خشک نگه دارید ${tag}`) && sys.includes(`عملِ اصلی («${pA.name}»)`), sys.slice(-300));
  ok('**شرحِ عملِ فرم (ثبت‌نشده) در پیام است**', usr.includes(`شرحِ عمل:\nشرحِ فرم: بخیهٔ جذبی ${tag}`), usr.slice(-200));

  console.log('\n۴) فرم مقدم بر مراجعهٔ ذخیره‌شده؛ متنِ فعلی همراه می‌رود');
  r = await send('/ai/care-draft', 'POST', { visitId: V.id, phase: 'pre', procedureTypeIds: [pB.id], diagnosisIds: [], text: `متنِ نوشتهٔ من ${tag}` });
  [sys, usr] = last();
  ok('**عملِ تازه‌انتخاب در پیام است، عملِ ذخیره‌شده نه**', r.status < 300 && usr.includes(pB.name) && !usr.includes(pA.name), usr.slice(0, 200));
  ok('**تشخیصِ برداشته‌شده در فرم نمی‌رود**', !usr.includes(dx.title), usr.slice(0, 200));
  ok('**متنِ فعلیِ کادر همراه رفت و دستور می‌گوید پایه بگیر**', usr.includes(`متنِ فعلی:\nمتنِ نوشتهٔ من ${tag}`) && sys.includes('همان را پایه بگیر'), usr.slice(-120));

  console.log('\n۵) نباید بیفتد');
  r = await send('/ai/care-draft', 'POST', { phase: 'pre', procedureTypeIds: [], diagnosisIds: [] });
  ok('**فرمِ بی‌بافتار «مراقبتِ عمومی» نمی‌گیرد (۴۰۰)**', r.status === 400 && msg(r).includes('نوعِ عمل یا تشخیص'), `${r.status} ${msg(r)}`);
  const before = captured.length;
  r = await send('/ai/care-draft', 'POST', {});
  ok('**بدنهٔ خالی هم «مراقبتِ عمومی» نمی‌گیرد (۴۰۰، بی‌تماس با سرویس)**', r.status === 400 && captured.length === before, `${r.status} ${msg(r)}`);
  r = await send('/ai/care-draft', 'POST', { phase: 'pre', procedureTypeIds: ['x'] });
  ok('شناسهٔ غیرعددی ۴۰۰', r.status === 400, `${r.status} ${msg(r)}`);
  r = await send('/ai/care-draft', 'POST', { phase: 'lunch', procedureTypeIds: [pA.id] });
  ok('مرحلهٔ ساختگی ۴۰۰', r.status === 400, `${r.status} ${msg(r)}`);
  r = await send('/ai/care-draft', 'POST', { visitId: V.id });
  [sys, usr] = last();
  ok('**بدنهٔ کهنهٔ `{visitId}`: همان رفتارِ دیروز** (قالبِ «بعد»، عمل و تشخیصِ مراجعه)',
    r.status < 300 && sys.includes(`پانسمان را خشک نگه دارید ${tag}`) && usr.includes(`نوعِ عمل: ${pA.name}`) && usr.includes(`تشخیص: ${dx.title}`),
    `${r.status} ${usr.slice(0, 160)}`);

  /* دامنهٔ دید: کارشناس‌ادمینِ (سطحِ ۳) بی‌ربط به این مراجعه — شرحِ عملش نباید به پیش‌نویسِ او برسد. */
  const ta = (await send('/accounts/temporary', 'POST', {
    firstName: 'کارشناسِ', lastName: `بافتار${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
    level: 3, jobRole: 'technician', username: `ac${tag}`,
  })).json;
  const taLogin = ta?.temporaryPassword ? await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: `ac${tag}`, password: ta.temporaryPassword }),
  }).then((x) => x.json()) : null;
  if (ta?.account?.id) trash.accounts.push(ta.account.id);
  if (taLogin?.accessToken) {
    const beforeTa = captured.length;
    const rt = await fetch(API + '/ai/care-draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + taLogin.accessToken },
      body: JSON.stringify({ visitId: V.id }),
    }).then(async (x) => ({ status: x.status, json: await x.json().catch(() => null) }));
    ok('**کارشناس‌ادمینِ بی‌ربط از شرحِ این مراجعه پیش‌نویس نمی‌گیرد** (۴۰۰، بی‌تماس با سرویس)',
      rt.status === 400 && msg(rt).includes('مراجعه پیدا نشد') && captured.length === beforeTa, `${rt.status} ${msg(rt)}`);
  } else ok('حسابِ کارشناس‌ادمین ساخته شد', false, JSON.stringify(ta).slice(0, 160));

  console.log('\n۶) دستیارِ کادرها (text-draft)');
  r = await send('/ai/text-draft', 'POST', {
    text: 'زخم تمیز است', mode: 'structure', purpose: 'شرح معاینه',
    context: { procedureTypeIds: [pA.id], diagnosisIds: [dx.id] },
  });
  [sys, usr] = last();
  ok('**خطِ بافتار: عمل و تشخیص**', r.status < 300 && usr.includes(`بافتار: نوعِ عمل: ${pA.name}؛ تشخیص: ${dx.title}`), `${r.status} ${usr.slice(0, 200)}`);
  ok('مستندِ بالینی: بافتار فقط اصطلاح و سرفصل، نه یافتهٔ تازه', sys.includes('بافتارِ مراجعه') && sys.includes('یافته یا عددی که در متن نیست نساز'), sys.slice(0, 300));
  r = await send('/ai/text-draft', 'POST', {
    text: 'ناشتا باشید', mode: 'continue', purpose: 'مراقبت‌های قبل از عمل — پیامک به بیمار',
    context: { procedureTypeIds: [pA.id], diagnosisIds: [dx.id], care: 'pre' },
  });
  [sys, usr] = last();
  ok('**کادرِ مراقبت: دستورِ پیامکِ بیمار، متناسب با همان عمل**',
    r.status < 300 && sys.includes('مراقبت‌های پیش از عمل') && sys.includes('متناسب با همین نوعِ عمل و تشخیص') && sys.includes('طبقِ دستورِ پزشک'),
    `${r.status} ${sys.slice(0, 300)}`);
  r = await send('/ai/text-draft', 'POST', { text: 'متنِ آزاد', mode: 'structure', purpose: 'یادداشت' });
  [, usr] = last();
  ok('نباید بیفتد: کادرِ بی‌بافتار (بیرونِ فرمِ مراجعه) خطِ «بافتار» بگیرد', r.status < 300 && !usr.includes('بافتار'), usr.slice(0, 120));
  r = await send('/ai/text-draft', 'POST', { text: 'متن', mode: 'structure', context: { care: 'lunch' } });
  ok('مراقبتِ مرحلهٔ ساختگی ۴۰۰', r.status === 400, `${r.status} ${msg(r)}`);

  console.log('\n۷) شرح‌نویس (note-draft): فرم مقدم بر مراجعه');
  r = await send('/ai/note-draft', 'POST', {
    patientId: V.patientId, visitId: V.id, kind: 'op', mode: 'structure', text: 'شرحِ خام',
    procedureTypeIds: [pB.id], diagnosisIds: [dx.id],
  });
  [, usr] = last();
  ok('**عملِ تازه‌انتخابِ فرم در بافتارِ شرح است، نه عملِ ذخیره‌شده**',
    r.status < 300 && usr.split('\n')[0] === `بافتار: نوعِ عمل/خدمت: ${pB.name}؛ تشخیص: ${dx.title}`, `${r.status} ${usr.split('\n')[0]}`);
  r = await send('/ai/note-draft', 'POST', { patientId: V.patientId, visitId: V.id, kind: 'op', mode: 'structure', text: 'شرحِ خام' });
  [, usr] = last();
  ok('بی‌شناسه: همان عمل و تشخیصِ ذخیره‌شده (رفتارِ دیروز)', usr.split('\n')[0] === `بافتار: نوعِ عمل/خدمت: ${pA.name}؛ تشخیص: ${dx.title}`, usr.split('\n')[0]);

  const everything = JSON.stringify(captured);
  ok('**نباید بیفتد:** نام یا شمارهٔ بیمار به سرویسِ بیرونی برود', !everything.includes(`بافتار${tag}`) && !everything.includes(PHONE));
} catch (e) {
  ok('اجرا متوقف شد: ' + (e?.stack ?? e), false);
} finally {
  mock.close();
  await setAi({ ai_base_url: '', ai_api_key: '', ai_model: '' }).catch(() => {});
  for (const id of trash.visits.filter(Boolean)) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs.filter(Boolean)) await send(`/procedure-types/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.diags.filter(Boolean)) await send(`/diagnoses/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) await send(`/accounts/${id}`, 'DELETE').catch(() => {});
}

console.log(`\n${pass} سنجه سبز${fails.length ? `، ${fails.length} قرمز` : ''}`);
if (fails.length) { for (const f of fails) console.log('  ✘ ' + f); process.exit(1); }
