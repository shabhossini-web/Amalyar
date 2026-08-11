/**
 * مرحلهٔ ۲ — لینکِ ثبت‌نام به فرم و به حسابِ بانکی وصل می‌شود.
 *
 * ⚠️ **هر ادعا با حالتِ برگشتیِ سرور سنجیده می‌شود، نه با «۲۰۰ گرفت».** همهٔ
 * خرابی‌های این مرحله بی‌صدا هستند: ستونی که نوشته می‌شود و خوانده نمی‌شود،
 * فرمی که حذف می‌شود و لینک را بی‌صدا به مسیرِ قدیمی برمی‌گرداند، مبلغی که
 * صفر ذخیره می‌شود. یک آزمونِ status-only همهٔ این‌ها را سبز نشان می‌دهد.
 *
 * اجرا: `node scripts/e2e/link-form.mjs` (راه‌اندازیِ محیط در README همین پوشه).
 */
const API = 'http://localhost:3101/api';
let TOKEN = '';
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch { /* غیرJSON */ }
  return { status: r.status, json, text: t };
}

TOKEN = (await api('/auth/login', { method: 'POST', body: { identifier: 'admin', password: 'test1234' } })).json?.accessToken;
if (!TOKEN) { console.error('ورود نشد'); process.exit(1); }

// ── آماده‌سازیِ تکرارپذیر ───────────────────────────────────────────────────
// لینک‌های اجرای قبلی غیرفعال می‌شوند (DELETE ندارند) و فرم‌ها پاک.
for (const l of (await api('/intake/links')).json.filter((x) => /^\[e2e]/.test(x.title))) {
  await api(`/intake/links/${l.id}`, { method: 'PATCH', body: { title: '[e2e-old] ' + l.id, active: false, formId: 0, bankAccountId: 0 } });
}
/* ⚠️ کلیدِ فرمِ **مراجعه** پیشوندِ `visit.` می‌گیرد (`createForm`)، پس الگوی
   `^e2elink` آن را جا می‌گذاشت و اجرای دوم «کلید تکراری» می‌گرفت — و بدتر:
   `visitForm.id` برابرِ undefined می‌شد و ادعای «فرمِ مراجعه رد می‌شود» بدونِ
   اینکه چیزی سنجیده شود، سبز به‌نظر می‌رسید. */
for (const f of (await api('/forms')).json.filter((x) => /(^|\.)e2elink/.test(x.key))) {
  await api(`/forms/${f.id}`, { method: 'DELETE' });
}

/**
 * کدِ ملیِ معتبر و **یکتا به‌ازای هر اجرا**.
 *
 * ⚠️ کدِ ثابت یعنی اجرای دوم ۴۰۹ می‌گیرد («این کد ملی به پروندهٔ … تعلق دارد»)
 * و آزمون به‌غلط قرمز می‌شود. رقمِ کنترلی هم واقعاً حساب می‌شود چون
 * `register` همان اعتبارسنجیِ مسیرِ ادمین را دارد.
 */
function nid(seed) {
  const base = String(seed % 1_000_000_000).padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
  const r = sum % 11;
  return base + String(r < 2 ? r : 11 - r);
}
/* از ساعتِ اجرا مشتق می‌شود تا دو اجرای پشتِ‌هم به هم نخورند. */
const RUN = Math.floor(Date.now() / 1000) % 100_000_000;

// فرمِ ثبت‌نامِ بدونِ پرداخت، و یکی با باکسِ پرداخت
const plain = (await api('/forms', { method: 'POST', body: { key: 'e2elinkPlain', title: '[e2e] فرمِ ساده', scope: 'intake' } })).json;
const payForm = (await api('/forms', { method: 'POST', body: { key: 'e2elinkPay', title: '[e2e] فرمِ پرداخت‌دار', scope: 'intake' } })).json;
await api(`/forms/${payForm.id}/fields`, { method: 'POST', body: { key: 'pay', label: 'پرداخت', type: 'payment' } });
// فرمِ مراجعه — نباید پشتِ لینک قبول شود
const visitForm = (await api('/forms', { method: 'POST', body: { key: 'e2elinkVisit', title: '[e2e] مراجعه', scope: 'visit' } })).json;

console.log('\n۱) گزینه‌های لینک — فقط فرمِ ثبت‌نام، فقط حسابِ علامت‌خورده');
{
  const o = (await api('/intake/link-options')).json;
  ok('endpoint پاسخ می‌دهد', !!o?.forms, JSON.stringify(o).slice(0, 120));
  ok('فرمِ ثبت‌نام در فهرست هست', o.forms.some((f) => f.id === plain.id));
  ok('فرمِ مراجعه در فهرست **نیست**', !o.forms.some((f) => f.id === visitForm.id),
    o.forms.map((f) => f.title).join('،'));
  ok('hasPayment برای فرمِ پرداخت‌دار true است', o.forms.find((f) => f.id === payForm.id)?.hasPayment === true);
  ok('hasPayment برای فرمِ ساده false است', o.forms.find((f) => f.id === plain.id)?.hasPayment === false);
  ok('حساب‌ها فقط برچسب دارند، بدونِ شماره',
    o.banks.every((b) => Object.keys(b).sort().join(',') === 'id,label'),
    JSON.stringify(o.banks[0] ?? {}));
}

// حسابِ آزمون: یکی علامت‌خورده، یکی نه
const pub = (await api('/bank-accounts', {
  method: 'POST',
  body: { ownerName: '[e2e] حسابِ عمومی', bankName: 'ملت', cardNumber: '6104111122223333', accountNumber: '1234567890', iban: '820120000000001234567890', showOnIntake: true },
})).json;
const priv = (await api('/bank-accounts', {
  method: 'POST', body: { ownerName: '[e2e] حسابِ خصوصی', bankName: 'سامان', cardNumber: '6219999988887777' },
})).json;

console.log('\n۲) ساختِ لینک با فرم و حساب');
let link;
{
  const r = await api('/intake/links', {
    method: 'POST',
    body: { title: '[e2e] لینکِ پرداخت‌دار', amount: 500000, formId: payForm.id, bankAccountId: pub.id },
  });
  ok('لینک ساخته شد', r.status < 300, r.status + ' ' + r.text.slice(0, 160));
  link = r.json;
  ok('formId ذخیره شد', link?.formId === payForm.id, 'formId=' + link?.formId);
  ok('bankAccountId ذخیره شد', link?.bankAccountId === pub.id, 'bank=' + link?.bankAccountId);
  ok('مبلغ درست ماند', link?.amount === 500000, 'amount=' + link?.amount);

  const list = (await api('/intake/links')).json.find((x) => x.id === link.id);
  ok('فهرست برچسبِ فرم را می‌دهد (نه فقط id)', list?.formTitle === '[e2e] فرمِ پرداخت‌دار', 'formTitle=' + list?.formTitle);
  ok('فهرست برچسبِ حساب را می‌دهد', list?.bankLabel === '[e2e] حسابِ عمومی — ملت', 'bankLabel=' + list?.bankLabel);
  ok('formHasPayment در فهرست هست', list?.formHasPayment === true);
  ok('bankHidden فعلاً false است', list?.bankHidden === false);
}

console.log('\n۳) اعتبارسنجیِ سمتِ سرور — فیلترِ کلاینت کافی نیست');
{
  const a = await api('/intake/links', { method: 'POST', body: { title: '[e2e] بد ۱', formId: visitForm.id } });
  ok('فرمِ مراجعه پشتِ لینک رد می‌شود', a.status === 400, a.status + ' ' + a.text.slice(0, 140));

  const b = await api('/intake/links', { method: 'POST', body: { title: '[e2e] بد ۲', formId: payForm.id, bankAccountId: priv.id } });
  ok('حسابِ علامت‌نخورده رد می‌شود', b.status === 400, b.status + ' ' + b.text.slice(0, 140));
  ok('پیامِ خطا فارسی و راهنماست', /حسابداری/.test(b.text), b.text.slice(0, 160));

  const c = await api('/intake/links', { method: 'POST', body: { title: '[e2e] بد ۳', formId: 999999 } });
  ok('فرمِ ناموجود رد می‌شود', c.status === 400, 'status=' + c.status);
}

console.log('\n۴) whitelistِ ValidationPipe — ستونِ بی‌صدا خالی نماند');
{
  // اگر DTO فیلد را اعلام نکرده باشد، این تست سبز می‌ماند ولی ستون null است.
  const r = await api('/intake/links', { method: 'POST', body: { title: '[e2e] whitelist', formId: plain.id } });
  ok('formId از whitelist رد شد و نشست', r.json?.formId === plain.id, 'formId=' + r.json?.formId);
}

console.log('\n۵) فرمی که یک لینک می‌فرستدش حذفِ سخت نمی‌شود');
{
  const del = await api(`/forms/${payForm.id}`, { method: 'DELETE' });
  ok('حذف به «خاموش‌کردن» تبدیل شد', del.json?.deactivated === true, JSON.stringify(del.json));
  ok('دلیلش لینک است نه مراجعه', del.json?.links >= 1 && del.json?.visits === 0, JSON.stringify(del.json));

  const still = (await api('/intake/links')).json.find((x) => x.id === link.id);
  ok('لینک هنوز به همان فرم وصل است', still?.formId === payForm.id, 'formId=' + still?.formId);

  // و دوباره روشنش کن تا بقیهٔ آزمون کار کند
  await api(`/forms/${payForm.id}`, { method: 'PATCH', body: { active: true } });
}

console.log('\n۶) فرمِ عمومی شماره‌های **همین حساب** را می‌بیند');
{
  const reg = await api(`/public/intake/link/${link.token}/register`, {
    method: 'POST',
    body: {
      firstName: 'آزمون', lastName: 'لینک', nationalId: nid(RUN * 7 + 13), phone: '09120000011',
      captchaA: 3, captchaB: 4, captchaAnswer: 7,
    },
  });
  // کپچا ممکن است رد شود؛ اگر شد، مستقیم از publicView استفاده نمی‌کنیم.
  if (reg.status >= 300) {
    console.log('    (ثبت‌نامِ عمومی رد شد: ' + reg.text.slice(0, 100) + ')');
    ok('ثبت‌نامِ عمومی انجام شد', false, 'status=' + reg.status);
  } else {
    const v = reg.json;
    ok('payTo فقط یک حساب دارد', v.payTo?.length === 1, 'n=' + v.payTo?.length);
    ok('همان حسابِ انتخاب‌شده است', v.payTo?.[0]?.id === pub.id, 'id=' + v.payTo?.[0]?.id);
    ok('شمارهٔ حساب هم برمی‌گردد', v.payTo?.[0]?.accountNumber === '1234567890', JSON.stringify(v.payTo?.[0]));
    ok('حسابِ خصوصی در فهرست نیست', !v.payTo?.some((b) => b.id === priv.id));
  }
}

console.log('\n۷) fallback — لینکِ بدونِ حساب همان فهرستِ سراسری را می‌دهد');
{
  const bare = (await api('/intake/links', { method: 'POST', body: { title: '[e2e] بی‌حساب', amount: 1000 } })).json;
  const reg = await api(`/public/intake/link/${bare.token}/register`, {
    method: 'POST',
    body: { firstName: 'آزمون', lastName: 'بی‌حساب', nationalId: nid(RUN * 11 + 29), phone: '09120000012', captchaA: 5, captchaB: 6, captchaAnswer: 11 },
  });
  if (reg.status < 300) {
    ok('لینکِ بدونِ حساب شماره دارد (fallback)', (reg.json.payTo?.length ?? 0) >= 1, 'n=' + reg.json.payTo?.length);
  } else {
    ok('ثبت‌نامِ لینکِ بی‌حساب انجام شد', false, reg.text.slice(0, 120));
  }
}

console.log('\n۸) برداشتنِ حساب از فرمِ بیمار روی لینک‌های ساخته‌شده اثر دارد');
{
  await api(`/bank-accounts/${pub.id}/public`, { method: 'PATCH', body: { showOnIntake: false } });
  const list = (await api('/intake/links')).json.find((x) => x.id === link.id);
  ok('فهرستِ ادمین هشدار می‌دهد (bankHidden)', list?.bankHidden === true, 'bankHidden=' + list?.bankHidden);
  await api(`/bank-accounts/${pub.id}/public`, { method: 'PATCH', body: { showOnIntake: true } });
}

console.log('\n۹) ویرایشِ شماره‌های حساب — بدونِ ساختنِ حسابِ تکراری');
{
  const r = await api(`/bank-accounts/${pub.id}`, { method: 'PATCH', body: { accountNumber: '9876543210' } });
  ok('PATCH پذیرفته شد', r.status < 300, r.status + ' ' + r.text.slice(0, 140));
  ok('شمارهٔ حساب عوض شد', r.json?.accountNumber === '9876543210', 'acc=' + r.json?.accountNumber);
  ok('بقیهٔ فیلدها دست‌نخورده ماندند', r.json?.cardNumber === '6104111122223333' && r.json?.ownerName === '[e2e] حسابِ عمومی');
  ok('showOnIntake از این مسیر عوض نمی‌شود', r.json?.showOnIntake === true);
}

console.log('\n──────────────────────────────');
console.log(`قبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
