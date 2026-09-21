/** W1.6: real HTTP + PostgreSQL regression test. Local isolated fixture DB only.
 * E2E_API=http://localhost:3101/api E2E_DB=postgresql://... node scripts/e2e/w1-6-form-snapshot.mjs
 * Covers historic labels/options, soft deletion, primary/extra-form usage, reset,
 * manual/automatic approval, negative authorization and unused-form deletion.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB;
if (!DB || !['localhost', '127.0.0.1'].includes(new URL(DB).hostname)
  || !['localhost', '127.0.0.1'].includes(new URL(API).hostname)) {
  throw new Error('این آزمون فقط روی API و دیتابیس محلی اجرا می‌شود');
}
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const tag = 'w16' + randomBytes(4).toString('hex');
const formIds = [], patientIds = [], subIds = [], visitIds = [];
let token = '', passed = 0;
async function api(path, method = 'GET', body, authenticated = true) {
  const r = await fetch(API + path, { method,
    headers: { 'Content-Type': 'application/json', ...(authenticated && token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  return { status: r.status, data };
}
const check = (condition, title) => { assert.ok(condition, title); console.log('PASS ' + title); passed++; };
async function form(suffix, fields = []) {
  const r = await api('/forms', 'POST', { key: tag + suffix, title: 'فرم آزمون ' + suffix, scope: 'record' });
  assert.equal(r.status, 201, JSON.stringify(r.data)); formIds.push(r.data.id);
  for (const f of fields) {
    const add = await api(`/forms/${r.data.id}/fields`, 'POST', f);
    assert.equal(add.status, 201, JSON.stringify(add.data));
  }
  return (await api('/forms/' + r.data.key)).data;
}
async function submission(formId, extraFormIds = [], status = 'pending_fill', data = {}) {
  const r = await db.intakeSubmission.create({ data: { token: tag + randomBytes(5).toString('hex'), formId,
    extraFormIds, patientId: patientIds[0], status, data, expiresAt: new Date(Date.now() + 86400000) } });
  subIds.push(r.id); return r;
}
const record = async () => {
  const r = await api(`/patients/${patientIds[0]}/record`);
  assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data;
};
try {
  const login = await api('/auth/login', 'POST', { identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' });
  token = login.data?.accessToken; assert.ok(token, 'ورود ناموفق');
  patientIds.push((await db.patient.create({ data: { code: tag, firstName: 'بیمار', lastName: 'آزمون' } })).id);
  const primary = await form('main', [{ key: 'pain', label: 'درد اولیه', type: 'select', options: [{ v: 'yes', l: 'بله اولیه' }] },
    { key: 'detail', label: 'شرح اولیه', type: 'textarea', page: 2 }]);
  const extra = await form('extra', [{ key: 'mobility', label: 'حرکت اولیه', type: 'text' }]);
  const row = await submission(primary.id, [extra.id]);
  const filled = await api(`/public/intake/form/${row.token}/fill`, 'POST', { values: { pain: 'yes', detail: 'شرح بیمار', mobility: 'خوب' } }, false);
  check(filled.status === 201, 'ثبت عمومی پاسخ موفق است');
  const saved = await db.intakeSubmission.findUnique({ where: { id: row.id } });
  check(saved.status === 'approved' && saved.schemaSnapshot.some(f => f.key === 'mobility'), 'تأیید خودکار، تعریف فرم اصلی و اختصاصی را ذخیره می‌کند');
  check(saved.schemaSnapshot.find(f => f.key === 'pain').options[0].l === 'بله اولیه', 'گزینه‌ها و برچسب زمان پاسخ ذخیره شدند');
  const pain = primary.fields.find(f => f.key === 'pain');
  const detail = primary.fields.find(f => f.key === 'detail');
  await api(`/forms/fields/${pain.id}`, 'PATCH', { label: 'درد جدید', type: 'text', options: [] });
  check((await api(`/forms/fields/${detail.id}`, 'DELETE')).status === 200, 'حذف سؤال موفق است');
  const deleted = await db.formField.findUnique({ where: { id: detail.id } });
  check(deleted?.deletedAt && !deleted.active, 'سؤال در دیتابیس باقی مانده و حذف نرم شده است');
  const live = (await api('/forms/' + primary.key)).data;
  check(!live.fields.some(f => f.id === detail.id) && live.pages === 1, 'سؤال و صفحه خالی از تعریف زنده حذف شدند');
  check((await api(`/forms/fields/${detail.id}`, 'PATCH', { active: true })).status === 404, 'سؤال حذف‌شده دوباره فعال نمی‌شود');
  check((await api(`/forms/${primary.id}/fields`, 'POST', { key: 'detail', label: 'معنای دیگر' })).status === 400, 'کلید تاریخی با معنای جدید استفاده نمی‌شود');
  let attached = (await record()).attachedForms.find(f => f.id === row.id);
  check(attached.answers.find(a => a.key === 'detail')?.value === 'شرح بیمار', 'پاسخ سؤال حذف‌شده در پرونده دیده می‌شود');
  check(attached.answers.find(a => a.key === 'pain')?.label === 'درد اولیه', 'ویرایش برچسب تاریخچه را تغییر نمی‌دهد');
  check((await db.intakeSubmission.findUnique({ where: { id: row.id } })).schemaSnapshot.find(f => f.key === 'pain').type === 'select', 'نوع تاریخی تغییر نکرده است');
  const used = await api(`/forms/${primary.id}`, 'DELETE');
  check(used.data.deactivated === true && used.data.submissions === 1 && used.data.used === 1, 'formUsage پاسخ بدون لینک و مراجعه را می‌شمارد و فرم را فقط خاموش می‌کند');
  check((await db.intakeSubmission.findUnique({ where: { id: row.id } })).formId === primary.id, 'ارجاع پاسخ به فرم باقی ماند');
  const extraUsed = await api(`/forms/${extra.id}`, 'DELETE');
  check(extraUsed.data.deactivated === true && extraUsed.data.submissions === 1, 'فرم اختصاصی نیز با پاسخ موجود حذف نمی‌شود');
  attached = (await record()).attachedForms.find(f => f.id === row.id);
  check(attached.answers.some(a => a.key === 'mobility' && a.label === 'حرکت اولیه'), 'پاسخ فرم خاموش‌شده هنوز دیده می‌شود');
  const fresh = await form('fresh', [{ key: 'note', label: 'شرح دستی' }]);
  const manual = await submission(fresh.id, [], 'pending_approval', { note: 'ثبت دستی' });
  const approved = await api(`/intake/submissions/${manual.id}/approve`, 'POST', {});
  check(approved.status === 201, 'تأیید دستی موفق است');
  check((await db.intakeSubmission.findUnique({ where: { id: manual.id } })).schemaSnapshot[0].label === 'شرح دستی', 'تأیید دستی پاسخ قدیمی بدون snapshot را پوشش می‌دهد');
  const legacy = await submission(fresh.id, [], 'approved', { note: 'بدون snapshot' });
  await api(`/forms/fields/${fresh.fields[0].id}`, 'DELETE');
  check((await record()).attachedForms.find(f => f.id === legacy.id).answers[0].value === 'بدون snapshot', 'fallback پاسخ فاقد snapshot از فیلد حذف نرم‌شده می‌خواند');
  const old = await submission(fresh.id, [extra.id], 'approved', { note: 'پاسخ پیش از مهاجرت', mobility: 'حرکت قدیمی' });
  const migration = await readFile(new URL('../../server/prisma/migrations/20260916140000_form_snapshot/migration.sql', import.meta.url), 'utf8');
  // Exercise the actual backfill, restricted to this fixture; no other local data changes.
  const backfill = migration.slice(migration.indexOf('UPDATE intake_submissions AS s')).trim().replace(/;$/, '') + ` AND s.id = ${old.id}`;
  await db.$executeRawUnsafe(backfill);
  const historic = await db.intakeSubmission.findUnique({ where: { id: old.id } });
  check(historic.schemaSnapshot.some(f => f.key === 'note') && historic.schemaSnapshot.some(f => f.key === 'mobility'), 'مهاجرت فرم اصلی و اختصاصی پاسخ قدیمی را حفظ می‌کند');
  const visit = await db.visit.create({ data: { patientId: patientIds[0], kind: 'clinic', extra: { note: 'شرح مراجعه' } } });
  visitIds.push(visit.id);
  await db.intakeSubmission.update({ where: { id: old.id }, data: { visitId: visit.id } });
  const historicVisit = (await record()).visits.find(v => v.id === visit.id);
  check(historicVisit.answers.some(a => a.key === 'note' && a.label === 'شرح دستی' && a.value === 'شرح مراجعه'), 'نمای مراجعه نیز تعریف ذخیره‌شده را مقدم می‌داند');
  const unused = await form('unused');
  check((await api(`/forms/${unused.id}`, 'DELETE')).data.deactivated === false, 'فرم بدون استفاده همچنان حذف می‌شود');
  check(await db.formDef.findUnique({ where: { id: unused.id } }) === null, 'حذف واقعی فقط برای فرم بدون استفاده');
  check((await api(`/forms/${fresh.id}`, 'DELETE', undefined, false)).status === 401, 'حذف بدون احراز رد می‌شود');
  const refilled = await api(`/public/intake/form/${row.token}/fill`, 'POST', { values: { pain: 'no' } }, false);
  check(refilled.status === 400, 'پاسخ تأییدشده از مسیر عمومی بازنویسی نمی‌شود');
  console.log(`W1.6: ${passed} passed`);
} finally {
  await db.intakeSubmission.deleteMany({ where: { id: { in: subIds } } });
  await db.visit.deleteMany({ where: { id: { in: visitIds } } });
  await db.formDef.deleteMany({ where: { id: { in: formIds } } });
  await db.patient.deleteMany({ where: { id: { in: patientIds } } });
  await db.$disconnect();
}
