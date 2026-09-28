/**
 * W1.9 — کلیدِ یکتای یادآوری + تلاشِ دوباره (N4/A3، قراردادِ §۸).
 * Real Prisma. Only run against an isolated local database.
 *
 * دو یافته:
 *
 * **N4 —** `syncNextVisit` هر بار همهٔ یادآوری‌های `pending` را لغو و از نو
 * می‌ساخت. یعنی هر ویرایشِ مراجعه شناسهٔ ردیف‌ها را عوض می‌کرد، دفتر پر از
 * `cancelled`ِ بی‌معنی می‌شد، و جلوگیری از پیامِ تکراری به یک کوئریِ دستیِ
 * مقایسهٔ متن (`sentSame`) بند بود که فقط `sent` را می‌دید.
 *
 * **A3 —** وضعیتِ `uncertain` عملاً **نهایی** بود: `sendReminders` فقط
 * `pending` را برمی‌دارد، پس پیامی که نتیجه‌اش نامعلوم مانده بود هیچ‌وقت
 * دوباره امتحان نمی‌شد و بی‌سروصدا می‌ماند.
 *
 *  باید بیفتد:
 *   - همگام‌سازیِ دوباره **همان ردیف** را نگه دارد، نه ردیفِ تازه
 *   - تغییرِ تاریخ یا متن، ردیفِ تازه بسازد و قبلی را لغو کند
 *   - `uncertain` با مکثِ ۵/۱۵/۴۵ دقیقه برگردد به صف
 *   - بعد از سه تلاشِ دوباره `failed` شود و `sms.failed` صادر شود
 *   - ردِ ملی‌پیامک («قطعاً نرفت») هم همان سه تلاش را بگیرد — در صف، با علتِ پیدا
 *     (گزارشِ میدانی ۱۴۰۵/۰۷/۰۴: ردِ لحظه‌ای تا ابد «ناموفق» ماند و دستیِ همان متن رفت)
 *  نباید بیفتد:
 *   - پیامِ **رفته** دوباره کاشته یا لغو شود
 *   - یادآوریِ کهنهٔ بی‌کلید برای همیشه `pending` بماند (تلهٔ NULL در SQL)
 *   - یادآوریِ مراجعهٔ دیگر یا kindِ بیرونِ برنامه هرس شود
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { RemindersService, reminderKey } = require('./dist/patients/reminders.service');
const { SettingsService } = require('./dist/config/settings.service');
const { sendReminders } = require('./dist/reminders/send-reminders');

const DB = process.env.E2E_DB;
if (!DB || !['localhost', '127.0.0.1'].includes(new URL(DB).hostname)) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'rem' + randomBytes(4).toString('hex');

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const DAY = 864e5;
const tenantStub = { require: () => ({ tenantId: tag, hostname: 'localhost' }) };
const settings = new SettingsService(db, { record: async () => {} }, tenantStub, {});
const reminders = new RemindersService(db, { send: async () => ({ ok: true }) }, settings, tenantStub);

const made = { patients: [], forms: [] };
const rowsOf = (visitId, kind) => db.reminder.findMany({ where: { visitId, ...(kind ? { kind } : {}) }, orderBy: { id: 'asc' } });

try {
  made.forms.push((await db.formDef.create({
    data: { key: tag + 'fu', title: 'پیگیری', scope: 'record', followUp: 'general', active: true },
  })).id);
  const pid = (await db.patient.create({ data: { code: tag, firstName: 'بیمار', lastName: 'یادآوری', phone: '09120000000' } })).id;
  made.patients.push(pid);
  const v = await db.visit.create({
    data: { patientId: pid, seq: 1, kind: 'surgery', opStatus: 'pending',
      opDate: new Date(Date.now() + 5 * DAY), followUpDays: '7', postOpCare: 'مراقبت الف', preOpCare: 'ناشتا' },
  });

  console.log('\n۱) کلید پایدار است — همگام‌سازیِ دوباره ردیفِ تازه نمی‌سازد');
  await reminders.syncNextVisit(v.id);
  const first = await rowsOf(v.id);
  ok(first.length > 0 && first.every((r) => r.dedupeKey),
    `همهٔ یادآوری‌ها کلید گرفتند (${first.length} ردیف)`);
  ok(first.some((r) => r.kind === 'post_op_care') && first.some((r) => r.kind === 'follow_up'),
    'هر دو نوعِ پس از عمل برنامه‌ریزی شدند');
  await reminders.syncNextVisit(v.id);
  const second = await rowsOf(v.id);
  ok(second.length === first.length && second.every((r) => r.status === 'pending'),
    `**باید بیفتد:** بارِ دوم هیچ ردیفی اضافه یا لغو نشد (${first.length} → ${second.length})`);
  ok(second.map((r) => r.id).join(',') === first.map((r) => r.id).join(','),
    '**باید بیفتد:** شناسهٔ ردیف‌ها هم عوض نشد — همان ردیف، نه ردیفِ تازه');

  console.log('\n۲) کلید از فرمولِ قرارداد ساخته می‌شود');
  const post = first.find((r) => r.kind === 'post_op_care');
  ok(post.dedupeKey === reminderKey('post_op_care', { visitId: v.id }, post.dueAt, post.text),
    'کلیدِ ذخیره‌شده با `reminderKey(kind, visit, موعد, متن)` یکی است');
  ok(post.dedupeKey.startsWith(`post_op_care:${v.id}:`), `شکلِ کلید (${post.dedupeKey})`);

  console.log('\n۳) تغییرِ متن ردیفِ تازه می‌سازد و قبلی را لغو می‌کند');
  await db.visit.update({ where: { id: v.id }, data: { postOpCare: 'مراقبتِ بازنویسی‌شده' } });
  await reminders.syncNextVisit(v.id);
  const posts = await rowsOf(v.id, 'post_op_care');
  ok(posts.length === 2, `دو ردیف شد (${posts.length})`);
  ok(posts.find((r) => r.id === post.id)?.status === 'cancelled',
    '**باید بیفتد:** ردیفِ متنِ قدیمی لغو شد — تاریخچه ماند، حذف نشد');
  ok(posts.find((r) => r.id !== post.id)?.status === 'pending', 'ردیفِ متنِ تازه در صف است');

  console.log('\n۴) نباید بیفتد — پیامِ رفته نه لغو می‌شود نه دوباره کاشته');
  const live = (await rowsOf(v.id, 'post_op_care')).find((r) => r.status === 'pending');
  await db.reminder.update({ where: { id: live.id }, data: { status: 'sent', sentAt: new Date() } });
  await reminders.syncNextVisit(v.id);
  const after = await rowsOf(v.id, 'post_op_care');
  ok(after.find((r) => r.id === live.id)?.status === 'sent',
    '**نباید بیفتد:** ردیفِ فرستاده‌شده دست‌نخورده ماند');
  ok(after.length === 2,
    `**نباید بیفتد:** با همان متن ردیفِ تکراری ساخته نشد (${after.length}) — کارِ کلید، نه \`sentSame\``);

  console.log('\n۵) نباید بیفتد — تلهٔ NULL: یادآوریِ کهنهٔ بی‌کلید باید هرس شود');
  const legacy = await db.reminder.create({
    data: { patientId: pid, visitId: v.id, kind: 'surgery', dueAt: new Date(Date.now() + DAY),
      phone: '09120000000', text: 'یادآوریِ کهنه از پیش از W1.9', status: 'pending' },
  });
  ok(legacy.dedupeKey === null, 'ردیفِ کهنه واقعاً بی‌کلید است');
  await reminders.syncNextVisit(v.id);
  ok((await db.reminder.findUnique({ where: { id: legacy.id } })).status === 'cancelled',
    '**نباید بیفتد:** `NOT IN` روی NULL ردیفِ کهنه را جا نگذاشت — لغو شد');

  console.log('\n۶) نباید بیفتد — مراجعهٔ دیگر و kindِ بیرونِ برنامه هرس نمی‌شوند');
  const other = await db.visit.create({ data: { patientId: pid, seq: 2, kind: 'surgery', opStatus: 'pending', opDate: new Date(Date.now() + 9 * DAY), postOpCare: 'مراقبتِ دوم' } });
  await reminders.syncNextVisit(other.id);
  const otherBefore = (await rowsOf(other.id)).filter((r) => r.status === 'pending').length;
  const notice = await db.reminder.create({
    data: { patientId: pid, visitId: v.id, kind: 'notice', dueAt: new Date(), phone: '09120000000',
      text: 'اعلانِ بیرونِ برنامه', status: 'pending', dedupeKey: tag + 'notice' },
  });
  await reminders.syncNextVisit(v.id);
  ok((await rowsOf(other.id)).filter((r) => r.status === 'pending').length === otherBefore,
    '**نباید بیفتد:** یادآوری‌های مراجعهٔ دیگر دست نخوردند');
  ok((await db.reminder.findUnique({ where: { id: notice.id } })).status === 'pending',
    '**نباید بیفتد:** kindِ بیرونِ برنامه (`notice`) هرس نشد');

  console.log('\n۷) تلاشِ دوباره با مکثِ ۵ / ۱۵ / ۴۵ دقیقه');
  const flaky = await db.reminder.create({
    data: { patientId: pid, kind: 'notice', dueAt: new Date(Date.now() - 60000), phone: '09120000000',
      text: tag + ' پیامِ نامعلوم', status: 'pending', dedupeKey: tag + 'flaky' },
  });
  const unknownSms = { send: async () => { const e = new Error('پاسخِ نامعلوم'); e.smsOutcome = 'unknown'; throw e; } };
  const waits = [];
  for (let i = 1; i <= 4; i++) {
    /* ⚠️ فقط **ساعت** جلو برده می‌شود، نه وضعیت. نسخهٔ اولِ همین حلقه خودش
       `uncertain` را به `pending` برمی‌گرداند و در عمل همان مکانیزمی را که
       باید بسنجد دور می‌زد: با برداشتنِ صفِ بازگشت از `sendReminders` هم سبز
       می‌ماند. حالا بازگرداندنِ ردیف به صف کارِ خودِ تابع است. */
    await db.reminder.updateMany({ where: { id: flaky.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await sendReminders(db, unknownSms, [flaky.id]);
    const r = await db.reminder.findUnique({ where: { id: flaky.id } });
    waits.push({ attempts: r.attempts, status: r.status, inMin: Math.round((r.dueAt.getTime() - Date.now()) / 60000) });
  }
  ok(waits.slice(0, 3).every((w) => w.status === 'uncertain'),
    `سه تلاشِ اول در حالتِ نامعلوم ماندند (${waits.map((w) => w.status).join('، ')})`);
  ok(waits.slice(0, 3).map((w) => w.inMin).join(',') === '5,15,45',
    `**باید بیفتد:** مکث‌ها ۵ / ۱۵ / ۴۵ دقیقه شدند (${waits.slice(0, 3).map((w) => w.inMin).join('، ')})`);
  ok(waits[3].status === 'failed' && waits[3].attempts === 4,
    `**باید بیفتد:** بعد از سه تلاشِ دوباره failed شد (${waits[3].status}، ${waits[3].attempts} تلاش)`);
  const ev = await db.domainEvent.findMany({ where: { type: 'sms.failed' }, orderBy: { id: 'desc' }, take: 5 });
  ok(ev.length > 0, 'رویدادِ `sms.failed` صادر شد — شکست دیده می‌شود، نه اینکه ساکت بماند');

  console.log('\n۸) نباید بیفتد — شکستِ قطعی اصلاً تلاشِ دوباره نمی‌گیرد');
  const hard = await db.reminder.create({
    data: { patientId: pid, kind: 'notice', dueAt: new Date(Date.now() - 60000), phone: '09120000000',
      text: tag + ' شکستِ قطعی', status: 'pending', dedupeKey: tag + 'hard' },
  });
  await sendReminders(db, { send: async () => { throw new Error('شمارهٔ نامعتبر'); } }, [hard.id]);
  const h = await db.reminder.findUnique({ where: { id: hard.id } });
  ok(h.status === 'failed' && h.attempts === 1,
    `**نباید بیفتد:** خطای قطعی سه بار تکرار نشد (${h.status}، ${h.attempts} تلاش)`);

  console.log('\n۹) ردِ ملی‌پیامک «قطعاً نرفت» است — همان سه تلاش، ولی در صف و با علتِ پیدا');
  const refusing = { send: async () => {
    const e = new Error('سرویس پیامک موقتاً در دسترس نیست');
    e.smsOutcome = 'rejected'; e.smsDetail = 'ملی‌پیامک پیام را نپذیرفت: سقفِ ارسالِ لحظه‌ای';
    throw e;
  } };
  const refused = await db.reminder.create({
    data: { patientId: pid, kind: 'notice', dueAt: new Date(Date.now() - 60000), phone: '09120000000',
      text: tag + ' ردِ لحظه‌ای', status: 'pending', dedupeKey: tag + 'refused' },
  });
  const rw = [];
  for (let i = 1; i <= 4; i++) {
    await db.reminder.updateMany({ where: { id: refused.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await sendReminders(db, refusing, [refused.id]);
    const r = await db.reminder.findUnique({ where: { id: refused.id } });
    rw.push({ status: r.status, attempts: r.attempts, inMin: Math.round((r.dueAt.getTime() - Date.now()) / 60000), error: r.error ?? '' });
  }
  ok(rw.slice(0, 3).every((w) => w.status === 'pending'),
    `**باید بیفتد:** ردِ ملی‌پیامک در صف ماند، نه «ناموفق» (${rw.map((w) => w.status).join('، ')})`);
  ok(rw.slice(0, 3).map((w) => w.inMin).join(',') === '5,15,45',
    `**باید بیفتد:** مکث‌ها ۵ / ۱۵ / ۴۵ دقیقه (${rw.slice(0, 3).map((w) => w.inMin).join('، ')})`);
  ok(rw.every((w) => w.error.includes('سقفِ ارسالِ لحظه‌ای') && !w.error.includes('موقتاً در دسترس نیست')),
    'علتِ واقعی در هر تلاش در دفتر پیداست، نه پیامِ کلی');
  ok(rw[3].status === 'failed' && rw[3].attempts === 4,
    `**باید بیفتد:** بعد از سه تلاشِ دوباره failed شد (${rw[3].status}، ${rw[3].attempts} تلاش)`);
  ok(await db.domainEvent.count({ where: { type: 'sms.failed', refType: 'reminder', refId: refused.id } }) === 1,
    'کارِ «ارسالِ دوباره» یک‌بار و فقط پس از آخرین تلاش');

  console.log('\n۱۰) ردِ لحظه‌ای که تلاشِ بعدی‌اش برود — همان ردیف «رفت»، بی‌علت و بی‌کار');
  const later = await db.reminder.create({
    data: { patientId: pid, kind: 'notice', dueAt: new Date(Date.now() - 60000), phone: '09120000000',
      text: tag + ' بعدتر می‌رود', status: 'pending', dedupeKey: tag + 'later' },
  });
  await sendReminders(db, refusing, [later.id]);
  await db.reminder.updateMany({ where: { id: later.id }, data: { dueAt: new Date(Date.now() - 1000) } });
  await sendReminders(db, { send: async () => ({ sent: true, stub: false, providerId: '3741437414' }) }, [later.id]);
  const l = await db.reminder.findUnique({ where: { id: later.id } });
  ok(l.status === 'sent' && !l.error && l.providerId === '3741437414', `تلاشِ دوم رفت (${l.status}، علت: ${l.error ?? '—'})`);
  ok(await db.domainEvent.count({ where: { type: 'sms.failed', refType: 'reminder', refId: later.id } }) === 0,
    '**نباید بیفتد:** ردی که بعدتر رفت کارِ «ارسالِ دوباره» نساخت');

  console.log('\n۱۱) گزارشِ عیب‌یابیِ پیامک — خطِ زمانیِ تلاش‌ها، بی‌شماره و بی‌متن');
  /* ارسالِ دوبارهٔ دستیِ `later` را شبیه‌سازی می‌کنیم: ممیزیِ `reminder.retry` لحظه‌ای
     **بعد از** رویدادِ `sms.sent`ِ همان ردیف ثبت می‌شود (همان ترتیبِ `retry()`). */
  const manual = await db.auditEvent.create({ data: {
    action: 'reminder.retry', entityType: 'reminder', entityId: String(later.id),
    afterJson: { due: 1, sent: 1, failed: 0, skipped: 0 },
  } });
  /* ارسالِ مستقیم از دکمه — فقط ممیزی دارد؛ `after.to` شمارهٔ واقعی است و نباید چاپ شود. */
  const directSms = await db.auditEvent.create({ data: {
    action: 'intake.link.sms', entityType: 'intake_link', entityId: '1',
    afterJson: { to: '09121112233', sent: true, stub: false },
  } });
  /* «رفت»ِ دروغینِ پیش از #110: پاسخِ «پیام ارسال نشد (کدِ ۱۱)» با `recIds[0] > 0` «رفت» ثبت می‌شد
     و شناسه‌اش همان کد بود. گزارش باید آن را «نرفت» با همان کد بخواند (مالک، ۱۴۰۵/۰۷/۰۶: «اعتبار
     زیاد دارد، ربطی به آن ندارد» — تنها ردِ واقعیِ آن دوره همین شناسه‌هاست). */
  const fakeSent = await db.reminder.create({
    data: { patientId: pid, kind: 'post_op_care', dueAt: new Date(Date.now() - 3600000), phone: '09120000000',
      text: tag + ' مراقبتِ بلند', status: 'sent', sentAt: new Date(), providerId: '11', dedupeKey: tag + 'fake' },
  });
  const fakeEvent = await db.domainEvent.create({ data: {
    type: 'sms.sent', patientId: pid, refType: 'reminder', refId: fakeSent.id, payload: { kind: 'post_op_care', providerId: '11' },
  } });
  const report = await reminders.diagnostics();
  const lines = report.split('\n');
  ok(lines.some((l) => l.includes(`ردیفِ ${String(fakeSent.id).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])}`) && l.includes('نرفت (ثبت شده بود «رفت»؛ ملی‌پیامک کدِ ۱۱ داده بود: پیام ارسال نشد)')),
    '**«رفت»ِ قدیمی با شناسهٔ کوچک «نرفت» با همان کدِ ملی‌پیامک خوانده شد**');
  ok(lines.some((l) => l.includes('«رفت»ِ ثبت‌شده که در واقع رد شده ۱')), 'خلاصهٔ نوع هم «رفت»ِ دروغین را جدا می‌شمارد');
  const causes = lines.slice(lines.findIndex((l) => l.startsWith('۴) علتِ ردها')));
  ok(causes.some((l) => l.startsWith('• ') && l.includes('کدِ ۱۱') && l.includes('پیام ارسال نشد'))
    && causes.some((l) => l.startsWith('• ') && l.includes('سقفِ ارسالِ لحظه‌ای') && !l.includes('تلاشِ')),
    '**علتِ ردها شمرده شد** — کدِ ملی‌پیامک و علتِ ثبت‌شده، بی‌پیشوندِ «تلاشِ n از ۴»');
  ok(lines[0].startsWith('عیب‌یابیِ پیامک') && report.includes('پروسهٔ سرور از'), 'گزارش سرتیتر و زمانِ روشن‌شدنِ سرور را دارد');
  ok(lines.some((l) => l.startsWith('• اطلاع‌رسانی:') && l.includes('نرفته') && l.includes('بخش')),
    'خلاصهٔ هر نوع: رفته/نرفته و طول و تعدادِ بخش');
  ok(lines.some((l) => l.includes(' · نرفت · ') && l.includes('سقفِ ارسالِ لحظه‌ای')),
    'هر تلاشِ ناموفق با علتش در خطِ زمانی هست');
  const faId = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
  ok(lines.some((l) => l.includes(' · رفت · ') && l.includes('دستی') && l.includes(`ردیفِ ${faId(later.id)}`)),
    'ارسالِ دوبارهٔ دستی «دستی» علامت خورد و شمارهٔ ردیفش پیداست');
  ok(report.includes('«ارسالِ دوباره»ی دستی') && lines.some((l) => l.includes(`ردیفِ `) && l.endsWith('· رفت')),
    'بخشِ «ارسالِ دوباره»ی دستی نتیجه را دارد');
  ok(lines.some((l) => l.includes(' · رفت · لینکِ ثبت‌نام · دکمهٔ ارسالِ مستقیم')),
    'ارسالِ مستقیم از دکمه هم در همان خطِ زمانی هست');
  ok(!report.includes('09120000000') && !report.includes('۰۹۱۲۰۰۰۰۰۰۰') && !report.includes(tag + ' ردِ لحظه‌ای')
    && !report.includes('09121112233') && !report.includes('۰۹۱۲۱۱۱۲۲۳۳'),
    '**نباید بیفتد:** شمارهٔ بیمار یا متنِ پیام در گزارش');
  await db.auditEvent.deleteMany({ where: { id: { in: [manual.id, directSms.id] } } });
  await db.domainEvent.deleteMany({ where: { id: fakeEvent.id } });
} finally {
  const vids = (await db.visit.findMany({ where: { patient: { code: { startsWith: tag } } }, select: { id: true } })).map((x) => x.id);
  await db.domainEvent.deleteMany({ where: { OR: [{ visitId: { in: vids } }, { patientId: { in: made.patients } }] } }).catch(() => {});
  await db.reminder.deleteMany({ where: { OR: [{ visitId: { in: vids } }, { patientId: { in: made.patients } }] } });
  await db.workItem.deleteMany({ where: { visitId: { in: vids } } }).catch(() => {});
  await db.intakeSubmission.deleteMany({ where: { OR: [{ patientId: { in: made.patients } }, { formId: { in: made.forms } }] } });
  await db.visit.deleteMany({ where: { id: { in: vids } } });
  await db.patient.deleteMany({ where: { code: { startsWith: tag } } });
  await db.formDef.deleteMany({ where: { id: { in: made.forms } } });
  await db.$disconnect();
}
console.log(`\nسبز: ${count}`);
