/**
 * W0.7 — اقدامِ تک‌ردیفی روی دفترِ یادآوری‌ها (U10).
 * Real Prisma. Only run against an isolated local database.
 *
 * تا امروز تنها اهرمِ مدیر «sweepِ همه» بود: یک پیامِ شکست‌خورده را نمی‌شد جدا
 * دوباره فرستاد و یک پیامِ اشتباه را نمی‌شد جلویش را گرفت — یا همه، یا هیچ.
 *
 *  باید بیفتد:
 *   - `failed` / `uncertain` / `simulated` دوباره در صف بنشینند و بروند
 *   - `attempts` صفر شود (تصمیمِ یک آدم است، نه ادامهٔ backoff)
 *   - `pending` لغو شود و دلیلش ثبت بماند
 *   - هر دو اقدام در `AuditEvent` بنشینند
 *  نباید بیفتد (⚠️ سنجه‌های منفی — هستهٔ این بسته):
 *   - 🔴 پیامِ **`sent`** دوباره فرستاده شود (پیامکِ دومِ سردرگم‌کننده به بیمارِ واقعی)
 *   - 🔴 پیامِ **`sent`** لغو شود (دفترِ پیام‌ها دربارهٔ چیزی که رخ داده دروغ بگوید)
 *   - ردیفِ `sending` — که همین حالا دستِ سرور است — دست بخورد
 *   - یادآوریِ ناموجود چیزی جز ۴۰۴ بدهد
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { RemindersService } = require('./dist/patients/reminders.service');

const DB = process.env.E2E_DB;
if (!DB || !['localhost', '127.0.0.1'].includes(new URL(DB).hostname)) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const tag = 'act' + randomBytes(4).toString('hex');

const audited = [];
const audit = { record: async (e) => { audited.push(e); } };
const tenantStub = { require: () => ({ tenantId: tag, hostname: 'localhost' }) };
const sent = [];
const sms = { send: async (phone, text) => { sent.push({ phone, text }); return { sent: true, providerId: 'p' + sent.length }; } };
const reminders = new RemindersService(db, sms, {}, tenantStub, audit);

/**
 * ⚠️ نتیجه **بیرونِ** try گرفته می‌شود. نسخهٔ اولِ همین کمک‌تابع `ok(false, …)`
 * را داخلِ try صدا می‌زد و بعد خودش AssertionErrorِ خودش را می‌گرفت و دوباره
 * می‌سنجید — یعنی اگر متنِ برچسب اتفاقاً شاملِ `needle` می‌شد، رگرسیون **سبز**
 * می‌ماند. سنجه‌ای که خطای خودش را می‌بلعد سنجه نیست.
 */
const fails = async (fn, needle, label) => {
  let msg = null;
  try { await fn(); } catch (e) { msg = String(e?.message ?? e); }
  ok(msg !== null && msg.includes(needle),
    msg === null ? `${label} — ولی اصلاً خطا نداد` : `${label} — «${msg.slice(0, 60)}»`);
};

try {
  const pid = (await db.patient.create({
    data: { code: tag, firstName: 'بیمار', lastName: 'یادآوری', phone: '09120000003' } })).id;
  const mk = (status, over = {}) => db.reminder.create({
    data: { patientId: pid, kind: 'notice', channel: 'sms', phone: '09120000003',
      text: `${tag} ${status}`, status, dueAt: new Date(Date.now() - 6e4), ...over },
  });

  console.log('\n۱) ارسالِ دوباره روی ردیفِ نرفته');
  const failed = await mk('failed', { attempts: 3, error: 'سرویس پیامک ارسال را نپذیرفت' });
  const after = await reminders.retry(failed.id, { id: 1 });
  ok(after.status === 'sent', `ردیفِ failed دوباره رفت (وضعیت: ${after.status})`);
  ok(sent.some((m) => m.text.includes('failed')), 'و واقعاً به سرویسِ پیامک رسید');
  /* ⚠️ ردیف با `attempts: 3` وارد شد (سقفِ backoffِ W1.9). اگر صفر نمی‌شد،
     یک شکستِ بعدی بلافاصله `failed` می‌شد و سه تلاشِ خودکار را از دست می‌داد.
     روی ارسالِ **موفق** خودِ `sendReminders` شمارنده را بالا نمی‌برد، پس
     مقدارِ درست همان صفرِ ریست‌شده است. */
  ok(after.attempts === 0,
    `شمارندهٔ تلاش از ۳ به ${after.attempts} ریست شد — تصمیمِ یک آدم است، نه ادامهٔ backoff`);
  ok(audited.some((a) => a.action === 'reminder.retry' && a.entityId === failed.id),
    'در دفترِ ممیزی ثبت شد');

  const uncertain = await mk('uncertain', { attempts: 2 });
  ok((await reminders.retry(uncertain.id, { id: 1 })).status === 'sent', 'ردیفِ uncertain هم دوباره رفت');
  const simulated = await mk('simulated');
  ok((await reminders.retry(simulated.id, { id: 1 })).status === 'sent', 'ردیفِ آزمایشی هم');

  console.log('\n۲) 🔴 پیامی که رفته، نه دوباره می‌رود نه لغو می‌شود');
  const done = await mk('sent', { sentAt: new Date(), providerId: 'px' });
  const before = sent.length;
  await fails(() => reminders.retry(done.id, { id: 1 }), 'ارسال شده',
    '⚠️ ارسالِ دوبارهٔ پیامِ رفته رد شد — بیمارِ واقعی پیامکِ دوم نمی‌گیرد');
  await fails(() => reminders.cancel(done.id, { id: 1 }), 'ارسال شده',
    '⚠️ لغوِ پیامِ رفته هم رد شد — دفتر دربارهٔ چیزی که رخ داده دروغ نمی‌گوید');
  ok(sent.length === before, 'و هیچ پیامکی در این دو تلاش نرفت');
  ok((await db.reminder.findUnique({ where: { id: done.id } })).status === 'sent',
    'ردیفش هم دست‌نخورده ماند');

  console.log('\n۳) لغو');
  const pending = await mk('pending', { dueAt: new Date(Date.now() + 864e5) });
  const cancelled = await reminders.cancel(pending.id, { id: 1 }, 'عمل موکول شد');
  ok(cancelled.status === 'cancelled' && cancelled.error === 'عمل موکول شد',
    'ردیفِ در صف لغو شد و دلیلش ماند');
  ok(audited.some((a) => a.action === 'reminder.cancel' && a.entityId === pending.id),
    'و در دفترِ ممیزی نشست');
  ok(!(await reminders.list()).some((r) => r.id === pending.id),
    'از دفترِ نمایش برداشته شد');

  console.log('\n۴) ردیف‌هایی که هیچ اقدامی نمی‌گیرند');
  const sending = await mk('sending', { attemptedAt: new Date() });
  await fails(() => reminders.retry(sending.id, { id: 1 }), 'sending',
    'ردیفِ «در حال ارسال» دست نمی‌خورد — همین حالا دستِ سرور است');
  await fails(() => reminders.cancel(sending.id, { id: 1 }), 'sending', 'نه برای لغو');
  await fails(() => reminders.retry(99999999, { id: 1 }), 'پیدا نشد', 'یادآوریِ ناموجود ۴۰۴ می‌دهد');

  console.log(`\n✅ ${count}/${count}`);
} finally {
  await db.$disconnect();
}
