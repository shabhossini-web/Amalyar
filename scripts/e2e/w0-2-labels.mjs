/**
 * W0.2 — برچسبِ `follow_up` در یادآوری‌ها + پیامِ پایانِ سفارش (D10b, D10c, B4).
 *
 * مرورگرِ واقعی، API ساختگی (`lib/mock-ui.mjs`).
 *
 *  باید بیفتد:
 *   - ردیفِ `follow_up` «فرمِ پیگیری» می‌خوانَد؛ کلیدِ ناشناختهٔ نوع/وضعیت هم خام دیده نمی‌شود
 *   - بعد از ثبتِ پاسخِ سفارش: «پاسخ ثبت شد؛ تیمِ درمان بررسی می‌کند» — نه «لازم نیست
 *     کارِ دیگری بکنید»، نه نویسهٔ «✓»
 *   - `needs_action` فرمِ پاسخ را دوباره باز می‌کند؛ `in_review`/`reviewed` نه (CONTRACTS §۴–۵)
 *  نباید بیفتد:
 *   - سفارشِ بی‌پاسخ همچنان فرم دارد و POST به همان نشانیِ قبلی با همان بدنه می‌رود
 *   - نامهٔ ارجاع همچنان نه فرم دارد نه پیام
 *   - برچسب‌های شناخته‌شدهٔ یادآوری دست نخورده‌اند
 */
import { startVite, launch, mockContext, hOverflow } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const KINDS = ['next_visit', 'surgery', 'appointment', 'pre_op_care', 'post_op_care', 'follow_up', 'notice', 'dispatch', 'zzz_unknown'];
const rows = KINDS.map((kind, i) => ({
  id: i + 1, kind, status: kind === 'zzz_unknown' ? 'weird_status' : 'pending', channel: 'sms',
  /* متنِ ردیف عمداً کلید را ندارد تا سنجهٔ «کلیدِ خام روی صفحه» خودِ fixture را نگیرد. */
  dueAt: '2026-09-17T08:00:00.000Z', sentAt: null, text: `پیامِ آزمایشیِ ${i + 1}`, phone: '09120000000',
  patientName: 'بیمار آزمایشی', recipientName: null, visitCode: 'AM-001-V1', deliveryStatus: null, providerId: null, error: null,
}));
const order = (o = {}) => ({ kind: 'lab', kindFa: 'درخواستِ آزمایش', clinic: 'مطبِ آزمایشی', summary: 'آزمایشِ CBC', note: null, dueDate: null, status: 'sent', answered: false, ...o });
const RAW = ['answered', 'needs_action', 'in_review', 'reviewed', 'follow_up', 'zzz_unknown', 'weird_status', 'pending'];

const vite = await startVite(5198);
const browser = await launch();
const seen = [];
try {
  let current = order();
  const { context, writes, errors } = await mockContext(browser, ({ path, method }) => {
    if (path === '/auth/me') return { id: 1, firstName: 'تست', lastName: 'مدیر', level: 6, status: 'active' };
    if (path === '/auth/accounts') return [];
    if (path === '/config') return { vertical: 'clinic', brand: {}, verticals: [] };
    if (path === '/features') return [{ key: 'dashboard', allowed: true }];
    if (path === '/reminders') return rows;
    if (path === '/public/order/tok' && method === 'GET') return current;
    if (path === '/public/order/tok/answer' && method === 'POST') return { ok: true };
    return undefined;
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);

  console.log('۱) یادآوری‌ها — هیچ کلیدِ خامی');
  await page.goto(`${vite.base}/app/reminders`, { waitUntil: 'networkidle' });
  await page.locator('.rm-row').first().waitFor();
  const heads = await page.locator('.rm-row').evaluateAll((els) => els.map((el) => ({
    kind: el.querySelector('.rm-row-head b')?.textContent.trim(),
    kindTitle: el.querySelector('.rm-row-head b')?.getAttribute('title'),
    status: el.querySelector('.rm-tag')?.textContent.trim(),
    text: el.querySelector('.rm-text')?.textContent.trim(),
  })));
  /* ردیف‌ها به همان ترتیبِ fixture رندر می‌شوند (تبِ «همه»). */
  const rowOf = (k) => heads[KINDS.indexOf(k)];
  ok(heads.length === KINDS.length, `${heads.length} ردیف رندر شد`);
  ok(rowOf('follow_up')?.kind === 'فرمِ پیگیری', `follow_up → «${rowOf('follow_up')?.kind}»`);
  ok(rowOf('zzz_unknown')?.kind === 'یادآوری' && rowOf('zzz_unknown')?.kindTitle === 'zzz_unknown',
    `نوعِ ناشناخته → برچسبِ عام «${rowOf('zzz_unknown')?.kind}»، کلید فقط در title`);
  ok(rowOf('zzz_unknown')?.status === 'وضعیتِ نامشخص', `وضعیتِ ناشناخته → «${rowOf('zzz_unknown')?.status}»`);
  ok(rowOf('surgery')?.kind === 'عملِ پیشِ‌رو' && rowOf('post_op_care')?.kind === 'مراقبتِ بعد از عمل' && rowOf('next_visit')?.status === 'در صف',
    'برچسب‌های شناخته‌شده دست نخورده‌اند (نباید بیفتد)');
  ok(!heads.some((h) => KINDS.includes(h.kind) || h.status === 'weird_status'), 'هیچ نوع/وضعیتی با کلیدِ خام دیده نمی‌شود');
  seen.push(await page.locator('.rm-list').innerText());
  ok((await hOverflow(page)) <= 1, 'یادآوری‌ها بدونِ سرریزِ افقی روی موبایل');

  console.log('\n۲) سفارشِ بی‌پاسخ — فرم هست و ثبت به همان نشانی می‌رود (نباید بیفتد)');
  const openOrder = async (o) => {
    current = o;
    await page.goto(`${vite.base}/o/tok`, { waitUntil: 'networkidle' });
    await page.locator('.op-card h1').waitFor();
    seen.push(await page.locator('.op-card').innerText());
  };
  const count = (sel) => page.locator(sel).count();
  await openOrder(order());
  ok((await count('.op-answer')) === 1 && (await count('.op-ok')) === 0, 'فرمِ پاسخ باز است و پیامی نیست');
  await page.locator('.op-answer textarea').fill('نتیجه نرمال بود');
  await page.getByRole('button', { name: 'ثبتِ پاسخ', exact: true }).click();
  await page.locator('.op-ok').waitFor();
  const w = writes.find((x) => x.path === '/public/order/tok/answer');
  ok(w?.method === 'POST' && w?.body?.text === 'نتیجه نرمال بود', 'POST /public/order/tok/answer با همان بدنهٔ قبلی');
  let msg = await page.locator('.op-ok').innerText();
  ok(msg.includes('پاسخ ثبت شد') && msg.includes('تیمِ درمان بررسی می‌کند'), `پیامِ پایان: «${msg}»`);
  ok(!msg.includes('لازم نیست') && !msg.includes('✓'), 'نه «لازم نیست کارِ دیگری بکنید»، نه نویسهٔ ✓');
  ok((await count('.op-ok svg')) === 1, 'آیکونِ SVG به‌جای نویسه');
  ok((await count('.op-answer')) === 0, 'فرم بعد از ثبت بسته می‌شود');
  seen.push(await page.locator('.op-card').innerText());

  console.log('\n۳) وضعیت‌های بررسی (CONTRACTS §۴–۵)');
  await openOrder(order({ status: 'answered', answered: true }));
  ok((await count('.op-ok')) === 1 && (await count('.op-answer')) === 0, 'answered: پیام، بدونِ فرم');
  await openOrder(order({ status: 'in_review', answered: true }));
  msg = await page.locator('.op-ok').innerText();
  ok(msg.includes('در حالِ بررسی') && (await count('.op-answer')) === 0, 'in_review: «در حالِ بررسی است»، بدونِ فرم');
  await openOrder(order({ status: 'reviewed', answered: true }));
  msg = await page.locator('.op-ok').innerText();
  ok(msg.includes('بررسی کرد') && (await count('.op-answer')) === 0, 'reviewed: «بررسی کرد»، بدونِ فرم');
  await openOrder(order({ status: 'needs_action', answered: true }));
  msg = await page.locator('.op-ok.st-needs_action').innerText();
  ok(msg.includes('دوباره') && (await count('.op-answer')) === 1, 'needs_action: «دوباره بفرستید» + فرمِ باز');
  const color = await page.locator('.op-ok.st-needs_action').evaluate((el) => getComputedStyle(el).color);
  ok(color !== 'rgb(52, 211, 153)', `رنگِ «دوباره بفرست» سبزِ «انجام شد» نیست (${color})`);
  await openOrder(order({ status: 'answered', answered: true, kind: 'referral', kindFa: 'نامهٔ ارجاع' }));
  ok((await count('.op-ok')) === 0 && (await count('.op-answer')) === 0, 'ارجاع: نه فرم، نه پیام (نباید بیفتد)');

  console.log('\n۴) هیچ کلیدِ خام، بدونِ خطای JS، بدونِ سرریز');
  const leaked = seen.flatMap((t) => RAW.filter((k) => t.includes(k)));
  ok(leaked.length === 0, leaked.length ? 'کلیدِ خام: ' + [...new Set(leaked)].join('، ') : 'هیچ کلیدِ خامی روی صفحه نیست');
  ok((await hOverflow(page)) <= 1, 'صفحهٔ سفارش بدونِ سرریزِ افقی روی موبایل');
  ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  await context.close();
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
