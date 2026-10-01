/**
 * پروندهٔ الکترونیکِ بیمار (/p/<token>) + یادآوریِ عمل:
 * - لینکِ دائمی؛ نمای عمومی: مراجعات، آتی‌ها، عمل‌ها، فیدِ اطلاع‌رسانی
 * - projection: بدونِ مبلغ/یادداشتِ داخلی؛ هر مراجعه لینکِ خلاصه دارد
 * - پیامکِ پرتال در فیدِ خودش ثبت می‌شود (notice)
 * - مراجعهٔ جراحی با تاریخِ آینده → یادآوریِ surgery؛ لغوِ عمل → cancelled
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b, auth = true) => fetch(API + p, {
  method: m, headers: auth ? A : { 'Content-Type': 'application/json' },
  body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'po' + randomBytes(3).toString('hex');
const trash = { forms: [], visits: [] };

try {
  const form = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ پرتال', scope: 'visit' })).json;
  trash.forms.push(form.id);

  /* مراجعهٔ ۱: کلینیکی با ویزیتِ بعدی */
  const v1 = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'پرتال', phone: '09120000811',
    opDate: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    nextVisitDate: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
    notes: 'یادداشتِ داخلی', amount: 700000,
  })).json;
  trash.visits.push(v1.id);

  /* مراجعهٔ ۲: جراحیِ آینده روی همان پرونده — یادآوریِ عمل باید کاشته شود.
     فرمِ surgery جراح/بیمارستانِ اجباری دارد → با psql مستقیم نوعش را جراحی
     می‌کنیم تا آزمون به تعریف‌های پایه گره نخورد. */
  const v2 = (await send('/visits', 'POST', {
    kind: tag, patientId: v1.patientId,
    opDate: new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString(),
  })).json;
  trash.visits.push(v2.id);
  sql(`UPDATE visits SET kind='surgery' WHERE id=${v2.id}`);
  /* sync بعد از تغییرِ نوع — از مسیرِ واقعیِ ویرایش */
  await send(`/visits/${v2.id}`, 'PATCH', { opDate: new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString() });

  console.log('۱) یادآوریِ عمل');
  const cnt = (kind, st) => Number(sql(`SELECT count(*) FROM reminders WHERE visit_id=${v2.id} AND kind='${kind}' AND status='${st}'`));
  ok(cnt('surgery', 'pending') === 1, 'جراحیِ آینده یک یادآوریِ pending دارد');
  ok(sql(`SELECT text FROM reminders WHERE visit_id=${v2.id} AND kind='surgery' AND status='pending'`).includes('عملِ شما'),
    'با متنِ عمل');
  await send(`/visits/${v2.id}/status`, 'PATCH', { opStatus: 'cancelled', cancelReason: 'other' });
  ok(cnt('surgery', 'pending') === 0 && cnt('surgery', 'cancelled') === 1,
    '**لغوِ عمل یادآوری‌اش را باطل می‌کند**');
  await send(`/visits/${v2.id}/status`, 'PATCH', { opStatus: 'pending' });
  ok(cnt('surgery', 'pending') === 1, 'و برگرداندنِ وضعیت دوباره می‌کارد');

  console.log('\n۲) لینکِ دائمیِ پرونده');
  const l1 = (await send(`/patients/${v1.patientId}/portal-link`, 'POST')).json;
  const l2 = (await send(`/patients/${v1.patientId}/portal-link`, 'POST')).json;
  ok(!!l1?.token && l1.token === l2?.token, 'توکن دائمی است');
  ok(String(l1.url).includes(`/p/${l1.token}`), 'و نشانیِ /p دارد');

  console.log('\n۳) پیامکِ پرتال + ثبت در فیدِ خودش');
  const sms = (await send(`/patients/${v1.patientId}/portal-sms`, 'POST')).json;
  ok(sms?.to === '09120000811', `به شمارهٔ پرونده (${sms?.to})`);
  ok(Number(sql(`SELECT count(*) FROM reminders WHERE patient_id=${v1.patientId} AND kind='notice' AND status='sent'`)) >= 1,
    'پیامِ فرستاده‌شده در دفترِ اطلاع‌رسانی ثبت شد');

  console.log('\n۴) نمای عمومیِ پرونده');
  const pub = await send(`/public/portal/${l1.token}`, 'GET', null, false);
  ok(pub.status === 200, `بدونِ ورود باز می‌شود (${pub.status})`);
  const d = pub.json;
  const body = JSON.stringify(d);
  ok(d?.patient?.fullName === 'بیمارِ پرتال', 'نامِ بیمار');
  /* بازبینیِ UX (بندِ ۱۰۰): مراجعهٔ آینده‌ای که در انتظار است برنامهٔ «پیشِ‌رو»ست نه تاریخچه، و
     خلاصه فقط برای مراجعهٔ انجام‌شده لینک می‌شود. */
  ok((d?.visits ?? []).length === 1, `تاریخچه فقط مراجعهٔ گذشته را دارد (${d?.visits?.length})`);
  ok(d.visits.every((v) => (v.status === 'done' ? String(v.summaryUrl).startsWith('/v/') : v.summaryUrl === null)),
    'خلاصه فقط برای مراجعهٔ انجام‌شده لینک دارد');
  ok((d?.surgeries ?? []).length === 1, 'بخشِ عمل‌ها فقط جراحی را دارد');
  const ahead = d.upcoming.find((u) => u.kind === 'visit' && /-V2$/.test(u.code ?? ''));
  ok(!!ahead && /\S+ \S+ \S+ \S+/.test(ahead.whenFa ?? ''), `**جراحیِ آینده در «پیشِ‌رو»** با روزِ هفته («${ahead?.whenFa}»)`);
  ok(d.upcoming.some((u) => u.kind === 'next_visit'), 'ویزیتِ بعدی در «پیشِ‌رو» هست');
  ok(d.notices.some((n) => n.text.includes('پروندهٔ الکترونیک')), 'پیامکِ پرتال در فیدِ پیام‌ها هست');
  ok(d.notices.some((n) => n.upcoming && n.text.includes('یادآوری')), 'یادآوریِ برنامه‌ریزی‌شده هم دیده می‌شود');
  ok(!body.includes('700000') && !body.includes('یادداشتِ داخلی'), '**مبلغ و یادداشتِ داخلی بیرون نمی‌رود**');
  const bad = await send('/public/portal/xxxx', 'GET', null, false);
  ok(bad.status === 404, `توکنِ جعلی ۴۰۴ (${bad.status})`);
} finally {
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE last_name='پرتال')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}'`);
  sql(`DELETE FROM patients WHERE last_name='پرتال' AND id NOT IN (SELECT patient_id FROM visits)`);
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
