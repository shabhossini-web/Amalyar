/**
 * W1.1 — تطبیقِ پیگیری با کلیدِ دقیق (D01). Real HTTP + Prisma.
 * Only run against an isolated local database.
 *
 * یافتهٔ D01: گزارشِ «پیگیری‌نشده» پاسخ را با `patientId + createdAt >= opDate`
 * به عمل می‌چسباند، ولی ردیفِ فرمِ پیگیری هنگامِ **ثبتِ مراجعه** ساخته می‌شود —
 * برای هر عملِ از‌پیش‌برنامه‌ریزی‌شده **پیش از** تاریخِ عمل. پس پاسخِ کامل هم
 * دیده نمی‌شد. این حالتِ عادی بود، نه استثنا.
 *
 * ردیف‌های پیگیری این‌جا با **خودِ `RemindersService.syncNextVisit`** ساخته
 * می‌شوند نه با دست: اگر کسی فردا نامِ کلیدِ `followUpVisitId`/`followUpDay` را
 * عوض کند، تستِ دست‌ساز سبز می‌ماند و گزارش بی‌صدا می‌شکند.
 *
 *  باید بیفتد:
 *   - فرمی که پیش از عمل ساخته و بعدِ عمل پر شده، «پیگیری‌شده» دیده شود
 *   - عملی که موعدش رسیده و بی‌پاسخ است، با **شمارهٔ همان موعد** گزارش شود
 *   - عملی که اصلاً ردیفِ پیگیری ندارد، گزارش شود
 *   - سقفِ فهرست در خروجی اعلام شود
 *  نباید بیفتد:
 *   - پاسخِ عملِ الف، عملِ ب را «پیگیری‌شده» نکند (یک پاسخ، دو عمل)
 *   - موعدی که هنوز نرسیده «پیگیری‌نشده» شمرده نشود
 *   - فرمِ دستیِ بی‌کلید دور ریخته نشود (ولی فقط به نزدیک‌ترین عملِ پیش از خودش بچسبد)
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { RemindersService } = require('./dist/patients/reminders.service');

const API = process.env.E2E_API ?? 'http://localhost:3101/api', DB = process.env.E2E_DB;
if (!DB || ![API, DB].every(u => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'unf' + randomBytes(4).toString('hex');

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const DAY = 864e5;
const ago = (d) => new Date(Date.now() - d * DAY);

async function api(path, auth) {
  const r = await fetch(API + path, { headers: auth ? { Authorization: 'Bearer ' + auth } : {} });
  return { status: r.status, data: await r.json().catch(() => null) };
}

/* فقط دو متدی که `syncNextVisit` از تنظیمات می‌خواهد. خودِ `followUpUrl` —
   که این تست دربارهٔ اوست — به تنظیمات کاری ندارد، پس استاب چیزی را ضعیف نمی‌کند. */
const settingsStub = {
  brand: async () => ({ name: 'آزمون' }),
  sms: async () => ({
    nextVisitText: 'ویزیت {date}', nextVisitDays: 1, surgeryText: 'عمل {date}', surgeryDays: 1,
    preOpDays: 1, postOpDays: 1, reminderHour: 9, appointmentText: 'نوبت {date}', appointmentHour: 17,
    portalText: 'پرونده {link}', summaryText: 'خلاصه {link}', formSendText: 'فرم {link}',
    followUpText: 'پیگیری {link}',
  }),
};
const reminders = new RemindersService(db, { send: async () => ({ ok: true }) }, settingsStub,
  { require: () => ({ hostname: 'localhost' }) });

const made = { patients: [], visits: [], forms: [] };
const savedAccess = [];

/** بیمار + عملِ انجام‌شده، و ردیف‌های پیگیری از مسیرِ واقعی. */
async function surgery({ daysAgo, followUpDays, seq = 1, patientId = null, sync = true }) {
  let pid = patientId;
  if (pid === null) {
    pid = (await db.patient.create({ data: { code: tag + made.patients.length, firstName: 'بیمار', lastName: 'پیگیری' } })).id;
    made.patients.push(pid);
  }
  const v = await db.visit.create({
    data: { patientId: pid, seq, kind: 'surgery', opStatus: 'done', opDate: ago(daysAgo), followUpDays },
  });
  made.visits.push(v.id);
  if (sync) {
    await reminders.syncNextVisit(v.id);
    /* حالتِ واقعیِ تولید: ردیف هنگامِ **ثبتِ مراجعه** ساخته شده، یعنی پیش از
       تاریخِ عمل. همین یک خط است که باگِ D01 را زنده می‌کند. */
    await db.intakeSubmission.updateMany({
      where: { patientId: pid, data: { path: ['followUpVisitId'], equals: v.id } },
      data: { createdAt: ago(daysAgo + 5) },
    });
  }
  return { patientId: pid, visit: v };
}

/** پاسخِ بیمار به موعدِ مشخص. */
const answer = async (visitId, day) => db.intakeSubmission.updateMany({
  where: { AND: [
    { data: { path: ['followUpVisitId'], equals: visitId } },
    { data: { path: ['followUpDay'], equals: day } },
  ] },
  data: { status: 'approved', reviewedAt: new Date() },
});

const rowOf = (u, visitId) => u.rows.find((r) => r.visitId === visitId);

try {
  const token = (await (await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
  })).json()).accessToken;
  assert.ok(token, 'login');
  for (const [table, key] of [['feature', 'formgen'], ['permission', 'intake.read']]) {
    savedAccess.push([table, key, await db[table].findUnique({ where: { key } })]);
    await db[table].upsert({ where: { key }, create: { key, minLevel: 3, enabled: true }, update: { minLevel: 3, enabled: true, roles: [] } });
  }

  /* بدونِ فرمِ پیگیری، گزارش باید بگوید «قابلیت روشن نیست» — نه فهرستِ
     «همه پیگیری‌نشده». همان قرارِ fail-soft که از قبل بود. */
  const off = await api('/intake/unfollowed', token);
  ok(off.data?.enabled === false, 'بی‌فرمِ پیگیری: قابلیت خاموش اعلام می‌شود، نه فهرستِ همه');

  const form = await db.formDef.create({
    data: { key: tag + 'fu', title: 'پیگیریِ پس از عمل', scope: 'record', followUp: 'general', active: true },
  });
  made.forms.push(form.id);

  console.log('\n۱) فرمِ پیش از عمل، تکمیل بعد — قلبِ D01');
  const a = await surgery({ daysAgo: 20, followUpDays: '1,7,30' });
  const subs = await db.intakeSubmission.findMany({
    where: { data: { path: ['followUpVisitId'], equals: a.visit.id } },
    select: { data: true, createdAt: true },
  });
  ok(subs.length === 3, `مسیرِ واقعی به‌ازای هر موعد یک ردیف ساخت (${subs.length})`);
  ok(subs.every((s) => s.createdAt < a.visit.opDate),
    'وضعیتِ تولید بازسازی شد: ردیف پیش از تاریخِ عمل ساخته شده');
  ok(subs.map((s) => s.data.followUpDay).sort((x, y) => x - y).join(',') === '1,7,30',
    'کلیدِ موعد در همان JSON است (`followUpDay`)');

  await answer(a.visit.id, 1);
  await answer(a.visit.id, 7);
  let u = (await api('/intake/unfollowed', token)).data;
  ok(!rowOf(u, a.visit.id),
    '**باید بیفتد:** پاسخِ بعد از عمل دیده شد، با اینکه ردیفش پیش از عمل ساخته شده بود');
  ok(u.followed >= 1, 'همان عمل در شمارشِ «پیگیری‌شده» نشست');

  console.log('\n۲) یک پاسخ، دو عمل — نباید یکی دیگری را بپوشاند');
  const b1 = await surgery({ daysAgo: 60, followUpDays: '1,7' });
  const b2 = await surgery({ daysAgo: 10, followUpDays: '1,7', seq: 2, patientId: b1.patientId });
  await answer(b2.visit.id, 1);
  await answer(b2.visit.id, 7);
  u = (await api('/intake/unfollowed', token)).data;
  ok(!!rowOf(u, b1.visit.id),
    '**نباید بیفتد:** پاسخِ عملِ تازه، عملِ قدیمیِ همان بیمار را پیگیری‌شده نکرد');
  ok(!rowOf(u, b2.visit.id), 'خودِ عملِ پاسخ‌گرفته در فهرست نیست');

  console.log('\n۳) گزارشِ per-موعد');
  const c = await surgery({ daysAgo: 40, followUpDays: '1,7,30' });
  await answer(c.visit.id, 1);
  u = (await api('/intake/unfollowed', token)).data;
  const rc = rowOf(u, c.visit.id);
  ok(rc?.pendingDays.join(',') === '7,30', `کدام موعد بی‌پاسخ است (${rc?.pendingDays.join('،')})`);
  ok(rc?.answeredDays.join(',') === '1', 'کدام موعد پاسخ گرفته');
  ok(rc?.days.find((d) => d.day === 1)?.answeredAt,
    'زمانِ پاسخ از `reviewedAt` می‌آید نه `createdAt` (که لحظهٔ ساختِ لینک است)');

  console.log('\n۴) موعدِ نرسیده کارِ امروز نیست');
  const d = await surgery({ daysAgo: 2, followUpDays: '7,30' });
  u = (await api('/intake/unfollowed', token)).data;
  ok(!rowOf(u, d.visit.id),
    '**نباید بیفتد:** عملِ دوروزه با پیگیریِ روزِ هفتم «پیگیری‌نشده» شمرده نشد');
  ok(u.waiting >= 1, 'ولی از قلم هم نیفتاد — جدا شمرده شد (`waiting`)');

  console.log('\n۵) نبودِ ردیفِ پیگیری هم یک شکاف است');
  const e = await surgery({ daysAgo: 40, followUpDays: '1,7', sync: false });
  u = (await api('/intake/unfollowed', token)).data;
  const re = rowOf(u, e.visit.id);
  ok(re && re.days.length === 0, 'عملی که اصلاً فرمِ پیگیری برایش ساخته نشده، گزارش می‌شود');

  console.log('\n۶) فرمِ دستیِ بی‌کلید — نه دور ریخته شود، نه دو عمل را بپوشاند');
  const f1 = await surgery({ daysAgo: 60, followUpDays: '1', sync: false });
  const f2 = await surgery({ daysAgo: 30, followUpDays: '1', seq: 2, patientId: f1.patientId, sync: false });
  await db.intakeSubmission.create({
    data: {
      token: tag + 'loose', formId: form.id, patientId: f1.patientId, amount: 0, status: 'approved',
      data: { note: 'فرمی که ادمین دستی فرستاد' }, createdAt: ago(20),
      expiresAt: new Date(Date.now() + 30 * DAY),
    },
  });
  u = (await api('/intake/unfollowed', token)).data;
  ok(!rowOf(u, f2.visit.id),
    '**نباید بیفتد:** پاسخِ بی‌کلید دور ریخته نشد — نزدیک‌ترین عملِ پیش از خودش را پوشاند');
  ok(!!rowOf(u, f1.visit.id),
    '**نباید بیفتد:** ولی عملِ دورترِ همان بیمار را هم نپوشاند');

  console.log('\n۷) CSV همان چیزی را می‌گوید که صفحه می‌گوید');
  const csv = await (await fetch(API + '/intake/unfollowed/csv', { headers: { Authorization: 'Bearer ' + token } })).text();
  ok(csv.includes('موعدِ بی‌پاسخ') && csv.includes('موعدِ پاسخ‌گرفته'), 'ستونِ موعد در CSV هست');
  ok(csv.includes('روزِ 7') || csv.includes('روزِ 30'), 'شمارهٔ موعدِ بی‌پاسخ در CSV نوشته می‌شود');

  console.log('\n۸) سقفِ فهرست اعلام می‌شود');
  u = (await api('/intake/unfollowed', token)).data;
  ok(u.limit === 300 && u.capped === false && u.total === u.checked,
    `زیرِ سقف: capped=false و total===checked (${u.total}/${u.checked})`);
  const bulk = (await db.patient.create({ data: { code: tag + 'bulk', firstName: 'انبوه', lastName: 'آزمون' } })).id;
  made.patients.push(bulk);
  await db.visit.createMany({
    data: Array.from({ length: 301 }, (_, i) => ({
      patientId: bulk, seq: i + 1, kind: 'surgery', opStatus: 'done', opDate: ago(1 + i % 300), followUpDays: '1',
    })),
  });
  u = (await api('/intake/unfollowed', token)).data;
  ok(u.capped === true && u.total > u.checked && u.checked === 300,
    `**باید بیفتد:** بریدگیِ فهرست دیده می‌شود (${u.checked} از ${u.total})`);
} finally {
  await db.visit.deleteMany({ where: { patient: { code: { startsWith: tag } } } });
  await db.intakeSubmission.deleteMany({ where: { OR: [{ patient: { code: { startsWith: tag } } }, { formId: { in: made.forms } }] } });
  await db.reminder.deleteMany({ where: { patient: { code: { startsWith: tag } } } });
  await db.patient.deleteMany({ where: { code: { startsWith: tag } } });
  await db.formDef.deleteMany({ where: { id: { in: made.forms } } });
  for (const [table, key, row] of savedAccess) {
    if (row) await db[table].update({ where: { key }, data: { minLevel: row.minLevel, enabled: row.enabled, roles: row.roles ?? [] } });
    else await db[table].delete({ where: { key } }).catch(() => {});
  }
  await db.$disconnect();
}
console.log(`\nسبز: ${count}`);
