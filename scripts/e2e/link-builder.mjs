/**
 * مرحلهٔ ۲ در مرورگرِ واقعی — سازندهٔ لینک.
 *
 * سناریوی خودِ کاربر: «کلیدِ ساختِ لینک را می‌زنم، اسم را تایپ می‌کنم، فرم را
 * از فرم‌های ساخته‌شده انتخاب می‌کنم، اگر فرم پرداخت دارد شمارهٔ حساب را هم
 * انتخاب می‌کنم، و لینک ساخته می‌شود.»
 */
import { chromium } from 'playwright-core';

const UI = 'http://127.0.0.1:5199';
const API = 'http://localhost:3101/api';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const api = (p, o = {}) => fetch(API + p, { headers: H, ...o, body: o.body ? JSON.stringify(o.body) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

// ── آماده‌سازیِ تکرارپذیر ───────────────────────────────────────────────────
for (const l of (await api('/intake/links')).json.filter((x) => /^\[ui]/.test(x.title))) {
  await api(`/intake/links/${l.id}`, { method: 'PATCH', body: { title: '[ui-old] ' + l.id, active: false, formId: 0, bankAccountId: 0 } });
}
for (const f of (await api('/forms')).json.filter((x) => /(^|\.)uilink/.test(x.key))) {
  await api(`/forms/${f.id}`, { method: 'DELETE' });
}
const plain = (await api('/forms', { method: 'POST', body: { key: 'uilinkPlain', title: '[ui] بدونِ پرداخت', scope: 'intake' } })).json;
const payForm = (await api('/forms', { method: 'POST', body: { key: 'uilinkPay', title: '[ui] با پرداخت', scope: 'intake' } })).json;
await api(`/forms/${payForm.id}/fields`, { method: 'POST', body: { key: 'pay', label: 'پرداخت', type: 'payment' } });
// یک حسابِ علامت‌خورده لازم است تا انتخابگرِ حساب گزینه داشته باشد
const banks = (await api('/intake/link-options')).json.banks;
if (!banks.length) {
  await api('/bank-accounts', {
    method: 'POST',
    body: { ownerName: '[ui] حسابِ آزمون', bankName: 'ملت', cardNumber: '6104000011112222', accountNumber: '55554444', showOnIntake: true },
  });
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 950 }, locale: 'fa-IR' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });

await page.goto(UI + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => localStorage.setItem('amalyar_token', t), login.accessToken);
await page.goto(UI + '/app/intake', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

console.log('\n۱) صفحهٔ ثبت‌نام و کلیدِ ساختِ لینک');
ok('صفحه بالا آمد', await page.locator('.ia-links').count() > 0);
ok('بدونِ خطای جاوااسکریپت', errors.length === 0, errors.slice(0, 2).join(' | '));

await page.locator('.ia-add').click();
await page.waitForTimeout(900);

console.log('\n۲) انتخابگرِ فرم هست و فرم‌های ساخته‌شده را نشان می‌دهد');
{
  const selects = page.locator('.ia-sheet select');
  ok('انتخابگرِ فرم رندر شد', await selects.count() >= 1, 'n=' + await selects.count());
  const opts = await selects.first().locator('option').allTextContents();
  ok('فرمِ «با پرداخت» در فهرست است', opts.some((o) => o.includes('[ui] با پرداخت')), opts.join('،'));
  ok('فرمِ «بدونِ پرداخت» هم هست', opts.some((o) => o.includes('[ui] بدونِ پرداخت')));
}

console.log('\n۳) انتخابگرِ حساب فقط برای فرمِ پرداخت‌دار دیده می‌شود');
{
  await page.locator('.ia-sheet select').first().selectOption(String(plain.id));
  await page.waitForTimeout(400);
  const noBank = await page.locator('.ia-sheet select').count();
  ok('با فرمِ بدونِ پرداخت، فقط یک انتخابگر هست', noBank === 1, 'n=' + noBank);

  await page.locator('.ia-sheet select').first().selectOption(String(payForm.id));
  await page.waitForTimeout(400);
  const withBank = await page.locator('.ia-sheet select').count();
  ok('با فرمِ پرداخت‌دار، انتخابگرِ حساب اضافه شد', withBank === 2, 'n=' + withBank);
  const label = await page.locator('.ia-sheet .ia-field').nth(3).textContent();
  ok('برچسبش دربارهٔ واریز است', /حساب/.test(label || ''), (label || '').slice(0, 60));
}

console.log('\n۴) مبلغِ فارسی — همان باگی که لینکِ «۰ تومان» می‌ساخت');
{
  const amountInput = page.locator('.ia-sheet input[inputmode="numeric"]');
  await amountInput.fill('۵۰۰۰۰۰');
  await page.waitForTimeout(400);
  const words = await page.locator('.ia-words').textContent().catch(() => '');
  ok('«به‌حروف» زیرِ مبلغ آمد', !!words?.trim(), words);
  ok('عدد درست خوانده شد (نه صفر)', /پانصد/.test(words || ''), words);

  // blur → گروه‌بندیِ سه‌رقمی
  await page.locator('.ia-sheet input').first().click();
  await page.waitForTimeout(300);
  const shown = await amountInput.inputValue();
  ok('در blur سه‌رقمی گروه‌بندی شد', shown.includes(','), 'value=' + shown);
}

console.log('\n۵) ساختِ لینک — و آنچه واقعاً در دیتابیس نشست');
{
  const before = (await api('/intake/links')).json.length;
  await page.locator('.ia-sheet input').first().fill('[ui] لینکِ ساخته‌شده');
  /* حساب را واقعاً انتخاب کن — وگرنه ادعای «حساب نشست» چیزی را نمی‌سنجد. */
  const bankSel = page.locator('.ia-sheet select').nth(1);
  const bankVals = await bankSel.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  await bankSel.selectOption(bankVals[0]);
  await page.waitForTimeout(300);
  await page.locator('.ia-sheet .ia-ok').click();
  await page.waitForTimeout(1500);

  const after = (await api('/intake/links')).json;
  ok('یک لینک اضافه شد', after.length === before + 1, `${before} → ${after.length}`);
  const made = after.find((l) => l.title === '[ui] لینکِ ساخته‌شده');
  ok('لینک پیدا شد', !!made);
  ok('فرمِ انتخاب‌شده نشست', made?.formId === payForm.id, 'formId=' + made?.formId);
  ok('حسابِ انتخاب‌شده نشست', made?.bankAccountId === Number(bankVals[0]), `bank=${made?.bankAccountId} expected=${bankVals[0]}`);
  ok('برچسبِ حساب از سرور می‌آید', !!made?.bankLabel, 'bankLabel=' + made?.bankLabel);
  /* ⚠️ ادعای اصلیِ این بخش: مبلغِ فارسی صفر نشد. */
  ok('مبلغ ۵۰۰۰۰۰ ذخیره شد، نه ۰', made?.amount === 500000, 'amount=' + made?.amount);
}

console.log('\n۶) ردیفِ لینک نشانِ فرم را نشان می‌دهد');
{
  await page.waitForTimeout(600);
  const chips = await page.locator('.ia-chip').allTextContents();
  ok('نشانِ فرم روی ردیف آمد', chips.some((c) => c.includes('[ui] با پرداخت')), chips.join(' | '));
}

console.log('\n۷) بدونِ خطای جاوااسکریپت در کلِ سناریو');
ok('صفحه بدونِ خطا ماند', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: '/tmp/link-builder.png', fullPage: true });
await browser.close();

console.log('\n──────────────────────────────');
console.log(`قبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
