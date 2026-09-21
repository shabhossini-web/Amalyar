/**
 * W1.8 — پیش‌نویسِ فرمِ عمومی (D09، قراردادِ §۶). Real HTTP + Prisma.
 * Only run against an isolated local database.
 *
 * یافتهٔ D09: تنها راهِ ذخیرهٔ پاسخِ بیمار `fill()` بود و آن `status` را جلو
 * می‌برد. پس «ذخیرهٔ موقتِ صفحهٔ ۲» ممکن نبود و رفرشِ وسطِ فرم — یا فقط قطعِ
 * لحظه‌ایِ اینترنتِ موبایل — همهٔ متنِ تایپ‌شده را می‌برد.
 *
 *  باید بیفتد:
 *   - `data` merge شود و `status` **دست نخورد**
 *   - شمارهٔ صفحه نگه داشته شود و از `GET form/:token` برگردد
 *   - ذخیرهٔ دوم روی اولی بنشیند نه جایش را بگیرد
 *  نباید بیفتد:
 *   - کلیدی که فیلدِ این فرم نیست نوشته شود (POSTِ دست‌ساز)
 *   - ارجاعِ `image` از این راه جعل شود
 *   - اعتبارسنجیِ فیلدِ اجباری اجرا شود (پیش‌نویس ناقص است)
 *   - لینکِ نیمه‌تایپ‌شده ذخیره را بشکند ← وگرنه هر blur ۴۰۰ می‌گرفت
 *   - فرمِ ثبت‌شده/تأییدشده پیش‌نویس بپذیرد
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const API = process.env.E2E_API ?? 'http://localhost:3101/api', DB = process.env.E2E_DB;
if (!DB || ![API, DB].every(u => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'drf' + randomBytes(4).toString('hex');

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const made = { patients: [], forms: [] };

async function pub(path, body, method = 'POST') {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const view = (t) => pub(`/public/intake/form/${t}`, undefined, 'GET');
const rowOf = (t) => db.intakeSubmission.findFirst({ where: { token: t } });

try {
  const form = await db.formDef.create({
    data: {
      key: tag, title: 'فرمِ چندصفحه‌ای', scope: 'record', active: true,
      fields: { create: [
        { key: 'shekayat', label: 'شکایتِ اصلی', type: 'text', page: 1, sort: 1, required: true },
        { key: 'sabeghe', label: 'سابقهٔ بیماری', type: 'text', page: 2, sort: 1 },
        { key: 'mri', label: 'لینکِ تصویربرداری', type: 'links', page: 2, sort: 2 },
        { key: 'aks', label: 'عکسِ مدرک', type: 'image', page: 2, sort: 3 },
      ] },
    },
  });
  made.forms.push(form.id);
  const pid = (await db.patient.create({ data: { code: tag, firstName: 'بیمار', lastName: 'پیش‌نویس' } })).id;
  made.patients.push(pid);
  const mk = async () => {
    const t = randomBytes(12).toString('base64url');
    await db.intakeSubmission.create({ data: { token: t, formId: form.id, patientId: pid, amount: 0,
      status: 'pending_fill', expiresAt: new Date(Date.now() + 30 * 864e5) } });
    return t;
  };

  console.log('\n۱) `data` merge می‌شود و `status` دست نمی‌خورد');
  const t1 = await mk();
  const r1 = await pub(`/public/intake/form/${t1}/draft`, { values: { shekayat: 'کمردرد' }, page: 1 });
  ok(r1.status === 200 || r1.status === 201, `پیش‌نویس پذیرفته شد (${r1.status})`);
  ok(!!r1.data?.savedAt, 'پاسخ `savedAt` دارد — نشانگرِ فرانت به همین بند است');
  let row = await rowOf(t1);
  ok(row.status === 'pending_fill', `**باید بیفتد:** وضعیت جلو نرفت (${row.status})`);
  ok(row.data.shekayat === 'کمردرد', 'پاسخ ذخیره شد');

  console.log('\n۲) صفحه نگه داشته می‌شود و از `GET` برمی‌گردد');
  await pub(`/public/intake/form/${t1}/draft`, { values: { sabeghe: 'دیابت' }, page: 2 });
  row = await rowOf(t1);
  ok(row.data.shekayat === 'کمردرد' && row.data.sabeghe === 'دیابت',
    '**باید بیفتد:** ذخیرهٔ دوم روی اولی نشست، جایش را نگرفت');
  ok(row.data._page === 2, `شمارهٔ صفحه ذخیره شد (${row.data._page})`);
  const v = await view(t1);
  ok(v.data?.data?._page === 2, 'همان `GET`ِ موجود `_page` را برمی‌گرداند — فرانت از این می‌خواند');

  console.log('\n۳) نباید بیفتد — کلیدِ بیرونی و جعلِ ارجاع');
  await pub(`/public/intake/form/${t1}/draft`, {
    values: { shekayat: 'کمردرد', naboodeh: 'کلیدِ جعلی', aks: [{ id: 999999, name: 'x' }], _page: 9 },
  });
  row = await rowOf(t1);
  ok(row.data.naboodeh === undefined, '**نباید بیفتد:** کلیدی که فیلدِ این فرم نیست نوشته نشد');
  ok(row.data.aks === undefined, '**نباید بیفتد:** ارجاعِ عکس از این راه جعل نشد');
  ok(row.data._page === 2, '**نباید بیفتد:** `_page` از داخلِ `values` قبول نشد — فقط فیلدِ typed');

  console.log('\n۴) نباید بیفتد — سنجشِ اجباری و لینکِ ناقص ذخیره را نمی‌شکنند');
  const t2 = await mk();
  const empty = await pub(`/public/intake/form/${t2}/draft`, { values: { sabeghe: 'فقط صفحهٔ دو' }, page: 2 });
  ok(empty.status === 200 || empty.status === 201,
    `**نباید بیفتد:** «شکایتِ اصلی»ِ اجباریِ خالی پیش‌نویس را رد نکرد (${empty.status})`);
  const halfLink = await pub(`/public/intake/form/${t2}/draft`, { values: { mri: 'https://pacs.exa' } });
  ok(halfLink.status === 200 || halfLink.status === 201,
    `**نباید بیفتد:** لینکِ نیمه‌تایپ‌شده ذخیره را نشکست (${halfLink.status}) — وگرنه هر blur ۴۰۰ می‌گرفت`);
  /* ولی ثبتِ نهایی همان لینک را باید رد کند — پیش‌نویس سنجش را حذف نکرده، عقب انداخته. */
  const bad = await pub(`/public/intake/form/${t2}/fill`, { values: { shekayat: 'کمردرد', mri: 'حتما-لینک-نیست' } });
  ok(bad.status === 400, `ثبتِ نهایی همان لینکِ خراب را رد کرد (${bad.status}) — سنجش عقب افتاده، حذف نشده`);

  console.log('\n۵) نباید بیفتد — فرمِ ثبت‌شده پیش‌نویس نمی‌گیرد');
  const t3 = await mk();
  await pub(`/public/intake/form/${t3}/fill`, { values: { shekayat: 'تمام' } });
  ok((await rowOf(t3)).status === 'approved', 'فرم ثبت و خودکار تأیید شد');
  const late = await pub(`/public/intake/form/${t3}/draft`, { values: { shekayat: 'دست‌کاری' } });
  ok(late.status === 400, `**نباید بیفتد:** پیش‌نویس روی فرمِ تأییدشده رد شد (${late.status})`);
  ok((await rowOf(t3)).data.shekayat === 'تمام', 'پاسخِ ثبت‌شده دست‌نخورده ماند');

  console.log('\n۶) نباید بیفتد — شمارهٔ صفحهٔ بی‌معنی به سرویس نمی‌رسد');
  for (const [p, what] of [[0, 'صفر'], [-3, 'منفی'], ['۲', 'رشته']]) {
    const bad2 = await pub(`/public/intake/form/${t1}/draft`, { values: {}, page: p });
    ok(bad2.status === 400, `**نباید بیفتد:** صفحهٔ ${what} رد شد (${bad2.status})`);
  }
} finally {
  await db.intakeSubmission.deleteMany({ where: { OR: [{ patientId: { in: made.patients } }, { formId: { in: made.forms } }] } });
  await db.document.deleteMany({ where: { patientId: { in: made.patients } } });
  await db.visit.deleteMany({ where: { patientId: { in: made.patients } } });
  await db.patient.deleteMany({ where: { id: { in: made.patients } } });
  await db.formField.deleteMany({ where: { formId: { in: made.forms } } });
  await db.formDef.deleteMany({ where: { id: { in: made.forms } } });
  await db.$disconnect();
}
console.log(`\nسبز: ${count}`);
