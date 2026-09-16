/**
 * W3.5 — فرم‌ساز: ردیفِ فشرده + ماتریسِ نقشِ یک‌جا + پنلِ کناری + پیش‌نمایشِ زنده (§۴.۷).
 *
 * مرورگرِ واقعی، API ساختگی (`lib/mock-ui.mjs`). قالبِ نمونه یک فرمِ ویزیتِ
 * پانزده‌فیلدی است — همان اندازه‌ای که نصبِ واقعی دارد و همان چیزی که معیارِ
 * پذیرشِ سند («قالبِ نمونهٔ ویزیت در موبایل < ۲۰۰۰px») درباره‌اش حرف می‌زند.
 *
 *  باید بیفتد (روی نسخهٔ قبلی نمی‌افتاد):
 *   - ارتفاعِ صفحه در موبایل زیرِ ۲۰۰۰px
 *   - هیچ چک‌باکسِ نقشی داخلِ ردیف‌ها نیست؛ نقش‌ها یک جدولِ فیلد × نقش‌اند
 *   - تیک‌زدن در ماتریس همان PATCHِ قبلی را می‌فرستد (یک نویسنده، نه دو مسیر)
 *   - پیش‌نمایش با همان `DynForm`ی که کاربر می‌بیند رندر می‌شود
 *   - تنظیماتِ فیلد روی دسکتاپ پنلِ کناری است، در موبایل شیتِ همیشگی
 *  نباید بیفتد:
 *   - کلیدِ «اجباری» همان‌جا و با همان درخواست کار می‌کند
 *   - فیلدِ هسته‌ای هنوز سطلِ زباله ندارد؛ ویرایش و روشن/خاموش سرِ جایشان‌اند
 *   - نقش‌های فیلد روی ردیف **دیده** می‌شوند (فقط تیک‌زدنشان جابه‌جا شده)
 */
import { startVite, launch, mockContext, hOverflow } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

/** قالبِ نمونهٔ ویزیت — پانزده فیلد، مثلِ seedِ حوزه. */
const FIELDS = [
  { key: 'surgeonId', label: 'جراح', type: 'select', builtin: true, roles: ['secretary'] },
  { key: 'hospitalId', label: 'بیمارستان', type: 'select', builtin: true, roles: ['secretary'] },
  { key: 'opDate', label: 'تاریخِ عمل', type: 'date', builtin: true, required: true, roles: ['secretary'] },
  { key: 'opStartTime', label: 'ساعتِ شروع', type: 'time', builtin: true },
  { key: 'amount', label: 'مبلغ', type: 'money', builtin: true, required: true },
  { key: 'chiefComplaint', label: 'شکایتِ اصلی', type: 'text' },
  { key: 'history', label: 'شرحِ حال', type: 'textarea', roles: ['doctor'] },
  { key: 'exam', label: 'شرحِ معاینه', type: 'textarea', roles: ['doctor'] },
  { key: 'bp', label: 'فشارِ خون', type: 'text', roles: ['nurse'] },
  { key: 'allergy', label: 'حساسیت', type: 'bool', roles: ['nurse'] },
  { key: 'severity', label: 'شدت', type: 'select', options: [{ v: 'low', l: 'کم' }, { v: 'high', l: 'زیاد' }] },
  { key: 'satisfaction', label: 'رضایت', type: 'rating' },
  { key: 'mri', label: 'تصاویرِ MRI', type: 'image', docCategory: 'imaging' },
  { key: 'labLinks', label: 'لینکِ آزمایش', type: 'links', docCategory: 'lab' },
  { key: 'notes', label: 'یادداشتِ داخلی', type: 'textarea', roles: ['doctor', 'nurse'] },
].map((f, i) => ({
  id: i + 1, active: true, required: false, page: 1, sort: i * 10,
  options: [], hint: null, placeholder: null, docCategory: null, roleLabel: null,
  ...f,
  role: f.roles?.[0] ?? null,
}));
const FORM = { id: 1, key: 'visit.clinic', title: 'ویزیتِ مطب', scope: 'visit', visitKind: 'clinic', color: 'violet', active: true, pages: 1, hint: '', fields: FIELDS };

const vite = await startVite(5195);
const browser = await launch();
try {
  /* ⚠️ سرورِ ساختگی باید **تغییر را اعمال کند**، نه همان فرمِ اول را پس بدهد:
     `apply()` پاسخِ سرور را منبعِ حقیقت می‌گیرد و فرمِ کهنه تیکِ تازه را همان
     لحظه برمی‌گرداند — که رفتارِ درستِ اپ است و فقط fixture را دروغ می‌کند. */
  let form = structuredClone(FORM);
  const reset = () => { form = structuredClone(FORM); };
  const handle = ({ path, method, body }) => {
    if (path === '/auth/me') return { id: 1, firstName: 'تست', lastName: 'مدیر', level: 6, status: 'active' };
    if (path === '/auth/accounts') return [];
    if (path === '/config') return { vertical: 'clinic', brand: {}, verticals: [{ key: 'clinic', label: 'مطب' }] };
    if (path === '/features') return [{ key: 'formgen', allowed: true }, { key: 'work', allowed: true }];
    if (path === '/work/counts') return { mine: 0, role: 0, overdue: 0, total: 0 };
    if (path.startsWith('/work')) return [];
    if (path === '/forms' && method === 'GET') return [form];
    if (path === '/procedure-types' || path === '/diagnoses') return [];
    const hit = /^\/forms\/fields\/(\d+)$/.exec(path);
    if (hit && method === 'PATCH') {
      const id = Number(hit[1]);
      form = { ...form, fields: form.fields.map((f) => (f.id === id
        ? { ...f, ...body, ...(body?.roles ? { role: body.roles[0] ?? null } : {}) }
        : f)) };
      return form;
    }
    if (method === 'PATCH' || method === 'POST') return form;
    return [];
  };

  console.log('۱) موبایل — سنجهٔ پذیرش: ارتفاعِ قالبِ نمونهٔ ویزیت');
  const m = await mockContext(browser, handle, { viewport: { width: 390, height: 844 } });
  const page = await m.context.newPage();
  page.setDefaultTimeout(9000);
  await page.goto(`${vite.base}/app/forms`, { waitUntil: 'networkidle' });
  await page.locator('.fb-row').first().waitFor();
  const rows = await page.locator('.fb-row').count();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  ok(rows === FIELDS.length, `${rows} ردیف برای ${FIELDS.length} فیلد`);
  ok(height < 2000, `ارتفاعِ صفحه ${height}px (معیار: زیرِ ۲۰۰۰px)`);
  ok((await hOverflow(page)) <= 1, 'بدونِ سرریزِ افقی');

  console.log('\n۲) نقش‌ها از ردیف برداشته شدند، ولی دیده می‌شوند');
  ok((await page.locator('.fb-row .fb-role-choices').count()) === 0, 'هیچ fieldsetِ نقشی در ردیف‌ها نیست');
  ok((await page.locator('.fb-row input[type=checkbox]').count()) === 0, 'هیچ چک‌باکسی در ردیف‌ها نیست');
  const examTag = await page.locator('.fb-row', { hasText: 'شرحِ معاینه' }).locator('.fb-tag.role').innerText();
  ok(examTag.includes('پزشک'), `نقشِ فیلد روی ردیف خوانده می‌شود («${examTag}»)`);
  const notesTag = await page.locator('.fb-row', { hasText: 'یادداشتِ داخلی' }).locator('.fb-tag.role').innerText();
  ok(notesTag.includes('پزشک') && notesTag.includes('پرستار'), `همهٔ نقش‌ها، نه فقط اولی («${notesTag}»)`);

  console.log('\n۳) ماتریسِ نقش‌ها — یک جدولِ فیلد × نقش');
  const matrix = page.locator('.fb-matrix');
  ok((await matrix.count()) === 1, 'یک ماتریس بالای فهرست');
  ok(!(await matrix.evaluate((el) => el.open)), 'بسته است (ارتفاعِ صفحه را برنمی‌گرداند)');
  await matrix.locator('summary').click();
  await matrix.locator('table').waitFor();
  const grid = await matrix.evaluate((el) => ({
    rows: el.querySelectorAll('tbody tr').length,
    cols: el.querySelectorAll('thead th').length,
    boxes: el.querySelectorAll('tbody input[type=checkbox]').length,
    checked: el.querySelectorAll('tbody input:checked').length,
    general: el.querySelectorAll('tbody tr.all').length,
  }));
  ok(grid.rows === FIELDS.length && grid.cols === 8, `جدول ${grid.rows}×${grid.cols - 1} (فیلد × نقش)`);
  ok(grid.boxes === FIELDS.length * 7, `${grid.boxes} خانهٔ تیک`);
  const preChecked = FIELDS.reduce((n, f) => n + (f.roles?.length ?? 0), 0);
  ok(grid.checked === preChecked, `تیک‌های موجود از داده می‌آیند (${grid.checked} از ${preChecked})`);
  ok(grid.general === FIELDS.filter((f) => !f.roles?.length).length, `فیلدهای عمومی نشان‌دار شدند (${grid.general})`);

  console.log('\n۴) تیکِ ماتریس همان درخواستِ قبلی را می‌فرستد');
  const before = m.writes.length;
  await matrix.locator('tbody tr').first().locator('input[type=checkbox]').first().check();
  await page.waitForTimeout(600);
  const w = m.writes[before];
  ok(w?.path === '/forms/fields/1' && w?.method === 'PATCH', `PATCH ${w?.path}`);
  ok(Array.isArray(w?.body?.roles) && w.body.roles.includes('doctor') && w.body.roles.includes('secretary'),
    `نقشِ تازه به نقش‌های قبلی اضافه شد (${JSON.stringify(w?.body?.roles)})`);

  console.log('\n۵) پیش‌نمایشِ زنده — همان DynFormِ کاربر');
  const prev = page.locator('.fb-preview');
  ok((await prev.count()) === 1 && !(await prev.evaluate((el) => el.open)), 'هست و بسته است');
  await prev.locator('summary').click();
  await prev.locator('.pf.dyn').waitFor();
  const shown = await prev.locator('.pf.dyn > .pf-field').count();
  ok(shown === FIELDS.length, `${shown} کادر رندر شد`);
  await prev.locator('.pf-field', { hasText: 'شکایتِ اصلی' }).locator('input').fill('سردرد');
  ok((await prev.locator('.pf-field', { hasText: 'شکایتِ اصلی' }).locator('input').inputValue()) === 'سردرد', 'کادرِ پیش‌نمایش تایپ می‌پذیرد');
  ok(!m.writes.slice(before + 1).some((x) => x.path === '/forms' || x.path.startsWith('/visits')), 'پیش‌نمایش چیزی ذخیره نمی‌کند');

  console.log('\n۶) موبایل — تنظیماتِ فیلد شیت می‌ماند (نباید بیفتد)');
  await page.locator('.fb-row').first().locator('.df-act').first().click();
  await page.locator('.fb-side').waitFor();
  const mob = await page.locator('.fb-side').evaluate((el) => getComputedStyle(el).alignSelf);
  ok(mob !== 'stretch', `در موبایل کشیده نمی‌شود (align-self: ${mob})`);
  await page.keyboard.press('Escape');
  await page.locator('.fb-side').waitFor({ state: 'detached' });
  ok(true, 'با Escape بسته شد (W0.6 روی همین پنل هم کار می‌کند)');

  console.log('\n۷) کارهای همیشگیِ ردیف (نباید بیفتد)');
  const row = page.locator('.fb-row').first();
  ok((await row.locator('.fb-req').count()) === 1, 'کلیدِ «اجباری» سرِ جایش است');
  const before2 = m.writes.length;
  await row.locator('.fb-req').click();
  await page.waitForTimeout(500);
  const w2 = m.writes[before2];
  ok(w2?.path === '/forms/fields/1' && w2?.body?.required === true, 'اجباری‌کردن همان PATCHِ قبلی است');
  ok((await row.locator('.df-act').count()) === 2, 'فیلدِ هسته‌ای: ویرایش و روشن/خاموش، بدونِ سطلِ زباله');
  const custom = page.locator('.fb-row', { hasText: 'شکایتِ اصلی' });
  ok((await custom.locator('.df-act').count()) === 3, 'فیلدِ دلخواه سطلِ زباله دارد');
  ok(m.errors.length === 0, m.errors.length ? 'خطای JS: ' + m.errors[0] : 'بدونِ خطای JS');
  await m.context.close();

  console.log('\n۸) دسکتاپ — پنلِ کناری');
  reset();
  const d = await mockContext(browser, handle, { viewport: { width: 1280, height: 800 } });
  const dp = await d.context.newPage();
  dp.setDefaultTimeout(9000);
  await dp.goto(`${vite.base}/app/forms`, { waitUntil: 'networkidle' });
  await dp.locator('.fb-row').first().waitFor();
  await dp.locator('.fb-row').first().locator('.df-act').first().click();
  await dp.locator('.fb-side').waitFor();
  await dp.waitForTimeout(400);
  const side = await dp.locator('.fb-side').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    return { x: r.x, w: r.width, h: r.height, align: c.alignSelf, bodyScroll: getComputedStyle(el.querySelector('.df-sheet-body')).overflowY };
  });
  ok(side.align === 'stretch' && side.h > 800 * 0.9, `به لبه چسبیده و تمام‌قد است (${Math.round(side.h)}px)`);
  ok(side.x < 40, `در RTL به لبهٔ پایانی نشسته (x=${Math.round(side.x)})`);
  ok(side.w < 1280 * 0.45, `فهرست زیرش دیده می‌شود (عرضِ پنل ${Math.round(side.w)}px)`);
  ok(side.bodyScroll === 'auto', 'بدنهٔ پنل خودش اسکرول می‌شود');
  ok(d.errors.length === 0, d.errors.length ? 'خطای JS: ' + d.errors[0] : 'بدونِ خطای JS');
  await d.context.close();
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
