/**
 * مرکزِ پیامک‌ها + سربرگ:
 * - گروهِ «پیامک‌ها و زمان‌بندی» در تنظیمات هست؛ کلیدهای پنهانِ سربرگ در صفحه نیستند
 * - متن و زمان‌بندیِ ویراسته → یادآوریِ ویزیتِ بعدی با متنِ خودِ شرکت و موعدِ درست
 * - متنِ پیامکِ پروندهٔ الکترونیک هم از تنظیمات می‌آید (ثبت در دفترِ notices)
 * - سربرگ: آپلود → دریافتِ همان تصویر → حذف → 404
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
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const patchSettings = (values) => send('/settings', 'PATCH', { values });

const tag = 'sc' + randomBytes(3).toString('hex');
const trash = { forms: [], visits: [] };
/* یک PNG یک‌پیکسلی واقعی — تا فیلترِ mime و بایت‌های برگشتی هر دو آزموده شوند. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

try {
  console.log('۱) گروهِ پیامک‌ها در صفحهٔ تنظیمات');
  const all = (await send('/settings', 'GET')).json;
  const smsGroup = all.groups.find((g) => g.key === 'sms');
  ok(!!smsGroup, 'گروهِ «پیامک‌ها و زمان‌بندی» هست');
  ok((smsGroup?.items ?? []).some((i) => i.key === 'sms_next_visit_text')
    && (smsGroup?.items ?? []).some((i) => i.key === 'sms_reminder_hour'),
    'متن‌ها و زمان‌بندی‌ها هر دو در همان گروه‌اند');
  const everyKey = all.groups.flatMap((g) => g.items.map((i) => i.key));
  ok(!everyKey.some((k) => k.startsWith('letterhead_')), '**کلیدهای پنهانِ سربرگ در صفحه نیستند**');

  console.log('\n۲) متن و زمان‌بندیِ ویراسته روی یادآوریِ ویزیتِ بعدی');
  const patched = await patchSettings({
    sms_next_visit_text: 'قرارِ بعدیِ شما {date} — کلینیکِ آزمون', sms_next_visit_days: 3,
  });
  ok(patched.status === 200, `متن و روزِ یادآوری ذخیره شد (${patched.status})`);
  const form = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ مرکزِ پیامک', scope: 'visit' })).json;
  trash.forms.push(form.id);
  const nv = new Date(Date.now() + 10 * 24 * 3600 * 1000);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'پیامک', phone: '09120000912',
    opDate: new Date().toISOString(), nextVisitDate: nv.toISOString(),
  })).json;
  trash.visits.push(visit.id);
  ok(!!visit?.id, `مراجعه با ویزیتِ بعدی ثبت شد (#${visit?.id})`);
  const row = sql(`SELECT text || '|' || to_char(due_at, 'YYYY-MM-DD') FROM reminders WHERE visit_id=${visit.id} AND kind='next_visit' AND status='pending'`);
  ok(row.includes('قرارِ بعدیِ شما') && row.includes('کلینیکِ آزمون'), '**متنِ یادآوری همان متنِ ویراستهٔ شرکت است**');
  ok(!row.includes('{date}'), 'جای‌گیرِ {date} با تاریخِ شمسی پر شده');
  const wantDay = new Date(nv.getTime() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  ok(row.endsWith('|' + wantDay), `موعد = سه روز قبل از ویزیت (${wantDay})`);

  console.log('\n۳) متنِ پیامکِ پرونده از تنظیمات');
  await patchSettings({ sms_portal_text: 'پروندهٔ آزمونیِ شما: {link}' });
  const psms = await send(`/patients/${visit.patientId}/portal-sms`, 'POST');
  ok(psms.status === 201 || psms.status === 200, `پیامکِ پرونده رفت (${psms.status})`);
  const notice = sql(`SELECT text FROM reminders WHERE patient_id=${visit.patientId} AND kind='notice' ORDER BY id DESC LIMIT 1`);
  ok(notice.includes('پروندهٔ آزمونیِ شما:') && notice.includes('/p/'), '**متنِ ثبت‌شده در دفتر، متنِ ویراسته + لینک است**');

  console.log('\n۴) سربرگِ شرکت');
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'letterhead.png');
  const up = await fetch(API + '/settings/letterhead', {
    method: 'POST', headers: { Authorization: A.Authorization }, body: fd,
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  ok(up.status === 201 || up.status === 200, `آپلود شد (${up.status})`);
  const got = await fetch(API + '/settings/letterhead', { headers: { Authorization: A.Authorization } });
  const bytes = Buffer.from(await got.arrayBuffer());
  ok(got.status === 200 && got.headers.get('content-type') === 'image/png', 'دریافت با همان نوعِ فایل');
  ok(bytes.equals(PNG), '**بایت‌های برگشتی همان تصویرِ آپلودشده‌اند**');
  const bad = new FormData();
  bad.append('file', new Blob([Buffer.from('nope')], { type: 'text/plain' }), 'x.txt');
  const rej = await fetch(API + '/settings/letterhead', {
    method: 'POST', headers: { Authorization: A.Authorization }, body: bad,
  });
  ok(rej.status === 400, 'فایلِ غیرتصویری رد می‌شود');
  const del = await send('/settings/letterhead', 'DELETE');
  ok(del.status === 200, 'حذف شد');
  const gone = await fetch(API + '/settings/letterhead', { headers: { Authorization: A.Authorization } });
  ok(gone.status === 404, 'بعد از حذف، ۴۰۴');

  console.log('\n۵) گزارشِ عیب‌یابیِ پیامک — متنِ ساده برای گوشیِ مالک، بی‌شماره');
  const diag = await fetch(API + '/reminders/diagnostics', { headers: { Authorization: A.Authorization } });
  const body = await diag.text();
  ok(diag.status === 200 && (diag.headers.get('content-type') ?? '').startsWith('text/plain'),
    `گزارش متنِ ساده است، نه JSON (${diag.status}، ${diag.headers.get('content-type')})`);
  ok(body.startsWith('عیب‌یابیِ پیامک') && body.includes('پروسهٔ سرور از') && body.includes('کلید و خطِ ملی‌پیامک'),
    'سرتیتر، زمانِ روشن‌شدنِ سرور و وضعیتِ تنظیمِ پیامک در گزارش هست');
  ok(!body.includes('09120000912') && !body.includes('۰۹۱۲۰۰۰۰۹۱۲'), '**نباید بیفتد:** شمارهٔ بیمار در گزارش');
} finally {
  await patchSettings({ sms_next_visit_text: '', sms_next_visit_days: 1, sms_portal_text: '' })
    .catch(() => {});
  /* «برابرِ پیش‌فرض = حذفِ ردیف» — ولی متنِ خالی خودش مقدار است؛ صریح به پیش‌فرض برگردان. */
  sql(`DELETE FROM settings WHERE key IN ('sms_next_visit_text','sms_next_visit_days','sms_portal_text','letterhead_sha','letterhead_mime')`);
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE last_name='پیامک')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM visits WHERE kind='${tag}'`);
  sql(`DELETE FROM patients WHERE last_name='پیامک' AND id NOT IN (SELECT patient_id FROM visits)`);
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
