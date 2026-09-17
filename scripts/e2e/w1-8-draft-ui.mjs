/**
 * W1.8 — نیمهٔ رابطِ پیش‌نویس (قراردادِ §۶؛ بخشِ باقی‌ماندهٔ W3.4 لِینِ ب).
 *
 * معیارِ پذیرشِ سند: **رفرش وسطِ صفحهٔ ۲ هیچ متنی را از دست ندهد؛ دادهٔ حساس
 * در `localStorage` نماند.** دومی به‌اندازهٔ اولی مهم است: این فرم دادهٔ پزشکیِ
 * بیمار را دارد و روی مرورگرِ مشترک/عمومی پر می‌شود.
 *
 *  باید بیفتد:
 *   - فرم روی همان صفحه‌ای باز شود که `_page` می‌گوید
 *   - رفتن به صفحهٔ بعد پیش‌نویس را با شمارهٔ صفحهٔ **تازه** بفرستد
 *   - نشانگر «ذخیره شد» را نشان دهد
 *   - شکستِ ذخیره «اتصال قطع است» بدهد، نه صفحهٔ شکسته
 *  نباید بیفتد:
 *   - هیچ کلیدی در `localStorage`/`sessionStorage` ننشیند
 *   - `_page`ِ بیرون از بازه صفحهٔ خالی نسازد
 */
import { startVite, launch, mockContext } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const FORM = {
  pages: 2, hint: null,
  fields: [
    { key: 'shekayat', label: 'شکایتِ اصلی', type: 'text', page: 1, required: true },
    { key: 'sabeghe', label: 'سابقهٔ بیماری', type: 'text', page: 2 },
  ],
};
const payload = (over = {}) => ({
  status: 'pending_fill', amount: 0, form: FORM, payTo: [], booking: { required: false },
  data: {}, patient: { firstName: 'بیمار', lastName: 'آزمایشی' },
  ...over,
});

const handleFor = (body, { failDraft = false } = {}) => ({ path, method }) => {
  /* پاسخِ غیر۲۰۰ در این helper **هر دو** کلیدِ `status` و `body` را می‌خواهد؛
     `{status}`ِ تنها به‌عنوانِ بدنهٔ ۲۰۰ برمی‌گردد و شکست اصلاً دیده نمی‌شود
     (اولین نسخهٔ همین سنجه به همین دلیل سبزِ توخالی بود). */
  if (path.endsWith('/draft')) {
    return failDraft ? { status: 503, body: { message: 'سرور در دسترس نیست' } }
      : { savedAt: new Date().toISOString() };
  }
  if (path.startsWith('/public/intake/form/')) return body;
  if (path === '/config') return { vertical: 'clinic', brand: { color: '#7c3aed' }, verticals: [] };
  if (path === '/auth/me') return { status: 401 };
  if (method !== 'GET') return {};
  return [];
};

const vite = await startVite(5295);
const browser = await launch();
/** خودِ helper هر درخواستِ تغییردهنده را در `writes` نگه می‌دارد — آرایهٔ موازی لازم نیست. */
const draftsOf = (c) => c.writes.filter((w) => w.path.endsWith('/draft')).map((w) => w.body ?? {});
const open = async (body, opts) => {
  const c = await mockContext(browser, handleFor(body, opts), { viewport: { width: 390, height: 844 } });
  const pg = await c.context.newPage();
  await pg.goto(vite.base + '/f/tok-draft', { waitUntil: 'networkidle' });
  return { c, pg };
};
const pageText = (pg) => pg.evaluate(() => document.querySelector('.ik-pages')?.textContent?.trim() ?? '');

try {
  console.log('\n۱) ادامه از همان صفحه‌ای که بیمار رویش بود');
  let { c, pg } = await open(payload({ data: { shekayat: 'کمردرد', _page: 2 } }));
  /* ⚠️ `includes('۲')` این‌جا **توخالی** است: «صفحهٔ ۱ از ۲» هم می‌گذرد. رگرسیونِ
     عمدی همین را لو داد — شمارهٔ **اول** سنجیده می‌شود نه هر ۲ای در رشته. */
  ok(/^صفحهٔ ۲\s/.test(await pageText(pg)), `**باید بیفتد:** روی صفحهٔ ۲ باز شد («${await pageText(pg)}»)`);
  ok(await pg.evaluate(() => !!document.querySelector('[name="sabeghe"], #sabeghe, [data-key="sabeghe"]')
      || document.body.innerText.includes('سابقهٔ بیماری')),
    'کادرِ همان صفحه رندر شد، نه صفحهٔ یک');
  ok(c.errors.length === 0, c.errors.length ? 'خطای JS: ' + c.errors[0] : 'بدونِ خطای JS');
  await c.context.close();

  console.log('\n۲) نباید بیفتد — هیچ‌چیز در حافظهٔ مرورگر');
  ({ c, pg } = await open(payload({ data: { shekayat: 'کمردرد', _page: 2 } })));
  const stored = await pg.evaluate(() => {
    const dump = (s) => { try { return Object.keys(s); } catch { return []; } };
    return { local: dump(localStorage), session: dump(sessionStorage) };
  });
  /* `amalyar_theme`/`density` انتخابِ تمِ کاربر است و `amalyar_accounts` کاشِ
     نمایشیِ فهرستِ حساب‌هاست که شِلِ اپ سراسری می‌نویسد — هیچ‌کدام پاسخِ بیمار
     نیستند. چیزی که قرارداد §۶ منع می‌کند همین پاسخ‌هاست. */
  const known = /^amalyar_(theme|density|accounts)$/;
  const leaked = [...stored.local, ...stored.session].filter((k) => !known.test(k));
  ok(leaked.length === 0,
    `**نباید بیفتد:** کلیدِ ناشناخته‌ای در حافظهٔ مرورگر ننشست (${leaked.join('، ') || 'هیچ'})`);
  const values = await pg.evaluate(() => {
    const all = (s) => { try { return Object.keys(s).map((k) => s.getItem(k)).join('|'); } catch { return ''; } };
    return all(localStorage) + '|' + all(sessionStorage);
  });
  ok(!values.includes('کمردرد'),
    '**نباید بیفتد:** خودِ متنِ تایپ‌شدهٔ بیمار در هیچ کلیدی نیست');
  await c.context.close();

  console.log('\n۳) نباید بیفتد — `_page`ِ بیرون از بازه صفحهٔ خالی نمی‌سازد');
  ({ c, pg } = await open(payload({ data: { _page: 99 } })));
  ok(/^صفحهٔ ۱\s/.test(await pageText(pg)), `به صفحهٔ ۱ برگشت («${await pageText(pg)}»)`);
  ok(await pg.evaluate(() => document.body.innerText.includes('شکایتِ اصلی')), 'کادرهای صفحهٔ ۱ رندر شدند');
  await c.context.close();

  console.log('\n۴) رفتن به صفحهٔ بعد، پیش‌نویس را با شمارهٔ تازه می‌فرستد');
  ({ c, pg } = await open(payload({ data: { shekayat: 'کمردرد' } })));
  await pg.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /بعد|ادامه/.test(b.textContent))?.click());
  await pg.waitForFunction(() => document.querySelector('.ik-draft'), { timeout: 5000 }).catch(() => {});
  const sent = draftsOf(c);
  ok(sent.some((b) => b.page === 2), `**باید بیفتد:** پیش‌نویس با صفحهٔ ۲ رفت (${JSON.stringify(sent.map(x => x.page))})`);
  ok(sent.some((b) => b.values?.shekayat === 'کمردرد'), 'پاسخِ صفحهٔ قبل هم همراهش رفت');
  const badge = await pg.evaluate(() => document.querySelector('.ik-draft')?.textContent?.trim() ?? '');
  ok(badge.includes('ذخیره شد'), `نشانگر «ذخیره شد» را نشان داد («${badge}»)`);
  ok(c.errors.length === 0, c.errors.length ? 'خطای JS: ' + c.errors[0] : 'بدونِ خطای JS');
  await c.context.close();

  console.log('\n۵) شکستِ ذخیره — پیام، نه صفحهٔ شکسته');
  ({ c, pg } = await open(payload({ data: { shekayat: 'کمردرد' } }), { failDraft: true }));
  await pg.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /بعد|ادامه/.test(b.textContent))?.click());
  await pg.waitForFunction(() => document.querySelector('.ik-draft.offline'), { timeout: 5000 }).catch(() => {});
  const off = await pg.evaluate(() => document.querySelector('.ik-draft')?.textContent?.trim() ?? '');
  ok(off.includes('اتصال قطع') && off.includes('این صفحه را نبندید'), `**نباید بیفتد:** شکست پیام داد نه خطا («${off}»)`);
  ok(await pg.evaluate(() => document.body.innerText.includes('سابقهٔ بیماری')),
    'و فرم سرِ جایش ماند — بیمار می‌تواند ادامه دهد');
  ok(c.errors.length === 0, c.errors.length ? 'خطای JS: ' + c.errors[0] : 'بدونِ خطای JS');
  await pg.screenshot({ path: 'scripts/e2e/.shots/w1-8-draft.png', fullPage: true });
  await c.context.close();
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
