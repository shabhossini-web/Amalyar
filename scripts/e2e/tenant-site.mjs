/**
 * سایتِ عمومیِ شرکت (لندینگِ tenant) — چهار ادعا:
 *  ۱. **پیش‌فرض خاموش**: تا وقتی شرکت منتشر نکند، `/public/site` خاموش
 *     برمی‌گردد و ریشهٔ دامنه مثلِ همیشه به فرمِ ورود می‌رود.
 *  ۲. **مرزِ عمومی/خصوصی**: صفحهٔ عمومی بی‌احراز باز می‌شود ولی ویرایشگر ۴۰۱
 *     می‌دهد؛ هویتِ مالیاتی هرگز در خوراکِ عمومی نیست؛ بخشِ خاموش نه خودش
 *     می‌آید نه قلم‌هایش.
 *  ۳. **پیش‌فرض از کد**: شرکتِ بی‌ردیف هم متن و چیدمانِ کامل دارد، و چیدمان
 *     با حوزهٔ کاری فرق می‌کند (clinic = ۱۰ بخش).
 *  ۴. **رندرِ واقعی**: صفحه با همان متن‌ها بالا می‌آید، بی‌خطای JS، بی‌اسکرولِ
 *     افقی روی موبایل، و آکاردئونِ پرسش پس از کلیک **محو نمی‌شود**.
 *
 * پیش‌نیازها و راه‌اندازیِ محیط: `scripts/e2e/README.md`.
 * متغیرها: `E2E_API` (پیش‌فرض 3009) و `E2E_WEB` (پیش‌فرض 5173).
 */
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://127.0.0.1:3009/api';
const WEB = process.env.E2E_WEB ?? 'http://127.0.0.1:5173';
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? '  ok ' : 'FAIL '} ${name}${extra ? ` — ${extra}` : ''}`);
};

async function j(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

/** ثبت‌نام + ورود. اولین حسابِ سیستم خودکار سوپرادمینِ فعال است. */
async function signup(phone, username, password) {
  const r1 = await j('/auth/signup/request-otp', { method: 'POST', body: { phone } });
  const code = r1.data?.devCode;
  if (!code) throw new Error(`devCode نیامد: ${JSON.stringify(r1.data)}`);
  const r2 = await j('/auth/signup/verify-otp', { method: 'POST', body: { phone, code } });
  const signupToken = r2.data?.signupToken;
  if (!signupToken) throw new Error(`signupToken نیامد: ${JSON.stringify(r2.data)}`);
  const selfie = 'data:image/png;base64,' + 'A'.repeat(64);
  const r3 = await j('/auth/signup/complete', {
    method: 'POST',
    body: { signupToken, firstName: 'آزمون', lastName: 'کاربر', username, password, selfie },
  });
  return r3;
}

(async () => {
  // ── ① API ────────────────────────────────────────────────────
  const admin = await signup('09120000001', 'siteadmin', 'Passw0rd!');
  ok('ثبت‌نامِ سوپرادمین', admin.status === 201 || admin.status === 200, `status=${admin.status}`);
  const login = await j('/auth/login', { method: 'POST', body: { identifier: 'siteadmin', password: 'Passw0rd!' } });
  const token = login.data?.accessToken;
  ok('ورود و دریافتِ توکن', !!token, `status=${login.status}`);

  const pub0 = await j('/public/site');
  ok('سایتِ منتشرنشده خاموش است', pub0.data?.enabled === false, `enabled=${pub0.data?.enabled}`);

  const noAuth = await j('/site');
  ok('ویرایشگر بدونِ ورود ۴۰۱ می‌دهد', noAuth.status === 401, `status=${noAuth.status}`);

  const view = await j('/site', { token });
  ok('نمای ویرایشگر باز می‌شود', view.status === 200 && Array.isArray(view.data?.sections), `status=${view.status}`);
  ok('پیش‌فرضِ متن از کد می‌آید', !!view.data?.blocks?.hero_title, view.data?.blocks?.hero_title);
  ok('چیدمانِ clinic ۱۰ بخش دارد', view.data?.sections?.length === 10, `n=${view.data?.sections?.length}`);

  // محتوا
  const mk = (kind, body) => j('/site/items', { method: 'POST', token, body: { kind, ...body } });
  const svc = await mk('service', { title: 'کاشتِ ایمپلنت', body: 'با طرحِ درمانِ اختصاصی', icon: 'scalpel' });
  ok('افزودنِ خدمت', svc.status === 201 || svc.status === 200, `status=${svc.status}`);
  await mk('stat', { title: '۱۲ سال', subtitle: 'سابقهٔ فعالیت' });
  await mk('faq', { title: 'چقدر طول می‌کشد؟', body: 'بستگی به نوعِ درمان دارد.' });
  await mk('doctor', { title: 'دکتر نمونه', subtitle: 'جراحِ عمومی', body: 'عضوِ تیمِ درمان.' });
  await mk('testimonial', { title: 'م. رضایی', subtitle: 'تهران', body: 'برخوردِ خوب و پیگیریِ منظم.' });
  await mk('process', { title: 'مشاورهٔ اولیه', body: 'تماس و تعیینِ وقت.' });

  const badKind = await mk('__bogus', { title: 'x' });
  ok('نوعِ قلمِ نامعتبر رد می‌شود', badKind.status === 400, `status=${badKind.status}`);

  const badBlock = await j('/site/blocks', { method: 'PATCH', token, body: { values: { not_a_key: 'x' } } });
  ok('کلیدِ متنِ ناشناخته رد می‌شود', badBlock.status === 400, `status=${badBlock.status}`);

  const reserved = await j('/site/blocks', { method: 'PATCH', token, body: { values: { __published: '1' } } });
  ok('کلیدِ رزروشدهٔ انتشار از راهِ متن‌ها بسته است', reserved.status === 400, `status=${reserved.status}`);

  const blocks = await j('/site/blocks', {
    method: 'PATCH', token,
    body: { values: { hero_title: 'کلینیکِ آزمون', hero_title_accent: 'آزمون' } },
  });
  ok('ذخیرهٔ متن', blocks.status === 200 && blocks.data?.blocks?.hero_title === 'کلینیکِ آزمون', `status=${blocks.status}`);

  const pub1 = await j('/public/site');
  ok('پیش از انتشار هنوز خاموش است', pub1.data?.enabled === false, `enabled=${pub1.data?.enabled}`);

  const publish = await j('/site/publish', { method: 'PATCH', token, body: { published: true } });
  ok('انتشار', publish.status === 200 && publish.data?.published === true, `status=${publish.status}`);

  const pub2 = await j('/public/site');
  ok('سایتِ منتشرشده روشن است', pub2.data?.enabled === true);
  ok('متنِ ویرایش‌شده روی صفحهٔ عمومی است', pub2.data?.blocks?.hero_title === 'کلینیکِ آزمون', pub2.data?.blocks?.hero_title);
  ok('خدمت روی صفحهٔ عمومی است', (pub2.data?.items?.service ?? []).length === 1);
  ok('شناسهٔ ملی روی صفحهٔ عمومی نیست', !('nationalId' in (pub2.data?.brand ?? {})) && !('econCode' in (pub2.data?.brand ?? {})));

  // خاموش‌کردنِ یک بخش
  await j('/site/sections', { method: 'PATCH', token, body: { sections: [{ key: 'testimonials', enabled: false }] } });
  const pub3 = await j('/public/site');
  ok('بخشِ خاموش از صفحهٔ عمومی می‌رود', !pub3.data?.sections?.some((s) => s.key === 'testimonials'));
  ok('قلم‌های بخشِ خاموش هم نمی‌آیند', !('testimonial' in (pub3.data?.items ?? {})));

  // گیتِ سطح — کاربرِ تازه pending است و نباید ویرایشگر را ببیند
  await signup('09120000002', 'lowuser', 'Passw0rd!');
  const low = await j('/auth/login', { method: 'POST', body: { identifier: 'lowuser', password: 'Passw0rd!' } });
  if (low.data?.accessToken) {
    const denied = await j('/site', { token: low.data.accessToken });
    ok('کاربرِ کم‌سطح ویرایشگر را نمی‌بیند', denied.status === 403, `status=${denied.status}`);
  } else {
    ok('کاربرِ کم‌سطح اصلاً وارد نمی‌شود (pending)', true, `status=${low.status}`);
  }

  // ── ② مرورگر ─────────────────────────────────────────────────
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(WEB + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.tl', { timeout: 8000 }).catch(() => {});
  ok('ریشهٔ دامنه لندینگ را نشان می‌دهد', await page.locator('.tl').count() > 0, page.url());
  ok('تیترِ ویرایش‌شده روی صفحه است', (await page.locator('.tl-hero h1').innerText().catch(() => '')).includes('کلینیکِ آزمون'));
  ok('واژهٔ برجسته گرادیان گرفته', await page.locator('.tl-grad-text').count() > 0);
  ok('بخشِ خدمات رندر شده', await page.locator('#services .tl-svc').count() === 1);
  ok('بخشِ نظرها (خاموش) رندر نشده', await page.locator('.tl-testi').count() === 0);
  ok('دکمهٔ ورود در سربرگ هست', await page.locator('.tl-header a[href="/login"]').count() > 0);
  ok('بدونِ خطای جاوااسکریپت', errors.length === 0, errors[0] ?? '');

  /* ⚠️ نگهبانِ برخوردِ نام: مودیفایرهای دکمه (`lg`/`sm`/`ghost`) یک‌بار با
     `.lg`ِ صفحهٔ ورود (`min-height:100vh; display:grid`) برخورد کردند و دکمهٔ
     هیرو ۹۰۰ پیکسل بلند شد. هیچ تستِ APIای این را نمی‌گیرد. */
  const btnH = await page.locator('.tl-hero .tl-btn').first().evaluate((e) => e.getBoundingClientRect().height);
  ok('دکمهٔ هیرو ارتفاعِ طبیعی دارد', btnH > 30 && btnH < 90, `h=${Math.round(btnH)}px`);
  /* ⚠️ `inline-flex` روی یک flex-item به `flex` تبدیل می‌شود (blockification) —
     پس سنجه «خانوادهٔ flex» است نه رشتهٔ دقیق. چیزی که آن باگ ساخت `grid` بود. */
  const btnDisplay = await page.locator('.tl-hero .tl-btn').first().evaluate((e) => getComputedStyle(e).display);
  ok('دکمهٔ هیرو از خانوادهٔ flex است', /^(inline-)?flex$/.test(btnDisplay), btnDisplay);

  // بدونِ جاوااسکریپت هیچ متنی پنهان نیست
  const hiddenBeforeJs = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'tl-reveal';
    document.body.appendChild(probe);           // بیرونِ `.tl-js`
    const o = getComputedStyle(probe).opacity;
    probe.remove();
    return o;
  });
  ok('بیرونِ tl-js متن پنهان نمی‌شود', hiddenBeforeJs === '1', `opacity=${hiddenBeforeJs}`);

  // آکاردئونِ پرسش‌ها
  const faqItem = page.locator('.tl-faq-item').first();
  await page.locator('.tl-faq-q').first().click();
  await page.waitForTimeout(500);
  ok('آکاردئونِ پرسش باز می‌شود', await page.locator('.tl-faq-item.tl-open').count() === 1);
  /* ⚠️ **پرسشِ بازشده باید دیده بماند.** نشانهٔ reveal یک‌بار کلاس بود و
     رندرِ دوباره‌ی React پاکش می‌کرد؛ کاربر روی پرسش می‌زد و پرسش محو می‌شد. */
  ok('پرسشِ بازشده محو نمی‌شود', await faqItem.evaluate((e) => getComputedStyle(e).opacity) === '1',
    `opacity=${await faqItem.evaluate((e) => getComputedStyle(e).opacity)}`);
  ok('پاسخ پس از باز شدن ارتفاع دارد',
    await page.locator('.tl-faq-item.tl-open .tl-faq-a').evaluate((e) => e.getBoundingClientRect().height) > 10);

  // اسکرولِ کامل تا همهٔ بخش‌ها reveal شوند و اسکرین‌شات واقعی باشد
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
  });
  /* ⚠️ **انتظار تا نشستنِ شمارش، نه خوابِ ثابت.** IntersectionObserver ناهم‌گام
     است؛ با خوابِ ثابت، المانِ آخر گاهی می‌رسید و گاهی نه و همین سنجه خودش
     نوسان می‌کرد. */
  const allShown = await page
    .waitForFunction(
      () => document.querySelectorAll('.tl-reveal').length === document.querySelectorAll('.tl-reveal[data-tl-in]').length,
      null, { timeout: 6000 },
    ).then(() => true).catch(() => false);
  const revealed = await page.evaluate(() => ({
    total: document.querySelectorAll('.tl-reveal').length,
    shown: document.querySelectorAll('.tl-reveal[data-tl-in]').length,
  }));
  ok('همهٔ بخش‌ها پس از اسکرول دیده می‌شوند', allShown, `${revealed.shown}/${revealed.total}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: process.env.E2E_SHOTS ? process.env.E2E_SHOTS + '/site-landing.png' : '/tmp/shot-landing.png', fullPage: true });

  // موبایل
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto(WEB + '/', { waitUntil: 'networkidle' });
  await m.waitForSelector('.tl-hero h1', { timeout: 8000 }).catch(() => {});
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('موبایل: اسکرولِ افقی ندارد', overflow <= 1, `overflow=${overflow}px`);
  await m.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 300) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
  });
  const mShown = await m
    .waitForFunction(
      () => document.querySelectorAll('.tl-reveal').length === document.querySelectorAll('.tl-reveal[data-tl-in]').length,
      null, { timeout: 6000 },
    ).then(() => true).catch(() => false);
  ok('موبایل: همهٔ بخش‌ها دیده می‌شوند', mShown);
  await m.evaluate(() => window.scrollTo(0, 0));
  await m.waitForTimeout(400);
  await m.screenshot({ path: process.env.E2E_SHOTS ? process.env.E2E_SHOTS + '/site-landing-mobile.png' : '/tmp/shot-landing-mobile.png', fullPage: true });

  // ویرایشگر
  const app = await ctx.newPage();
  const appErrors = [];
  app.on('pageerror', (e) => appErrors.push(String(e)));
  await app.goto(WEB + '/login', { waitUntil: 'networkidle' });
  await app.evaluate((t) => localStorage.setItem('amalyar_token', t), token);
  await app.goto(WEB + '/app/site', { waitUntil: 'networkidle' });
  await app.waitForSelector('.st-publish', { timeout: 8000 }).catch(() => {});
  ok('ویرایشگر باز می‌شود', await app.locator('.st-publish').count() > 0, app.url());
  ok('وضعیتِ «منتشر شده» نشان داده می‌شود', (await app.locator('.st-publish b').innerText().catch(() => '')).includes('منتشر شده'));
  ok('فهرستِ چیدمان ۱۰ بخش دارد', await app.locator('.df-row').count() === 10, `n=${await app.locator('.df-row').count()}`);
  await app.locator('button:has-text("متن‌ها")').click();
  await app.waitForTimeout(400);
  ok('تبِ متن‌ها فرم دارد', await app.locator('.st-group .pf-field').count() > 0);
  /* ⚠️ کارت‌های گروهِ متن باید هم‌عرض باشند — داخلِ grid، بدونِ `width:100%`
     هر کدام تا اندازهٔ محتوای خودش جمع می‌شد و فهرست پله‌پله می‌شد. */
  const groupW = await app.locator('.st-group').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  ok('کارت‌های متن هم‌عرض‌اند', new Set(groupW).size === 1, groupW.join(','));
  ok('ویرایشگر بدونِ خطای جاوااسکریپت', appErrors.length === 0, appErrors[0] ?? '');
  await app.screenshot({ path: process.env.E2E_SHOTS ? process.env.E2E_SHOTS + '/site-editor.png' : '/tmp/shot-editor.png', fullPage: true });

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${failed.length ? `✗ ${failed.length} FAILED` : '✓ ALL PASS'} — ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e); process.exit(2); });
