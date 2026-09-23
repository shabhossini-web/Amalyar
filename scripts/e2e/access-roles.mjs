/**
 * سه ادعای این بسته:
 * ۱. **نقش در ماتریسِ دسترسی — AND با سطح**: دو حسابِ هم‌سطح با نقش‌های
 *    متفاوت دسترسیِ متفاوت می‌گیرند؛ آرایهٔ خالی یعنی بدونِ قیدِ نقش.
 * ۲. **سوپرادمین همه‌چیز را می‌بیند**: همهٔ کاشی‌ها allowed، پنلِ کارشناسی
 *    نمای همه، پرتالِ حمل‌ونقل بدونِ ۴۰۴.
 * ۳. **شرح‌های فرمِ مراجعه در پرونده**: هر textarea + یادداشتِ builtin در
 *    خوراکِ `visitTexts` پرونده می‌نشیند.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
/* ⚠️ کوئری از **stdin** می‌رود نه آرگومانِ شل: هشِ bcrypt پر از `$` است و
   شل داخلِ نقل‌قولِ دوتایی آن‌ها را متغیرِ محیطی می‌خوانَد — هشِ مثله،
   ورودِ همیشه‌۴۰۱. stdin هیچ تفسیری ندارد. */
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const loginAs = async (identifier) => {
  const r = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'test1234' }),
  }).then((x) => x.json());
  if (!r.accessToken) { console.error(`ورودِ ${identifier} نشد: ${JSON.stringify(r).slice(0, 120)}`); process.exit(1); }
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + r.accessToken };
};
const send = (H, p, m, b) => fetch(API + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'ar' + randomBytes(3).toString('hex');
const HASH = '$2a$10$VFAPklsJPGax940crODU7O5vdzw2Pny43m/rNCXtTwnDx1YwjVOnu'; // test1234
const trash = { forms: [], visits: [] };

const A = await loginAs('admin');

/* دو حسابِ هم‌سطح (۵) با دو نقش — دکتر و منشی. ساخت با psql تا چرخهٔ ثبتِ
   حساب واردِ این آزمون نشود؛ personِ لازم هم ساخته می‌شود. */
const mk = (u, role) => {
  const pid = sql(`INSERT INTO people (first_name, last_name, created_at, updated_at) VALUES ('آزمونِ','${u}', now(), now()) RETURNING id`);
  return sql(`INSERT INTO accounts (person_id, username, password_hash, level, job_role, status, created_at, approved_at) VALUES (${pid}, '${u}', '${HASH}', 5, '${role}', 'active', now(), now()) RETURNING id`).trim();
};
const docId = mk(`${tag}doc`, 'doctor');
const secId = mk(`${tag}sec`, 'secretary');

try {
  console.log('۱) نقش در ماتریس — AND با سطح');
  const m0 = (await send(A, '/access/matrix', 'GET')).json;
  ok(Array.isArray(m0.roles) && m0.roles.some((r) => r.key === 'secretary'),
    `کاتالوگِ نقش‌ها در ماتریس هست (${m0.roles?.map((r) => r.label).join('، ')})`);
  const row = m0.groups.flatMap((g) => g.rows).find((r) => r.kind === 'feature' && r.key === 'accounting');
  ok(row && Array.isArray(row.roles) && row.roles.length === 0, 'پیش‌فرضِ ردیف: بدونِ قیدِ نقش');

  const patched = await send(A, '/access/features/accounting', 'PATCH', { roles: ['secretary'] });
  ok(patched.status === 200 && patched.json?.roles?.join() === 'secretary',
    `حسابداری به نقشِ منشی محدود شد (${JSON.stringify(patched.json?.roles)})`);
  const badRole = await send(A, '/access/features/accounting', 'PATCH', { roles: ['hacker'] });
  ok(badRole.status === 400, `نقشِ ناشناخته رد می‌شود (${badRole.status})`);

  const D = await loginAs(`${tag}doc`);
  const S = await loginAs(`${tag}sec`);
  const fDoc = (await send(D, '/features', 'GET')).json.find((f) => f.key === 'accounting');
  const fSec = (await send(S, '/features', 'GET')).json.find((f) => f.key === 'accounting');
  ok(fDoc?.allowed === false && /نقش/.test(fDoc?.reason ?? ''),
    `پزشکِ سطح ۵: ممنوع («${fDoc?.reason}»)`);
  ok(fSec?.allowed === true, 'منشیِ سطح ۵: مجاز — **هم‌سطح، دسترسیِ متفاوت**');
  const gDoc = await send(D, '/ledger/summary', 'GET');
  const gSec = await send(S, '/ledger/summary', 'GET');
  ok(gDoc.status === 403, `گاردِ ماژول هم پزشک را رد می‌کند (${gDoc.status})`);
  ok(gSec.status !== 403, `و منشی را عبور می‌دهد (${gSec.status})`);

  console.log('\n۲) سوپرادمین همه‌چیز را می‌بیند');
  const fAdmin = (await send(A, '/features', 'GET')).json;
  ok(fAdmin.every((f) => f.allowed === true),
    `همهٔ کاشی‌ها برای سوپرادمین باز (${fAdmin.filter((f) => f.allowed).length}/${fAdmin.length})`);
  const acc = await send(A, '/ledger/summary', 'GET');
  ok(acc.status !== 403, 'قیدِ نقش روی سوپرادمین اثر ندارد');
  const techAgenda = await send(A, '/tech/agenda?scope=upcoming', 'GET');
  ok(techAgenda.status === 200, `پنلِ کارشناسی برای سوپرادمین باز شد (${techAgenda.status})`);
  const trAgenda = await send(A, '/transport/agenda', 'GET');
  ok(trAgenda.status === 200, `پرتالِ حمل‌ونقل دیگر ۴۰۴ نمی‌دهد (${trAgenda.status})`);
  ok(trAgenda.json?.staff === null || !!trAgenda.json?.staff, 'و پاسخِ سرپرستی شکلِ سالم دارد');

  console.log('\n۳) شرح‌های فرمِ مراجعه در پروندهٔ بیمار');
  const form = (await send(A, '/forms', 'POST', { key: tag, title: 'ویزیتِ شرح‌دار', scope: 'visit' })).json;
  trash.forms.push(form.id);
  /* ⚠️ کلیدِ فیلد `examNote` است: از بستهٔ ۶الف `exam` کلیدِ رزروِ هستهٔ ثابت
     است و فیلدِ سفارشی با آن ساخته نمی‌شود (۴۰۰) — آن شرح حالا ClinicalNote است
     و پایین‌تر جدا سنجیده می‌شود. */
  const reserved = await send(A, `/forms/${form.id}/fields`, 'POST', { key: 'exam', label: 'شرحِ معاینه', type: 'textarea' });
  ok(reserved.status === 400, `کلیدِ رزروِ «exam» برای فیلدِ سفارشی رد می‌شود (${reserved.status})`);
  await send(A, `/forms/${form.id}/fields`, 'POST', { key: 'examNote', label: 'شرحِ معاینه', type: 'textarea' });
  const visit = (await send(A, '/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'شرح‌ها',
    opDate: new Date().toISOString(),
    notes: 'یادداشتِ کوتاهِ منشی',
    exam: 'تونِ عضلانی طبیعی',
    extra: { examNote: 'رفلکس‌ها طبیعی، لاسگ منفی' },
  })).json;
  trash.visits.push(visit.id);
  const rec = (await send(A, `/patients/${visit.patientId}/record`, 'GET')).json;
  const texts = rec?.visitTexts ?? [];
  ok(texts.some((t) => t.label === 'شرحِ معاینه' && t.body.includes('لاسگ')),
    '**شرحِ معاینهٔ نوشته‌شده در فرم، در شرح‌های پرونده است**');
  ok(texts.some((t) => t.label === 'یادداشتِ مراجعه' && t.body.includes('منشی')),
    'یادداشتِ builtin هم آمده — تا امروز نامرئی بود');
  ok(texts.every((t) => typeof t.code === 'string' && t.code.includes('-V')),
    'و هر شرح کدِ مراجعهٔ خودش را دارد');
  ok((rec?.counts?.visitTexts ?? 0) >= 2, `شمارش هم از سرور می‌آید (${rec?.counts?.visitTexts})`);
  /* شرحِ بخشیِ هستهٔ ثابت یک ClinicalNote است: در فهرستِ شرح‌ها با نوعِ
     خودش، و روی کارتِ مراجعه با برچسبِ فارسی — نه کلیدِ خام. و در visitTexts
     **تکرار نمی‌شود**، وگرنه یک متن دو بار در همان تب دیده می‌شد. */
  const examNote = (rec?.clinicalNotes ?? []).find((n) => n.kind === 'exam' && n.visitId === visit.id);
  ok(examNote?.body === 'تونِ عضلانی طبیعی' && examNote?.kindFa === 'شرحِ معاینه',
    `شرحِ معاینهٔ بخشی در شرح‌های بالینی است (${examNote?.kindFa})`);
  ok(rec?.counts?.notesByKind?.exam === 1, `و چیپِ «شرحِ معاینه» می‌شماردش (${rec?.counts?.notesByKind?.exam})`);
  ok(!texts.some((t) => t.body === 'تونِ عضلانی طبیعی'), 'در visitTexts تکرار نشده');
  const card = (rec?.visits ?? []).find((v) => v.id === visit.id);
  const examAns = (card?.answers ?? []).find((a) => a.key === 'exam');
  ok(examAns?.value === 'تونِ عضلانی طبیعی' && examAns?.label !== 'exam',
    `کارتِ مراجعه هم شرحِ بخشی را با برچسب نشان می‌دهد («${examAns?.label}»)`);
} finally {
  await send(A, '/access/features/accounting/reset', 'POST').catch(() => {});
  for (const id of trash.visits) await send(A, `/visits/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}'`);
  sql(`DELETE FROM patients WHERE last_name='شرح‌ها' AND id NOT IN (SELECT patient_id FROM visits)`);
  for (const id of trash.forms) await send(A, `/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM account_sessions WHERE account_id IN (${docId}, ${secId})`);
  sql(`DELETE FROM accounts WHERE id IN (${docId}, ${secId})`);
  sql(`DELETE FROM people WHERE last_name IN ('${tag}doc','${tag}sec')`);
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
