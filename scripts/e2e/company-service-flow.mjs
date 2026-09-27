/**
 * **جریانِ شرکتیِ نورومانیتورینگ از ثبت‌نام تا کارشناس** — گزارشِ مالک ۱۴۰۵/۰۷/۰۵ روی roham:
 *
 *   ۱. «کارشناس باید وضعیتِ عمل را تعیین کند — انجام شد، موکول شد یا کلاً لغو شد»
 *   ۲. «ساعتِ عمل موقعِ تأیید بی‌معناست؛ نوعِ عمل از فرمِ بیمار بیاید و نزدیک‌ترینش انتخاب شود،
 *      اگر در فهرستِ ما نیست نوشتهٔ بیمار نشان داده شود»
 *   ۳. «بعد از انتخابِ اولین عکسِ فیش، فرم خودبه‌خود می‌رود مرحلهٔ بعد و اجازهٔ چند عکس نمی‌دهد»
 *   ۴. «چرا فرمِ عمل ساخته می‌شود؛ باید مراجعهٔ نورومانیتورینگ ساخته شود»
 *   ۵. «گزارش و شرحِ عمل را از هم تفکیک کن» — شرکت گزارشِ خدمت دارد، مطب شرحِ عمل
 *
 *  باید بیفتد:
 *   - فیشِ دوم پس از رفتنِ ثبت‌نام به «در انتظارِ بررسی» هم پذیرفته می‌شود (سرور؛ رابط در `company-flow-ui`)
 *   - نوعِ عمل: نزدیک‌ترینِ یکتا پیشنهاد می‌شود؛ وقتی چیزی نزدیک نیست `null`
 *   - مراجعهٔ تأییدشده «نورومانیتورینگ» نام دارد (مراجعه، پرونده، «الان کجاییم»، پرتالِ بیمار) و
 *     فرمش «فرمِ نورومانیتورینگ»؛ نامِ دستیِ مدیر دست نمی‌خورد
 *   - کارشناس: «موکول» بی‌تاریخ و با تاریخ، «انجام شد»، «لغو» با دلیل؛ رویداد و ممیزی
 *   - نامِ سندِ گزارش «گزارشِ نورومانیتورینگ» است و پنل همان را نشان می‌دهد
 *   - مطب: کاشیِ «پنلِ کارشناسی» و «چینش» حتی برای سوپرادمین نیست
 *  نباید بیفتد:
 *   - «موکول» به گذشته، لغوِ بی‌دلیل، تغییرِ وضعیتِ ثبت‌شده از پنلِ کارشناس
 *   - کارشناسِ دیگر روی عملِ این کارشناس وضعیت بزند
 *   - دو نوعِ عملِ هم‌فاصله یکی را سکه‌ای برنده کنند
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { captchaFor } from './lib/captcha.mjs';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB;
if (![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });

let pass = 0;
const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fails.push(m); console.log(`  ✘ ${m}${d ? ` — ${d}` : ''}`); } };
async function api(path, body, method = body ? 'POST' : 'GET', token) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const upload = async (path, token) => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048)])], { type: 'image/jpeg' }), 'x.jpg');
  const r = await fetch(API + path, { method: 'POST', body: fd, headers: token ? { Authorization: 'Bearer ' + token } : {} });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const set = (key, value) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
const tag = randomBytes(3).toString('hex');
let seed = Number.parseInt(randomBytes(3).toString('hex'), 16);
function nid(n) { const b = String(n % 1e9).padStart(9, '0'); let s = 0; for (let i = 0; i < 9; i++) s += +b[i] * (10 - i); const r = s % 11; return b + (r < 2 ? r : 11 - r); }
const phone = () => '0912' + String(1000000 + ((seed += 13) % 8999999));
const isoDay = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

const auth = (await api('/auth/login', { identifier: 'admin', password: 'test1234' })).data?.accessToken;
if (!auth) throw new Error('ورودِ ادمین');
const vertical0 = (await db.setting.findUnique({ where: { key: 'vertical' } }))?.value ?? null;
await set('vertical', 'ionm'); await set('services', JSON.stringify(['ionm']));
for (const k of ['tech', 'dispatch']) await db.feature.updateMany({ where: { key: k }, data: { enabled: true } });

const mkTech = async (u, last) => {
  const made = (await api('/accounts/temporary', { firstName: 'کارشناسِ', lastName: `${last}${tag}`, phone: phone(), level: 2, jobRole: 'technician', username: `${u}${tag}` }, 'POST', auth)).data;
  if (!made?.account?.id) throw new Error('حسابِ کارشناس: ' + JSON.stringify(made).slice(0, 160));
  const t = (await api('/auth/login', { identifier: `${u}${tag}`, password: made.temporaryPassword })).data?.accessToken;
  if (!t) throw new Error('ورودِ کارشناس');
  return { id: made.account.id, token: t };
};

try {
  console.log('\n۱) ثبت‌نام: فیشِ دوم پس از «در انتظارِ بررسی»');
  await api('/forms', null, 'GET', auth);
  const ionm = await db.formDef.findUnique({ where: { key: 'intake.ionm' } });
  const bank = await db.bankAccount.create({ data: { bankName: 'ملت', ownerName: `شرکت ${tag}`, cardNumber: '6104337912345678', showOnIntake: true } });
  const link = await api('/intake/links', { title: `نورو ${tag}`, formId: ionm.id, amount: 40000000, bankAccountId: bank.id }, 'POST', auth);
  if (!link.data?.token) throw new Error('لینک: ' + JSON.stringify(link.data));
  const hosp = await db.hospital.create({ data: { name: `بیمارستان آراد ${tag}` } });
  const surgeon = await db.surgeon.create({ data: { person: { create: { firstName: 'علیرضا', lastName: `طبیب ${tag}` } } } });
  for (const n of [`BT${tag}`, `اسکولیوز ${tag}`]) await db.procedureType.create({ data: { name: n } });
  const register = async (procedure) => {
    seed += 7;
    const r = await api(`/public/intake/link/${link.data.token}/register`, { firstName: 'سید', lastName: `شهاب ${tag}`, nationalId: nid(seed * 7919), phone: phone(), ...(await captchaFor(API, link.data.token)) });
    const t = r.data?.token;
    if (!t) throw new Error('ثبت‌نام: ' + JSON.stringify(r.data));
    for (const f of ['nationalIdImage', 'prescription']) await upload(`/public/intake/form/${t}/image/${f}`);
    const fill = await api(`/public/intake/form/${t}/fill`, { values: { hospitalName: hosp.name, hospitalId: hosp.id, surgeonName: 'طبیب', procedure, opDate: isoDay(1) }, opDate: isoDay(1) });
    if (fill.data?.status !== 'pending_payment') throw new Error('ثبت: ' + JSON.stringify(fill.data).slice(0, 200));
    return t;
  };
  const token = await register('کرانیوتومی');
  const r1 = await upload(`/public/intake/form/${token}/receipt`);
  ok(r1.status === 201 && r1.data?.status === 'pending_approval', 'فیشِ اول ← «در انتظارِ بررسی»', `${r1.status} ${r1.data?.status}`);
  const r2 = await upload(`/public/intake/form/${token}/receipt`);
  const ids = r2.data?.data?.receiptDocumentIds ?? [];
  ok(r2.status === 201 && ids.length === 2, '**فیشِ دوم** پس از آن هم پذیرفته شد (دو فیش روی ثبت‌نام)', `${r2.status} ${JSON.stringify(ids)}`);

  console.log('\n۲) نوعِ عمل: نزدیک‌ترین، نه سکه');
  const sub = await db.intakeSubmission.findUnique({ where: { token } });
  let refs = (await api(`/intake/submissions/${sub.id}/refs`, null, 'GET', auth)).data;
  ok(refs && refs.procedure === null, '«کرانیوتومی» با فهرستِ BT/اسکولیوز ← هیچ پیشنهادی (نوشتهٔ بیمار نشان داده می‌شود)', JSON.stringify(refs?.procedure));
  const crani = await db.procedureType.create({ data: { name: `کرانیوتومی مغز ${tag}` } });
  refs = (await api(`/intake/submissions/${sub.id}/refs`, null, 'GET', auth)).data;
  ok(refs?.procedure?.id === crani.id && refs.procedure.source === 'suggested', '**نزدیک‌ترین** («کرانیوتومی مغز») پیشنهاد و پیش‌پر می‌شود', JSON.stringify(refs?.procedure));
  const t2 = await register(`دیسک ${tag}`);
  await upload(`/public/intake/form/${t2}/receipt`);
  await db.procedureType.createMany({ data: [{ name: `دیسک ${tag} کمری` }, { name: `دیسک ${tag} گردنی` }] });
  const sub2 = await db.intakeSubmission.findUnique({ where: { token: t2 } });
  const tie = (await api(`/intake/submissions/${sub2.id}/refs`, null, 'GET', auth)).data;
  ok(tie && tie.procedure === null, '**نباید بیفتد:** دو گزینهٔ هم‌فاصله یکی را سکه‌ای برنده کنند', JSON.stringify(tie?.procedure));

  console.log('\n۳) تأیید ← «مراجعهٔ نورومانیتورینگ»');
  const techA = await mkTech('sfa', 'یکم');
  const techB = await mkTech('sfb', 'دوم');
  const approved = await api(`/intake/submissions/${sub.id}/approve`, { surgeonId: surgeon.id, hospitalId: hosp.id, techId: techA.id, procedureTypeId: crani.id, opDate: isoDay(0), registerPayment: false }, 'POST', auth);
  ok(approved.status === 201 && approved.data?.visitId, 'تأیید مراجعه ساخت', `${approved.status} ${JSON.stringify(approved.data).slice(0, 120)}`);
  const vid = approved.data.visitId;
  const row = await db.visit.findUnique({ where: { id: vid } });
  ok(row.kind === 'surgery' && row.service === 'ionm', 'نوعِ داده همان `surgery` با خدمتِ `ionm` (تقویم و چینش دست نمی‌خورند)', `${row.kind}/${row.service}`);
  const full = (await api(`/visits/${vid}`, null, 'GET', auth)).data;
  ok(full?.kindTitle === 'نورومانیتورینگ', 'نامِ مراجعه «نورومانیتورینگ» — نه «فرمِ عمل»', full?.kindTitle);
  const kinds = (await api('/forms/visit-kinds', null, 'GET', auth)).data ?? [];
  ok(kinds.find((k) => k.kind === 'surgery')?.title === 'فرمِ نورومانیتورینگ', 'فرمِ مراجعه «فرمِ نورومانیتورینگ»', JSON.stringify(kinds.map((k) => k.title)));
  const rec = (await api(`/patients/${row.patientId}/record`, null, 'GET', auth)).data;
  const recVisit = (rec?.visits ?? []).find((x) => x.id === vid);
  ok(!rec || recVisit?.kindTitle === 'نورومانیتورینگ', 'پرونده هم همان نام', recVisit?.kindTitle);
  const live = (await api(`/patients/${row.patientId}/live`, null, 'GET', auth)).data;
  const step = (live?.stage?.steps ?? []).find((s) => s.key === 'visit');
  ok(step?.kindFa === 'نورومانیتورینگ' && /نورومانیتورینگ در انتظار/.test(step?.detail ?? ''), '«الان کجاییم»: «نورومانیتورینگ در انتظار»', JSON.stringify(step && { k: step.kindFa, d: step.detail }));
  const tl = (live?.timeline?.items ?? []).find((i) => i.id === `visit:${vid}`);
  ok(tl?.kindFa === 'نورومانیتورینگ' && tl.title.startsWith('نورومانیتورینگ'), 'خطِ زمانِ پرونده هم «نورومانیتورینگ» (نه نامِ فرم)', JSON.stringify(tl && { k: tl.kindFa, t: tl.title }));

  /* نامِ دستیِ مدیر: پرچم پاک می‌شود تا ارتقا دوباره بدود — و نباید بازنویسی کند. */
  await db.formDef.update({ where: { key: 'visit.surgery' }, data: { title: 'فرمِ اختصاصیِ ما' } });
  await db.setting.deleteMany({ where: { key: 'company_visit_form_title' } });
  await api('/forms', null, 'GET', auth);
  ok((await db.formDef.findUnique({ where: { key: 'visit.surgery' } })).title === 'فرمِ اختصاصیِ ما', '**نباید بیفتد:** نامی که مدیر در فرم‌ساز گذاشته بازنویسی شود');
  /* دوخدمته: نامِ قالبی ← «فرمِ خدمت»؛ هر مراجعه همچنان نامِ خدمتِ خودش. */
  await db.formDef.update({ where: { key: 'visit.surgery' }, data: { title: 'فرمِ عمل' } });
  await set('services', JSON.stringify(['ionm', 'implant']));
  await api('/forms', null, 'GET', auth);
  ok((await db.formDef.findUnique({ where: { key: 'visit.surgery' } })).title === 'فرمِ خدمت', 'شرکتِ دوخدمته: «فرمِ خدمت»');
  ok((await api(`/visits/${vid}`, null, 'GET', auth)).data?.kindTitle === 'نورومانیتورینگ', 'و مراجعه همچنان «نورومانیتورینگ»');
  await set('services', JSON.stringify(['ionm']));
  await api('/forms', null, 'GET', auth);
  ok((await db.formDef.findUnique({ where: { key: 'visit.surgery' } })).title === 'فرمِ نورومانیتورینگ', 'برگشت به تک‌خدمته ← دوباره «فرمِ نورومانیتورینگ» (نامِ خودکار، نه دستی)');

  console.log('\n۴) کارشناس: وضعیتِ عمل');
  const agenda = (await api('/tech/agenda?scope=today', null, 'GET', techA.token)).data;
  const card = (agenda?.visits ?? []).find((x) => x.id === vid);
  ok(card && card.status === 'pending', 'عمل در دفترِ امروزِ کارشناس', JSON.stringify(card && { s: card.status }));
  ok(card?.reportLabel === 'گزارشِ نورومانیتورینگ', 'نامِ گزارش «گزارشِ نورومانیتورینگ»', card?.reportLabel);
  const other = await api(`/tech/visits/${vid}/status`, { status: 'done' }, 'POST', techB.token);
  ok(other.status === 404, '**نباید بیفتد:** کارشناسِ دیگر روی عملِ این کارشناس وضعیت بزند', String(other.status));
  const past = await api(`/tech/visits/${vid}/status`, { status: 'postponed', opDate: isoDay(-2) }, 'POST', techA.token);
  ok(past.status === 400 && /امروز یا بعد/.test(past.data?.message ?? ''), '**نباید بیفتد:** موکول به گذشته', `${past.status} ${past.data?.message}`);
  const later = await api(`/tech/visits/${vid}/status`, { status: 'postponed', opDate: isoDay(3) }, 'POST', techA.token);
  let v = await db.visit.findUnique({ where: { id: vid } });
  ok(later.status === 201 && v.opStatus === 'pending' && v.opDate?.toISOString().slice(0, 10) === isoDay(3), 'موکول به سه روزِ بعد: همان «در انتظار» با تاریخِ تازه', `${later.status} ${v.opStatus} ${v.opDate?.toISOString()}`);
  const ev = await db.domainEvent.findFirst({ where: { type: 'visit.postponed', visitId: vid }, orderBy: { id: 'desc' } });
  ok(ev && ev.payload?.to?.startsWith(isoDay(3)), 'رویدادِ `visit.postponed` با تاریخِ قبل و بعد');
  ok(!!(await db.auditEvent.findFirst({ where: { action: 'visit.postpone', entityId: String(vid) } })), 'ممیزیِ `visit.postpone`');
  const open = await api(`/tech/visits/${vid}/status`, { status: 'postponed' }, 'POST', techA.token);
  v = await db.visit.findUnique({ where: { id: vid } });
  ok(open.status === 201 && v.opDate === null && v.opStatus === 'pending', 'موکولِ **بی‌تاریخ**: `opDate = null`، هنوز در انتظار', `${open.status} ${v.opDate}`);
  const upcoming = (await api('/tech/agenda?scope=upcoming', null, 'GET', techA.token)).data?.visits ?? [];
  ok(!upcoming.some((x) => x.id === vid) && !((await api('/tech/agenda?scope=today', null, 'GET', techA.token)).data?.visits ?? []).some((x) => x.id === vid), 'عملِ بی‌تاریخ از دفترِ کارشناس بیرون رفت');
  await db.visit.update({ where: { id: vid }, data: { opDate: new Date(`${isoDay(0)}T00:00:00Z`) } });
  const done = await api(`/tech/visits/${vid}/status`, { status: 'done' }, 'POST', techA.token);
  v = await db.visit.findUnique({ where: { id: vid } });
  ok(done.status === 201 && v.opStatus === 'done' && done.data?.status === 'done', '«انجام شد» ثبت شد (پاسخ همان کارتِ بی‌مبلغ)', `${done.status} ${v.opStatus}`);
  ok(done.data && !('amount' in done.data) && !('paid' in done.data), 'پاسخِ پنل هیچ عددِ مالی ندارد');
  const again = await api(`/tech/visits/${vid}/status`, { status: 'cancelled', cancelReason: 'patient' }, 'POST', techA.token);
  ok(again.status === 400, '**نباید بیفتد:** تغییرِ وضعیتِ ثبت‌شده از پنلِ کارشناس (کارِ مدیر است)', String(again.status));

  const t3 = await register(`BT${tag}`);
  await upload(`/public/intake/form/${t3}/receipt`);
  const sub3 = await db.intakeSubmission.findUnique({ where: { token: t3 } });
  const ap3 = await api(`/intake/submissions/${sub3.id}/approve`, { surgeonId: surgeon.id, hospitalId: hosp.id, techId: techA.id, opDate: isoDay(0), registerPayment: false }, 'POST', auth);
  const vid3 = ap3.data?.visitId;
  const bare = await api(`/tech/visits/${vid3}/status`, { status: 'cancelled' }, 'POST', techA.token);
  ok(bare.status === 400, '**نباید بیفتد:** لغوِ بی‌دلیل', String(bare.status));
  const cancelled = await api(`/tech/visits/${vid3}/status`, { status: 'cancelled', cancelReason: 'doctor', cancelNote: 'جراح تماس گرفت' }, 'POST', techA.token);
  const v3 = await db.visit.findUnique({ where: { id: vid3 } });
  ok(cancelled.status === 201 && v3.opStatus === 'cancelled' && v3.cancelReason === 'doctor', '«لغو شد» با دلیل ثبت شد', `${cancelled.status} ${v3.opStatus} ${v3.cancelReason}`);

  console.log('\n۵) گزارشِ خدمت، نه گزارشِ عمل');
  const rep = await upload(`/tech/visits/${vid}/report`, techA.token);
  const doc = await db.document.findFirst({ where: { visitId: vid, category: 'report' }, orderBy: { id: 'desc' } });
  ok(rep.status === 201 && doc?.title === 'گزارشِ نورومانیتورینگ', 'سندِ گزارش «گزارشِ نورومانیتورینگ» نام دارد', `${rep.status} ${doc?.title}`);

  console.log('\n۶) مطب: بخشِ کارشناس نیست');
  await set('vertical', 'clinic'); await set('services', '[]');
  for (const k of ['tech', 'dispatch']) await db.feature.updateMany({ where: { key: k }, data: { enabled: false } });
  const feats = (await api('/features', null, 'GET', auth)).data ?? [];
  const f = (k) => feats.find((x) => x.key === k);
  ok(f('tech')?.allowed === false && f('dispatch')?.allowed === false, 'سوپرادمینِ مطب کاشیِ «پنلِ کارشناسی» و «چینش» نمی‌بیند', JSON.stringify([f('tech')?.allowed, f('dispatch')?.allowed]));
  ok(f('dashboard')?.allowed === true && f('theatre')?.allowed === true, 'و بقیهٔ کاشی‌هایش سرِ جایشان‌اند');
  await db.feature.updateMany({ where: { key: 'tech' }, data: { enabled: true } });
  ok(((await api('/features', null, 'GET', auth)).data ?? []).find((x) => x.key === 'tech')?.allowed === true, 'مطبی که خودش پنلِ کارشناسی را روشن کرده همچنان می‌بیندش');
} catch (e) {
  ok(false, `اجرا متوقف شد: ${e?.stack ?? e}`);
} finally {
  if (vertical0) await set('vertical', vertical0); else await db.setting.deleteMany({ where: { key: 'vertical' } });
  await set('services', JSON.stringify(['ionm']));
  for (const k of ['tech', 'dispatch']) await db.feature.updateMany({ where: { key: k }, data: { enabled: true } }).catch(() => {});
  await db.$disconnect();
}

console.log(`\nسبز: ${pass}   قرمز: ${fails.length}`);
if (fails.length) process.exit(1);
