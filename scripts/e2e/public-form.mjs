/**
 * مرحلهٔ ۳ — فرمِ ساخته‌شده به **خودِ بیمار** می‌رسد.
 *
 * تا دیروز `src/pages/Intake.jsx` صددرصد JSXِ هاردکد بود و هیچ‌وقت `FormDef` را
 * نمی‌دید: کاربر فرم می‌ساخت، لینک را می‌فرستاد، و بیمار همان چهار فیلدِ ثابتِ
 * همیشگی را می‌دید. این آزمون همان مسیر را از دیدِ بیمار می‌رود.
 *
 * ⚠️ سنجه‌ها روی **حالتِ برگشتیِ سرور**اند: چه چیزی واقعاً در `data` نشست، نه
 * اینکه صفحه خطا نداد.
 */
const API = 'http://localhost:3101/api';
let TOKEN = '';
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch { /* غیرJSON */ }
  return { status: r.status, json, text: t };
}

TOKEN = (await api('/auth/login', { method: 'POST', body: { identifier: 'admin', password: 'test1234' } })).json?.accessToken;
if (!TOKEN) { console.error('ورود نشد'); process.exit(1); }

/** کدِ ملیِ معتبرِ یکتا — کدِ ثابت در اجرای دوم ۴۰۹ می‌گیرد. */
function nid(seed) {
  const base = String(seed % 1_000_000_000).padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
  const r = sum % 11;
  return base + String(r < 2 ? r : 11 - r);
}
const RUN = Math.floor(Date.now() / 1000) % 100_000_000;

// ── آماده‌سازیِ تکرارپذیر ───────────────────────────────────────────────────
for (const l of (await api('/intake/links')).json.filter((x) => /^\[pf]/.test(x.title))) {
  await api(`/intake/links/${l.id}`, { method: 'PATCH', body: { title: '[pf-old] ' + l.id, active: false, formId: 0, bankAccountId: 0 } });
}
for (const f of (await api('/forms')).json.filter((x) => /(^|\.)pfform/.test(x.key))) {
  await api(`/forms/${f.id}`, { method: 'DELETE' });
}

// فرمِ دوصفحه‌ای: صفحهٔ ۱ یک متنِ اجباری + یک انتخاب، صفحهٔ ۲ عکس + پرداخت
const form = (await api('/forms', { method: 'POST', body: { key: 'pfform', title: '[pf] فرمِ بیمار', scope: 'intake', hint: 'لطفاً کامل پر کنید.' } })).json;
await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'complaint', label: 'شکایتِ اصلی', type: 'text', required: true, page: 1 } });
await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'side', label: 'سمت', type: 'select', options: 'right=راست\nleft=چپ', page: 1 } });
await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'xray', label: 'عکسِ رادیولوژی', type: 'image', page: 2 } });
await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'pay', label: 'پرداخت', type: 'payment', page: 2 } });

// حسابِ علامت‌خورده با هر سه شماره
let bank = (await api('/intake/link-options')).json.banks[0];
if (!bank) {
  const made = (await api('/bank-accounts', {
    method: 'POST',
    body: { ownerName: '[pf] حساب', bankName: 'ملت', accountNumber: '11112222', cardNumber: '6104333344445555', iban: '820120000000001111222233', showOnIntake: true },
  })).json;
  bank = { id: made.id };
}
const link = (await api('/intake/links', {
  method: 'POST',
  body: { title: '[pf] لینکِ فرم‌دار', amount: 300000, formId: form.id, bankAccountId: bank.id },
})).json;

console.log('\n۱) بیمار ثبت‌نام می‌کند و **تعریفِ فرم** را می‌گیرد');
let view;
{
  const reg = await api(`/public/intake/link/${link.token}/register`, {
    method: 'POST', auth: false,
    body: { firstName: 'بیمار', lastName: 'آزمون', nationalId: nid(RUN * 3 + 7), phone: '09120000021', captchaA: 2, captchaB: 3, captchaAnswer: 5 },
  });
  ok('ثبت‌نام انجام شد', reg.status < 300, reg.status + ' ' + reg.text.slice(0, 160));
  view = reg.json;
  ok('تعریفِ فرم برمی‌گردد', !!view?.form, 'form=' + JSON.stringify(view?.form)?.slice(0, 80));
  ok('عنوانِ فرم درست است', view.form?.title === '[pf] فرمِ بیمار');
  ok('دو صفحه دارد', view.form?.pages === 2, 'pages=' + view.form?.pages);
  ok('چهار فیلدِ دلخواه دارد', view.form?.fields.length === 4, 'n=' + view.form?.fields.length);
  ok('فیلدهای builtin نمی‌آیند (در گامِ اول گرفته شدند)',
    !view.form.fields.some((x) => ['firstName', 'nationalId', 'phone'].includes(x.key)),
    view.form.fields.map((x) => x.key).join(','));
  ok('شمارهٔ حساب برای باکسِ پرداخت آمد', !!view.payTo?.[0]?.accountNumber, JSON.stringify(view.payTo?.[0]));
}

console.log('\n۲) فیلدِ اجباریِ خالی جلوی ذخیره را می‌گیرد');
{
  const r = await api(`/public/intake/form/${view.token}/fill`, { method: 'POST', auth: false, body: { values: { side: 'right' } } });
  ok('۴۰۰ می‌گیرد', r.status === 400, 'status=' + r.status + ' ' + r.text.slice(0, 140));
  ok('پیام نامِ همان فیلد را دارد', /شکایتِ اصلی/.test(r.text), r.text.slice(0, 140));
}

console.log('\n۳) پاسخ‌های فرم واقعاً ذخیره می‌شوند');
{
  const r = await api(`/public/intake/form/${view.token}/fill`, {
    method: 'POST', auth: false,
    body: { values: { complaint: 'دردِ کمر', side: 'left' } },
  });
  ok('ذخیره شد', r.status < 300, r.status + ' ' + r.text.slice(0, 140));
  ok('پاسخِ متنی در data نشست', r.json?.data?.complaint === 'دردِ کمر', 'complaint=' + r.json?.data?.complaint);
  ok('انتخاب هم نشست', r.json?.data?.side === 'left', 'side=' + r.json?.data?.side);
  ok('وضعیت به pending_payment رفت', r.json?.status === 'pending_payment', 'status=' + r.json?.status);
}

console.log('\n۴) ذخیرهٔ جزئی مقادیرِ قبلی را **پاک نمی‌کند**');
{
  // فقط یک کلید فرستاده می‌شود — قبلاً `fill` هر پنج کلیدِ ثابت را null می‌کرد
  const r = await api(`/public/intake/form/${view.token}/fill`, {
    method: 'POST', auth: false,
    body: { values: { complaint: 'دردِ کمر', side: 'right' } },
  });
  ok('کلیدِ تازه عوض شد', r.json?.data?.side === 'right', 'side=' + r.json?.data?.side);
  ok('نام و کدِ ملیِ گامِ اول سرِ جایشان‌اند',
    !!r.json?.data?.firstName && !!r.json?.data?.nationalId,
    JSON.stringify({ f: r.json?.data?.firstName, n: r.json?.data?.nationalId }));
}

console.log('\n۵) کلیدِ بیرون از فرم بی‌صدا دور ریخته می‌شود');
{
  const r = await api(`/public/intake/form/${view.token}/fill`, {
    method: 'POST', auth: false,
    body: { values: { complaint: 'دردِ کمر', surgeonId: 999, hacked: 'yes' } },
  });
  ok('کلیدِ ناشناخته ذخیره نشد', r.json?.data?.hacked === undefined, 'hacked=' + r.json?.data?.hacked);
  ok('کلیدِ ستونی‌نما هم ذخیره نشد', r.json?.data?.surgeonId === undefined, 'surgeonId=' + r.json?.data?.surgeonId);
}

console.log('\n۶) آپلودِ عکس روی باکسِ عکس');
{
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const send = async (field) => {
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'x.png');
    const r = await fetch(`${API}/public/intake/form/${view.token}/image/${field}`, { method: 'POST', body: fd });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  const good = await send('xray');
  ok('عکس روی فیلدِ image پذیرفته شد', good.status < 300, 'status=' + good.status);
  ok('ارجاع در data نشست', !!good.json?.data?.xray?.id, JSON.stringify(good.json?.data?.xray));
  ok('نشانیِ عمومی برنمی‌گردد (مدرک پشتِ guard می‌ماند)',
    good.json?.data?.xray?.url === undefined, JSON.stringify(good.json?.data?.xray));

  const bad = await send('complaint');
  ok('آپلود روی فیلدِ غیرعکسی رد می‌شود', bad.status === 400, 'status=' + bad.status);
  const ghost = await send('doesNotExist');
  ok('آپلود روی کلیدِ ناموجود رد می‌شود', ghost.status === 400, 'status=' + ghost.status);
}

console.log('\n۷) لینکِ بدونِ فرم همان مسیرِ قدیمی را می‌رود');
{
  const bare = (await api('/intake/links', { method: 'POST', body: { title: '[pf] بی‌فرم', amount: 1000 } })).json;
  const reg = await api(`/public/intake/link/${bare.token}/register`, {
    method: 'POST', auth: false,
    body: { firstName: 'بیمار', lastName: 'قدیمی', nationalId: nid(RUN * 5 + 19), phone: '09120000022', captchaA: 1, captchaB: 1, captchaAnswer: 2 },
  });
  ok('ثبت‌نام انجام شد', reg.status < 300, reg.status + ' ' + reg.text.slice(0, 140));
  ok('form برابرِ null است', reg.json?.form === null, 'form=' + JSON.stringify(reg.json?.form));

  const fill = await api(`/public/intake/form/${reg.json.token}/fill`, {
    method: 'POST', auth: false,
    body: { procedure: 'عملِ قدیمی', surgeonName: 'دکتر الف' },
  });
  ok('فیلدهای ثابتِ قدیمی هنوز کار می‌کنند', fill.json?.data?.procedure === 'عملِ قدیمی', JSON.stringify(fill.json?.data)?.slice(0, 140));
}

console.log('\n──────────────────────────────');
console.log(`قبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
