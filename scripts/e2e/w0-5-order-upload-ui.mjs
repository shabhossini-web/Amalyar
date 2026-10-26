/**
 * W0.5 — آپلودِ فایلِ پاسخ روی صفحهٔ عمومیِ سفارش + اندازهٔ دکمه.
 * مرورگرِ واقعی + Vite واقعی + APIِ ساختگی (سروری بالا نمی‌آید).
 *
 * معیارِ پذیرشِ سند: «بیمار با موبایل عکسِ برگهٔ آزمایش را می‌فرستد؛ دکمه ≤ ۵۶px».
 *
 *  باید بیفتد:
 *   - کادرِ بارگذاری روی صفحهٔ عمومی باشد و فایل را به endpointِ W0.8 بفرستد
 *   - فایلِ تنها یک پاسخِ کامل باشد — «ثبت» بدونِ متن و لینک برود
 *   - روی سفارشِ پاسخ‌داده‌شده دکمهٔ «افزودن» باشد و با `append:true` برود
 *   - ارتفاعِ دکمهٔ ثبت ≤ ۵۶px باشد (باگِ `flex-basis`ِ مشترک)
 *  نباید بیفتد:
 *   - ⚠️ فرمِ پاسخ روی سفارشِ پاسخ‌داده‌شده **خودبه‌خود** باز باشد (بازنویسیِ بی‌صدا)
 *   - «ثبت» با هیچ ورودی‌ای درخواستی به سرور بفرستد
 *   - نامهٔ ارجاع بخشِ پاسخ داشته باشد
 *   - صفحه اسکرولِ افقی یا خطای JS بدهد
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startVite, launch, mockContext, hOverflow } from './lib/mock-ui.mjs';

let count = 0;
const ok = (v, label) => { assert.ok(v, label); console.log('PASS ' + ++count + ' ' + label); };

const ORDER = (over = {}) => ({
  kind: 'lab', kindFa: 'درخواستِ آزمایش', clinic: 'کلینیکِ آزمون',
  summary: 'CBC — ناشتا', note: null, dueDate: null, status: 'sent', answered: false, ...over,
});

const dir = await mkdtemp(join(tmpdir(), 'w05-'));
const shot = join(dir, 'result.png');
/* PNGِ ۱×۱ واقعی — همان چیزی که دوربینِ موبایل می‌دهد، در کوچک‌ترین شکلش. */
await writeFile(shot, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'));

const vite = await startVite(5216);
const browser = await launch();

const open = async (order, extra = {}) => {
  const { context, writes, errors } = await mockContext(browser, ({ path, method }) => {
    if (path.startsWith('/public/order/') && path.endsWith('/files')) return { id: 9, name: 'result.png', size: 70 };
    if (path.startsWith('/public/order/') && path.endsWith('/answer')) return { ok: true, status: extra.answerStatus ?? 'answered' };
    if (path.startsWith('/public/order/')) return order;
    if (path === '/config') return { tenant: { name: 'آزمون' } };
    if (method === 'GET') return { };
    return undefined;
  });
  const page = await context.newPage();
  await page.goto(`${vite.base}/o/tok-${Math.random().toString(36).slice(2)}`, { waitUntil: 'networkidle' });
  return { page, writes, errors, context };
};

try {
  console.log('\n۱) کادرِ بارگذاری هست و فایل واقعاً می‌رود');
  {
    const { page, writes, errors, context } = await open(ORDER());
    ok(await page.locator('input[type=file]').count() > 0, 'کادرِ بارگذاری روی صفحهٔ عمومی رندر شد');
    await page.locator('input[type=file]').first().setInputFiles(shot);
    await page.waitForFunction(() => document.body.innerText.includes('ارسال شد'), null, { timeout: 8000 });
    const up = writes.find((w) => w.path.endsWith('/files'));
    ok(up && up.method === 'POST', 'درخواستِ آپلود به endpointِ W0.8 رفت');
    ok(typeof up.body === 'string' && up.body.includes('result.png'),
      'و multipart بود با نامِ خودِ فایل (نه JSON)');
    ok(/\/public\/order\/[^/]+\/files$/.test(up.path), `مسیرش همان قراردادِ §۵ است (${up.path})`);

    console.log('\n۲) فایل خودش یک پاسخِ کامل است');
    await page.getByRole('button', { name: 'ارسالِ پاسخ', exact: true }).click();
    /* یا موفقیت یا خطا — هر کدام زودتر. بی این، رگرسیونِ «فایل پاسخ نیست»
       به‌جای یک سنجهٔ قرمزِ خوانا یک timeoutِ گنگ می‌داد. */
    await page.waitForFunction(
      () => /پاسخ ثبت شد|فایلِ پاسخ/.test(document.body.innerText), null, { timeout: 8000 });
    const ans = writes.find((w) => w.path.endsWith('/answer'));
    ok(ans && !ans.body?.text && !ans.body?.link,
      '⚠️ «ثبت» بدونِ متن و لینک رفت — جوابِ آزمایش معمولاً فقط یک عکس است');
    ok(!ans.body?.append, 'و بدونِ append، چون پاسخِ اول است');
    ok(errors.length === 0, 'هیچ خطای JS نداد');
    await context.close();
  }

  console.log('\n۳) اندازهٔ دکمه — باگِ `flex-basis`ِ مشترک');
  {
    const { page, context } = await open(ORDER());
    const h = await page.getByRole('button', { name: 'ارسالِ پاسخ', exact: true })
      .evaluate((el) => Math.round(el.getBoundingClientRect().height));
    ok(h > 0 && h <= 56, `ارتفاعِ دکمهٔ ثبت ${h}px است (معیارِ سند: ≤۵۶)`);
    ok(await hOverflow(page) === 0, 'صفحه روی موبایل اسکرولِ افقی ندارد');
    await page.screenshot({ path: 'scripts/e2e/.shots/w0-5-order-answer.png', fullPage: true });
    await context.close();
  }

  console.log('\n۴) بدونِ هیچ ورودی، چیزی به سرور نمی‌رود');
  {
    const { page, writes, context } = await open(ORDER());
    await page.getByRole('button', { name: 'ارسالِ پاسخ', exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes('فایلِ پاسخ'), null, { timeout: 8000 });
    ok(writes.filter((w) => w.path.endsWith('/answer')).length === 0,
      'هیچ درخواستی نرفت و پیامِ خطا هر سه راه را گفت');
    await context.close();
  }

  console.log('\n۵) سفارشِ پاسخ‌داده‌شده: افزودن، نه بازنویسی');
  {
    const { page, writes, context } = await open(ORDER({ status: 'reviewed', answered: true }), { answerStatus: 'reviewed' });
    /* ⚠️ ادعا روی خودِ بخش است، نه روی نبودِ برچسبِ «ثبتِ پاسخ»: در حالتِ
       افزودن برچسبِ دکمه «افزودن» است، پس آن ادعا حتی با فرمِ **باز** هم سبز
       می‌ماند. (رگرسیونِ عمدی همین را لو داد.) */
    ok(await page.locator('.op-answer').count() === 0,
      '⚠️ فرمِ پاسخ خودبه‌خود باز نیست — پاسخِ ثبت‌شده بی‌صدا بازنویسی نمی‌شود');
    ok(await page.locator('input[type=file]').count() === 0, 'و کادرِ بارگذاری هم بسته است');
    ok((await page.textContent('body')).includes('بررسی کرد'), 'وضعیتِ «بررسی شد» از واژه‌نامه نشان داده شد');
    await page.getByRole('button', { name: 'فرستادنِ پاسخِ تازه (فایل یا توضیح)' }).click();
    ok(await page.locator('input[type=file]').count() > 0, 'با یک کلیکِ صریح، کادرِ افزودن باز می‌شود');
    await page.locator('input[type=file]').first().setInputFiles(shot);
    await page.waitForFunction(() => document.body.innerText.includes('ارسال شد'), null, { timeout: 8000 });
    /* ۱۴۰۵/۰۸/۰۴ — «هر ارسال، پاسخِ جدا»: دکمه «ارسالِ پاسخِ تازه» است و پس از ارسال تأییدِ «ثبتِ مجدد» می‌آید. */
    await page.getByRole('button', { name: 'ارسالِ پاسخِ تازه', exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes('ثبتِ مجدد انجام شد'), null, { timeout: 8000 });
    const ans = writes.find((w) => w.path.endsWith('/answer'));
    ok(ans?.body?.append === true, '⚠️ و با `append:true` رفت — وضعیت و تصمیمِ بررسی دست نمی‌خورد');
    await context.close();
  }

  console.log('\n۶) نامهٔ ارجاع پاسخ نمی‌گیرد');
  {
    const { page, context } = await open(ORDER({ kind: 'referral', kindFa: 'نامهٔ ارجاع' }));
    ok(await page.locator('input[type=file]').count() === 0 && await page.locator('.op-answer').count() === 0,
      'نه کادرِ بارگذاری، نه بخشِ پاسخ');
    await context.close();
  }

  console.log('\n۷) رنگِ وضعیت از توکن می‌آید، نه هگزِ خام (قانون ۲۳)');
  {
    /* ⚠️ `/o` روی tenantِ حوزهٔ **مطب** تمِ روشن می‌گیرد (`LIGHT_VERTICALS`)، پس
       `#34d399`ِ هاردکدِ قبلی روی زمینهٔ روشن همان‌قدر کم‌کنتراست می‌ماند که
       W3.6 برای رفعش ساخته شد. سنجه: رنگِ رندرشده باید بینِ دو تم **فرق** کند —
       هگزِ ثابت در هر دو یکی می‌ماند. */
    const seen = {};
    for (const theme of ['dark', 'light']) {
      const { page, context } = await open(ORDER({ status: 'reviewed', answered: true }));
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      seen[theme] = await page.locator('.op-ok').evaluate((el) => getComputedStyle(el).color);
      await page.screenshot({ path: `scripts/e2e/.shots/w0-5-order-state-${theme}.png`, fullPage: true });
      await context.close();
    }
    ok(seen.dark && seen.light && seen.dark !== seen.light,
      `رنگِ خطِ وضعیت با تم عوض می‌شود (تیره ${seen.dark} ← → روشن ${seen.light})`);
  }

  console.log(`\n✅ ${count}/${count}`);
} finally {
  await browser.close();
  vite.stop();
}
