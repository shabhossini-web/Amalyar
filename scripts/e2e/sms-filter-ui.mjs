/**
 * «متن حاوی کلمه فیلتر شده است» در دفترِ یادآوری‌ها — راهنمای «کدام کلمه؟» زیرِ علت (dr-gorji، ۱۴۰۵/۰۷/۲۸).
 * مرورگرِ واقعی + Vite واقعی + APIِ ساختگی؛ عکس در هر دو تم و گوشی (قانونِ ۲۸).
 *
 *  باید بیفتد:
 *   - ردیفِ فیلترشده زیرِ علت، کلمهٔ احتمالی و راهِ اصلاح را نشان دهد (`filterHint` از سرور)
 *   - بی‌کلمه (`words: []`) فقط راهِ اصلاح بیاید، نه برچسبِ خالیِ «کلمهٔ احتمالی:»
 *  نباید بیفتد:
 *   - ردیفِ بی‌`filterHint` (رفته، یا نرفتهٔ دیگر) جعبهٔ راهنما بگیرد
 *   - اسکرولِ افقی روی گوشی، یا خطای JS
 *
 *  «پیدا کردنِ دقیقِ کلمه» (جستجوی دوبخشی با پیامکِ آزمایشی به موبایلِ خودِ کاربر + جایگزینی):
 *   باید بیفتد:
 *   - پرسشِ تأیید پیش از هر پیامک: شمارهٔ ماسک‌شده، «فقط به شمارهٔ خودتان»، شمارِ آزمایشِ مانده
 *   - کلمهٔ فیلترشده پیدا شود؛ هر آزمایش فقط شمارهٔ کلمه‌ها را بفرستد (نه متن) و ≤ ۱۶ آزمایش
 *   - «جایگزین کن» تا جایگزین نوشته نشده غیرفعال؛ بعد `replace-word` با کلمه و جایگزین، و توست
 *  نباید بیفتد:
 *   - موبایلِ تأییدنشده: علت دیده شود و **هیچ** آزمایشی نرود
 *   - متنی که کلِ آن رد نمی‌شود: «بدونِ مشکل» (نه کلمهٔ ساختگی)؛ خطای ارسال: علتِ فارسی
 */
import assert from 'node:assert/strict';
import { startVite, launch, mockContext, hOverflow } from './lib/mock-ui.mjs';

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };
const SHOTS = process.env.E2E_SHOTS;

const HOW = 'آن کلمه را در متنِ مراقبتِ همین عمل (فرمِ عمل) عوض و ذخیره کنید — متنِ تازه خودکار می‌رود و این ردیف کنار می‌رود.';
const ROWS = [
  { id: 1, kind: 'post_op_care', kindFa: 'مراقبتِ بعد از عمل', status: 'failed', statusFa: 'ارسالِ ناموفق', channel: 'sms',
    text: 'دکتر نمونه\nسارا مرادی عزیز، از مصرفِ الکل و دخانیات تا دو هفته پرهیز کنید و پانسمان را خشک نگه دارید.',
    phone: '09120000001', dueAt: '2026-10-20T06:30:00.000Z', patientName: 'سارا مرادی', visitCode: 'AM-0008-V1',
    error: 'ملی‌پیامک پیام را نپذیرفت: متن حاوی کلمه فیلتر شده است — همین متن دوباره هم نمی‌رود؛ کلمه را عوض کنید',
    filterHint: { words: ['الکل', 'دخانیات'], how: HOW } },
  { id: 2, kind: 'post_op_care', kindFa: 'مراقبتِ بعد از عمل', status: 'failed', statusFa: 'ارسالِ ناموفق', channel: 'sms',
    text: 'دکتر نمونه\nامیدواریم جراحیِ خوبی را پشتِ سر گذاشته باشید.', phone: '09120000002', dueAt: '2026-10-01T06:30:00.000Z',
    patientName: 'رضا اکبری', visitCode: 'AM-0010-V1',
    error: 'ملی‌پیامک پیام را نپذیرفت: متن حاوی کلمه فیلتر شده است — همین متن دوباره هم نمی‌رود؛ کلمه را عوض کنید',
    filterHint: { words: [], how: HOW } },
  { id: 3, kind: 'notice', kindFa: 'اطلاع‌رسانی', status: 'failed', statusFa: 'ارسالِ ناموفق', channel: 'sms', text: 'پیامِ دیگری که نرفت',
    phone: '09120000003', dueAt: '2026-10-19T06:30:00.000Z', patientName: 'لیلا یوسفی', error: 'شمارهٔ موبایلِ گیرنده معتبر نیست', filterHint: null },
  { id: 4, kind: 'next_visit', kindFa: 'یادآوریِ ویزیت', status: 'sent', statusFa: 'ارسال‌شده', channel: 'sms', text: 'پیامِ رفته',
    phone: '09120000004', dueAt: '2026-10-18T06:30:00.000Z', sentAt: '2026-10-18T06:31:00.000Z', deliveryStatus: 'delivered',
    patientName: 'حسن کریمی', filterHint: null },
];

const vite = await startVite(5231);
const browser = await launch();
try {
  for (const [theme, viewport, tag] of [
    ['dark', { width: 1100, height: 900 }, 'desk-dark'],
    ['light', { width: 1100, height: 900 }, 'desk-light'],
    ['light', { width: 390, height: 844 }, 'phone-light'],
    ['dark', { width: 390, height: 844 }, 'phone-dark'],
  ]) {
    const { context, errors } = await mockContext(browser, ({ path, method }) => {
      if (path === '/reminders' && method === 'GET') return ROWS;
      if (path === '/auth/me') return { id: 1, firstName: 'مدیرِ', lastName: 'آزمون', level: 6, status: 'active' };
      if (path === '/config') return { vertical: 'clinic', brand: {} };
      if (path === '/features') return [{ key: 'dashboard', allowed: true }];
      if (method === 'GET') return {};
      return undefined;
    }, { viewport });
    await context.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* */ } }, theme);
    const page = await context.newPage();
    await page.goto(`${vite.base}/app/reminders`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('.rm-row').length > 0, null, { timeout: 15000 });
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === theme, `${tag}: تمِ ${theme}`);
    const hints = page.locator('.rm-filter');
    ok(await hints.count() === 2, `${tag}: فقط دو ردیفِ فیلترشده راهنما دارند`);
    const first = await hints.nth(0).innerText();
    ok(first.includes('«الکل»') && first.includes('«دخانیات»') && first.includes('فرمِ عمل') && first.includes('حدس است'),
      `${tag}: کلمه‌های احتمالی و راهِ اصلاح`);
    const second = await hints.nth(1).innerText();
    ok(!second.includes('کلمهٔ احتمالی') && second.includes('فرمِ عمل'), `${tag}: بی‌کلمه، فقط راهِ اصلاح`);
    ok(await hOverflow(page) <= 1, `${tag}: اسکرولِ افقی ندارد`);
    ok(errors.length === 0, `${tag}: خطای JS ندارد ${errors.join(' | ')}`);
    if (SHOTS) {
      await hints.nth(0).scrollIntoViewIfNeeded();
      await page.locator('.rm-row').nth(0).screenshot({ path: `${SHOTS}/sms-filter-${tag}.png` });
      if (tag === 'phone-light') await page.screenshot({ path: `${SHOTS}/sms-filter-page-${tag}.png` });
    }
    await context.close();
  }

  /* ── «پیدا کردنِ دقیقِ کلمه» ── */
  const TOKENS = ROWS[0].text.split(/\s+/).filter(Boolean);
  const BAD = 'دخانیات';
  for (const [theme, viewport, tag] of [['dark', { width: 1100, height: 900 }, 'desk-dark'], ['light', { width: 390, height: 844 }, 'phone-light']]) {
    for (const mode of ['ok', 'noPhone', 'clean', 'smsError']) {
      const { context, writes, errors } = await mockContext(browser, ({ path, method, body }) => {
        if (path === '/reminders' && method === 'GET') return ROWS;
        if (path === '/reminders/filter-probe/info') {
          return mode === 'noPhone'
            ? { ok: false, phoneMask: null, reason: 'شمارهٔ موبایلِ شما هنوز تأیید نشده؛ پیامکِ آزمایشی فقط به شمارهٔ تأییدشدهٔ خودتان می‌رود', left: 60, perDay: 60 }
            : { ok: true, phoneMask: '0912***1234', reason: null, left: 48, perDay: 60 };
        }
        if (path === '/reminders/1/filter-probe' && method === 'POST') {
          if (mode === 'smsError') return { outcome: 'error', left: 47, detail: 'اعتبارِ پنلِ پیامک کافی نیست' };
          if (body && body.start !== undefined) return { outcome: TOKENS.slice(body.start, body.end).includes(BAD) ? 'filtered' : 'passed', left: 40 };
          return mode === 'clean' ? { outcome: 'passed', left: 47 } : { outcome: 'filtered', left: 47, tokens: TOKENS };
        }
        if (path === '/reminders/replace-word' && method === 'POST') return { rule: { from: body.from, to: body.to }, updated: false, requeued: 1, sent: 1, failed: 0 };
        if (path === '/auth/me') return { id: 1, firstName: 'مدیرِ', lastName: 'آزمون', level: 6, status: 'active' };
        if (path === '/config') return { vertical: 'clinic', brand: {} };
        if (path === '/features') return [{ key: 'dashboard', allowed: true }];
        if (method === 'GET') return {};
        return undefined;
      }, { viewport });
      await context.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* */ } }, theme);
      const page = await context.newPage();
      await page.goto(`${vite.base}/app/reminders`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.rm-find-go');
      const label = `${tag}/${mode}`;
      const probes = () => writes.filter((w) => /filter-probe$/.test(w.path));
      ok(await page.locator('.rm-find-go').count() === 2, `${label}: دکمه فقط روی دو ردیفِ فیلترشده`);
      await page.locator('.rm-find-go').first().click();
      if (mode === 'noPhone') {
        await page.waitForSelector('.rm-find-msg.err');
        ok((await page.locator('.rm-find-msg.err').first().innerText()).includes('تأیید'), `${label}: علتِ موبایلِ تأییدنشده دیده می‌شود`);
        ok(await page.locator('[role=alertdialog]').count() === 0 && probes().length === 0, `${label}: پرسش و پیامکی نیامد`);
      } else {
        await page.waitForSelector('[role=alertdialog]');
        const dlg = await page.locator('[role=alertdialog]').innerText();
        ok(dlg.includes('۰۹۱۲***۱۲۳۴') && dlg.includes('فقط به شمارهٔ خودتان') && dlg.includes('۴۸') && dlg.includes('بیمار هیچ چیزی نمی‌رود'), `${label}: پرسشِ تأیید — شمارهٔ ماسک‌شده، فقط خودش، شمارِ مانده`);
        ok(probes().length === 0, `${label}: پیش از «شروع کن» هیچ پیامکی نرفته`);
        if (SHOTS && mode === 'ok') { await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/sms-find-confirm-${tag}.png` }); }
        await page.getByRole('button', { name: 'شروع کن' }).click();
        if (mode === 'ok') {
          await page.waitForSelector('.rm-find-word');
          ok((await page.locator('.rm-find-word').innerText()).includes(BAD), `${label}: کلمهٔ فیلترشده پیدا شد`);
          const cap = 1 + 2 * Math.ceil(Math.log2(TOKENS.length));
          ok(probes().length >= 2 && probes().length <= Math.min(16, cap), `${label}: ${probes().length} آزمایش ≤ ${Math.min(16, cap)}`);
          ok(probes().every((w) => Object.keys(w.body ?? {}).every((k) => k === 'start' || k === 'end')), `${label}: **متن هرگز به سرور نمی‌رود** — فقط شمارهٔ کلمه‌ها`);
          ok(await page.locator('.rm-filter').first().innerText().then((t) => !t.includes('کلمهٔ احتمالی')), `${label}: با کلمهٔ قطعی، حدس و راهِ کلی کنار می‌رود`);
          const go = page.getByRole('button', { name: 'جایگزین کن و بفرست' });
          ok(await go.isDisabled(), `${label}: بی‌جایگزین، دکمه غیرفعال`);
          await page.locator('.rm-find-field input').fill('مواد دخانی');
          ok(await go.isEnabled(), `${label}: با جایگزین فعال`);
          if (SHOTS) { await page.locator('.rm-row').nth(0).scrollIntoViewIfNeeded(); await page.locator('.rm-row').nth(0).screenshot({ path: `${SHOTS}/sms-find-${tag}.png` }); }
          ok(await hOverflow(page) <= 1, `${label}: اسکرولِ افقی ندارد`);
          await go.click();
          await page.waitForFunction(() => document.querySelector('.rm-toast.on')?.textContent.includes('عوض شد'), null, { timeout: 8000 });
          const rep = writes.find((w) => w.path === '/reminders/replace-word');
          ok(rep && rep.body.from === BAD && rep.body.to === 'مواد دخانی', `${label}: replace-word با کلمه و جایگزین`);
          ok(await page.locator('.rm-find-res').count() === 0, `${label}: بعد از جایگزینی پنل بسته شد`);
        } else if (mode === 'clean') {
          await page.waitForSelector('.rm-find-msg');
          ok((await page.locator('.rm-find-msg').first().innerText()).includes('بدونِ مشکل') && probes().length === 1, `${label}: کلِ متن رسید ← «مشکل از متن نیست»، فقط یک آزمایش`);
        } else {
          await page.waitForSelector('.rm-find-msg.err');
          ok((await page.locator('.rm-find-msg.err').first().innerText()).includes('اعتبار') && probes().length === 1, `${label}: علتِ واقعیِ ارسال دیده می‌شود و جستجو می‌ایستد`);
        }
      }
      ok(errors.length === 0, `${label}: خطای JS ندارد ${errors.join(' | ')}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nسبز: ${count}`);
