/**
 * اعتبارسنجی از مسیرِ **واقعیِ نوشتن** (ثبتِ مراجعه) سنجیده می‌شود، نه از یک
 * تابعِ جدا: همان جایی که کاربر ۴۰۰ می‌گیرد.
 *
 * سه ادعا:
 *  • باکسِ پرداختِ ستاره‌دار **جلوی ذخیره را نمی‌گیرد** (مقدار ندارد).
 *  • باکسِ عکسِ ستاره‌دار **می‌گیرد** تا وقتی ارجاعِ فایل نیامده.
 *  • باکسِ **هسته‌ایِ** ستاره‌دار که ستون نیست (`opReport`) هم درست سنجیده
 *    می‌شود — نه «همیشه خالی».
 */
const API = 'http://localhost:3101/api';
let TOKEN = '';
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* غیرJSON */ }
  return { status: r.status, json, text };
}

TOKEN = (await api('/auth/login', { method: 'POST', body: { identifier: 'admin', password: 'test1234' } })).json?.accessToken;
if (!TOKEN) { console.error('ورود نشد'); process.exit(1); }

// فرمِ تمیز برای این آزمون: یک عکسِ اجباری + یک پرداختِ اجباری
const key = 'valtest';
/* ⚠️ اگر اجرای قبلی مراجعه ثبت کرده، سرویس فرم را فقط **خاموش** می‌کند و کلید
   می‌ماند — پس به‌جای «حذف و بساز»، فرمِ موجود را برمی‌گردانیم و تمیز می‌کنیم.
   آزمونی که بارِ دوم قرمز شود، هیچ‌کس بارِ دوم اجرایش نمی‌کند. */
let form = (await api('/forms')).json.find((f) => f.key === 'visit.' + key) ?? null;
if (form) {
  await api(`/forms/${form.id}`, { method: 'PATCH', body: { active: true } });
  for (const f of form.fields.filter((x) => !x.builtin)) {
    await api(`/forms/fields/${f.id}`, { method: 'DELETE' });
  }
} else {
  const created = await api('/forms', { method: 'POST', body: { key, title: 'آزمونِ اعتبارسنجی', scope: 'visit' } });
  form = created.json;
  if (!form?.id) { console.error('فرم ساخته نشد: ' + created.text.slice(0, 200)); process.exit(1); }
}

await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'scan', label: 'اسکن', type: 'image', required: true } });
await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'pay', label: 'پرداخت', type: 'payment', required: true } });

// سرور required را روی payment می‌پذیرد؟ اگر نه، خودِ آزمون بی‌معنی است.
const fresh = (await api(`/forms/visit.${key}`)).json;
const payF = fresh.fields.find((f) => f.type === 'payment');
console.log('\nحالتِ فرم: payment.required =', payF.required, '| image.required =', fresh.fields.find((f) => f.type === 'image').required);

const base = {
  nationalId: '0499370899', firstName: 'آزمون', lastName: 'اعتبار', phone: '09120000009',
  kind: key, opDate: '2026-08-10', amount: 0,
};

console.log('\nثبتِ مراجعه بدونِ عکس — باید رد شود');
{
  const r = await api('/visits', { method: 'POST', body: { ...base, extra: {} } });
  ok('بدونِ عکسِ اجباری ۴۰۰ می‌گیرد', r.status === 400, 'status=' + r.status + ' ' + r.text.slice(0, 200));
  ok('پیام دربارهٔ عکس است', /اسکن/.test(r.text), r.text.slice(0, 200));
  ok('پیام دربارهٔ پرداخت **نیست**', !/پرداخت/.test(r.text), r.text.slice(0, 200));
}

console.log('\nثبتِ مراجعه با ارجاعِ عکس — باید بپذیرد');
{
  const r = await api('/visits', {
    method: 'POST',
    body: { ...base, extra: { scan: { id: 7, url: '/x.jpg', name: 'x.jpg' } } },
  });
  ok('با ارجاعِ عکس ذخیره می‌شود', r.status < 300, 'status=' + r.status + ' ' + r.text.slice(0, 250));
  ok('باکسِ پرداختِ ستاره‌دار مانعِ ذخیره نشد', r.status < 300);
}

console.log('\nآبجکتِ خالی نباید «پر» حساب شود');
{
  const r = await api('/visits', { method: 'POST', body: { ...base, extra: { scan: {} } } });
  ok('عکسِ نیمه‌کاره ({}) رد می‌شود', r.status === 400, 'status=' + r.status + ' ' + r.text.slice(0, 200));
}

/**
 * ⚠️ **فیلدِ هسته‌ایِ اجباری که ستون نیست — ستاره‌ای که فیلد را برای ابد قفل
 * می‌کرد.**
 *
 * `opReport` («شرحِ عمل») در کاتالوگِ فرم‌ساز هست (پس ستاره می‌گیرد) ولی در
 * `BUILTIN_VISIT_KEYS` نیست، چون ستون نیست و به `ClinicalNote` می‌رود. تا
 * دیروز `pickBuiltin` فقط `BUILTIN_VISIT_KEYS` را برمی‌داشت، یعنی مقدارش
 * **هیچ‌وقت** وارد اعتبارسنجی نمی‌شد: مدیر که «شرحِ عمل» را اجباری می‌کرد،
 * ثبتِ مراجعه **برای همیشه** ۴۰۰ می‌گرفت («شرحِ عمل را کامل کنید») هر چقدر
 * هم کاربر می‌نوشت. و چون خطا درست و فارسی بود، شبیهِ باگ هم به‌نظر نمی‌رسید.
 */
console.log('\nفیلدِ هسته‌ایِ اجباری که ستون نیست (`opReport`)');
{
  const cur = (await api(`/forms/visit.${key}`)).json;
  const rep = (cur.fields ?? []).find((f) => f.key === 'opReport');
  ok('«شرحِ عمل» در فرم ردیفِ builtin دارد', !!rep, JSON.stringify((cur.fields ?? []).map((f) => f.key)));
  if (rep) {
    await api(`/forms/fields/${rep.id}`, { method: 'PATCH', body: { required: true, active: true } });
    const withImg = { ...base, extra: { scan: { id: 7, url: '/x.jpg', name: 'x.jpg' } } };

    const empty = await api('/visits', { method: 'POST', body: withImg });
    ok('بدونِ شرحِ عمل ۴۰۰ می‌گیرد', empty.status === 400 && /شرحِ عمل/.test(empty.text),
      'status=' + empty.status + ' ' + empty.text.slice(0, 200));

    const filled = await api('/visits', { method: 'POST', body: { ...withImg, opReport: 'شرحِ کاملِ عمل.' } });
    ok('⚠️ **نباید بیفتد:** با شرحِ عمل هم رد شود (ستارهٔ ابدی)',
      filled.status < 300, 'status=' + filled.status + ' ' + filled.text.slice(0, 250));
    if (filled.json?.id) {
      const back = (await api(`/visits/${filled.json.id}`)).json;
      ok('و شرح واقعاً ذخیره شد (از `ClinicalNote` برمی‌گردد)',
        back?.opReport === 'شرحِ کاملِ عمل.', JSON.stringify(back?.opReport));
      await api(`/visits/${filled.json.id}`, { method: 'DELETE' });
    }
    await api(`/forms/fields/${rep.id}`, { method: 'PATCH', body: { required: false } });
  }
}

console.log('\n──────────────────────────────');
console.log(`قبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
