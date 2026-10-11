/**
 * «ارسالِ لینکِ سفارش» (دکمهٔ پنلِ کارکنان) — علتِ واقعیِ ردِ پیامک و ثبتِ «نرفت» در **production**
 * (گزارشِ آمادگیِ فروش، بندِ ۳: `orders.service.ts` به‌جای `sendForStaff` همان `send` را می‌زد).
 *
 * قراردادِ دو سرویس را با **کدِ واقعیِ هر دو** می‌سنجد: `SmsService` واقعی (fetchِ ملی‌پیامک ساختگی، NODE_ENV=production)
 * + `OrdersService` واقعی با دیتابیسِ جعلی. دو باگِ هم‌خانواده را می‌گیرد:
 *  ۱. در production ردِ ملی‌پیامک **پرتاب** می‌شود؛ شاخهٔ «ثبتِ نرفت + کارِ ارسالِ دوباره» فقط بیرون از production می‌دوید.
 *  ۲. `sendForStaff` علت را برمی‌گرداند ولی `smsOutcome` را دور می‌ریخت، پس فراخوان «قطعاً نرفت» را از «نامعلوم» جدا نمی‌کرد.
 *
 *  باید بیفتد:
 *   - ردِ قطعی (کدِ ۱۴ / کلید تنظیم نیست) ← ۵۰۳ با **علتِ واقعی** (نه پیامِ کلیِ عمومی)، یک ردیفِ `failed` با همان علت،
 *     یک `sms.failed` با همان علت، و سفارش «پیش‌نویس» می‌ماند (نرفته که «ارسال‌شده» نیست)
 *   - بیرون از production (`sent:false` بدونِ پرتاب) هم همان قرارداد: ۵۰۳ و ثبت — «لینک فرستاده شد»ِ دروغ نیست
 *  نباید بیفتد:
 *   - ارسالِ موفق و آزمایشی (stub): سفارش `sent`، ردیفِ `sent`، بدونِ `sms.failed`
 *   - نتیجهٔ نامعلوم (قطعِ شبکه) و خطای برنامه: همان خطا بالا می‌آید و **چیزی ثبت نمی‌شود** (شاید پیام رفته باشد؛
 *     «ارسالِ دوباره»ی خودکار پیامِ تکراری می‌ساخت)
 *   - علت شماره‌ای نمی‌ماند
 *  و دو قراردادِ «ارسالِ دوباره» (بازبینیِ ۱۴۰۵/۰۷/۱۹):
 *   - لینکی که بعداً از دفترِ پیام‌ها (`sendReminders`) واقعاً رفت سفارش را «فرستاده‌شده» می‌کند — وگرنه صفحهٔ بیمار
 *     پاسخ و فایل را با ۴۰۹ رد می‌کرد؛ ولی ردِ دوباره یا لینکِ پرونده‌ای دیگر آن را جلو نمی‌برد
 *   - ارسالِ موفقِ بعدی از همان شیت ردیفِ «نرفت»ِ قبلی را کنار می‌گذارد و کارِ «ارسالِ دوباره»اش را می‌بندد
 *     (`sms.cancelled`) — وگرنه بیمار همان لینک را دو بار می‌گرفت
 *   - «نتیجه نامعلوم» کدِ ماشینیِ `SMS_UNKNOWN` دارد تا رابط آن را «ناموفق» نخواند
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { SmsService } = require('./dist/sms/sms.service');
const { OrdersService } = require('./dist/patients/orders.service');
const { sendReminders } = require('./dist/reminders/send-reminders');

let pass = 0; const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fails.push(m); console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };
const PUBLIC = 'سرویس پیامک موقتاً در دسترس نیست';

/* دیتابیسِ جعلی: فقط آنچه `send()` لمس می‌کند. */
const TOKEN = 'tok123tok123tok123AB';
function world() {
  const state = { order: { id: 1, patientId: 5, visitId: 9, token: TOKEN, status: 'draft', tests: ['CBC'], note: '', patient: { phone: '09121234567' } },
    reminders: [], events: [], audits: [], outbox: [] };
  const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('contains' in v) return String(row[k] ?? '').includes(v.contains);
      if ('not' in v) return row[k] !== v.not;
      if ('in' in v) return v.in.includes(row[k]);
      if ('lte' in v) return row[k] <= v.lte;
      if ('lt' in v) return row[k] < v.lt;
      return true;
    }
    return row[k] === v;
  });
  const labOrder = {
    findUnique: async () => ({ ...state.order }),
    update: async ({ data }) => { Object.assign(state.order, data); return { ...state.order }; },
    updateMany: async ({ where, data }) => { if (!matches(state.order, where)) return { count: 0 }; Object.assign(state.order, data); return { count: 1 }; },
  };
  const tx = { $queryRawUnsafe: async () => [], labOrder };
  const reminder = {
    create: async ({ data }) => { const row = { id: 70 + state.reminders.length, channel: 'sms', attempts: 0, kind: 'notice', ...data }; state.reminders.push(row); return row; },
    findMany: async ({ where }) => state.reminders.filter((r) => matches(r, where)).map((r) => ({ ...r })),
    updateMany: async ({ where, data }) => { const hit = state.reminders.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
    update: async ({ where, data }) => { const r = state.reminders.find((x) => x.id === where.id); Object.assign(r, data); return r; },
  };
  const prisma = {
    labOrder,
    patient: { findFirst: async () => ({ id: 5 }) },
    reminder,
    domainEvent: { create: async ({ data }) => { state.outbox.push(data); return data; } },
    $transaction: async (fn) => fn(tx),
  };
  const svc = (sms) => new OrdersService(
    prisma,
    { brand: async () => ({ name: 'مطبِ آزمون' }) },
    sms,
    { require: () => ({ hostname: 't.amalyar.com' }) },
    { record: async (a) => { state.audits.push(a); } },
    { emit: async (e) => { state.events.push(e); } },
    {}, {},
  );
  return { state, svc, client: prisma };
}

/* همان کلاینتِ جعلی، شکلی که `sendReminders` می‌خواهد. */
const worldClient = (w) => w.client;
const answer = (status, body) => {
  global.fetch = async () => ({ ok: status < 400, status, json: async () => body });
};
const user = { id: 3, level: 6 };
const attempt = async (svc) => { try { return { res: await svc.send('lab', 1, user) }; } catch (e) { return { err: e }; } };

process.env.MELI_API_KEY = 'ci-key'; process.env.MELI_FROM = 'ci-line';

console.log('۱) production — ردِ قطعیِ ملی‌پیامک');
process.env.NODE_ENV = 'production';
let w = world();
answer(200, { recIds: [14] });
let r = await attempt(w.svc(new SmsService()));
ok(r.err?.getStatus?.() === 503, 'ردِ ملی‌پیامک ← ۵۰۳', String(r.err));
ok(/لینک/.test(r.err?.message ?? '') && r.err?.message !== PUBLIC, '**علتِ واقعی (کدِ ۱۴: لینک) به کارمند می‌رسد، نه پیامِ کلیِ عمومی**', r.err?.message);
ok(/سفارش ثبت شد ولی پیامک نرفت/.test(r.err?.message ?? ''), 'کارمند می‌فهمد خودِ سفارش ثبت شده');
ok(w.state.order.status === 'draft', '**سفارشِ نرفته «ارسال‌شده» نمی‌شود** (پیش‌نویس می‌ماند)');
ok(w.state.reminders.length === 1 && w.state.reminders[0].status === 'failed' && w.state.reminders[0].sentAt === null, '**یک ردیفِ «نرفت» در دفترِ پیام‌ها نشست** (تا امروز در production نمی‌نشست)');
ok(/لینک/.test(w.state.reminders[0]?.error ?? ''), 'علتِ واقعی روی همان ردیف است');
ok(w.state.events.length === 1 && w.state.events[0].type === 'sms.failed' && w.state.events[0].refType === 'reminder' && w.state.events[0].refId === w.state.reminders[0].id, '**کارِ «ارسالِ دوباره» برای منشی ساخته شد** و به همان ردیف وصل است');
ok(/لینک/.test(w.state.events[0]?.payload?.error ?? ''), 'علت در کارِ «ارسالِ دوباره» هم هست');
ok(w.state.audits.some((a) => a.action === 'order.lab.send' && a.after.sent === false), 'ممیزی ثبت شد (sent:false)');

console.log('\n۲) production — کلید/خط تنظیم نیست');
w = world();
delete process.env.MELI_API_KEY;
r = await attempt(w.svc(new SmsService()));
ok(r.err?.getStatus?.() === 503 && /MELI_API_KEY/.test(r.err?.message ?? ''), 'علتِ راه‌اندازی به کارمند می‌رسد', r.err?.message);
ok(w.state.reminders.length === 1 && w.state.reminders[0].status === 'failed' && w.state.events.length === 1, 'ردیف و کارِ ارسالِ دوباره ثبت شد');
process.env.MELI_API_KEY = 'ci-key';

console.log('\n۳) production — ارسالِ موفق');
w = world();
answer(200, { recIds: [3741437414] });
r = await attempt(w.svc(new SmsService()));
ok(r.res?.ok && r.res.sent === true && r.res.stub === false, 'ارسال موفق ← sent:true');
ok(w.state.order.status === 'sent' && w.state.order.sentAt instanceof Date, 'سفارش «فرستاده‌شده» شد');
ok(w.state.reminders.length === 1 && w.state.reminders[0].status === 'sent' && w.state.reminders[0].sentAt instanceof Date && !('error' in w.state.reminders[0]), 'ردیفِ «رفت»، بی‌علت');
ok(w.state.events.length === 0, 'موفقیت کارِ «ارسالِ دوباره» نمی‌سازد');

console.log('\n۴) نتیجهٔ نامعلوم و خطای برنامه — چیزی ثبت نمی‌شود');
w = world();
global.fetch = async () => { throw new Error('socket hang up'); };
r = await attempt(w.svc(new SmsService()));
ok(r.err?.getStatus?.() === 503 && /مشخص نشد/.test(r.err?.message ?? ''), 'قطعِ شبکه ← همان «نتیجه مشخص نشد»', r.err?.message);
ok(r.err?.getResponse?.()?.code === 'SMS_UNKNOWN' && /سفارش ثبت شد/.test(r.err?.message ?? ''), '**نامعلوم کدِ SMS_UNKNOWN دارد** (رابط آن را «ناموفق» نمی‌خواند و به ارسالِ تکراری دعوت نمی‌کند)', JSON.stringify(r.err?.getResponse?.()));
ok(w.state.reminders.length === 0 && w.state.events.length === 0 && w.state.order.status === 'draft', '**نامعلوم: ردیف و کارِ ارسالِ دوباره نمی‌سازد** (شاید رفته باشد؛ تکراری می‌شد)');
w = world();
r = await attempt(w.svc({ sendForStaff: async () => { throw new TypeError('bug'); } }));
ok(r.err instanceof TypeError && w.state.reminders.length === 0 && w.state.events.length === 0, 'خطای برنامه بالا می‌آید و قورت داده نمی‌شود');

console.log('\n۵) بیرون از production — بدونِ پرتاب');
process.env.NODE_ENV = 'test';
w = world();
answer(200, { recIds: [], status: 'خط فرستنده معتبر نیست' });
r = await attempt(w.svc(new SmsService()));
ok(r.err?.getStatus?.() === 503 && /خط فرستنده/.test(r.err?.message ?? ''), '**ردِ بدونِ پرتاب هم ۵۰۳ با علت است — «لینک فرستاده شد»ِ دروغ نیست**', r.err?.message);
ok(w.state.reminders.length === 1 && w.state.reminders[0].status === 'failed' && w.state.events.length === 1 && w.state.order.status === 'draft', 'ثبتِ نرفت و کارِ ارسالِ دوباره مثلِ production');
w = world();
delete process.env.MELI_API_KEY;
r = await attempt(w.svc(new SmsService()));
ok(r.res?.ok && r.res.stub === true && r.res.sent === false && w.state.order.status === 'sent' && w.state.reminders[0].status === 'sent', 'آزمایشی (stub): ثبت و «فرستاده‌شده»، بدونِ خطا');
ok(w.state.events.length === 0, 'stub کارِ ارسالِ دوباره نمی‌سازد');
process.env.MELI_API_KEY = 'ci-key';

console.log('\n۶) علت شماره‌ای نمی‌ماند');
process.env.NODE_ENV = 'production';
w = world();
answer(200, { recIds: [], status: 'گیرنده 09121234567 با کد 123456 رد شد' });
r = await attempt(w.svc(new SmsService()));
ok(!/[0-9]{4,}/.test(r.err?.message ?? '') && !/[0-9]{4,}/.test(w.state.reminders[0]?.error ?? '') && !/[0-9]{4,}/.test(w.state.events[0]?.payload?.error ?? ''), 'شماره و کد از پیام، ردیف و کارِ ارسالِ دوباره پاک است');

console.log('\n۷) «ارسالِ دوباره» از دفترِ پیام‌ها — لینک که رفت، سفارش «فرستاده‌شده» می‌شود');
process.env.NODE_ENV = 'production';
w = world();
answer(200, { recIds: [14] });
await attempt(w.svc(new SmsService()));
const failedRow = w.state.reminders[0];
ok(w.state.order.status === 'draft' && failedRow?.status === 'failed', 'پیش‌شرط: ردِ اول، سفارش پیش‌نویس و ردیفِ «نرفت»');
/* همان کارِ `RemindersService.retry`: ردیف به صف و `sendReminders` روی همان شناسه. */
Object.assign(failedRow, { status: 'pending', attempts: 0, dueAt: new Date(), error: null });
answer(200, { recIds: [14] });
await sendReminders(worldClient(w), new SmsService(), [failedRow.id]);
ok(w.state.order.status === 'draft', 'ردِ دوباره سفارش را جلو نمی‌برد');
Object.assign(failedRow, { status: 'pending', attempts: 0, dueAt: new Date(), error: null });
answer(200, { recIds: [3741437414] });
await sendReminders(worldClient(w), new SmsService(), [failedRow.id]);
ok(failedRow.status === 'sent', 'ارسالِ دوباره رفت');
ok(w.state.order.status === 'sent' && w.state.order.sentAt instanceof Date, '**سفارش «فرستاده‌شده» شد** — صفحهٔ بیمار دیگر پاسخ و فایل را با ۴۰۹ رد نمی‌کند');
w = world();
w.state.order.patientId = 6;
w.state.reminders.push({ id: 90, channel: 'sms', kind: 'notice', status: 'pending', attempts: 0, dueAt: new Date(), patientId: 5, phone: '09121234567', text: `x\nhttps://t.amalyar.com/o/${TOKEN}` });
answer(200, { recIds: [3741437414] });
await sendReminders(worldClient(w), new SmsService(), [90]);
ok(w.state.order.status === 'draft', 'لینکی در پیامِ پرونده‌ای دیگر سفارش را جلو نمی‌برد');

console.log('\n۸) ارسالِ موفقِ بعدی از همان شیت — ردیفِ «نرفت»ِ قبلی کنار می‌رود');
w = world();
answer(200, { recIds: [14] });
await attempt(w.svc(new SmsService()));
answer(200, { recIds: [3741437414] });
r = await attempt(w.svc(new SmsService()));
ok(r.res?.sent === true && w.state.order.status === 'sent', 'بارِ دوم رفت');
ok(w.state.reminders[0].status === 'cancelled' && /بعداً/.test(w.state.reminders[0].error ?? ''), '**ردیفِ «نرفت»ِ قبلی لغو شد** — دیگر «ارسالِ دوباره» ندارد');
ok(w.state.reminders[1].status === 'sent', 'ردیفِ تازه «رفت» است و دست نخورد');
ok(w.state.outbox.some((e) => e.type === 'sms.cancelled' && e.refType === 'reminder' && e.refId === w.state.reminders[0].id), '**`sms.cancelled` برای همان ردیف ← کارِ «ارسالِ دوباره» بسته می‌شود**');
const { rulesFor } = require('./dist/work/work-rules');
const closes = rulesFor({ type: 'sms.cancelled', refType: 'reminder', refId: 70, patientId: 5 }).closes;
ok(closes.some((c) => c.type === 'resend_sms' && c.refId === 70), 'قاعدهٔ کارها `sms.cancelled` را به بستنِ resend_sms وصل می‌کند');

console.log(`\nسبز: ${pass}  قرمز: ${fails.length}`);
if (fails.length) process.exit(1);
