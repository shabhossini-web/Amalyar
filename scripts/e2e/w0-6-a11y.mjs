/**
 * W0.6 — صفحه‌کلید و صفحه‌خوان در primitiveهای مشترک (`src/ui/Overlay.jsx`, `src/ui/Tabs.jsx`).
 *
 * مرورگرِ واقعی، API ساختگی (`lib/mock-ui.mjs`)، روی شیتِ واقعیِ مراجعه در داشبورد.
 *
 *  باید بیفتد (روی نسخهٔ قبلی):
 *   - شیت `role="dialog"` و `aria-modal` دارد و با باز شدن فوکوس به داخلش می‌آید
 *   - Tab داخلِ شیت می‌چرخد و به پشتِ پوشش نمی‌رود؛ Shift+Tab از اولی به آخری
 *   - Escape شیت را می‌بندد و هیچ پوششی نمی‌ماند؛ فوکوس به دکمهٔ بازکننده برمی‌گردد
 *   - تب‌ها roving tabindex دارند و با فلش/Home/End عوض می‌شوند (فیلترِ وضعیتِ همان داشبورد — گامِ ۱ِ شیت از
 *     بازبینیِ UX، clinic-daily-22، یک جست‌وجوی واحد است و تب ندارد)
 *  نباید بیفتد:
 *   - Escape روی تقویمِ بازِ داخلِ شیت فقط تقویم را می‌بندد، نه شیت را (لایه‌ها)
 *  نگهبانِ تغییرِ ذخیره‌نشده (بازبینیِ UX ۱۴۰۵/۰۷، clinic-daily-08):
 *   - کلیک روی پس‌زمینهٔ فرمِ بلندِ مراجعه **نمی‌بندد** (پیش از این می‌بست)
 *   - Escape روی شیتِ دست‌خورده پرسشِ `alertdialog` می‌دهد؛ Escapeِ پرسش = ادامهٔ ویرایش؛
 *     «دور ریختن» می‌بندد و هیچ پوششی نمی‌ماند
 */
import { startVite, launch, mockContext } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const visit = { id: 1, patientId: 1, kind: 'clinic', firstName: 'بیمار', lastName: 'آزمایشی', fullName: 'بیمار آزمایشی', phone: '09120000000', code: 'AM-001', seq: 1, decisions: [], opReport: '', amount: 0, paid: 0, due: 0, opStatus: 'pending' };
const record = { ...visit, clinicalVisible: true, visits: [visit], notes: [], clinicalNotes: [], documents: [], forms: [], visitTexts: [], counts: { visits: 1, notes: 0, documents: 0, forms: 0, notesByKind: {} } };

const vite = await startVite(5196);
const browser = await launch();
try {
  const { context, errors } = await mockContext(browser, ({ path, method }) => {
    if (path === '/auth/me') return { id: 1, firstName: 'تست', lastName: 'مدیر', level: 6, status: 'active' };
    if (path === '/auth/accounts') return [];
    if (path === '/config') return { vertical: 'clinic', brand: {}, verticals: [] };
    if (path === '/features') return [{ key: 'dashboard', allowed: true }];
    if (path === '/visits/1') return visit;
    if (path === '/visits') return { rows: [visit], total: 1, pages: 1, stats: { total: 1, pending: 1, today: 0, due: 0, kinds: [] } };
    if (path === '/forms/visit-kinds') return [{ key: 'clinic', title: 'ویزیت' }];
    if (path.startsWith('/forms/visit.')) return { fields: [{ key: 'opDate', builtin: true, active: true, label: 'تاریخ' }] };
    if (path === '/ai/status') return { enabled: false, stt: false };
    if (path === '/patients/1/record') return record;
    if (path === '/care-plan/timing') return {};
    if (method !== 'GET') return { id: 2 };
    return [];
  }, { viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const active = () => page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName, cls: a?.className ?? '', inSheet: !!a?.closest('.db-sheet'), isBody: a === document.body, isAdd: !!a?.classList?.contains('db-add'), isJd: !!a?.classList?.contains('jd-btn') };
  });
  const overlays = () => page.evaluate(() => document.querySelectorAll('[class*="overlay"]').length);
  const openSheet = async () => {
    await page.locator('.db-add').first().click();
    await page.locator('.db-sheet').waitFor();
    await page.waitForTimeout(450);
  };

  await page.goto(`${vite.base}/app/dashboard`, { waitUntil: 'networkidle' });
  await page.locator('.db-add').first().waitFor();

  console.log('۱) باز شدن — دیالوگ و فوکوس');
  await openSheet();
  const sheet = page.locator('.db-sheet');
  ok((await sheet.getAttribute('role')) === 'dialog' && (await sheet.getAttribute('aria-modal')) === 'true', 'role="dialog" و aria-modal="true"');
  let a = await active();
  ok(a.inSheet, `فوکوس داخلِ شیت است (${a.tag}.${String(a.cls).split(' ')[0]})`);

  console.log('\n۲) Tab داخلِ شیت می‌چرخد');
  /* فرمِ پروندهٔ تازه — گامِ ۱ با جست‌وجو باز می‌شود و کنترل‌های بیشتر پشتِ «ساختِ پروندهٔ تازه» است. */
  await page.locator('.db-sheet [data-act="new-record"]').click();
  await page.waitForFunction(() => !!document.activeElement?.closest('.db-sheet .db-grid2'), null, { timeout: 3000 }).catch(() => {});
  a = await active();
  ok(a.inSheet && a.tag === 'INPUT', `«ساختِ پروندهٔ تازه» فوکوس را به کادرِ «نام» می‌برد (${a.tag})`);
  const n = await page.evaluate(() => {
    const SEL = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
    return [...document.querySelector('.db-sheet').querySelectorAll(SEL)].filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden]')).length;
  });
  let escaped = 0;
  for (let i = 0; i < n + 3; i++) { await page.keyboard.press('Tab'); if (!(await active()).inSheet) escaped++; }
  ok(n > 3 && escaped === 0, `${n + 3} بار Tab، ${n} عنصرِ قابلِ فوکوس — فوکوس هیچ‌وقت از شیت بیرون نرفت (بیرون: ${escaped})`);
  await page.evaluate(() => {
    const SEL = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
    [...document.querySelector('.db-sheet').querySelectorAll(SEL)].filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden]'))[0].focus();
  });
  await page.keyboard.press('Shift+Tab');
  const wrapped = await page.evaluate(() => {
    const SEL = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
    const items = [...document.querySelector('.db-sheet').querySelectorAll(SEL)].filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden]'));
    return document.activeElement === items[items.length - 1];
  });
  ok(wrapped, 'Shift+Tab از اولین عنصر به آخرین می‌رود');

  console.log('\n۳) لایهٔ تودرتو — Escape فقط تقویم را می‌بندد (نباید بیفتد)');
  await page.locator('.db-sheet .jd-btn:visible').first().click();
  await page.locator('.jd-cal').waitFor();
  await page.waitForTimeout(300);
  a = await active();
  ok(!a.inSheet && !a.isBody, 'فوکوس به تقویم رفت');
  await page.keyboard.press('Escape');
  await page.locator('.jd-cal').waitFor({ state: 'detached' });
  await page.waitForTimeout(200);
  ok((await page.locator('.db-sheet').count()) === 1, 'شیت باز ماند');
  a = await active();
  ok(a.isJd, `فوکوس به دکمهٔ تقویم برگشت (${a.tag}.${String(a.cls).split(' ')[0]})`);

  console.log('\n۴) Escape شیت را می‌بندد و فوکوس برمی‌گردد');
  await page.keyboard.press('Escape');
  await page.locator('.db-sheet').waitFor({ state: 'detached' });
  await page.waitForTimeout(300);
  ok((await overlays()) === 0, 'هیچ پوششی نماند');
  a = await active();
  ok(a.isAdd, `فوکوس روی دکمهٔ «مراجعهٔ جدید» است (${a.tag}.${String(a.cls).split(' ')[0]})`);

  console.log('\n۵) فرمِ بلند: پس‌زمینه نمی‌بندد؛ نوشتهٔ ذخیره‌نشده اول پرسیده می‌شود');
  await openSheet();
  await page.locator('.db-overlay').click({ position: { x: 8, y: 8 } });
  await page.waitForTimeout(300);
  ok((await page.locator('.db-sheet').count()) === 1, 'کلیک روی پس‌زمینه شیتِ مراجعه را نبست');
  await page.locator('.db-sheet [data-act="new-record"]').click();
  const nameBox = page.locator('.db-sheet .db-grid2 input').first();
  await nameBox.fill('نوشته');
  await page.keyboard.press('Escape');
  const ask = page.locator('[role="alertdialog"]');
  await ask.waitFor();
  ok((await ask.getAttribute('aria-modal')) === 'true' && (await ask.locator('[data-unsaved]').count()) >= 2,
    'Escape روی شیتِ دست‌خورده پرسشِ «ذخیره‌نشده» را باز کرد (alertdialog)');
  await page.keyboard.press('Escape');
  await ask.waitFor({ state: 'detached' });
  ok((await page.locator('.db-sheet').count()) === 1 && (await nameBox.inputValue()) === 'نوشته',
    'Escapeِ پرسش = ادامهٔ ویرایش؛ شیت و نوشته سرِ جایشان');
  await page.locator('.db-sheet .db-x').click();
  await page.locator('[data-unsaved="discard"]').click();
  await page.locator('.db-sheet').waitFor({ state: 'detached' });
  await page.waitForTimeout(250);
  ok((await overlays()) === 0, '«دور ریختن» بست، بدونِ پوششِ باقی‌مانده');

  console.log('\n۶) تب‌ها — roving tabindex و کلیدهای جهت');
  /* همان `Tabs`ِ مشترک — فیلترِ وضعیتِ داشبورد (گامِ ۱ِ شیت دیگر تب ندارد؛ clinic-daily-22). */
  const tabs = page.locator('.db-filters:not(.db-kindfilter) button[role="tab"]');
  const nTabs = await tabs.count();
  ok(nTabs >= 2, `${nTabs} تب`);
  const tabState = () => tabs.evaluateAll((els) => els.map((b) => ({ sel: b.getAttribute('aria-selected'), ti: b.getAttribute('tabindex'), focused: b === document.activeElement })));
  let ts = await tabState();
  ok(ts[0].sel === 'true' && ts[0].ti === '0' && ts.slice(1).every((x) => x.ti === '-1'), 'فقط تبِ فعال tabindex=0 دارد');
  const rtl = await page.evaluate(() => getComputedStyle(document.querySelector('.db-filters')).direction === 'rtl');
  const nextKey = rtl ? 'ArrowLeft' : 'ArrowRight';
  const prevKey = rtl ? 'ArrowRight' : 'ArrowLeft';
  await tabs.nth(0).focus();
  await page.keyboard.press(nextKey);
  await page.waitForTimeout(150);
  ts = await tabState();
  ok(ts[1].sel === 'true' && ts[1].ti === '0' && ts[0].ti === '-1', `${nextKey} تبِ دوم را انتخاب کرد (${rtl ? 'RTL' : 'LTR'})`);
  await tabs.nth(1).focus();
  await page.keyboard.press(prevKey);
  await page.waitForTimeout(150);
  ts = await tabState();
  ok(ts[0].sel === 'true' && ts[0].focused, `${prevKey} به تبِ اول برگشت و فوکوس روی خودِ تب است`);
  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  ts = await tabState();
  ok(ts[nTabs - 1].sel === 'true', 'End آخرین تب را انتخاب کرد');
  await tabs.nth(nTabs - 1).focus();
  await page.keyboard.press('Home');
  await page.waitForTimeout(150);
  ts = await tabState();
  ok(ts[0].sel === 'true' && ts[0].focused, 'Home اولین تب را انتخاب کرد');

  console.log('\n۷) بدونِ خطای JS');
  ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  await context.close();
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
