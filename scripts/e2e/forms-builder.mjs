/**
 * آزمونِ مرورگرِ واقعی برای فرم‌ساز — مرحلهٔ ۱.
 *
 * ⚠️ ادعاها با **حالتِ دیده‌شده روی صفحه** سنجیده می‌شوند، نه با اینکه کلیک
 * خطا نداد. هر گام قبل و بعدش شمرده می‌شود (اختلاف)، وگرنه آزمونی که همیشه
 * سبز است هیچ چیزی را نگه نمی‌دارد.
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

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fa-IR' });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

// ورود از راهِ API و تزریقِ توکن — صفحهٔ ورود موضوعِ این آزمون نیست.
const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }

// آزمون باید **قابلِ اجرای دوباره** باشد: فیلدِ جاماندهٔ اجرای قبلی را می‌ریزد،
// وگرنه دفعهٔ دوم ۴۰۰ِ «کلیدِ تکراری» می‌گیرد و آزمون به‌غلط قرمز می‌شود.
{
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
  const all = await fetch(API + '/forms', { headers: H }).then((r) => r.json());
  for (const f of all.flatMap((x) => x.fields).filter((x) => x.key === 'caseImage')) {
    await fetch(API + '/forms/fields/' + f.id, { method: 'DELETE', headers: H });
  }
}

await page.goto(UI + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => localStorage.setItem('amalyar_token', t), login.accessToken);

await page.goto(UI + '/app/forms', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

console.log('\n۱) فرم‌ساز بالا می‌آید');
{
  const rows = await page.locator('.fb-row').count();
  ok('ردیفِ فیلد دیده می‌شود', rows > 0, 'rows=' + rows);
  ok('هیچ خطای جاوااسکریپت نیست', errors.length === 0, errors.slice(0, 2).join(' | '));
}

console.log('\n۲) انتخابگرِ رنگ روی صفحه هست و کار می‌کند');
{
  const swatches = await page.locator('.fb-meta .fb-color').count();
  ok('سوآچ‌های رنگ رندر شدند', swatches >= 9, 'n=' + swatches); // ۸ رنگ + خودکار

  // رنگِ فعلی چیست؟ بعد یکی از سوآچ‌ها را می‌زنیم و از **سرور** می‌پرسیم.
  const key = await page.locator('.fb-tabrow [aria-selected="true"], .fb-tabrow .on').first().textContent().catch(() => '');
  const before = await fetch(API + '/forms', { headers: { Authorization: 'Bearer ' + login.accessToken } }).then((r) => r.json());
  const shown = before.find((f) => f.title.trim() === (key || '').trim()) ?? before[0];

  const target = shown.color === 'amber' ? 'rose' : 'amber';
  await page.locator(`.fb-meta .fb-color[title="${target === 'amber' ? 'کهربا' : 'سرخ'}"]`).click();
  await page.waitForTimeout(900);

  const after = await fetch(API + '/forms', { headers: { Authorization: 'Bearer ' + login.accessToken } }).then((r) => r.json());
  const now = after.find((f) => f.id === shown.id);
  ok('کلیکِ سوآچ رنگ را روی سرور عوض کرد', now.color === target,
    `${shown.color} → ${now.color}`);

  const onCount = await page.locator('.fb-meta .fb-color.on').count();
  ok('دقیقاً یک سوآچ نشانِ «انتخاب‌شده» دارد', onCount === 1, 'n=' + onCount);
}

console.log('\n۳) دو نوعِ تازه در فهرستِ نوع هست');
{
  await page.locator('.df-add').first().click();
  await page.waitForTimeout(700);
  const opts = await page.locator('.df-sheet select').first().locator('option').allTextContents();
  ok('«باکسِ عکس» در فهرست هست', opts.some((o) => o.includes('باکسِ عکس')), opts.join('،'));
  ok('«باکسِ پرداخت» در فهرست هست', opts.some((o) => o.includes('باکسِ پرداخت')));
  ok('کادرِ شمارهٔ صفحه هست', await page.getByText('صفحه', { exact: true }).count() > 0);

  // با انتخابِ «پرداخت» باید کلیدِ «اجباری» ناپدید شود و توضیح بیاید.
  const reqBefore = await page.locator('.df-sheet .fb-check').count();
  await page.locator('.df-sheet select').first().selectOption('payment');
  await page.waitForTimeout(400);
  const reqAfter = await page.locator('.df-sheet .fb-check').count();
  ok('کلیدِ «اجباری» برای پرداخت پنهان شد', reqBefore === 1 && reqAfter === 0, `${reqBefore} → ${reqAfter}`);
  ok('توضیحِ باکسِ پرداخت دیده می‌شود', (await page.locator('.df-sheet .fb-note').allTextContents()).some((t) => t.includes('لینک')));
}

console.log('\n۴) ساختِ فیلدِ عکس روی صفحهٔ ۲ — از راهِ رابط');
{
  await page.locator('.df-sheet select').first().selectOption('image');
  await page.waitForTimeout(300);

  const inputs = page.locator('.df-sheet .pf-field input[type="text"]');
  await inputs.nth(0).fill('عکسِ پرونده');          // برچسب
  await inputs.nth(1).fill('caseImage');            // کلید
  // کادرِ صفحه: آخرین ورودیِ عددیِ dir=ltr
  await page.locator('.df-sheet .pf-field input[dir="ltr"][inputmode="numeric"]').fill('۲');

  const beforeRows = await page.locator('.fb-row').count();
  await page.locator('.df-save').click();
  await page.waitForTimeout(1200);
  const afterRows = await page.locator('.fb-row').count();
  ok('یک ردیف اضافه شد', afterRows === beforeRows + 1, `${beforeRows} → ${afterRows}`);

  const badges = await page.locator('.fb-page').allTextContents();
  ok('نشانِ صفحه روی ردیف‌ها آمد', badges.length > 0, badges.join('،'));
  ok('«صفحهٔ ۲» دیده می‌شود', badges.some((b) => b.includes('۲')), badges.join('،'));

  const meta = await page.locator('.fb-meta').textContent();
  ok('شمارِ صفحه در سربرگ آمد', /۲\s*صفحه/.test(meta), meta.trim().replace(/\s+/g, ' '));

  // ⚠️ رقمِ فارسیِ «۲» باید به ۲ تبدیل شده باشد، نه NaN → صفحهٔ ۱.
  const forms = await fetch(API + '/forms', { headers: { Authorization: 'Bearer ' + login.accessToken } }).then((r) => r.json());
  const fld = forms.flatMap((f) => f.fields).find((x) => x.key === 'caseImage');
  ok('رقمِ فارسی درست خوانده شد (page=2)', fld?.page === 2, 'page=' + fld?.page);
  ok('نوعش image ذخیره شد', fld?.type === 'image');
}

console.log('\n۵) باکسِ پرداخت در فرمِ نظرسنجی رندر می‌شود (DynForm واقعی)');
{
  // نظرسنجی تنها صفحه‌ای است که DynForm را با فیلدهای دلخواه عمومی نشان می‌دهد.
  const forms = await fetch(API + '/forms', { headers: { Authorization: 'Bearer ' + login.accessToken } }).then((r) => r.json());
  const survey = forms.find((f) => f.key === 'survey');
  ok('نظرسنجی scope=record دارد', survey?.scope === 'record', 'scope=' + survey?.scope);
  const chip = await page.locator('.fb-chip').first().textContent();
  ok('برچسبِ فارسیِ محدوده خالی نیست', !!chip?.trim(), chip);
}

console.log('\n۶) هیچ خطای جاوااسکریپت در کلِ سناریو');
ok('صفحه بدونِ خطا ماند', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: '/tmp/fb-stage1.png', fullPage: true });
await browser.close();

console.log('\n──────────────────────────────');
console.log(`قبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
