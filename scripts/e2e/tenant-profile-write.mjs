/**
 * نوعِ نصب و بستهٔ خدمات — **نوشتن** (`PATCH /config/profile`) و پیش‌نمایش.
 * Real HTTP + Nest + Prisma + PGlite (`tenant-profile-write-local.mjs`). Only against an isolated local database.
 *
 * زمینه (مالک، ۱۴۰۵/۰۷/۰۱): شرکت خودش خدماتش را می‌چیند؛ شرکتِ دوخدمته برای هر خدمت
 * فرم و لینکِ جدا دارد. قاعدهٔ خالص را `tenant-profile-unit.mjs` می‌سنجد؛ این‌جا سیم‌کشی.
 *
 *  باید بیفتد:
 *   - شرکتِ بی‌خدمت / مطبِ با خدمت / کلیدِ ناشناخته ← ۴۰۰ فارسی؛ فیلدِ نااعلام بی‌صدا نمی‌افتد
 *   - زیرِ سوپرادمین ← ۴۰۳
 *   - پیش‌نمایش هیچ چیزی نمی‌نویسد
 *   - افزودنِ ایمپلنت: هر دو فرمِ ثبت‌نام نصب و **هر دو** پیشنهاد می‌شوند
 *   - سطحِ دست‌خوردهٔ انبار و ماژولِ عمداً خاموش حفظ می‌شوند
 *   - برداشتنِ نورومانیتورینگ: پیش‌نمایش لینک‌های زنده‌اش را می‌شمارد؛ چینش خاموش؛ لینک هنوز کار می‌کند
 *   - عوض‌شدنِ خدمتِ اصلی: بخش‌های سایت همان می‌مانند که بودند
 *   - مطب: ماژول‌های شرکتی خاموش + بنیان‌گذارِ تنها پزشک
 *  نباید بیفتد:
 *   - ذخیرهٔ پروفایلِ بی‌تغییر هیچ نوشتنی ندارد (نه ماژول، نه audit)
 *   - `vertical` هرگز «company» نمی‌شود
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const API = process.env.E2E_API, DB = process.env.E2E_DB;
if (![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
let count = 0;
const ok = (v, label, detail = '') => { assert.ok(v, `${label}${detail ? ' — ' + detail : ''}`); console.log('PASS ' + ++count + ' ' + label); };
const login = async (identifier, password) => (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) }).then((r) => r.json())).accessToken;
const as = (token) => async (path, body, method = body ? 'POST' : 'GET') => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const msg = (r) => JSON.stringify(r.data?.message ?? r.data);
const feat = async (key) => db.feature.findUnique({ where: { key } });
const setting = async (key) => (await db.setting.findUnique({ where: { key } }))?.value ?? null;
const snapshot = async () => JSON.stringify(await db.feature.findMany({ orderBy: { key: 'asc' }, select: { key: true, minLevel: true, enabled: true } }));

try {
  const admin = as(await login('admin', 'test1234'));
  await db.account.create({ data: { username: 'mgr', passwordHash: await bcrypt.hash('test1234', 4), level: 5, status: 'active', person: { create: { firstName: 'مدیر', lastName: 'پنجم' } } } });
  const manager = as(await login('mgr', 'test1234'));

  /* شروع: شرکتِ نورومانیتورینگ با پلانِ خودش (مسیرِ قدیمی، همان نصب‌های فعلی). */
  let r = await admin('/config/vertical', { vertical: 'ionm' }, 'PATCH');
  assert.equal(r.status, 200, msg(r));
  await admin('/forms'); // فرم‌های پیش‌فرض نصب می‌شوند (ثبت‌نامِ نورومانیتورینگ)

  console.log('۱) اعتبارسنجی و دسترسی (باید بیفتد)');
  r = await admin('/config/profile', { kind: 'company', services: [] }, 'PATCH');
  ok(r.status === 400 && /دست‌کم یک خدمت/.test(msg(r)), '**شرکتِ بی‌خدمت ← ۴۰۰ فارسی**', `${r.status} ${msg(r)}`);
  r = await admin('/config/profile', { kind: 'clinic', services: ['ionm'] }, 'PATCH');
  ok(r.status === 400, 'مطبِ با خدمت ← ۴۰۰', `${r.status} ${msg(r)}`);
  r = await admin('/config/profile', { kind: 'company', services: ['dental'] }, 'PATCH');
  ok(r.status === 400 && /خدمت/.test(msg(r)), 'خدمتِ ناشناخته ← ۴۰۰', `${r.status} ${msg(r)}`);
  r = await admin('/config/profile', { kind: 'company' }, 'PATCH');
  ok(r.status === 400, 'بستهٔ خدماتِ جاافتاده بی‌صدا خالی فرض نمی‌شود ← ۴۰۰', `${r.status} ${msg(r)}`);
  r = await manager('/config/profile', { kind: 'company', services: ['ionm', 'implant'] }, 'PATCH');
  ok(r.status === 403, 'زیرِ سوپرادمین ← ۴۰۳', String(r.status));
  r = await manager('/config/profile/preview', { kind: 'company', services: ['ionm', 'implant'] });
  ok(r.status === 403, 'پیش‌نمایش هم زیرِ سوپرادمین ← ۴۰۳', String(r.status));

  console.log('\n۲) پیش‌نمایش چیزی نمی‌نویسد');
  /* شرکت سطحِ انبار را خودش ۴ کرده (پیش‌فرضِ نورومانیتورینگ ۳) و پیام‌رسان را عمداً خاموش. */
  await db.feature.update({ where: { key: 'inventory' }, data: { minLevel: 4 } });
  await db.feature.update({ where: { key: 'messenger' }, data: { enabled: false } });
  const before = await snapshot();
  r = await admin('/config/profile/preview', { kind: 'company', services: ['ionm', 'implant'] });
  ok(r.status === 201 && r.data.after.services.join() === 'ionm,implant', 'پیش‌نمایش پاسخ می‌دهد', `${r.status} ${msg(r)}`);
  ok(r.data.changes.some((c) => c.key === 'accounting' && c.action === 'relevel' && c.label === 'حسابداری'), 'حسابداری به سطحِ ۴ می‌رود (با برچسبِ فارسی)', JSON.stringify(r.data.changes));
  ok(!r.data.changes.some((c) => c.key === 'inventory'), '**سطحِ دست‌خوردهٔ انبار در پیش‌نمایش هم دست نمی‌خورد**', JSON.stringify(r.data.changes));
  ok(await snapshot() === before && await setting('services') === null, '**پیش‌نمایش هیچ چیزی ننوشت**');

  console.log('\n۳) افزودنِ ایمپلنت');
  r = await admin('/config/profile', { kind: 'company', services: ['implant', 'ionm'] }, 'PATCH');
  ok(r.status === 200 && r.data.kind === 'company' && r.data.services.join() === 'ionm,implant', 'ذخیره شد', `${r.status} ${msg(r)}`);
  ok(await setting('vertical') === 'ionm' && await setting('services') === '["ionm","implant"]', 'vertical خدمتِ اصلی ماند، نه «company»');
  ok((await feat('accounting')).minLevel === 4 && (await feat('inventory')).minLevel === 4, '**حسابداری ۵←۴ ولی انبارِ دست‌خورده همان ۴**');
  ok((await feat('messenger')).enabled === false, '**پیام‌رسانِ عمداً خاموش خاموش ماند**');
  ok((await feat('dispatch')).enabled === true, 'چینش سرِ جایش');
  const opts = (await admin('/intake/link-options')).data.forms;
  const rec = opts.filter((f) => f.recommended).map((f) => f.title);
  ok(rec.length === 2 && rec.some((t) => /نورومانیتورینگ/.test(t)) && rec.some((t) => /ایمپلنت/.test(t)), '**هر دو فرمِ ثبت‌نام پیشنهاد می‌شوند**', JSON.stringify(rec));
  ok(await db.formDef.count({ where: { key: { in: ['intake.ionm', 'intake.implant'] } } }) === 2, 'و هر کدام دقیقاً یک‌بار نصب شد');
  await admin('/intake/link-options');
  ok(await db.formDef.count({ where: { key: { in: ['intake.ionm', 'intake.implant'] } } }) === 2, 'خواندنِ دوباره فرمِ تکراری نمی‌سازد');

  console.log('\n۴) ذخیرهٔ بی‌تغییر (نباید بیفتد)');
  const s1 = await snapshot(), audits = await db.auditEvent.count({ where: { action: 'config.profile' } });
  r = await admin('/config/profile', { kind: 'company', services: ['ionm', 'implant'] }, 'PATCH');
  ok(r.status === 200 && await snapshot() === s1 && await db.auditEvent.count({ where: { action: 'config.profile' } }) === audits, 'بی‌تغییر ← هیچ نوشتنی، هیچ audit');

  console.log('\n۵) برداشتنِ نورومانیتورینگ');
  const ionmForm = await db.formDef.findUnique({ where: { key: 'intake.ionm' } });
  const link = await admin('/intake/links', { title: 'لینکِ نورو', formId: ionmForm.id });
  assert.ok(link.status < 300, msg(link));
  /* بخش‌های سایت تا امروز ردیف ندارند و از چیدمانِ خدمتِ اصلی پیش‌فرض می‌گیرند. */
  const sitePlanBefore = JSON.stringify((await admin('/site')).data?.sections?.map((x) => `${x.key}:${x.enabled}`) ?? null);
  r = await admin('/config/profile/preview', { kind: 'company', services: ['implant'] });
  const gone = r.data.removed.find((x) => x.service === 'ionm');
  ok(gone?.links === 1 && r.data.vocabularyChanges === true, '**پیش‌نمایش لینکِ زندهٔ خدمتِ برداشته‌شده را می‌شمارد** و تغییرِ واژگان را می‌گوید', JSON.stringify(r.data.removed));
  ok(r.data.changes.some((c) => c.key === 'dispatch' && c.action === 'disable'), 'چینش خاموش می‌شود');
  r = await admin('/config/profile', { kind: 'company', services: ['implant'] }, 'PATCH');
  ok(r.status === 200 && await setting('vertical') === 'implant', 'ذخیره؛ خدمتِ اصلی ایمپلنت', `${r.status} ${msg(r)}`);
  ok((await feat('dispatch')).enabled === false && (await feat('tech')).enabled === false, 'چینش و پنلِ کارشناسی خاموش شدند');
  const sitePlanAfter = JSON.stringify((await admin('/site')).data?.sections?.map((x) => `${x.key}:${x.enabled}`) ?? null);
  ok(sitePlanBefore !== 'null' && sitePlanAfter === sitePlanBefore, '**بخش‌های سایت همان ماندند که بودند**', `${sitePlanBefore} → ${sitePlanAfter}`);
  const view = await fetch(`${API}/public/intake/link/${link.data.token}`).then((x) => x.status);
  ok(view === 200, 'لینکِ نورومانیتورینگِ قبلی هنوز باز می‌شود', String(view));
  const opts2 = (await admin('/intake/link-options')).data.forms;
  ok(!opts2.some((f) => /نورومانیتورینگ/.test(f.title)), 'ولی برای لینکِ تازه پیشنهاد نمی‌شود');

  console.log('\n۶) مطب');
  r = await admin('/config/profile', { kind: 'clinic', services: [] }, 'PATCH');
  ok(r.status === 200 && r.data.kind === 'clinic' && await setting('services') === null && await setting('vertical') === 'clinic', 'مطب: vertical=clinic و بی‌ردیفِ خدمات', `${r.status} ${msg(r)}`);
  ok((await feat('inventory')).enabled === false && (await feat('transport')).enabled === false, 'ماژول‌های شرکتی خاموش');
  const founder = await db.account.findFirst({ where: { username: 'admin' }, select: { jobRole: true, personId: true } });
  ok(founder.jobRole === 'doctor' && !!(await db.surgeon.findUnique({ where: { personId: founder.personId } })), 'بنیان‌گذارِ تنها پزشک شد (با تعریفِ جراح)');
  ok(!(await admin('/intake/link-options')).data.forms.some((f) => /ایمپلنت/.test(f.title)), 'فرمِ ایمپلنت در مطب پیشنهاد نمی‌شود');

  console.log(`\n${count} سنجه سبز`);
} finally {
  await db.$disconnect().catch(() => undefined);
}
