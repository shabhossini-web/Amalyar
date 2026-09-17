/**
 * W1.7 — پیامِ پس از عمل وقتی «انجام شد» ثبت نشده (D07 · `DECISIONS.md` #۱).
 * Real HTTP + Prisma. Only run against an isolated local database.
 *
 * یافتهٔ D07: مراقبتِ بعد از عمل و فرمِ پیگیری زیرِ شرطِ
 * `kind==='surgery' && opDate && opStatus !== 'cancelled'` کاشته می‌شوند —
 * یعنی برای عملی که **هنوز انجام نشده** هم می‌روند. `opStatus` تا وقتی کسی
 * دستی ثبتش نکند `pending` می‌ماند، پس بیمارِ موکول‌شده دستورِ «بعد از عمل»
 * می‌گرفت.
 *
 * پیش‌فرضِ سند «نگه‌داشتنِ پیام تا تأیید» بود؛ مالک ردش کرد: پیام برود ولی
 * **متنش دوشاخه** باشد. نفرستادن، بیماری را که عملش انجام شده و فقط کسی
 * وضعیت را ثبت نکرده، بی‌دستور می‌گذارد.
 *
 * تنظیمات با **SettingsServiceِ واقعی** خوانده می‌شود نه استاب — خودِ
 * پیش‌فرضِ رجیستری بخشی از چیزی است که سنجیده می‌شود.
 *
 *  باید بیفتد:
 *   - عملِ ثبت‌نشده: متنِ مراقبت و پیگیری پوششِ «اگر انجام شده…» بگیرد
 *   - «انجام شد» که ثبت شد، موعدهای نرفته با متنِ عادی دوباره کاشته شوند
 *   - کادرِ خالیِ تنظیمات = همان متنِ عادی (کلینیک بتواند خاموشش کند)
 *  نباید بیفتد:
 *   - عملِ لغوشده اصلاً پیامِ مراقبت/پیگیری نگیرد
 *   - پیامِ **پیش** از عمل (مراقبتِ قبل، یادآوریِ عمل) پوشش نگیرد
 *   - تعویق تاریخچه را پاک کند (موعدِ قبلی باید `cancelled` بماند، نه حذف)
 *   - همگام‌سازیِ دوباره پیامِ **رفته** را دست بزند
 *   - کارِ `confirm_surgery_done` جایش را به پیام بدهد
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { RemindersService } = require('./dist/patients/reminders.service');
const { SettingsService } = require('./dist/config/settings.service');
const { processDomainEvents } = require('./dist/work/work-processor');

const API = process.env.E2E_API ?? 'http://localhost:3101/api', DB = process.env.E2E_DB;
if (!DB || ![API, DB].every(u => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'pog' + randomBytes(4).toString('hex');

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const DAY = 864e5;
const ago = (d) => new Date(Date.now() - d * DAY);

/* تنظیماتِ واقعی — پیش‌فرضِ `sms_care_unconfirmed_text` از رجیستری می‌آید. */
const tenantStub = { require: () => ({ tenantId: tag, hostname: 'localhost' }) };
const settings = new SettingsService(db, { record: async () => {} }, tenantStub, {});
const reminders = new RemindersService(db, { send: async () => ({ ok: true }) }, settings, tenantStub);

const CARE = 'زخم را خشک نگه دارید و ۴۸ ساعت حمام نروید.';
const PRE = 'از نیمه‌شبِ قبل ناشتا باشید.';
const HEDGE_HEAD = 'اگر عملِ شما انجام شده';
const HEDGE_TAIL = 'با پزشکِ خود در ارتباط باشید';

const made = { patients: [], forms: [] };
const savedAccess = [];
let token;

async function api(path, body, method = 'PATCH') {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, data: await r.json().catch(() => null) };
}

/** عملِ جراحیِ گذشته با متنِ مراقبت، و کاشتِ یادآوری‌ها. */
async function surgery({ daysAgo = 10, opStatus = 'pending', followUpDays = '7', seq = 1, sync = true } = {}) {
  const pid = (await db.patient.create({ data: { code: tag + made.patients.length, firstName: 'بیمار', lastName: 'مراقبت', phone: '09120000000' } })).id;
  made.patients.push(pid);
  const v = await db.visit.create({
    data: { patientId: pid, seq, kind: 'surgery', opStatus, opDate: ago(daysAgo),
      followUpDays, postOpCare: CARE, preOpCare: PRE },
  });
  if (sync) await reminders.syncNextVisit(v.id);
  return { patientId: pid, visit: v };
}

const remOf = (visitId, kind, status = undefined) => db.reminder.findMany({
  where: { visitId, kind, ...(status ? { status } : {}) }, orderBy: { id: 'asc' },
});

try {
  token = (await (await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
  })).json()).accessToken;
  assert.ok(token, 'login');
  for (const [table, key] of [['feature', 'dashboard'], ['permission', 'patients.status']]) {
    savedAccess.push([table, key, await db[table].findUnique({ where: { key } })]);
    await db[table].upsert({ where: { key }, create: { key, minLevel: 3, enabled: true }, update: { minLevel: 3, enabled: true, roles: [] } });
  }
  /* فرمِ پیگیری لازم است وگرنه `followUpUrl` چیزی نمی‌سازد و پیامِ پیگیری نمی‌رود. */
  made.forms.push((await db.formDef.create({
    data: { key: tag + 'fu', title: 'پیگیری', scope: 'record', followUp: 'general', active: true },
  })).id);

  console.log('\n۱) عملی که «انجام شد» نخورده — متنِ دوشاخه');
  const a = await surgery({ opStatus: 'pending' });
  const aPost = await remOf(a.visit.id, 'post_op_care');
  const aFu = await remOf(a.visit.id, 'follow_up');
  ok(aPost.length === 1 && aPost[0].text.includes(HEDGE_HEAD) && aPost[0].text.includes(HEDGE_TAIL),
    '**باید بیفتد:** مراقبتِ بعد از عمل پوششِ «اگر انجام شده…» گرفت');
  ok(aPost[0].text.includes(CARE), 'خودِ دستورِ مراقبت داخلِ پوشش ماند — حذف نشد');
  ok(aFu.length === 1 && aFu[0].text.includes(HEDGE_HEAD), 'فرمِ پیگیری هم همان پوشش را گرفت');

  console.log('\n۲) نباید بیفتد — پیامِ پیش از عمل پوشش نمی‌گیرد');
  /* روی عملِ **آینده** سنجیده می‌شود: برای عملِ گذشته `dueOn` موعدِ پیش از
     عمل را اصلاً نمی‌سازد (تاریخش رد شده)، پس فهرست خالی می‌ماند و سنجه
     توخالی می‌شد — «هیچ ردیفی پوشش ندارد» وقتی هیچ ردیفی نیست. */
  const fut = await surgery({ daysAgo: -5, opStatus: 'pending' });
  const aPre = await remOf(fut.visit.id, 'pre_op_care');
  const aSg = await remOf(fut.visit.id, 'surgery');
  ok(aPre.length > 0 && aPre.every((r) => !r.text.includes(HEDGE_HEAD)) && aPre.some((r) => r.text.includes(PRE)),
    `**نباید بیفتد:** مراقبتِ **قبل** از عمل دست‌نخورده ماند (${aPre.length} موعد)`);
  ok(aSg.length > 0 && aSg.every((r) => !r.text.includes(HEDGE_HEAD)),
    `**نباید بیفتد:** یادآوریِ خودِ عمل هم پوشش نگرفت (${aSg.length} موعد)`);
  ok((await remOf(fut.visit.id, 'post_op_care')).every((r) => r.text.includes(HEDGE_HEAD)),
    'ولی مراقبتِ **بعد** از عملِ آینده پوشش می‌گیرد — هنوز معلوم نیست انجام می‌شود');

  console.log('\n۳) ثبتِ «انجام شد» متن را ارتقا می‌دهد — از مسیرِ واقعیِ API');
  const res = await api(`/visits/${a.visit.id}/status`, { opStatus: 'done' });
  ok(res.status === 200, `endpointِ وضعیت پاسخ داد (${res.status})`);
  const aPostAfter = await remOf(a.visit.id, 'post_op_care', 'pending');
  ok(aPostAfter.length === 1 && !aPostAfter[0].text.includes(HEDGE_HEAD) && aPostAfter[0].text.includes(CARE),
    '**باید بیفتد:** بعد از «انجام شد» موعدِ نرفته با متنِ عادی دوباره کاشته شد');
  ok((await remOf(a.visit.id, 'post_op_care', 'cancelled')).length === 1,
    'نسخهٔ پوشش‌دار حذف نشد، `cancelled` شد — تاریخچه می‌ماند');

  console.log('\n۴) نباید بیفتد — عملِ لغوشده پیامِ مراقبت نمی‌گیرد');
  const b = await surgery({ opStatus: 'pending' });
  ok((await remOf(b.visit.id, 'post_op_care', 'pending')).length === 1, 'قبل از لغو، موعدِ مراقبت هست');
  const cancelled = await api(`/visits/${b.visit.id}/status`, { opStatus: 'cancelled', cancelReason: 'patient' });
  ok(cancelled.status === 200, `لغو پذیرفته شد (${cancelled.status})`);
  ok((await remOf(b.visit.id, 'post_op_care', 'pending')).length === 0
     && (await remOf(b.visit.id, 'follow_up', 'pending')).length === 0,
    '**نباید بیفتد:** بعد از لغو هیچ موعدِ مراقبت/پیگیریِ بازی نماند');

  console.log('\n۵) نباید بیفتد — تعویق تاریخچه را پاک نمی‌کند');
  const c = await surgery({ daysAgo: 3, opStatus: 'pending' });
  const before = (await remOf(c.visit.id, 'post_op_care'))[0];
  await db.visit.update({ where: { id: c.visit.id }, data: { opDate: ago(1) } });
  await reminders.syncNextVisit(c.visit.id);
  const all = await remOf(c.visit.id, 'post_op_care');
  ok(all.length === 2 && all.some((r) => r.id === before.id && r.status === 'cancelled'),
    '**نباید بیفتد:** موعدِ قبلی حذف نشد — `cancelled` ماند کنارِ موعدِ تازه');
  ok(all.find((r) => r.status === 'pending')?.dueAt?.getTime() !== before.dueAt?.getTime(),
    'موعدِ تازه با تاریخِ جدید کاشته شد');

  console.log('\n۶) نباید بیفتد — پیامِ رفته دوباره دست‌کاری نمی‌شود');
  const d = await surgery({ daysAgo: 5, opStatus: 'pending' });
  const dPost = (await remOf(d.visit.id, 'post_op_care'))[0];
  await db.reminder.update({ where: { id: dPost.id }, data: { status: 'sent', sentAt: new Date() } });
  await api(`/visits/${d.visit.id}/status`, { opStatus: 'done' });
  const dAfter = await db.reminder.findUnique({ where: { id: dPost.id } });
  ok(dAfter.status === 'sent' && dAfter.text.includes(HEDGE_HEAD),
    '**نباید بیفتد:** پیامِ فرستاده‌شده نه لغو شد نه متنش عوض شد');

  console.log('\n۷) کادرِ خالیِ تنظیمات = همان متنِ عادی');
  await db.setting.upsert({ where: { key: 'sms_care_unconfirmed_text' }, create: { key: 'sms_care_unconfirmed_text', value: '' }, update: { value: '' } });
  settings.cache?.clear?.();
  const e = await surgery({ opStatus: 'pending' });
  const ePost = (await remOf(e.visit.id, 'post_op_care'))[0];
  ok(ePost && !ePost.text.includes(HEDGE_HEAD) && ePost.text.includes(CARE),
    'کلینیکی که پوشش نمی‌خواهد، خالی‌کردنِ کادر خاموشش می‌کند');
  await db.setting.delete({ where: { key: 'sms_care_unconfirmed_text' } }).catch(() => {});
  settings.cache?.clear?.();

  console.log('\n۸) کارِ «تأییدِ انجامِ عمل» جایش را به پیام نمی‌دهد');
  const f = await surgery({ opStatus: 'pending' });
  await db.domainEvent.create({ data: { type: 'visit.planned', refType: 'visit', refId: f.visit.id,
    visitId: f.visit.id, patientId: f.patientId, payload: {} } }).catch(() => {});
  await processDomainEvents(db).catch(() => {});
  const rules = (await import('node:fs')).readFileSync(new URL('../../server/src/work/work-rules.ts', import.meta.url), 'utf8');
  ok(rules.includes("'confirm_surgery_done'") && rules.includes("'visit.done': (_e, ref) => close(ref, 'confirm_surgery_done')"),
    'قاعدهٔ کارِ `confirm_surgery_done` سرِ جایش است (تصمیمِ ۱)');
} finally {
  const vids = (await db.visit.findMany({ where: { patient: { code: { startsWith: tag } } }, select: { id: true } })).map((v) => v.id);
  await db.reminder.deleteMany({ where: { OR: [{ visitId: { in: vids } }, { patient: { code: { startsWith: tag } } }] } });
  await db.domainEvent.deleteMany({ where: { visitId: { in: vids } } }).catch(() => {});
  await db.workItem.deleteMany({ where: { visitId: { in: vids } } }).catch(() => {});
  await db.intakeSubmission.deleteMany({ where: { OR: [{ patient: { code: { startsWith: tag } } }, { formId: { in: made.forms } }] } });
  await db.visit.deleteMany({ where: { id: { in: vids } } });
  await db.patient.deleteMany({ where: { code: { startsWith: tag } } });
  await db.formDef.deleteMany({ where: { id: { in: made.forms } } });
  await db.setting.deleteMany({ where: { key: 'sms_care_unconfirmed_text' } }).catch(() => {});
  for (const [table, key, row] of savedAccess) {
    if (row) await db[table].update({ where: { key }, data: { minLevel: row.minLevel, enabled: row.enabled, roles: row.roles ?? [] } });
    else await db[table].delete({ where: { key } }).catch(() => {});
  }
  await db.$disconnect();
}
console.log(`\nسبز: ${count}`);
