/**
 * برگشت برای اصلاح / رد — داخلِ پاپ‌آپِ تأیید، با مرحله و دلیل؛ بنرِ اصلاح برای بیمار (مالک، ۱۴۰۵/۰۷/۰۱).
 * مرورگرِ واقعی، APIِ ساختگی (`lib/mock-ui.mjs`). قراردادِ سرور را `intake-return.mjs` می‌سنجد.
 *
 *  باید بیفتد:
 *   - دکمهٔ برگشت تا مرحله **و** دلیل پر نشده غیرفعال است
 *   - `{stage, note}` به سرور می‌رود؛ رد فقط `{note}`
 *   - توست می‌گوید پیامک در صف نشست یا شمارهٔ معتبری نبود — نه «انجام شد»ِ کلی
 *   - دکمه‌های ردیف پاپ‌آپ را روی همان تصمیم باز می‌کنند؛ هیچ `prompt`ِ مرورگری
 *   - برگشت‌های قبلی در پاپ‌آپ دیده می‌شوند
 *   - بیمار مرحله، دلیل و راهنما را در بنر می‌بیند
 *  نباید بیفتد:
 *   - «انصراف» به حالتِ تأیید برمی‌گردد
 *   - بی‌برگشتِ جاری، یادداشتِ قدیمیِ بازبین همان‌طور نشان داده می‌شود
 *   - پیامِ «فهرستِ بیمارستان باز نشد» زیرِ کادر کوچک است (تا دیروز `<p>`ِ بی‌استایل بود)
 */
import { startVite, launch, mockContext, hOverflow } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };
const row = (id, o = {}) => ({
  id, token: 't' + id, status: 'pending_approval', statusLabel: 'در انتظارِ تأیید', makesVisit: true, workflow: 'ionm', approvalKind: 'surgery',
  profileKind: 'company', service: 'ionm', serviceLabel: 'نورومانیتورینگ', serviceAmbiguous: false,
  amount: 2_000_000, payable: 2_000_000, discountAmount: 0, createdAt: '2026-09-23T08:00:00Z',
  data: { firstName: 'بیمار', lastName: String(id), surgeonName: 'دکتر آزمون', hospitalName: 'مرکز آزمون', procedure: 'فیوژن' },
  patient: { id: 10 + id, code: 'AM-00' + (10 + id), firstName: 'بیمار', lastName: String(id), phone: '0912000001' + id, nationalId: '001234567' + id },
  receipts: [], documents: [], returns: [], ...o,
});
const ROWS = [
  row(1, { returns: [{ stage: 'receipt', stageLabel: 'فیشِ واریزی', note: 'مبلغِ فیش کم بود', at: '2026-09-22T08:00:00Z' }] }),
  row(2),
];

/* `THEME=light` برای اسکرین‌شاتِ تمِ روشن (قانون ۲۳: معیار نگاه‌کردن است). */
const theme = (ctx) => process.env.THEME && ctx.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* about:blank */ } }, process.env.THEME);
const vite = await startVite(5221);
const browser = await launch();
try {
  const { context, writes, errors } = await mockContext(browser, ({ path, method }) => {
    if (path === '/auth/me') return { id: 1, level: 6, status: 'active', firstName: 'مدیر', lastName: 'تست' };
    if (path === '/config') return { vertical: 'ionm', kind: 'company', services: ['ionm'], serviceCatalog: [{ key: 'ionm', label: 'نورومانیتورینگ' }], brand: {} };
    if (path === '/features') return ['dashboard', 'formgen', 'definitions'].map((key) => ({ key, allowed: true }));
    if (path === '/intake/submissions') return ROWS;
    if (path === '/intake/links') return [];
    if (/^\/intake\/submissions\/\d+\/refs$/.test(path)) return {};
    if (path === '/intake/submissions/1/return' && method === 'POST') return { ok: true, status: 'pending_fill', stage: 'documents', sms: 'queued' };
    if (path === '/intake/submissions/2/reject' && method === 'POST') return { ok: true, sms: 'no_phone' };
    if (path === '/forms/types') return [];
    if (path.startsWith('/forms/visit.')) return { fields: ['surgeonId', 'hospitalId', 'opDate'].map((key) => ({ key, active: true, builtin: true })) };
    if (['/surgeons', '/hospitals', '/techs', '/procedure-types', '/bank-accounts'].includes(path)) return [];
    return undefined;
  });
  await theme(context);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await page.goto(`${vite.base}/app/intake`, { waitUntil: 'networkidle' });
  await page.locator('.ia-card').first().waitFor();
  const sheet = page.locator('.ia-sheet');
  const decide = sheet.locator('.ia-decide');

  console.log('۱) برگشت از دکمهٔ ردیف');
  await page.locator('.ia-card').nth(0).getByRole('button', { name: 'بازگرداندن', exact: true }).click();
  await decide.waitFor();
  ok(dialogs === 0, '**هیچ `prompt`ِ مرورگری** — تصمیم داخلِ پاپ‌آپ است');
  ok((await decide.locator('h3').innerText()).includes('بازگرداندن برای اصلاح'), 'پاپ‌آپ روی همان تصمیم باز شد');
  ok((await sheet.innerText()).includes('مبلغِ فیش کم بود') && (await sheet.innerText()).includes('فیشِ واریزی'), 'برگشتِ قبلی (مرحله و دلیل) دیده می‌شود');
  const radios = decide.getByRole('radio');
  ok((await radios.allInnerTexts()).map((t) => t.trim()).join('|') === 'اطلاعاتِ خدمت|مدارک|فیش|همه', 'چهار مرحله — هویت مرحله نیست', (await radios.allInnerTexts()).join('|'));
  const submit = decide.getByRole('button', { name: /بازگرداندن و ارسال/ });
  ok(await submit.isDisabled(), 'بی‌مرحله و بی‌دلیل غیرفعال');
  await decide.locator('textarea').fill('کارتِ ملی خوانا نیست');
  ok(await submit.isDisabled(), '**با دلیل ولی بی‌مرحله هنوز غیرفعال**');
  await decide.getByRole('radio', { name: 'مدارک' }).click();
  ok(await decide.getByRole('radio', { name: 'مدارک' }).getAttribute('aria-checked') === 'true', 'مرحلهٔ انتخاب‌شده aria-checked دارد');
  ok((await decide.innerText()).includes('دوباره بارگذاری'), 'اثرِ مرحله زیرش توضیح داده می‌شود');
  await decide.locator('textarea').fill('   ');
  ok(await submit.isDisabled(), 'دلیلِ فقط‌فاصله کافی نیست');
  await decide.locator('textarea').fill('کارتِ ملی خوانا نیست');
  ok(!(await submit.isDisabled()), 'مرحله + دلیل ← فعال');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-decide.png', fullPage: true });
  await submit.click();
  await sheet.waitFor({ state: 'detached' });
  const sent = writes.find((w) => w.path === '/intake/submissions/1/return');
  ok(JSON.stringify(sent?.body) === JSON.stringify({ stage: 'documents', note: 'کارتِ ملی خوانا نیست' }), '**`{stage, note}` به سرور رفت**', JSON.stringify(sent?.body));
  const toast = page.locator('.ia-toast.on');
  await toast.waitFor();
  ok((await toast.innerText()).includes('پیامک برای بیمار در صفِ ارسال است'), 'توست وضعیتِ پیامک را می‌گوید', await toast.innerText());

  console.log('\n۲) رد از دکمهٔ ردیف');
  await page.locator('.ia-card').nth(1).getByRole('button', { name: 'رد', exact: true }).click();
  await decide.waitFor();
  ok(await decide.getByRole('radio').count() === 0, 'رد مرحله ندارد');
  const rej = decide.getByRole('button', { name: /رد و ارسال/ });
  ok(await rej.isDisabled(), 'بی‌دلیل غیرفعال');
  await decide.locator('textarea').fill('این خدمت ارائه نمی‌شود');
  await rej.click();
  await sheet.waitFor({ state: 'detached' });
  ok(JSON.stringify(writes.find((w) => w.path === '/intake/submissions/2/reject')?.body) === JSON.stringify({ note: 'این خدمت ارائه نمی‌شود' }), 'فقط `{note}` رفت');
  await page.waitForFunction(() => document.querySelector('.ia-toast.on')?.textContent.includes('شمارهٔ معتبری'));
  ok((await toast.innerText()).includes('رد شد — شمارهٔ معتبری برای پیامک نبود'), '**بی‌شماره: توست همین را می‌گوید، نه «انجام شد»ِ کلی**', await toast.innerText());

  console.log('\n۳) از حالتِ تأیید به تصمیم و برگشت');
  await page.locator('.ia-card').nth(1).locator('.ia-facts').click();
  await sheet.waitFor();
  ok(await decide.count() === 0 && await sheet.getByRole('button', { name: /تأیید و ساختِ مراجعه/ }).count() === 1, 'کلیکِ ردیف حالتِ تأیید را باز می‌کند');
  await sheet.getByRole('button', { name: 'بازگرداندن برای اصلاح' }).click();
  await decide.waitFor();
  ok(await sheet.getByRole('button', { name: /تأیید و ساختِ مراجعه/ }).count() === 0, 'در حالتِ برگشت دکمهٔ تأیید نیست');
  await decide.getByRole('button', { name: 'انصراف' }).click();
  await decide.waitFor({ state: 'detached' });
  ok(await sheet.getByRole('button', { name: /تأیید و ساختِ مراجعه/ }).count() === 1, '«انصراف» به حالتِ تأیید برمی‌گردد');
  ok(await hOverflow(page) <= 0, 'بی‌اسکرولِ افقی در عرضِ موبایل');
  ok(errors.length === 0, 'بدونِ خطای JS', errors[0]);
  await context.close();

  console.log('\n۴) بنرِ بیمار');
  const view = (o) => ({
    token: 'tok', status: 'pending_payment', statusLabel: 'در انتظارِ واریز', booking: { required: false, appointment: null },
    makesVisit: true, amount: 2_000_000, discountCode: null, discountAmount: 0, payable: 2_000_000,
    data: { firstName: 'بیمار', lastName: 'آزمایشی' }, reviewNote: null, expiresAt: null, form: null, paymentNote: 'واریز کنید', payTo: [], ...o,
  });
  let current = view({ reviewNote: 'مبلغِ فیش کم است', returned: { stage: 'receipt', stageLabel: 'فیشِ واریزی', note: 'مبلغِ فیش کم است', at: '2026-09-23T08:00:00Z', hint: 'فیشِ تازه بارگذاری کنید؛ اطلاعات و مدارکِ قبلی سرِ جایشان هستند.' } });
  const pub = await mockContext(browser, ({ path, method }) => (path === '/public/intake/form/tok' && method === 'GET' ? current : undefined));
  await theme(pub.context);
  const p2 = await pub.context.newPage();
  p2.setDefaultTimeout(8000);
  await p2.goto(`${vite.base}/f/tok`, { waitUntil: 'networkidle' });
  const banner = p2.locator('.ik-returned');
  await banner.waitFor();
  const text = await banner.innerText();
  ok(text.includes('فیشِ واریزی') && text.includes('مبلغِ فیش کم است') && text.includes('فیشِ تازه بارگذاری کنید'), '**بیمار مرحله، دلیل و راهنما را می‌بیند**', text);
  ok(await p2.locator('.ik-warn', { hasText: 'مبلغِ فیش کم است' }).count() === 0, 'دلیل دوبار (بنر + یادداشت) تکرار نمی‌شود');
  if (process.env.SHOT) await p2.screenshot({ path: process.env.SHOT + '-banner.png', fullPage: true });
  /* فهرستِ بیمارستان در این ماک باز نمی‌شود — پیامش باید کوچکِ زیرِ کادر باشد، نه متنِ بدنه.
     از ۱۴۰۵/۰۷/۰۴ فهرست فقط هنگامِ تایپ خوانده می‌شود (کادرِ جست‌وجو، نه دیوارِ چیپ)، پس اول
     چیزی تایپ می‌شود. */
  /* در مرحلهٔ واریز فرمِ پرشده یک کارتِ خلاصه است (بازبینیِ UX، public-12)؛ کادرِ بیمارستان پشتِ «ویرایش» است. */
  if (await p2.locator('.ik-sum-edit').count()) await p2.locator('.ik-sum-edit').click();
  await p2.locator('.hospital-lookup input').fill('امام');
  const lookupNote = p2.locator('.hospital-lookup > p');
  await lookupNote.waitFor();
  ok(Number.parseFloat(await lookupNote.evaluate((el) => getComputedStyle(el).fontSize)) <= 13, 'پیامِ «فهرست باز نشد» استایل دارد (نه قلمِ درشتِ بدنه)');
  current = view({ reviewNote: 'یادداشتِ قدیمی' });
  await p2.reload({ waitUntil: 'networkidle' });
  const old = p2.locator('.ik-warn', { hasText: 'یادداشتِ قدیمی' });
  await old.waitFor();
  ok(await banner.count() === 0 && await old.count() === 1, 'بی‌برگشتِ جاری، یادداشتِ قبلی همان‌طور');
  ok(pub.errors.length === 0, 'بدونِ خطای JS', pub.errors[0]);
  await pub.context.close();
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nقبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
