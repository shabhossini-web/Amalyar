/**
 * **دامنهٔ دیدِ دستیارِ بالینی** (object-authz، قانونِ ۴) — کاربرِ زیرِ سوپروایزر فقط پرونده و مراجعهٔ
 * منتسب به خودش را می‌بیند؛ دستیار هم نباید شرح و سابقهٔ مراجعهٔ دیگری را به سرویسِ بیرونی بفرستد
 * و متنِ ساخته‌شده از آن را برگرداند. هم‌خانوادهٔ سنجهٔ `careDraft` در `ai-care-context.mjs`.
 *
 *  چیدمان: کارشناس‌ادمینِ (سطحِ ۳) موقت · پروندهٔ «مشترک» با یک مراجعهٔ منتسب به او و یک مراجعهٔ
 *  بیگانه · پروندهٔ «بیگانه» با یک مراجعهٔ بیگانه.
 *
 *  باید بیفتد:
 *   - کارشناس‌ادمین روی مراجعه/پروندهٔ بیگانه از note-draft (عادی و استریم)، record-summary و
 *     suggest-codes همان ۴۰۰ِ «پیدا نشد» را بگیرد — **بی‌هیچ تماسی با سرویسِ AI**
 *   - روی مراجعهٔ خودش هر سه کار کنند؛ خلاصهٔ پروندهٔ مشترک فقط مراجعه و شرحِ خودش (و شرحِ
 *     بی‌مراجعهٔ پرونده) را بفرستد
 *   - ادمین مثلِ دیروز همه‌چیز را ببیند
 *  نباید بیفتد:
 *   - عمل یا شرحِ مراجعهٔ بیگانه در هیچ درخواستی از کارشناس‌ادمین به سرویس برسد
 *   - پیام‌های «پیدا نشد» عوض شوند (کلاینت رویشان شاخه نمی‌زند، ولی وجودِ پرونده هم نباید لو برود)
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};

const tag = 'os' + randomBytes(3).toString('hex');
const IC = `OS${tag.slice(2, 6).toUpperCase()}`;
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

const loginAs = (identifier, password) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
}).then((r) => r.json());
const client = (token) => (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const login = await loginAs(process.env.E2E_USER ?? 'admin', process.env.E2E_PASS ?? 'test1234');
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = client(login.accessToken);
const setAi = (values) => send('/settings', 'PATCH', { values });
const msg = (r) => String(r?.json?.message ?? '');
/** همهٔ درخواست‌هایی که از شمارهٔ `from` به بعد به سرویسِ AI رسیده‌اند، یک‌جا. */
const since = (from) => JSON.stringify(captured.slice(from));
const lastUser = () => String(captured[captured.length - 1]?.body?.messages?.[1]?.content ?? '');

const trash = { visits: [], procs: [], diags: [], codes: [], accounts: [] };

try {
  console.log('۱) چیدمان');
  await setAi({ ai_base_url: 'http://127.0.0.1:3199/v1', ai_api_key: `key-${tag}`, ai_model: 'mock-1' });
  const pOwn = (await send('/procedure-types', 'POST', { name: `عملِ خودی ${tag}` })).json;
  const pForeign = (await send('/procedure-types', 'POST', { name: `عملِ بیگانه ${tag}` })).json;
  const dx = (await send('/diagnoses', 'POST', { title: `تشخیصِ ${tag}` })).json;
  const ic = (await send('/internal-codes', 'POST', { code: IC, name: `خدمتِ ${tag}`, price: 100000 })).json;
  trash.procs.push(pOwn?.id, pForeign?.id);
  trash.diags.push(dx?.id);
  trash.codes.push(ic?.id);
  const surgeon = (await send('/surgeons')).json?.[0] ?? (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `دامنه${tag}` })).json;
  const hospital = (await send('/hospitals')).json?.[0] ?? (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;

  const ta = (await send('/accounts/temporary', 'POST', {
    firstName: 'کارشناسِ', lastName: `دامنه${tag}`, phone: phone(), level: 3, jobRole: 'technician', username: `os${tag}`,
  })).json;
  if (ta?.account?.id) trash.accounts.push(ta.account.id);
  const taLogin = ta?.temporaryPassword ? await loginAs(`os${tag}`, ta.temporaryPassword) : null;
  ok('حسابِ کارشناس‌ادمینِ سطحِ ۳ ساخته شد و وارد شد', !!taLogin?.accessToken && ta.account.level === 3, JSON.stringify(ta).slice(0, 160));
  const T = client(taLogin?.accessToken ?? '');

  const visitBody = (extra) => ({
    kind: 'surgery', opDate: new Date(Date.now() + 3 * 864e5).toISOString(),
    surgeonId: surgeon?.id, hospitalId: hospital?.id, diagnosisId: dx?.id, ...extra,
  });
  /* پروندهٔ مشترک: یک مراجعهٔ بیگانه (X) و یک مراجعهٔ منتسب به کارشناس‌ادمین (Y). */
  const X = (await send('/visits', 'POST', visitBody({ firstName: 'بیمارِ', lastName: `مشترک${tag}`, phone: phone(), procedureTypeId: pForeign?.id }))).json;
  const P1 = X?.patientId;
  const Y = (await send('/visits', 'POST', visitBody({ patientId: P1, procedureTypeId: pOwn?.id, techId: ta?.account?.id }))).json;
  /* پروندهٔ بیگانه: کارشناس‌ادمین هیچ مراجعه‌ای در آن ندارد. */
  const Z = (await send('/visits', 'POST', visitBody({ firstName: 'بیمارِ', lastName: `بیگانه${tag}`, phone: phone(), procedureTypeId: pForeign?.id }))).json;
  const P2 = Z?.patientId;
  for (const v of [X, Y, Z]) if (v?.id) trash.visits.push(v.id);
  ok('سه مراجعه ساخته شد؛ Y منتسب به کارشناس‌ادمین، X و Z نه',
    [X, Y, Z].every((v) => v?.id) && Y.patientId === P1 && Y.techId === ta?.account?.id && !X.techId && !Z.techId,
    JSON.stringify([X, Y, Z].map((v) => [v?.id, v?.patientId, v?.techId, v?.message])));

  await send(`/patients/${P1}/notes`, 'POST', { kind: 'op', visitId: X.id, body: `شرحِ بیگانه ${tag}: برشِ پنهان` });
  await send(`/patients/${P1}/notes`, 'POST', { kind: 'op', visitId: Y.id, body: `شرحِ خودی ${tag}: ${IC} انجام شد` });
  await send(`/patients/${P1}/notes`, 'POST', { kind: 'history', body: `شرحِ حالِ پرونده ${tag}` });
  await send(`/patients/${P2}/notes`, 'POST', { kind: 'op', visitId: Z.id, body: `شرحِ پروندهٔ بیگانه ${tag}` });

  console.log('\n۲) کارشناس‌ادمین روی دادهٔ بیگانه — ۴۰۰ِ «پیدا نشد»، بی‌تماس با سرویس');
  const before = captured.length;
  let r = await T('/ai/note-draft', 'POST', { patientId: P2, visitId: Z.id, kind: 'op', mode: 'structure', text: 'شرحِ خام' });
  ok('**note-draft روی پروندهٔ بیگانه: ۴۰۰ «پرونده پیدا نشد»**', r.status === 400 && msg(r) === 'پرونده پیدا نشد', `${r.status} ${msg(r)}`);
  r = await T('/ai/note-draft', 'POST', { patientId: P2, kind: 'op', mode: 'structure', text: 'شرحِ خام' });
  ok('note-draft روی پروندهٔ بیگانه بی‌مراجعه هم ۴۰۰', r.status === 400 && msg(r) === 'پرونده پیدا نشد', `${r.status} ${msg(r)}`);
  r = await T('/ai/note-draft', 'POST', { patientId: P1, visitId: X.id, kind: 'op', mode: 'structure', text: 'شرحِ خام' });
  ok('**note-draft روی مراجعهٔ بیگانهٔ پروندهٔ مشترک: ۴۰۰ «مراجعهٔ انتخابی برای این بیمار نیست»**',
    r.status === 400 && msg(r) === 'مراجعهٔ انتخابی برای این بیمار نیست', `${r.status} ${msg(r)}`);
  r = await T('/ai/note-draft/stream', 'POST', { patientId: P2, visitId: Z.id, kind: 'op', mode: 'structure', text: 'شرحِ خام' });
  ok('**note-draft/stream روی پروندهٔ بیگانه: ۴۰۰**', r.status === 400 && msg(r) === 'پرونده پیدا نشد', `${r.status} ${msg(r)}`);
  r = await T('/ai/note-draft/stream', 'POST', { patientId: P1, visitId: X.id, kind: 'op', mode: 'continue', text: 'شرحِ خام' });
  ok('note-draft/stream روی مراجعهٔ بیگانهٔ پروندهٔ مشترک: ۴۰۰', r.status === 400 && msg(r) === 'مراجعهٔ انتخابی برای این بیمار نیست', `${r.status} ${msg(r)}`);
  r = await T('/ai/record-summary', 'POST', { patientId: P2 });
  ok('**record-summary روی پروندهٔ بیگانه: ۴۰۰ «پرونده پیدا نشد»**', r.status === 400 && msg(r) === 'پرونده پیدا نشد', `${r.status} ${msg(r)}`);
  r = await T('/ai/suggest-codes', 'POST', { visitId: X.id });
  ok('**suggest-codes روی مراجعهٔ بیگانه: ۴۰۰ «مراجعه پیدا نشد»**', r.status === 400 && msg(r) === 'مراجعه پیدا نشد', `${r.status} ${msg(r)}`);
  r = await T('/ai/suggest-codes', 'POST', { visitId: Z.id });
  ok('suggest-codes روی مراجعهٔ پروندهٔ بیگانه: ۴۰۰', r.status === 400 && msg(r) === 'مراجعه پیدا نشد', `${r.status} ${msg(r)}`);
  ok('**هیچ‌کدام به سرویسِ AI نرسید**', captured.length === before, `${captured.length - before} درخواست`);

  console.log('\n۳) کارشناس‌ادمین روی مراجعهٔ خودش — مثلِ دیروز، ولی فقط دادهٔ خودش');
  let from = captured.length;
  mockReply = `پیش‌نویس [${tag}]`;
  r = await T('/ai/note-draft', 'POST', { patientId: P1, visitId: Y.id, kind: 'op', mode: 'structure', text: 'شرحِ خام' });
  ok('**note-draft روی مراجعهٔ خودش کار می‌کند**',
    r.status < 300 && (r.json?.text ?? '').includes(`[${tag}]`) && lastUser().includes(pOwn.name), `${r.status} ${msg(r)} ${lastUser().split('\n')[0]}`);
  mockReply = `خلاصه [${tag}]`;
  r = await T('/ai/record-summary', 'POST', { patientId: P1 });
  const data = lastUser();
  ok('**record-summary روی پروندهٔ مشترک کار می‌کند**', r.status < 300 && (r.json?.text ?? '').includes(`[${tag}]`), `${r.status} ${msg(r)}`);
  ok('**خلاصه: مراجعه و شرحِ خودش + شرحِ بی‌مراجعهٔ پرونده**',
    data.includes(pOwn.name) && data.includes(`شرحِ خودی ${tag}`) && data.includes(`شرحِ حالِ پرونده ${tag}`), data.slice(0, 400));
  mockReply = `${IC}`;
  r = await T('/ai/suggest-codes', 'POST', { visitId: Y.id });
  ok('**suggest-codes روی مراجعهٔ خودش کار می‌کند**', r.status < 300 && (r.json?.suggestions ?? []).some((s) => s.code === IC), `${r.status} ${msg(r)}`);
  const own = since(from);
  ok('**نباید بیفتد: عمل یا شرحِ مراجعهٔ بیگانه به سرویس برسد**',
    !own.includes(pForeign.name) && !own.includes(`شرحِ بیگانه ${tag}`) && !own.includes(`شرحِ پروندهٔ بیگانه ${tag}`), own.slice(0, 300));

  console.log('\n۴) ادمین — بی‌تغییر');
  from = captured.length;
  mockReply = `پیش‌نویسِ ادمین [${tag}]`;
  r = await send('/ai/note-draft', 'POST', { patientId: P2, visitId: Z.id, kind: 'op', mode: 'structure', text: 'شرحِ خام' });
  ok('ادمین: note-draft روی هر پرونده', r.status < 300 && lastUser().includes(pForeign.name), `${r.status} ${msg(r)}`);
  mockReply = `خلاصهٔ ادمین [${tag}]`;
  r = await send('/ai/record-summary', 'POST', { patientId: P1 });
  const all = lastUser();
  ok('**ادمین: خلاصه همهٔ مراجعه‌ها و شرح‌های پرونده را دارد**',
    r.status < 300 && all.includes(pOwn.name) && all.includes(pForeign.name) && all.includes(`شرحِ بیگانه ${tag}`) && all.includes(`شرحِ خودی ${tag}`),
    `${r.status} ${all.slice(0, 400)}`);
  mockReply = `${IC}`;
  r = await send('/ai/suggest-codes', 'POST', { visitId: Y.id });
  ok('ادمین: suggest-codes روی هر مراجعه', r.status < 300 && (r.json?.suggestions ?? []).some((s) => s.code === IC), `${r.status} ${msg(r)}`);
  r = await send('/ai/record-summary', 'POST', { patientId: 999999999 });
  ok('ادمین: پروندهٔ ناموجود همان ۴۰۰ «پرونده پیدا نشد»', r.status === 400 && msg(r) === 'پرونده پیدا نشد', `${r.status} ${msg(r)}`);
  ok('ادمین: سه درخواست به سرویس رسید', captured.length - from === 3, `${captured.length - from}`);

  const everything = JSON.stringify(captured);
  ok('نام یا شمارهٔ بیمار به سرویسِ بیرونی نرفت', !everything.includes(`مشترک${tag}`) && !everything.includes(`بیگانه${tag}`));
} catch (e) {
  ok('اجرا متوقف شد: ' + (e?.stack ?? e), false);
} finally {
  mock.close();
  await setAi({ ai_base_url: '', ai_api_key: '', ai_model: '' }).catch(() => {});
  for (const id of trash.visits.filter(Boolean)) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.codes.filter(Boolean)) await send(`/internal-codes/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.procs.filter(Boolean)) await send(`/procedure-types/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.diags.filter(Boolean)) await send(`/diagnoses/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) await send(`/accounts/${id}`, 'DELETE').catch(() => {});
}

console.log(`\n${pass} سنجه سبز${fails.length ? `، ${fails.length} قرمز` : ''}`);
if (fails.length) { for (const f of fails) console.log('  ✘ ' + f); process.exit(1); }
