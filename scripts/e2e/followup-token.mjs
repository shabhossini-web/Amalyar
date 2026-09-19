/**
 * فرمِ پیگیریِ پس از عمل — **یک توکن برای همهٔ موج‌ها**. Real Prisma + PGlite.
 * Only run against an isolated local database.
 *
 * چرا این سوئیت ساخته شد: `scripts/e2e/follow-up.mjs` سه سنجهٔ قرمز داشت
 * («هر دو موج همان یک توکن را دارند» · «هم‌گام‌سازیِ دوباره همان توکنِ باز را
 * نگه می‌دارد» · «فرمِ پرشده می‌ماند و موجِ بعدی فرمِ تازه می‌گیرد») و چون آن
 * سوئیت به Postgres و سرورِ بیرونی نیاز دارد **در CI نیست**، ماه‌ها کسی
 * ندیدشان. این نسخه روی PGlite می‌دود و به CI اضافه شده تا دوباره بی‌صدا نشکند.
 *
 * ریشه: `syncNextVisit` تابعِ `followUpUrl` را داخلِ حلقه با `[day]` صدا
 * می‌زد، در حالی که آن تابع کلِ آرایه را می‌خواهد — انقضا را از **آخرین** روز
 * می‌سازد و کلیدِ هویتِ رکورد را از **اولین** روز. نتیجه: هر موج رکورد و
 * توکنِ خودش را می‌گرفت.
 *
 *  باید بیفتد:
 *   - دو موج، **یک** توکن و **یک** رکوردِ `intakeSubmission`
 *   - انقضا از آخرین موج حساب شود، نه اولی
 *   - هم‌گام‌سازیِ دوباره همان توکن را برگرداند (رکوردِ تازه نسازد)
 *   - پیامکِ مراقبتِ بعد از عمل همان لینک را ضمیمه داشته باشد
 *   - **بعد از پرشدن**، فرمِ پرشده بسته بماند و موجِ بعدی فرمِ **تازه** بگیرد
 *     (وگرنه پیامکِ روزِ ۳۰ به فرمی لینک می‌دهد که دیگر پاسخ نمی‌گیرد)
 *   - و این بدونِ دخالتِ ادمین رخ بدهد: خودِ `fill()`ِ عمومی بعد از ثبتِ پاسخ
 *     دوباره هم‌گام می‌کند (وگرنه تا اولین ویرایشِ دستیِ مراجعه، پیامکِ روزِ ۳۰
 *     همان لینکِ پرشده را داشت)
 *  نباید بیفتد:
 *   - مراجعهٔ تک‌موجی رکوردِ اضافه بگیرد (رگرسیونِ معکوس)
 *   - نبودِ فرمِ پیگیری، پیامکِ **مراقبت** را هم قربانی کند
 *   - لغوِ عمل موج‌ها را `pending` بگذارد
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const DB = process.env.E2E_DB;
if (!DB || !['localhost', '127.0.0.1'].includes(new URL(DB).hostname)) throw new Error('فقط محیط محلی جداگانه');
const { sync } = globalThis.__futok;
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'fut' + randomBytes(4).toString('hex');

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const eq = (a, b, label) => { assert.equal(a, b, `${label} (${a} ≠ ${b})`); console.log('PASS ' + ++count + ' ' + label); };

const DAY = 24 * 3600 * 1000;
const linkOf = (text) => text.match(/\/f\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
const waves = (visitId) => db.reminder.findMany({
  where: { visitId, kind: 'follow_up', status: 'pending' }, orderBy: { dueAt: 'asc' },
});
const subsOf = (patientId, formId) => db.intakeSubmission.findMany({ where: { patientId, formId }, orderBy: { id: 'asc' } });

try {
  /* فرمِ پیگیریِ عمومی — همان چیزی که `followUpUrl` دنبالش می‌گردد. */
  const form = await db.formDef.create({
    data: {
      key: tag, title: 'پیگیریِ عمومی', scope: 'record', active: true, followUp: 'general',
      fields: { create: [{ key: 'fuPain', label: 'شدتِ درد', type: 'text', page: 1, sort: 1 }] },
    },
  });
  const proc = await db.procedureType.create({
    data: { name: `عملِ ${tag}`, followUpDays: '7,30', postOpCare: 'پانسمان را خشک نگه دارید.' },
  });
  const patient = await db.patient.create({
    data: { code: tag, firstName: 'بیمارِ', lastName: 'پیگیری', phone: '09120000918' },
  });
  const opDate = new Date(Date.now() + 2 * DAY);
  const visit = await db.visit.create({
    data: { patientId: patient.id, seq: 1, kind: 'surgery', opDate, procedureTypeId: proc.id },
  });

  console.log('\n۱) دو موج، یک توکن');
  await sync(visit.id);
  const rows = await waves(visit.id);
  eq(rows.length, 2, 'دو موجِ پیگیری کاشته شد');
  const tokens = rows.map((r) => linkOf(r.text));
  ok(tokens[0], 'متنِ موجِ اول لینکِ فرم دارد');
  /* 🔴 همان سنجه‌ای که در `follow-up.mjs` قرمز بود. */
  eq(tokens[1], tokens[0], '**هر دو موج همان یک توکن را دارند**');

  const subs = await subsOf(patient.id, form.id);
  eq(subs.length, 1, '**یک رکوردِ فرم ساخته شد، نه یکی به‌ازای هر موج**');
  eq(subs[0].token, tokens[0], 'توکنِ داخلِ پیامک همان رکوردِ ساخته‌شده است');
  eq(subs[0].data.followUpDay, 7, 'کلیدِ هویتِ رکورد = کوچک‌ترین روزِ پیگیری');

  /* انقضا از **آخرین** موج: `followUpUrl` آن را از `days[days.length-1]`
     می‌سازد. با فراخوانیِ per-wave، فرمِ موجِ اول ۱۴ روز پس از روزِ ۷ منقضی
     می‌شد — یعنی پیش از آنکه موجِ روزِ ۳۰ اصلاً فرستاده شود. */
  const expectedExpiry = opDate.getTime() + 30 * DAY + 14 * DAY;
  ok(Math.abs(subs[0].expiresAt.getTime() - expectedExpiry) < 5 * 60_000,
    '**انقضا از آخرین موج حساب می‌شود، نه اولی**');

  console.log('\n۲) هم‌گام‌سازیِ دوباره');
  await sync(visit.id);
  const again = await subsOf(patient.id, form.id);
  eq(again.length, 1, '**هم‌گام‌سازیِ دوباره رکوردِ تازه نمی‌سازد**');
  eq(again[0].token, tokens[0], 'همان توکنِ باز نگه داشته می‌شود');
  const rows2 = await waves(visit.id);
  eq(rows2.length, 2, 'موج‌ها هم انباشت نمی‌شوند');

  console.log('\n۳) پیامکِ مراقبتِ بعد از عمل');
  const care = await db.reminder.findFirst({ where: { visitId: visit.id, kind: 'post_op_care', status: 'pending' } });
  ok(care?.text.includes('پانسمان'), 'متنِ مراقبت از نوعِ عمل آمده');
  eq(linkOf(care.text), tokens[0], '**مراقبتِ بعد از عمل همان لینکِ پیگیری را ضمیمه دارد**');

  console.log('\n۴) نباید بیفتد — مراجعهٔ تک‌موجی');
  const proc1 = await db.procedureType.create({ data: { name: `تک‌موجِ ${tag}`, followUpDays: '10' } });
  const p1 = await db.patient.create({ data: { code: tag + 'a', firstName: 'تک', lastName: 'موج', phone: '09120000919' } });
  const v1 = await db.visit.create({
    data: { patientId: p1.id, seq: 1, kind: 'surgery', opDate, procedureTypeId: proc1.id },
  });
  await sync(v1.id);
  eq((await waves(v1.id)).length, 1, 'یک موج کاشته شد');
  const s1 = await subsOf(p1.id, form.id);
  eq(s1.length, 1, 'مراجعهٔ تک‌موجی هم دقیقاً یک رکورد دارد');
  eq(s1[0].data.followUpDay, 10, 'کلیدِ هویتش همان تنها روزِ خودش است');

  console.log('\n۵) نباید بیفتد — نبودِ فرمِ پیگیری مراقبت را قربانی نکند');
  await db.formDef.update({ where: { id: form.id }, data: { active: false } });
  const p2 = await db.patient.create({ data: { code: tag + 'b', firstName: 'بی', lastName: 'فرم', phone: '09120000920' } });
  const v2 = await db.visit.create({
    data: { patientId: p2.id, seq: 1, kind: 'surgery', opDate, procedureTypeId: proc.id },
  });
  await sync(v2.id);
  eq((await waves(v2.id)).length, 0, 'بدونِ فرم، موجِ پیگیری کاشته نمی‌شود');
  const care2 = await db.reminder.findFirst({ where: { visitId: v2.id, kind: 'post_op_care', status: 'pending' } });
  ok(care2?.text.includes('پانسمان'), '**پیامکِ مراقبت باز هم می‌رود — فقط بدونِ لینک**');
  eq(linkOf(care2.text), null, 'و لینکی هم داخلش نیست');
  await db.formDef.update({ where: { id: form.id }, data: { active: true } });

  console.log('\n۶) نباید بیفتد — لغوِ عمل');
  await db.visit.update({ where: { id: visit.id }, data: { opStatus: 'cancelled' } });
  await sync(visit.id);
  eq((await waves(visit.id)).length, 0, 'لغوِ عمل موج‌های pending را باطل می‌کند');

  console.log('\n۷) بعد از پرشدن — فرمِ پرشده می‌ماند، موجِ بعدی فرمِ تازه می‌گیرد');
  const p3 = await db.patient.create({ data: { code: tag + 'c', firstName: 'پر', lastName: 'شده', phone: '09120000921' } });
  const v3 = await db.visit.create({
    data: { patientId: p3.id, seq: 1, kind: 'surgery', opDate, procedureTypeId: proc.id },
  });
  await sync(v3.id);
  const before = await subsOf(p3.id, form.id);
  eq(before.length, 1, 'پیش از پرشدن: یک فرم برای هر دو موج');
  const t1 = before[0].token;
  /* بیمار روزِ ۷ فرم را پر می‌کند — همان گذاری که `fill()` می‌کند. */
  await db.intakeSubmission.update({ where: { id: before[0].id }, data: { status: 'approved' } });
  await sync(v3.id);
  const after = await subsOf(p3.id, form.id);
  eq(after.length, 2, '**بعد از پرشدن، موجِ بعدی فرمِ تازه می‌گیرد (دو رکورد)**');
  eq(after[0].token, t1, 'فرمِ پرشده همان است که بود (پایدار)');
  eq(after[0].status, 'approved', 'و همچنان بسته');
  eq(after[1].status, 'pending_fill', 'فرمِ تازه باز است');
  eq(after[1].data.followUpDay, 30, 'کلیدِ هویتِ فرمِ تازه = اولین موجِ باقی‌مانده');
  const w3 = await waves(v3.id);
  eq(w3.length, 2, 'همچنان دو موجِ pending');
  eq(linkOf(w3[0].text), t1, 'پیامکِ روزِ ۷ همان لینکِ پرشده را دارد');
  eq(linkOf(w3[1].text), after[1].token, '**پیامکِ روزِ ۳۰ لینکِ فرمِ تازه را دارد**');
  ok(linkOf(w3[1].text) !== t1, 'و آن لینک با فرمِ پرشده فرق دارد');
  const cancelled = await db.reminder.count({ where: { visitId: v3.id, kind: 'follow_up', status: 'cancelled' } });
  eq(cancelled, 1, 'پیامکِ قدیمیِ روزِ ۳۰ (با لینکِ پرشده) هرس شد');
  /* نباید بیفتد: هم‌گام‌سازیِ سوم چیزی اضافه نکند. */
  await sync(v3.id);
  eq((await subsOf(p3.id, form.id)).length, 2, 'هم‌گام‌سازیِ دوباره فرمِ سومی نمی‌سازد');
  eq(linkOf((await waves(v3.id))[1].text), after[1].token, 'و روزِ ۳۰ همان فرمِ تازه را نگه می‌دارد');

  console.log('\n۸) پرشدن از مسیرِ عمومیِ واقعی — بدونِ هیچ هم‌گام‌سازیِ دستی');
  const API = process.env.E2E_API;
  const p4 = await db.patient.create({ data: { code: tag + 'd', firstName: 'مسیرِ', lastName: 'عمومی', phone: '09120000922' } });
  const v4 = await db.visit.create({
    data: { patientId: p4.id, seq: 1, kind: 'surgery', opDate, procedureTypeId: proc.id },
  });
  await sync(v4.id);
  const open4 = (await subsOf(p4.id, form.id))[0];
  const fill = await fetch(`${API}/public/intake/form/${open4.token}/fill`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: { fuPain: '۳' } }),
  });
  ok(fill.status === 200 || fill.status === 201, `بیمار فرم را از مسیرِ عمومی پر کرد (${fill.status})`);
  /* ⚠️ عمداً هیچ `sync` صدا زده نمی‌شود. */
  const after4 = await subsOf(p4.id, form.id);
  eq(after4.length, 2, '**خودِ fill() موجِ بعدی را فرمِ تازه داد — بدونِ ویرایشِ ادمین**');
  eq(after4[0].status, 'approved', 'فرمِ پرشده بسته شد');
  const w4 = await waves(v4.id);
  eq(w4.length, 2, 'دو موجِ pending');
  eq(linkOf(w4[1].text), after4[1].token, '**پیامکِ روزِ ۳۰ همان لحظه لینکِ تازه گرفت**');

  console.log(`\n${count} سنجه سبز`);
} finally {
  await db.$disconnect().catch(() => undefined);
}
