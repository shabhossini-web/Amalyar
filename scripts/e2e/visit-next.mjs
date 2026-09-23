/**
 * «ویزیتِ بعدی» روی فرمِ مراجعه — ستونِ واقعی، نه کلیدِ دفن‌شده در extra:
 * - کاتالوگِ builtin ردیفِ nextVisitDate را به هر فرمِ مراجعه backfill می‌کند
 * - ساخت/ویرایش/پاک‌کردن مقدار را در **ستون** می‌نشاند (پایهٔ یادآوری‌ها)
 * - طرحِ درمان/نسخه از بستهٔ ۶الف شرحِ بخشی‌اند (ClinicalNote) — حتی اگر
 *   کلاینتِ کهنه آن‌ها را در extra بفرستد، سرور بیرونشان می‌کشد
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtAc ${JSON.stringify(q)}`).toString().trim().split('\n')[0];

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());

const tag = 'nv' + randomBytes(3).toString('hex');
const trash = { visits: [], forms: [] };

try {
  console.log('۱) کاتالوگِ builtin ردیفِ «ویزیتِ بعدی» را به فرمِ مراجعه می‌دهد');
  const form = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ آزمونِ nv', scope: 'visit' })).json;
  trash.forms.push(form.id);
  const def = await get(`/forms/visit.${tag}`);
  const nv = (def.fields ?? []).find((x) => x.key === 'nextVisitDate');
  ok(!!nv && nv.builtin === true, `ردیفِ builtinِ nextVisitDate هست (${nv?.label})`);
  ok(nv?.type === 'date', `و نوعش date است (${nv?.type})`);

  console.log('\n۲) ساخت با ویزیتِ بعدی → ستون، نه extra');
  const iso = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  const made = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'ویزیتِ‌بعدی',
    opDate: new Date().toISOString(),
    nextVisitDate: iso,
    extra: { planNote: 'فیزیوتراپی دو هفته', prescription: 'ژلوفن ۴۰۰ — روزی دو عدد' },
  })).json;
  if (!made?.id) { console.error('مراجعه ساخته نشد: ' + JSON.stringify(made)); process.exit(1); }
  trash.visits.push(made.id);
  const fresh = await get(`/visits/${made.id}`);
  ok(String(fresh.nextVisitDate).slice(0, 10) === iso.slice(0, 10),
    `formatVisit تاریخ را برمی‌گرداند (${String(fresh.nextVisitDate).slice(0, 10)})`);
  ok(sql(`SELECT next_visit_date::date::text FROM visits WHERE id=${made.id}`) === iso.slice(0, 10),
    '**ستونِ** next_visit_date پر شده');
  ok(sql(`SELECT COALESCE(extra->>'nextVisitDate','-') FROM visits WHERE id=${made.id}`) === '-',
    'و در extra دفن نشده');
  ok(fresh.prescription?.includes('ژلوفن') && fresh.extra?.prescription === undefined,
    `نسخهٔ کلاینتِ کهنه (extra) به شرحِ بخشی رفت («${fresh.prescription}»)`);
  ok(sql(`SELECT count(*) FROM clinical_notes WHERE visit_id=${made.id} AND kind='rx' AND replaced_at IS NULL`) === '1',
    'و یک ClinicalNote از نوعِ rx است');

  console.log('\n۳) ویرایش و پاک‌کردن');
  const iso2 = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await send(`/visits/${made.id}`, 'PATCH', { nextVisitDate: iso2 });
  ok(sql(`SELECT next_visit_date::date::text FROM visits WHERE id=${made.id}`) === iso2.slice(0, 10),
    `ویرایش نشست (${iso2.slice(0, 10)})`);
  await send(`/visits/${made.id}`, 'PATCH', { nextVisitDate: null });
  ok(sql(`SELECT next_visit_date IS NULL FROM visits WHERE id=${made.id}`) === 't',
    '«پزشک منصرف شد» — null پاکش می‌کند');
  const bad = await send(`/visits/${made.id}`, 'PATCH', { nextVisitDate: 'فردا' });
  ok(bad.status === 400, `تاریخِ نامعتبر رد می‌شود (${bad.status})`);
} finally {
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}'`);
  sql(`DELETE FROM patients WHERE last_name='ویزیتِ‌بعدی' AND id NOT IN (SELECT patient_id FROM visits)`);
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
