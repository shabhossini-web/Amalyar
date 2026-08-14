/**
 * چهار نگهبانِ فرمِ عمومی — همه از گزارشِ نصبِ واقعی (reyteb) آمده‌اند:
 *
 * ۱. **بدونِ فیش مرحلهٔ بعد نه.** مبلغِ ثبت‌نام هنگامِ spawn عکس‌برداری می‌شود؛
 *    ثبت‌نامی که پیش از قیمت‌گذاریِ لینک ساخته شده بود صفر می‌ماند و از مرحلهٔ
 *    فیش می‌پرید. حالا `fill` تا وقتی تخفیفی نخورده، مبلغ را از خودِ لینک تازه
 *    می‌کند.
 * ۲. **برخوردِ کد ملی نام نشت نمی‌دهد.** پیامِ ۴۰۹ روی نشانیِ عمومی نه نامِ
 *    صاحبِ پرونده را می‌گوید نه «از فهرست انتخاب کنید» — فهرستی که بیمار ندارد.
 * ۳. **فیلدِ بخش‌دار (شرحِ معاینه) روی فرمِ بیمار نمی‌آید** و مقدارش از بیمار
 *    پذیرفته هم نمی‌شود.
 * ۴. **مدرکِ لینکی**: MRI/پاراکلینیکِ میزبانی‌شده در جای دیگر با لینک ثبت
 *    می‌شود؛ فقط http/https، و «دانلود» برایش معنی ندارد.
 */
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const { execSync } = await import('node:child_process');
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const sql = (q) => execSync(`psql "${DB}" -qtAc ${JSON.stringify(q)}`).toString().trim().split('\n')[0];

/* کد ملی‌های آزمون — رقمِ کنترلی معتبر. پاک‌سازی در ابتدا و انتها تا اجرای
   دوم هم سبز باشد (ثبت‌نامِ باز روی همان لینک ادامه پیدا می‌کند و آزمون را کج می‌کند). */
const NID_A = '0084575646';
const NID_B = '0012069361';
const wipe = () => {
  sql(`DELETE FROM intake_submissions WHERE patient_id IN (SELECT id FROM patients WHERE national_id IN ('${NID_A}','${NID_B}'))`);
  sql(`DELETE FROM patients WHERE national_id IN ('${NID_A}','${NID_B}') AND id NOT IN (SELECT patient_id FROM visits)`);
};
wipe();

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b, auth = true) => fetch(API + p, {
  method: m, headers: auth ? A : { 'Content-Type': 'application/json' },
  body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());

const CAP = { captchaA: 3, captchaB: 4, captchaAnswer: 7 };
const trash = { forms: [], visits: [], patients: [] };

try {
  console.log('۱) مبلغِ کهنه از مرحلهٔ فیش نمی‌پرد');
  const mk = await send('/intake/links', 'POST', { title: 'گاردِ فیش', amount: 0 });
  const reg = await send(`/public/intake/link/${mk.json.token}/register`, 'POST',
    { firstName: 'گاردِ', lastName: 'فیش', nationalId: NID_A, phone: '09120000411', ...CAP }, false);
  ok(reg.status < 300, `ثبت‌نام روی لینکِ بی‌مبلغ (${reg.status})`);
  await send(`/intake/links/${mk.json.id}`, 'PATCH', { amount: 1200000 });
  const fill = await send(`/public/intake/form/${reg.json.token}/fill`, 'POST', { procedure: 'ویزیت' }, false);
  ok(fill.json?.status === 'pending_payment', `بعدِ قیمت‌گذاریِ لینک، fill به مرحلهٔ فیش می‌رود (${fill.json?.status})`);
  ok(fill.json?.payable === 1200000, `و مبلغِ قابلِ پرداخت همان قیمتِ جاریِ لینک است (${fill.json?.payable})`);
  const again = await send(`/public/intake/form/${reg.json.token}/fill`, 'POST', { procedure: 'ویزیت' }, false);
  ok(again.json?.status === 'pending_payment', 'ذخیرهٔ دوباره هم بدونِ فیش جلوتر نمی‌رود');

  /* فرمِ سبک برای بخش‌های ۲ و ۳ — نوعِ بی‌فیلدِ اجباری (جز تاریخ) تا چکِ
     ادمین به اعتبارسنجیِ جراح/بیمارستان نخورد. */
  const tag = Math.random().toString(36).slice(2, 7);
  const form = (await send('/forms', 'POST', { key: `ig${tag}`, title: 'ویزیتِ گارد', scope: 'visit' })).json;
  trash.forms.push(form.id);
  await send(`/forms/${form.id}/fields`, 'POST', { key: 'examNote', label: 'شرحِ معاینه', type: 'textarea', role: 'doctor' });
  await send(`/forms/${form.id}/fields`, 'POST', { key: 'complaint', label: 'شکایتِ اصلی', type: 'text' });

  console.log('\n۲) برخوردِ کد ملی روی فرمِ عمومی نام نشت نمی‌دهد');
  const clash = await send(`/public/intake/link/${mk.json.token}/register`, 'POST',
    { firstName: 'غریبهٔ', lastName: 'کنجکاو', nationalId: NID_A, phone: '09120000412', ...CAP }, false);
  ok(clash.status === 409, `نامِ خانوادگیِ متفاوت با همان کد ملی رد شد (${clash.status})`);
  const msg = clash.json?.message ?? '';
  ok(!/فیش|گارد/.test(msg), '**نامِ صاحبِ پرونده در پیام نیست**');
  ok(!/AM-\d/.test(msg), 'کدِ پرونده هم نیست');
  ok(!/فهرست/.test(msg), 'و «از فهرست انتخاب کنید» هم نمی‌گوید — بیمار فهرستی ندارد');
  ok(/نامِ خانوادگی/.test(msg), `پیام راهِ درست را می‌گوید («${msg.slice(0, 60)}…»)`);

  /* ادمین همان برخورد را با نام و کد می‌بیند — پیامِ ادمین عمداً عوض نشده. */
  const adminClash = await send('/visits', 'POST', {
    kind: `ig${tag}`, firstName: 'غریبهٔ', lastName: 'کنجکاو', nationalId: NID_A,
    opDate: new Date().toISOString(),
  });
  ok(adminClash.status === 409 && /«/.test(adminClash.json?.message ?? ''),
    `ادمین همچنان نام و کدِ پرونده را در پیام می‌بیند (${adminClash.status})`);

  console.log('\n۳) فیلدِ بخش‌دار روی فرمِ بیمار نمی‌آید');
  const mk2 = await send('/intake/links', 'POST', { title: 'گاردِ بخش', amount: 0, formId: form.id });
  const reg2 = await send(`/public/intake/link/${mk2.json.token}/register`, 'POST',
    { firstName: 'بخشِ', lastName: 'پنهان', nationalId: NID_B, phone: '09120000413', ...CAP }, false);
  const pv = await send(`/public/intake/form/${reg2.json.token}`, 'GET', null, false);
  const keys = (pv.json?.form?.fields ?? []).map((x) => x.key);
  ok(keys.includes('complaint'), 'فیلدِ عمومی روی فرمِ بیمار هست');
  ok(!keys.includes('examNote'), '**«شرحِ معاینه» (بخشِ پزشک) روی فرمِ بیمار نیست**');
  const fill2 = await send(`/public/intake/form/${reg2.json.token}/fill`, 'POST',
    { values: { complaint: 'کمردرد', examNote: 'دست‌کاریِ بیمار' } }, false);
  ok(fill2.status < 300, `پرکردنِ فرم با کلیدِ قاچاقی خطا نمی‌دهد (${fill2.status})`);
  ok(fill2.json?.data?.complaint === 'کمردرد', 'پاسخِ فیلدِ عمومی نشست');
  ok(fill2.json?.data?.examNote === undefined, '**ولی مقدارِ بخشِ پزشک از بیمار پذیرفته نشد**');

  console.log('\n۴) مدرکِ لینکی — MRI که جای دیگری میزبانی می‌شود');
  const pid = Number(sql(`SELECT id FROM patients WHERE national_id='${NID_B}'`));
  ok(Number.isInteger(pid) && pid > 0, `پروندهٔ آزمون پیدا شد (${pid})`);
  const lk = await send(`/patients/${pid}/documents/link`, 'POST',
    { url: 'https://pacs.example.com/study/42', category: 'imaging', title: 'MRI کمر' });
  ok(lk.status < 300 && lk.json?.externalUrl === 'https://pacs.example.com/study/42', `لینک ثبت شد (${lk.status})`);
  const docs = await get(`/patients/${pid}/documents`);
  const row = (Array.isArray(docs) ? docs : []).find((d) => d.id === lk.json.id);
  ok(row?.isLink === true && row?.externalUrl === 'https://pacs.example.com/study/42', 'در فهرستِ مدارک با نشانی برگشت');
  ok(row?.title === 'MRI کمر' && row?.category === 'imaging', 'عنوان و دسته سرِ جایشان‌اند');
  const evil = await send(`/patients/${pid}/documents/link`, 'POST',
    { url: 'javascript:alert(1)//12345678', category: 'imaging' });
  ok(evil.status === 400, `«لینکِ» javascript رد شد (${evil.status}) — روی صفحهٔ پرونده کلیک‌شدنی می‌شد`);
  const dl = await fetch(`${API}/patients/documents/${lk.json.id}/file`, { headers: A });
  ok(dl.status === 400, `دانلودِ مدرکِ لینکی ۴۰۰ می‌دهد نه فایلِ خالی (${dl.status})`);
  await send(`/patients/documents/${lk.json.id}`, 'DELETE');

  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  process.exitCode = fail ? 1 : 0;
} finally {
  for (const id of trash.forms) await fetch(API + `/forms/${id}`, { method: 'DELETE', headers: A });
  wipe();
}
