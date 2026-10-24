/**
 * «کدام کلمه فیلتر شد؟» + «جایگزینیِ کلمه» در دفترِ یادآوری‌ها — دیتابیسِ واقعی، سرویس‌های واقعی، ملی‌پیامکِ ساختگی.
 * (همان خواستهٔ مالک: مثلِ پنلِ چینشِ ملک‌طب — با شمارهٔ خودم بده، کلمه را پیدا کند، همان‌جا عوض شود و برود.)
 *
 *  باید بیفتد:
 *   - جایگزینیِ کلمه **هنگامِ ارسال** اعمال شود (متنِ ثبت‌شده و کلیدِ یکتا دست‌نخورده)، بی‌اعراب و بی‌نیم‌فاصله، و لینک نشکند
 *   - آزمایش فقط به موبایلِ **تأییدشدهٔ خودِ** کاربر برود — هرگز شمارهٔ بیمار؛ کلِ متن با «لغو11» و تکه بی‌آن
 *   - متنِ آزمایش هرگز از کلاینت نیاید (فقط شمارهٔ کلمه‌ها)؛ بازهٔ نامعتبر ۴۰۰
 *   - موبایلِ تأییدنشدهٔ **موقتی** (مهلتِ تأیید دارد) / نبودِ موبایل ۴۰۹؛ حسابِ عادیِ بی‌مهلت (سوپرادمینِ اصلی) مجاز سقفِ روزانه (۶۰) ۴۲۹؛ شمارندهٔ روزهای قبل پاک شود
 *   - ردِ فیلتر ← `filtered`، رسید ← `passed`، سرویسِ خاموش/قطع ← `error` با علتِ فارسی
 *   - «جایگزین کن» کلمه را در فهرستِ مطب بگذارد، «نرفتِ فیلتر»ِ حاویِ آن کلمه را دوباره بفرستد (با متنِ جایگزین)
 *  نباید بیفتد:
 *   - ردیفِ «نرفت»ِ علتِ دیگر یا بی‌آن کلمه، و ردیفِ در صف: دست نخورد
 *   - جایگزینیِ دوباره برای همان کلمه یک خطِ تکراری نسازد
 *   - ورودیِ نامعتبر (چندکلمه، جایگزینِ خالی/برابر، «=») ۴۰۰ و فهرست دست‌نخورده
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { RemindersService, PROBE_DAILY_MAX } = require('./dist/patients/reminders.service');
const { SettingsService } = require('./dist/config/settings.service');
const { sendReminders } = require('./dist/reminders/send-reminders');
const wr = require('./dist/sms/word-replacements');

const DB = process.env.E2E_DB;
if (!DB || !['localhost', '127.0.0.1'].includes(new URL(DB).hostname)) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'fp' + randomBytes(4).toString('hex');
let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const status = async (p) => { try { await p; return 200; } catch (e) { return e.getStatus?.() ?? e.status ?? 500; } };

/* ── خالص ─────────────────────────────────────────────────────────────────────────────── */
console.log('\n۱) توابعِ خالص');
{
  const rules = wr.parseWordReplacements('سپری = گذرانده\nخط بدون مساوی\nدو کلمه = نه\n= هیچ\nكميل = كامل\nسپري = تکراری\n  \n# یادداشت');
  ok(rules.length === 2 && rules[0].from === 'سپری' && rules[0].to === 'گذرانده', 'parse: فقط خط‌های درست، تکراریِ هم‌کلید و چندکلمه‌ای رد');
  ok(wr.applyWordReplacements('جراحی را سپری کنید', rules) === 'جراحی را گذرانده کنید', 'apply: کلمهٔ کامل');
  ok(wr.applyWordReplacements('سَپْرِي', rules) === 'گذرانده', 'apply: اعراب و «ي» عربی هم می‌گیرد');
  ok(wr.applyWordReplacements('سپری‌شده', rules) === 'سپری‌شده', 'apply: «سپری‌شده» کلمهٔ دیگری است، نمی‌چسبد');
  ok(wr.applyWordReplacements('لینک https://x.amalyar.com/f/سپری و سپری', rules) === 'لینک https://x.amalyar.com/f/سپری و گذرانده', 'apply: داخلِ لینک دست نمی‌خورد');
  ok(wr.applyWordReplacements('سپری', [{ from: 'سپری', to: 'سپری‌دار' }]) === 'سپری‌دار', 'apply: یک گذر — حلقه ندارد');
  ok(wr.validateWordRule('دو کلمه', 'x') && wr.validateWordRule('سپری', '') && wr.validateWordRule('سپری', 'سپری') && wr.validateWordRule('سپری', 'a=b') && !wr.validateWordRule('سپری', 'گذرانده'), 'validate: ورودیِ بد با پیامِ فارسی');
  const up = wr.upsertWordRule('# یادداشتِ من\nسپری = قدیمی', 'سپری', 'تازه');
  ok(up.replaced && up.value === '# یادداشتِ من\nسپری = تازه', 'upsert: همان کلمه عوض می‌شود، یادداشت می‌ماند');
  ok(wr.probeTokens('الف  ب\nج').join('|') === 'الف|ب|ج', 'probeTokens');
}

/* ── دنیای آزمون ──────────────────────────────────────────────────────────────────────── */
const phoneOf = () => '09' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
const made = { accounts: [], persons: [], reminders: [] };
const mkAccount = async (extra = {}) => {
  const person = await db.person.create({ data: { firstName: 'کاربر', lastName: tag, phone: phoneOf(), ...extra.person } });
  /* provisional = مهلتِ تأیید دارد و هنوز تأیید نکرده؛ legacy = هیچ‌کدام (حسابِ عادیِ نصبِ اول، مثلِ سوپرادمینِ مطب). */
  const state = extra.provisional ? { phoneVerifiedAt: null, verificationDueAt: new Date(Date.now() + 864e5) } : extra.legacy ? { phoneVerifiedAt: null, verificationDueAt: null } : { phoneVerifiedAt: new Date() };
  const account = await db.account.create({ data: { personId: person.id, username: tag + made.accounts.length, passwordHash: 'x', level: extra.level ?? 5, status: 'active', ...state } });
  made.persons.push(person.id); made.accounts.push(account.id);
  return { id: account.id, phone: person.phone, level: 5 };
};
const mkRem = async (data) => {
  const r = await db.reminder.create({ data: { channel: 'sms', kind: 'post_op_care', dueAt: new Date(Date.now() - 1000), phone: phoneOf(), status: 'failed', ...data } });
  made.reminders.push(r.id); return r;
};
const FILTER_ERR = 'ملی‌پیامک پیام را نپذیرفت: متن حاوی کلمه فیلتر شده است — همین متن دوباره هم نمی‌رود؛ کلمه را عوض کنید';
const SET = 'sms_word_replacements';
/* ساعتِ سکوتِ پیش‌فرض ۲۱ تا ۸ به وقتِ `CLINIC_TZ` است — در CIِ گیت‌هاب UTC و در سندباکس تهران. این دو لحظه در **هر دو** منطقه درست‌اند:
   ۱۱:۰۰Z = ۱۱ UTC و ۱۴:۳۰ تهران (روز)؛ ۲۳:۳۰Z = ۲۳ UTC و ۰۳:۰۰ تهران (شب). */
const DAYTIME = new Date('2026-10-24T11:00:00Z');
const NIGHT = new Date('2026-10-24T23:30:00Z');
const setVal = async (v) => { if (v === null) await db.setting.deleteMany({ where: { key: SET } }); else await db.setting.upsert({ where: { key: SET }, create: { key: SET, value: v }, update: { value: v } }); };

/* ملی‌پیامکِ ساختگی: هر متنی که BAD دارد فیلتر می‌شود؛ همهٔ تماس‌ها ثبت می‌شوند. */
const calls = [];
let mode = 'normal';
const sms = {
  send: async (phone, text, opts = {}) => {
    calls.push({ phone, text, opts });
    if (mode === 'stub') return { sent: false, stub: true };
    if (mode === 'down') throw Object.assign(new Error('x'), { smsDetail: 'اعتبارِ پنلِ پیامک کافی نیست' });
    if (mode === 'rejected') return { sent: false, stub: false, detail: 'ملی‌پیامک پیام را نپذیرفت: شمارهٔ فرستنده معتبر نیست', outcome: 'rejected' };
    if (/BAD/.test(text)) return { sent: false, stub: false, detail: 'فیلتر', outcome: 'rejected', filtered: true };
    return { sent: true, stub: false, providerId: '1234567' };
  },
};
const audits = [];
const tenantStub = { require: () => ({ tenantId: tag, hostname: 'localhost' }) };
const settings = new SettingsService(db, { record: async (e) => { audits.push(e); } }, tenantStub, {});
const svc = new RemindersService(db, sms, settings, tenantStub, { record: async (e) => { audits.push(e); } });

try {
  const me = await mkAccount();
  const patientPhone = phoneOf();

  console.log('\n۲) جایگزینی هنگامِ ارسال');
  await setVal('سپری = گذرانده');
  const text2 = 'دکتر نمونه\nامیدواریم جراحیِ خوبی را سپری کرده باشید https://x.amalyar.com/f/سپری';
  const r2 = await mkRem({ status: 'pending', text: text2, phone: patientPhone, dedupeKey: tag + 'a' });
  calls.length = 0;
  await sendReminders(db, sms, [r2.id]);
  ok(calls.length === 1 && calls[0].text.includes('گذرانده کرده باشید') && calls[0].text.includes('f/سپری'), 'متنِ رفته جایگزین‌شده و لینک سالم است');
  const after2 = await db.reminder.findUnique({ where: { id: r2.id } });
  ok(after2.text === text2 && after2.dedupeKey === tag + 'a' && after2.status === 'sent', '**متنِ ثبت‌شده و کلیدِ یکتا دست‌نخورده** (برداشتنِ جایگزینی پیامِ رفته را «تازه» نمی‌کند)');

  console.log('\n۳) اطلاعِ پیش از شروع');
  await db.setting.deleteMany({ where: { key: { startsWith: 'sms_probe:' } } });
  const info = await svc.filterProbeInfo(me);
  ok(info.ok && info.phoneMask === `${me.phone.slice(0, 4)}***${me.phone.slice(-4)}` && info.left === PROBE_DAILY_MAX && info.perDay === 60, 'شمارهٔ ماسک‌شدهٔ خودِ کاربر + سقفِ روز');
  const unv = await mkAccount({ provisional: true });
  ok(!(await svc.filterProbeInfo(unv)).ok && (await svc.filterProbeInfo(unv)).reason.includes('تأیید'), 'حسابِ موقتیِ تأییدنشده: ok=false با علتِ فارسی');
  const legacy = await mkAccount({ legacy: true, level: 6 });
  const li = await svc.filterProbeInfo(legacy);
  ok(li.ok && li.phoneMask && li.left === PROBE_DAILY_MAX, '**حسابِ عادیِ بی‌مهلت (سوپرادمینِ اصلی) مجاز است** — بی‌تأییدِ ثبت‌شده، بی‌مهلت');
  const nophone = await db.person.create({ data: { firstName: 'بی', lastName: tag } }); made.persons.push(nophone.id);
  const accNo = await db.account.create({ data: { personId: nophone.id, username: tag + 'np', passwordHash: 'x', level: 5, status: 'active', phoneVerifiedAt: new Date() } }); made.accounts.push(accNo.id);
  ok((await svc.filterProbeInfo({ id: accNo.id })).reason.includes('ثبت نشده'), 'بی‌موبایل: علتِ فارسی');

  console.log('\n۴) آزمایش');
  await setVal(null);
  const text4 = 'یک دو BAD چهار پنج\nشش';
  const r4 = await mkRem({ text: text4, phone: patientPhone, error: FILTER_ERR, dedupeKey: tag + 'b' });
  calls.length = 0;
  const whole = await svc.filterProbe(r4.id, {}, me);
  ok(whole.outcome === 'filtered' && whole.tokens.join(' ') === 'یک دو BAD چهار پنج شش' && whole.left === 59, 'کلِ متن: filtered + تکه‌ها + ۵۹ مانده');
  ok(calls[0].phone === me.phone && calls[0].text === text4 && calls[0].opts.skipLagho === false, 'کلِ متن به **خودِ کاربر**، همان‌طور که می‌رود، با «لغو11»');
  const part = await svc.filterProbe(r4.id, { start: 3, end: 5 }, me);
  ok(part.outcome === 'passed' && part.tokens === undefined && calls[1].text === 'چهار پنج' && calls[1].opts.skipLagho === true && calls[1].phone === me.phone, 'تکه: passed، فقط از متنِ ذخیره‌شده، بی‌«لغو11»، به خودِ کاربر');
  ok(calls.every((c) => c.phone === me.phone && c.phone !== patientPhone), '**هیچ‌وقت شمارهٔ بیمار**');
  ok(await status(svc.filterProbe(r4.id, { start: 3, end: 3 }, me)) === 400 && await status(svc.filterProbe(r4.id, { start: -1, end: 2 }, me)) === 400
    && await status(svc.filterProbe(r4.id, { start: 0, end: 99 }, me)) === 400 && await status(svc.filterProbe(r4.id, { start: 'x', end: 2 }, me)) === 400
    && await status(svc.filterProbe(r4.id, { start: 1 }, me)) === 400, 'بازهٔ نامعتبر ۴۰۰ — متن هرگز از کلاینت نمی‌آید');
  ok(await status(svc.filterProbe(999999, {}, me)) === 404, 'ردیفِ ناموجود ۴۰۴');
  const chat = await mkRem({ channel: 'chat', text: 'سلام', status: 'sent' });
  ok(await status(svc.filterProbe(chat.id, {}, me)) === 404, 'ردیفِ غیرِپیامکی ۴۰۴');
  ok(await status(svc.filterProbe(r4.id, {}, unv)) === 409, 'حسابِ موقتیِ تأییدنشده ۴۰۹ (پیامکی نمی‌رود)');
  const nCalls = calls.length;
  await status(svc.filterProbe(r4.id, {}, unv));
  ok(calls.length === nCalls, 'و هیچ پیامکی نرفت');
  calls.length = 0;
  const legacyProbe = await svc.filterProbe(r4.id, { start: 3, end: 5 }, legacy);
  ok(legacyProbe.outcome === 'passed' && calls[0].phone === legacy.phone, 'سوپرادمینِ اصلی: آزمایش به شمارهٔ خودش رفت');
  mode = 'stub';
  const stub = await svc.filterProbe(r4.id, { start: 0, end: 1 }, me);
  ok(stub.outcome === 'error' && stub.detail.includes('راه‌اندازی نشده'), 'سرویسِ خاموش (stub): error با علتِ فارسی، نه «passed»');
  mode = 'down';
  const down = await svc.filterProbe(r4.id, { start: 0, end: 1 }, me);
  ok(down.outcome === 'error' && down.detail.includes('اعتبار'), 'علتِ واقعیِ ملی‌پیامک (اعتبار تمام) به کارمند می‌رسد');
  mode = 'rejected';
  const rej = await svc.filterProbe(r4.id, { start: 0, end: 1 }, me);
  ok(rej.outcome === 'error' && rej.detail.includes('فرستنده'), 'ردِ غیرِفیلتر «error» است، نه «filtered»');
  mode = 'normal';
  await setVal('BAD = گذرانده');
  const eff = await svc.filterProbe(r4.id, { start: 2, end: 3 }, me);
  ok(eff.outcome === 'passed' && calls[calls.length - 1].text === 'گذرانده', 'جایگزینیِ فعلی در متنِ آزمایش هم اعمال است (کلمهٔ قبلاً عوض‌شده دوباره پیدا نمی‌شود)');
  await setVal(null);

  console.log('\n۵) سقفِ روزانه');
  const capMe = await mkAccount();
  const key = (d) => `sms_probe:${capMe.id}:${d}`;
  await db.setting.create({ data: { key: key('2000-01-01'), value: '60' } });
  const lastOk = await (async () => { await db.setting.deleteMany({ where: { key: key('2000-01-01') } }); await db.setting.create({ data: { key: key('2000-01-01'), value: '60' } }); const t = (await db.setting.findMany({ where: { key: { startsWith: `sms_probe:${capMe.id}:` } } })).length; return t; })();
  ok(lastOk === 1, 'شمارندهٔ روزِ قدیمیِ ۶۰ آزمایش در دیتابیس است');
  const first = await svc.filterProbe(r4.id, { start: 0, end: 1 }, capMe);
  ok(first.left === 59, 'روزِ تازه از صفر شروع می‌شود (سقفِ دیروز امروز را نمی‌بندد)');
  ok((await db.setting.findMany({ where: { key: { startsWith: `sms_probe:${capMe.id}:` } } })).length === 1, 'شمارندهٔ روزهای قبل پاک شد (یک ردیف برای هر کاربر)');
  const todayKey = (await db.setting.findMany({ where: { key: { startsWith: `sms_probe:${capMe.id}:` } } }))[0].key;
  await db.setting.update({ where: { key: todayKey }, data: { value: '59' } });
  const last = await svc.filterProbe(r4.id, { start: 0, end: 1 }, capMe);
  ok(last.left === 0 && last.outcome === 'passed', 'آزمایشِ شصتم هنوز می‌رود');
  const nBefore = calls.length;
  ok(await status(svc.filterProbe(r4.id, { start: 0, end: 1 }, capMe)) === 429 && calls.length === nBefore, 'آزمایشِ شصت‌ویکم ۴۲۹ و پیامکی نمی‌رود');
  ok((await svc.filterProbeInfo(capMe)).left === 0, 'info هم «۰ مانده» می‌گوید');

  console.log('\n۶) جایگزین کن و بفرست');
  await setVal(null);
  const w1 = await mkRem({ text: 'الف سپری BAD ب', error: FILTER_ERR, dedupeKey: tag + 'w1' });
  const w2 = await mkRem({ text: 'دوم سپری BAD', error: FILTER_ERR, dedupeKey: tag + 'w2' });
  const other = await mkRem({ text: 'بدونِ آن کلمه BAD', error: FILTER_ERR, dedupeKey: tag + 'w3' });
  const otherErr = await mkRem({ text: 'سپری ولی علتِ دیگر', error: 'شمارهٔ موبایلِ گیرنده معتبر نیست', dedupeKey: tag + 'w4' });
  const queued = await mkRem({ status: 'pending', dueAt: new Date(Date.now() + 3600e3), text: 'در صف سپری', dedupeKey: tag + 'w5' });
  for (const [from, to] of [['دو کلمه', 'x'], ['سپری', ''], ['سپری', 'سپری'], ['سپری', 'الف=ب']]) {
    ok(await status(svc.replaceWord({ from, to }, me, DAYTIME)) === 400, `ورودیِ نامعتبر ۴۰۰ (${from} ← ${to || 'خالی'})`);
  }
  ok(!(await db.setting.findUnique({ where: { key: SET } })), 'فهرست دست‌نخورده ماند');
  calls.length = 0;
  const res = await svc.replaceWord({ from: 'سپری', to: 'گذرانده' }, me, DAYTIME);
  ok(res.rule.from === 'سپری' && res.requeued === 2 && res.sent === 0 && res.failed === 2, 'دو «نرفتِ فیلتر»ِ حاویِ کلمه دوباره در صف نشست (BAD هنوز در متن است، پس باز رد شد)');
  ok((await db.setting.findUnique({ where: { key: SET } })).value === 'سپری = گذرانده', 'کلمه در فهرستِ مطب نشست');
  ok(calls.length === 2 && calls.every((c) => c.text.includes('گذرانده') && !c.text.includes('سپری')), 'متنِ رفته جایگزین‌شده بود');
  const st = async (r) => (await db.reminder.findUnique({ where: { id: r.id } })).status;
  ok(await st(other) === 'failed' && await st(otherErr) === 'failed' && await st(queued) === 'pending', '**نباید بیفتد:** بی‌آن کلمه، علتِ دیگر و در صف دست نخوردند');
  /* کلمهٔ دومی (BAD) هم عوض شود → حالا واقعاً می‌رود */
  const res2 = await svc.replaceWord({ from: 'BAD', to: 'گذرانده' }, me, DAYTIME);
  ok(res2.requeued === 4 && res2.sent === 4, `کلمهٔ دوم: هر چهار ردیفِ «نرفت»ِ حاویِ آن (${res2.requeued}) رفتند — از جمله ردیفِ آزمایشِ بخشِ ۴`);
  ok(await st(w1) === 'sent' && await st(w2) === 'sent' && await st(other) === 'sent' && await st(otherErr) === 'failed', 'ردیف‌ها «رفته»؛ علتِ دیگر هنوز «نرفته»');
  const res3 = await svc.replaceWord({ from: 'سپری', to: 'گذراندن' }, me, DAYTIME);
  const lines = (await db.setting.findUnique({ where: { key: SET } })).value.split('\n');
  ok(res3.updated === true && lines.length === 2 && lines.includes('سپری = گذراندن') && !lines.includes('سپری = گذرانده'), 'جایگزینیِ دوباره برای همان کلمه، خطِ تکراری نمی‌سازد');
  ok(audits.some((a) => a.action === 'reminder.replace_word' && a.after.from === 'سپری'), 'ممیزی ثبت شد (کلمه، نه متنِ بیمار)');

  console.log('\n۷) دفتر');
  const rows = await svc.list();
  const q = rows.find((r) => r.id === queued.id);
  ok(q.rewrites.length === 1 && q.rewrites[0].from === 'سپری' && q.rewrites[0].to === 'گذراندن', 'ردیفِ در صف می‌گوید هنگامِ ارسال چه عوض می‌شود');
  const w1r = rows.find((r) => r.id === w1.id);
  ok(w1r.rewrites.some((w) => w.from === 'سپری' && w.to === 'گذرانده') && !w1r.rewrites.some((w) => w.to === 'گذراندن') && w1r.sentText === 'الف گذرانده گذرانده ب',
    '**ردیفِ رفته همان جایگزینیِ لحظهٔ ارسال را نشان می‌دهد** (نه فهرستِ فعلی که بعداً عوض شد) و متنِ واقعاً رفته را می‌دهد');
  console.log('\n۸) ساعتِ سکوت: «جایگزین کن و بفرست» در شب نمی‌فرستد، و دفترِ ردیفِ رفته می‌گوید چه عوض شد');
  await setVal(null);
  const n1 = await mkRem({ text: 'ورزشِ سنگین نکنید', error: FILTER_ERR, dedupeKey: tag + 'n1' });
  calls.length = 0;
  const night = await svc.replaceWord({ from: 'ورزش', to: 'حرکت' }, me, NIGHT);
  ok(night.requeued === 1 && night.sent === 0 && night.held === 8 && calls.length === 0, '**شب:** ردیف دوباره در صف نشست ولی پیامکی نرفت (held=۸)');
  ok((await db.reminder.findUnique({ where: { id: n1.id } })).status === 'pending', 'ردیف «در صف» است، نه «نرفته»');
  /* با `ids`: سوییت‌های هم‌شاردِ دیگر ممکن است ردیفِ سررسیده در همین دیتابیس بگذارند و sweepِ بی‌ids آن‌ها را هم بفرستد. */
  await sendReminders(db, sms, [n1.id], { respectQuiet: true, now: NIGHT });
  ok(calls.length === 0 && (await db.reminder.findUnique({ where: { id: n1.id } })).status === 'pending', 'workerِ خودکار هم در شب نمی‌فرستد');
  /* موعدِ ردیف «همین حالا»ی واقعی است؛ ساعتِ آزمونِ ما ۲۲:۳۰Z — پس موعد را پیش از آن می‌گذاریم تا «سررسیده» حساب شود. */
  await db.reminder.update({ where: { id: n1.id }, data: { dueAt: new Date(NIGHT.getTime() - 60000) } });
  const held = (await svc.list(undefined, NIGHT)).find((r) => r.id === n1.id);
  ok(held.held && held.held.until === 8, 'دفتر می‌گوید «تا ساعتِ ۸ در صف است» (مشتقِ سرور)');
  ok(!(await svc.list(undefined, DAYTIME)).find((r) => r.id === n1.id).held, 'روز: یادداشتِ سکوت نیست');
  await sendReminders(db, sms, [n1.id], { respectQuiet: true, now: DAYTIME });
  const sentRow = await db.reminder.findUnique({ where: { id: n1.id } });
  ok(sentRow.status === 'sent' && calls.length === 1 && calls[0].text === 'حرکت سنگین نکنید', 'روز: همان ردیف با متنِ جایگزین‌شده رفت ' + JSON.stringify({ status: sentRow.status, error: sentRow.error, calls: calls.map((c) => c.text) }));
  ok(sentRow.text === 'ورزشِ سنگین نکنید', 'متنِ ثبت‌شده دست‌نخورده ماند');
  ok(await status(svc.replaceWord({ from: 'سنگین', to: 'زیاد' }, me, NIGHT)) === 200, 'شب: جایگزینیِ بی‌ردیفِ نرفته هم خطا نمی‌دهد');
  const ev = await db.domainEvent.findFirst({ where: { type: 'sms.sent', refType: 'reminder', refId: n1.id } });
  ok(Array.isArray(ev?.payload?.replaced) && ev.payload.replaced[0]?.from === 'ورزش', 'رویدادِ sms.sent جایگزینیِ واقعی را نگه داشت');
  const lr = (await svc.list(undefined, DAYTIME)).find((r) => r.id === n1.id);
  ok(lr.rewrites.length >= 1 && lr.rewrites.some((w) => w.from === 'ورزش') && lr.sentText && lr.sentText.startsWith('حرکت '), '**ردیفِ رفته می‌گوید چه عوض شد و متنِ واقعاً فرستاده‌شده را می‌دهد**');
  /* رویدادِ پیش از این تغییر (بی‌`replaced`): اگر فهرست از لحظهٔ ارسال تا حالا عوض نشده، فهرستِ فعلی دقیق است؛ وگرنه ادعایی نمی‌کند. */
  const ruleAt = (await db.setting.findUnique({ where: { key: SET } })).updatedAt;
  const old1 = await mkRem({ status: 'sent', text: 'ورزش بعد از عمل', sentAt: new Date(ruleAt.getTime() + 5000), dedupeKey: tag + 'o1' });
  const old2 = await mkRem({ status: 'sent', text: 'ورزش بعد از عمل', sentAt: new Date(ruleAt.getTime() - 3600e3), dedupeKey: tag + 'o2' });
  const listed = await svc.list(undefined, DAYTIME);
  ok(listed.find((r) => r.id === old1.id).rewrites.length === 1 && listed.find((r) => r.id === old2.id).rewrites.length === 0,
    'رویدادِ قدیمی: بعد از آخرین تغییرِ فهرست = دقیق؛ پیش از آن = بی‌ادعا');
  console.log('\n۹) بدونِ ساعتِ سکوت و با تنظیمِ سفارشی');
  await db.setting.upsert({ where: { key: 'sms_quiet_on' }, create: { key: 'sms_quiet_on', value: 'false' }, update: { value: 'false' } });
  const n2 = await mkRem({ status: 'pending', text: 'متنِ شبانه', dedupeKey: tag + 'n2' });
  calls.length = 0;
  await sendReminders(db, sms, [n2.id], { respectQuiet: true, now: NIGHT });
  ok(calls.length === 1, 'خاموش‌کردنِ ساعتِ سکوت: در شب هم می‌رود');
  await db.setting.deleteMany({ where: { key: { startsWith: 'sms_quiet_' } } });
} finally {
  await db.setting.deleteMany({ where: { OR: [{ key: SET }, { key: { startsWith: 'sms_probe:' } }, { key: { startsWith: 'sms_quiet_' } }] } }).catch(() => {});
  await db.domainEvent.deleteMany({ where: { refType: 'reminder', refId: { in: made.reminders } } }).catch(() => {});
  await db.reminder.deleteMany({ where: { id: { in: made.reminders } } });
  await db.account.deleteMany({ where: { id: { in: made.accounts } } });
  await db.person.deleteMany({ where: { id: { in: made.persons } } });
  await db.$disconnect();
}
console.log(`\nسبز: ${count}`);
