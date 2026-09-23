/**
 * برگشت برای اصلاح **به یک مرحله** + پیامک؛ رد با پیامک؛ زمانِ کارِ «بررسی و تأییدِ ثبت‌نام».
 * Real HTTP + Nest + Prisma + PGlite (`intake-return-local.mjs`). Only against an isolated local database.
 *
 * زمینه (مالک، ۱۴۰۵/۰۷/۰۱): «مرحله باید انتخاب شود و پیام به بیمار برود»؛ مرحله‌ها
 * خدمت / مدارک / فیش / همه (هویت را تأییدکننده خودش درست می‌کند). قاعده‌ها در
 * `server/src/patients/intake-return.ts`؛ رابطِ پاپ‌آپ را `intake-return-ui.mjs` می‌سنجد.
 *
 *  باید بیفتد:
 *   - برگشتِ بی‌مرحله / با مرحلهٔ «هویت» / بی‌دلیل / از وضعیتی جز «در انتظارِ تأیید» ← ۴۰۰
 *   - فرمِ پولی تا فیش نیامده کارِ تأیید باز نمی‌کند
 *   - «مدارک»: عکس‌ها از پاسخ بیرون می‌روند و ثبتِ فرم بی‌عکسِ تازه رد می‌شود
 *   - «فیش»: فیشِ قبلی از ردیفِ صف بیرون می‌رود
 *   - «خدمت»: ثبتِ دوباره با فیشِ مانده مستقیم به صف برمی‌گردد و کار دوباره باز می‌شود
 *   - پیامکِ برگشت دلیل، مرحله و لینکِ همان فرم را دارد؛ پیامکِ رد بی‌لینک است
 *   - تاریخچهٔ برگشت (`_returns`) به `Visit.extra` و صفحهٔ عمومی نمی‌رود و بیمار نمی‌نویسدش
 *  نباید بیفتد:
 *   - مدرک و فیشِ کنارگذاشته پاک نمی‌شوند (سندند)
 *   - بیمارِ بی‌شمارهٔ معتبر: برگشت انجام می‌شود، فقط پیامکی نمی‌رود
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { applyReturn, currentReturn, returnsOf } = require('./dist/patients/intake-return.js');
const { processDomainEvents } = require('./dist/work/work-processor');

const API = process.env.E2E_API, DB = process.env.E2E_DB;
if (![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'ir' + randomBytes(3).toString('hex');
let count = 0, auth, seed = Number.parseInt(randomBytes(3).toString('hex'), 16);
const ok = (v, label, detail = '') => { assert.ok(v, `${label}${detail ? ' — ' + detail : ''}`); console.log('PASS ' + ++count + ' ' + label); };
const msg = (r) => JSON.stringify(r.data?.message ?? r.data);
async function api(path, body, method = body ? 'POST' : 'GET', token = auth) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const pub = (path, body, method) => api(path, body, method, null);
function nid(n) {
  const base = String(n % 1_000_000_000).padStart(9, '0');
  let sum = 0; for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
  const r = sum % 11; return base + String(r < 2 ? r : 11 - r);
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
async function send(path, name) {
  const form = new FormData(); form.append('file', new Blob([JPEG], { type: 'image/jpeg' }), name);
  const r = await fetch(API + path, { method: 'POST', body: form });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const subOf = (t) => db.intakeSubmission.findUnique({ where: { token: t } });
const sms = (dedupeKey) => db.reminder.findUnique({ where: { dedupeKey } });
/** وضعیتِ کارِ «بررسی و تأییدِ ثبت‌نام» بعد از پردازشِ رویدادها (`null` = هرگز باز نشده). */
async function task(id) {
  await processDomainEvents(db);
  return (await db.workItem.findUnique({ where: { idempotencyKey: `approve_intake:intake_submission:${id}` } }))?.state ?? null;
}

try {
  auth = (await api('/auth/login', { identifier: 'admin', password: 'test1234' })).data.accessToken;
  assert.ok(auth, 'ورود');

  console.log('۰) قاعدهٔ مرحله‌ها (خالص)');
  const base = { a: 1, card: { id: 7 }, rx: [{ id: 8 }], receiptDocumentId: 5, receiptDocumentIds: [5, 6] };
  const meta = { note: 'n', at: '2026-09-23T00:00:00.000Z', by: 1 };
  let x = applyReturn(base, 'service', ['card', 'rx'], meta);
  ok(x.status === 'pending_fill' && x.data.card && x.data.receiptDocumentIds.length === 2 && x.data._returns.length === 1,
    '«خدمت»: پاسخ، مدارک و فیش می‌مانند؛ فقط تاریخچه اضافه می‌شود');
  x = applyReturn(base, 'documents', ['card', 'rx'], meta);
  ok(x.status === 'pending_fill' && !('card' in x.data) && !('rx' in x.data) && x.data.a === 1 && x.data.receiptDocumentIds.length === 2
    && JSON.stringify(x.data._returns[0].images) === JSON.stringify({ card: [{ id: 7 }], rx: [{ id: 8 }] }),
    '«مدارک»: فقط کادرهای عکس کنار می‌روند (شیءِ تکیِ قدیمی آرایه می‌شود)', JSON.stringify(x.data));
  x = applyReturn(base, 'receipt', ['card', 'rx'], meta);
  ok(x.status === 'pending_payment' && !('receiptDocumentId' in x.data) && !('receiptDocumentIds' in x.data) && x.data.card
    && x.data._returns[0].receipts.join() === '5,6', '«فیش»: فیش‌ها کنار، مدارک سرِ جا', JSON.stringify(x.data));
  x = applyReturn(applyReturn(base, 'all', ['card', 'rx'], meta).data, 'service', ['card', 'rx'], { ...meta, note: 'دوم' });
  ok(x.data._returns.length === 2 && returnsOf(x.data).at(-1).note === 'دوم' && !x.data.card && !x.data.receiptDocumentIds,
    '«همه» هر دو را کنار می‌گذارد؛ تاریخچه جمع می‌شود، پاک نه');
  ok(currentReturn(x.data, 'pending_approval') === null && currentReturn(x.data, 'pending_fill')?.stage === 'service'
    && currentReturn(x.data, 'pending_fill')?.hint, 'برگشتِ جاری فقط تا ارسالِ دوباره دیده می‌شود، با راهنما');
  ok(returnsOf({ _returns: [{ stage: 'identity', note: 'x' }, null] }).length === 0, 'مرحلهٔ ناشناخته/خراب از تاریخچهٔ نمایشی بیرون است');

  await db.setting.upsert({ where: { key: 'vertical' }, create: { key: 'vertical', value: 'ionm' }, update: { value: 'ionm' } });
  await api('/forms');
  const form = await db.formDef.findUnique({ where: { key: 'intake.ionm' } });
  const surgeonId = (await db.surgeon.create({ data: { active: true, person: { create: { firstName: 'پزشکِ', lastName: 'برگشت ' + tag } } } })).id;
  const hospitalId = (await db.hospital.create({ data: { name: 'بیمارستانِ برگشت ' + tag } })).id;
  const link = await api('/intake/links', { title: 'نورو ' + tag, formId: form.id, amount: 2_000_000 });
  assert.ok(link.status < 300, msg(link));
  const phoneOf = () => '0912' + String(1000000 + (++seed % 8999999));
  async function register(phone) {
    const r = await pub(`/public/intake/link/${link.data.token}/register`, {
      firstName: 'بیمارِ', lastName: 'برگشت', nationalId: nid(++seed * 7919), phone, birthDate: '1990-03-21', captchaA: 2, captchaB: 3, captchaAnswer: 5,
    });
    assert.ok(r.status < 300 && r.data?.token, msg(r));
    return r.data.token;
  }
  async function upload(t, field, name = field + '.jpg') {
    const r = await send(`/public/intake/form/${t}/image/${field}`, name);
    assert.equal(r.status, 201, msg(r));
  }
  async function receipt(t, name) {
    const r = await send(`/public/intake/form/${t}/receipt`, name);
    assert.equal(r.status, 201, msg(r));
  }
  const VALUES = { surgeonName: 'دکتر آزمون', hospitalName: 'بیمارستان آزمون', procedure: 'فیوژن', opDateOpen: true };
  const fill = (t, extra = {}) => pub(`/public/intake/form/${t}/fill`, { values: { ...VALUES, ...extra } });
  const ret = (id, body) => api(`/intake/submissions/${id}/return`, body);
  const rowOf = async (t) => (await api('/intake/submissions?status=pending_approval')).data.find((r) => r.token === t);
  /** بیمارِ تازه تا «در انتظارِ تأیید»: دو مدرک، فرم، فیش. */
  async function ready(phone = phoneOf()) {
    const t = await register(phone);
    await upload(t, 'nationalIdImage'); await upload(t, 'prescription');
    const f = await fill(t);
    assert.equal(f.data?.status, 'pending_payment', msg(f));
    return { t, phone, id: (await subOf(t)).id };
  }

  const P = await ready();
  const t = P.t, id = P.id;

  console.log('\n۱) زمانِ کارِ «بررسی و تأیید»');
  ok(await task(id) === null, '**فرمِ پولی تا فیش نیامده کارِ تأیید باز نمی‌کند**');
  await receipt(t, 'fish-1.jpg');
  ok((await subOf(t)).status === 'pending_approval' && await task(id) === 'open', 'اولین فیش ثبت‌نام را به صف می‌برد و کار را باز می‌کند');
  await receipt(t, 'fish-2.jpg');
  ok(await db.domainEvent.count({ where: { refType: 'intake_submission', refId: id, type: 'intake.submitted' } }) === 1, 'فیشِ دوم رویدادِ دوم نمی‌سازد');

  console.log('\n۲) اعتبارسنجیِ برگشت');
  for (const [body, label] of [[{ note: 'x' }, 'بی‌مرحله'], [{ stage: 'identity', note: 'x' }, 'با مرحلهٔ «هویت»'], [{ stage: 'service', note: '   ' }, 'بی‌دلیل']]) {
    const r = await ret(id, body);
    ok(r.status === 400, `برگشتِ ${label} ← ۴۰۰`, `${r.status} ${msg(r)}`);
  }
  ok((await subOf(t)).status === 'pending_approval' && !(await subOf(t)).data._returns, 'وضعیت و داده دست نخوردند');

  console.log('\n۳) «خدمت» — فیش و مدارک می‌مانند');
  const reason1 = 'نام عمل را کامل بنویسید';
  let r = await ret(id, { stage: 'service', note: reason1 });
  ok(r.status === 201 && r.data.status === 'pending_fill' && r.data.stage === 'service' && r.data.sms === 'queued', 'برگشت پذیرفته شد و پیامک در صف است', msg(r));
  let sub = await subOf(t);
  ok(sub.data.receiptDocumentIds?.length === 2 && sub.data.nationalIdImage && sub.data.prescription, 'فیش و مدارک سرِ جایشان');
  let s = await sms(`intake_returned:${id}:1`);
  ok(s?.kind === 'notice' && s.phone === P.phone && s.text.includes(reason1) && s.text.includes('اطلاعاتِ خدمت') && s.text.includes(`/f/${t}`),
    '**پیامکِ برگشت: دلیل، مرحله و لینکِ همان فرم**', s?.text);
  ok(await task(id) === 'done', 'کارِ تأیید بسته شد — حالا منتظرِ بیمار است');
  let view = (await pub(`/public/intake/form/${t}`)).data;
  ok(view.returned?.stage === 'service' && view.returned.note === reason1 && view.returned.hint, 'بیمار مرحله، دلیل و راهنما را می‌بیند', JSON.stringify(view.returned));
  ok(view.data && !('_returns' in view.data) && view.data.procedure === 'فیوژن', '**تاریخچهٔ برگشت (شناسهٔ تأییدکننده، فایل‌های کنارگذاشته) به صفحهٔ عمومی نمی‌رود**', JSON.stringify(view.data));
  let f = await fill(t, { procedure: 'فیوژنِ کمری', _returns: [] });
  ok(f.status < 300 && f.data?.status === 'pending_approval', '**ثبتِ دوباره با فیشِ مانده مستقیم به صف** — نه واریزِ دوباره', msg(f));
  sub = await subOf(t);
  ok(returnsOf(sub.data).length === 1 && sub.data.procedure === 'فیوژنِ کمری', 'اصلاح نشست و بیمار تاریخچهٔ برگشت را ننوشت');
  ok(await task(id) === 'open', '**کارِ تأیید دوباره باز شد**');
  ok((await pub(`/public/intake/form/${t}`)).data.returned === null, 'بعد از ارسال، بنرِ اصلاح نیست');

  console.log('\n۴) «مدارک» — عکس‌ها کنار، سند پاک نه');
  const imgIds = [sub.data.nationalIdImage, sub.data.prescription].flat().map((d) => d.id);
  r = await ret(id, { stage: 'documents', note: 'کارتِ ملی خوانا نیست' });
  ok(r.status === 201 && r.data.status === 'pending_fill', 'برگشت به «مدارک»', msg(r));
  sub = await subOf(t);
  ok(!sub.data.nationalIdImage && !sub.data.prescription && sub.data.receiptDocumentIds?.length === 2, 'عکس‌ها از پاسخ بیرون، فیش سرِ جا');
  ok(Object.values(sub.data._returns.at(-1).images).flat().map((d) => d.id).sort().join() === [...imgIds].sort().join(), 'ارجاعِ عکس‌ها در تاریخچه نگه داشته شد');
  ok(await db.document.count({ where: { id: { in: imgIds }, deletedAt: null } }) === imgIds.length, '**مدرکِ کنارگذاشته پاک نمی‌شود**');
  f = await fill(t);
  ok(f.status === 400, '**ثبتِ فرم بی‌عکسِ تازه رد می‌شود**', `${f.status} ${msg(f)}`);
  await upload(t, 'nationalIdImage', 'card-2.jpg'); await upload(t, 'prescription', 'rx-2.jpg');
  f = await fill(t);
  ok(f.data?.status === 'pending_approval', 'با عکسِ تازه مستقیم به صف', msg(f));
  let row = await rowOf(t);
  ok(row.documents.length === 2 && row.documents.every((d) => !imgIds.includes(d.id)), 'ردیفِ صف فقط مدارکِ تازه را نشان می‌دهد', JSON.stringify(row.documents));
  ok(row.returns.length === 2 && row.returns[1].stageLabel === 'مدارک' && row.returns[0].note === reason1, 'تأییدکننده تاریخچهٔ برگشت‌ها را می‌بیند', JSON.stringify(row.returns));

  console.log('\n۵) «فیش» — فیشِ قبلی از صف بیرون');
  const oldReceipts = (await subOf(t)).data.receiptDocumentIds;
  r = await ret(id, { stage: 'receipt', note: 'مبلغِ فیش کم است' });
  ok(r.data?.status === 'pending_payment', 'برگشت به «فیش» ← در انتظارِ واریز', msg(r));
  sub = await subOf(t);
  ok(!sub.data.receiptDocumentIds && !sub.data.receiptDocumentId && sub.data.nationalIdImage, 'فیش‌ها کنار، مدارک سرِ جا');
  ok(await task(id) === 'done', 'کار بسته شد');
  await receipt(t, 'fish-3.jpg');
  ok(await task(id) === 'open', 'فیشِ تازه کار را دوباره باز می‌کند');
  row = await rowOf(t);
  ok(row.receipts.length === 1 && !oldReceipts.includes(row.receipts[0].id), '**فقط فیشِ تازه در ردیفِ صف**', JSON.stringify(row.receipts));
  ok(await db.document.count({ where: { id: { in: oldReceipts }, deletedAt: null } }) === oldReceipts.length, 'فیشِ کنارگذاشته هم سند است و پاک نمی‌شود');

  console.log('\n۶) «همه» — فرم و فیش از نو');
  r = await ret(id, { stage: 'all', note: 'همه را دوباره بفرستید' });
  ok(r.data?.status === 'pending_fill', 'برگشت به «همه»', msg(r));
  r = await ret(id, { stage: 'service', note: 'دوباره' });
  ok(r.status === 400, 'برگشت از وضعیتی جز «در انتظارِ تأیید» ← ۴۰۰', `${r.status} ${msg(r)}`);
  await upload(t, 'nationalIdImage', 'card-3.jpg'); await upload(t, 'prescription', 'rx-3.jpg');
  f = await fill(t);
  ok(f.data?.status === 'pending_payment', '**بی‌فیش به واریز می‌رود، نه به صف**', msg(f));
  ok(await task(id) === 'done', 'و کار تا فیش نیامده بسته می‌ماند');
  await receipt(t, 'fish-4.jpg');
  ok(await task(id) === 'open', 'فیش آمد، کار باز شد');
  ok(await db.reminder.count({ where: { dedupeKey: { startsWith: `intake_returned:${id}:` } } }) === 4, 'هر برگشت پیامکِ خودش را دارد');

  console.log('\n۷) تأیید بعد از برگشت‌ها');
  r = await api(`/intake/submissions/${id}/approve`, { surgeonId, hospitalId });
  ok(r.status === 201 && r.data?.visitId, 'تأیید شد', msg(r));
  const visit = await db.visit.findUnique({ where: { id: r.data.visitId } });
  ok(!Object.keys(visit.extra ?? {}).some((k) => k.startsWith('_')), '**تاریخچهٔ برگشت به `Visit.extra` نمی‌رود**', JSON.stringify(visit.extra));
  ok(await task(id) === 'done', 'کار بسته شد');

  console.log('\n۸) رد — پیامک بی‌لینک');
  const Q = await ready();
  await receipt(Q.t, 'q.jpg');
  const reason2 = 'این خدمت در بیمارستانِ شما ارائه نمی‌شود';
  r = await api(`/intake/submissions/${Q.id}/reject`, { note: reason2 });
  ok(r.status === 201 && r.data?.sms === 'queued', 'رد شد و پیامک در صف است', msg(r));
  s = await sms(`intake_rejected:${Q.id}`);
  ok(s?.phone === Q.phone && s.text.includes(reason2) && !s.text.includes('/f/'), '**پیامکِ رد: دلیل، بی‌لینک**', s?.text);
  ok(await task(Q.id) === 'done', 'کارِ تأیید بسته شد');

  console.log('\n۹) بیمارِ بی‌شمارهٔ معتبر');
  const N = await ready();
  await receipt(N.t, 'n.jpg');
  await db.patient.update({ where: { id: (await subOf(N.t)).patientId }, data: { phone: null } });
  r = await ret(N.id, { stage: 'service', note: 'نام جراح' });
  ok(r.status === 201 && r.data?.sms === 'no_phone' && (await subOf(N.t)).status === 'pending_fill',
    '**برگشت انجام می‌شود، فقط پیامکی نمی‌رود** — و رابط همین را می‌گوید', msg(r));
  ok(!(await sms(`intake_returned:${N.id}:1`)), 'ردیفِ پیامکِ بی‌شماره ساخته نشد');

  console.log(`\n${count} سنجه سبز`);
} finally {
  await db.$disconnect().catch(() => undefined);
}
