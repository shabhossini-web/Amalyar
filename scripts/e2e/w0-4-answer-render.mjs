/**
 * W0.4 — رندرِ پاسخِ فرم: هیچ `[object Object]`، و لینک/عکس بازشدنی (D03b).
 * Real Prisma + مرورگر.
 *
 * یافتهٔ D03b: باکسِ لینک `{url,title}` و باکسِ عکس `{id,name}` ذخیره می‌کنند.
 * مسیرِ **فرم‌های چسبیده به پرونده** مقدارِ خام را به کلاینت می‌داد و آن‌جا
 * `faNum(v.join('، '))` می‌خورد — یعنی روی صفحه `[object Object]`.
 *
 * و حتی وقتی خوانا نوشته می‌شد، **بازشدنی نبود**: نشانیِ MRI روی صفحه بود و
 * کلیک نمی‌شد؛ عکسِ پیوست فقط یک اسم بود.
 *
 *  باید بیفتد:
 *   - سرور هم متنِ خوانا بدهد هم `items`ِ بازشدنی
 *   - لینک `<a>`ِ کلیک‌پذیر با `noopener` شود
 *   - عکس دکمه‌ای شود که مدرک را از مسیرِ محافظت‌شده باز می‌کند
 *  نباید بیفتد:
 *   - `[object Object]` در هیچ حالتی (آرایه، شیءِ تکی، لینک، عکس)
 *   - نشانیِ مستقیمِ فایل در HTML بنشیند (مدرکِ پزشکی پشتِ گارد می‌ماند)
 *   - فیلدِ متنیِ ساده قطعهٔ بی‌مورد بسازد
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startVite, launch, mockContext } from './lib/mock-ui.mjs';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { answerParts } = require('./dist/patients/record.service');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

console.log('\n۱) شکل‌دهندهٔ سرور — متن و قطعات');
const link = answerParts([{ url: 'https://pacs.test/s/1', title: 'MRI کمر' }]);
ok(link.text.includes('MRI کمر') && !link.text.includes('[object'),
  `آرایهٔ لینک متنِ خوانا شد («${link.text}»)`);
ok(link.items.length === 1 && link.items[0].kind === 'link' && link.items[0].url === 'https://pacs.test/s/1',
  '**باید بیفتد:** قطعهٔ لینک با نشانی برگشت');

const img = answerParts([{ id: 42, name: 'جوابِ آزمایش.jpg' }, { id: 43, name: 'صفحهٔ دوم.jpg' }]);
ok(img.items.length === 2 && img.items.every((i) => i.kind === 'doc'), 'دو قطعهٔ مدرک');
ok(img.items[0].docId === 42 && img.items[0].url === undefined,
  '**نباید بیفتد:** برای مدرک نشانیِ مستقیم نمی‌آید — فقط شناسه');

ok(answerParts({ id: 9, name: 'تکی.pdf' }).items[0]?.docId === 9, 'شیءِ تکی هم قطعه می‌دهد');
ok(answerParts('کمردرد').text === 'کمردرد' && answerParts('کمردرد').items.length === 0,
  '**نباید بیفتد:** متنِ ساده قطعهٔ بی‌مورد نساخت');
ok(answerParts(true).text === 'بله' && answerParts(['الف', 'ب']).text === 'الف، ب', 'بولی و آرایهٔ متنی مثلِ قبل');
for (const v of [[{ url: 'https://a.test' }], [{ id: 1 }], { id: 2 }, [{ x: 1 }], [1, 2]]) {
  const t = answerParts(v).text;
  if (t.includes('[object')) { fail++; console.log('  ✘ `[object Object]` در ' + JSON.stringify(v)); }
}
ok(true, '**نباید بیفتد:** هیچ شکلی از ورودی `[object Object]` نداد');

console.log('\n۲) رابط — کلیک‌پذیر و بدونِ نشانیِ فایل');
const rec = {
  id: 1, code: 'AM-0001', firstName: 'بیمار', lastName: 'آزمایشی', updatedAt: new Date().toISOString(),
  visits: [], documents: [], notes: [], texts: [], orders: [], clinicalVisible: true,
  counts: { visits: 0, documents: 0, forms: 1, notes: 0, visitTexts: 0, notesByKind: {} },
  attachedForms: [{
    id: 5, formTitle: 'جوابِ آزمایش', formColor: null, submittedAt: new Date().toISOString(), locked: false,
    answers: [
      { key: 'mri', label: 'لینکِ تصویربرداری', type: 'links', value: '۱ لینک: MRI کمر',
        items: [{ kind: 'link', title: 'MRI کمر', url: 'https://pacs.test/s/1' }] },
      { key: 'aks', label: 'عکسِ جواب', type: 'image', value: '۱ فایل: جواب.jpg',
        items: [{ kind: 'doc', title: 'جواب.jpg', docId: 42 }] },
      { key: 'note', label: 'توضیح', type: 'text', value: 'حالِ عمومی خوب', items: [] },
    ],
  }],
};
const handle = ({ path, method }) => {
  /* مسیرِ واقعیِ صفحه `GET /patients/:id/record` است — نسخهٔ اولِ همین fixture
     مسیرِ دیگری می‌داد، صفحه اصلاً رندر نمی‌شد، و چکِ «نشانیِ فایل در HTML
     ننشست» **توخالی** سبز می‌ماند چون HTMLی وجود نداشت. */
  if (path === '/patients/1/record') return rec;
  if (path.startsWith('/patients/1/')) return [];
  if (path === '/config') return { vertical: 'clinic', brand: { color: '#7c3aed' }, verticals: [] };
  if (path === '/auth/me') return { id: 1, level: 6, status: 'active', firstName: 'مدیر', lastName: 'آزمون' };
  if (path === '/features') return [{ key: 'dashboard', allowed: true }, { key: 'work', allowed: true }];
  if (method !== 'GET') return {};
  return [];
};
const vite = await startVite(5297);
const browser = await launch();
try {
  const c = await mockContext(browser, handle, { viewport: { width: 900, height: 1000 } });
  const pg = await c.context.newPage();
  await pg.goto(vite.base + '/app/patients/1', { waitUntil: 'networkidle' });
  await pg.waitForSelector('.rc-tabs, [class*="tab"]', { timeout: 8000 }).catch(() => {});
  await pg.evaluate(() => [...document.querySelectorAll('button, a')]
    .find((b) => /^فرم‌ها/.test(b.textContent.trim()))?.click());
  await pg.waitForSelector('.rc-form-ans', { timeout: 8000 }).catch(() => {});

  const body = await pg.evaluate(() => document.body.innerText);
  /* ⚠️ اول **اثباتِ رندر**: بدونِ این، همهٔ «نباید بیفتد»های زیر روی صفحهٔ
     خالی سبز می‌مانند. یک‌بار همین اتفاق افتاد. */
  ok(body.includes('جوابِ آزمایش'), 'صفحه واقعاً رندر شد — وگرنه چک‌های زیر توخالی‌اند');
  ok(!body.includes('[object Object]'), '**نباید بیفتد:** `[object Object]` روی صفحه نیست');
  const anchor = await pg.evaluate(() => {
    const a = document.querySelector('.rc-ans-items a');
    return a ? { href: a.getAttribute('href'), rel: a.getAttribute('rel'), text: a.textContent } : null;
  });
  ok(anchor?.href === 'https://pacs.test/s/1', `لینک کلیک‌پذیر شد (${anchor?.href ?? 'نشد'})`);
  ok((anchor?.rel ?? '').includes('noopener'), 'لینکِ بیرونی `noopener` دارد');
  const docBtn = await pg.evaluate(() => {
    const b = document.querySelector('.rc-ans-doc');
    return b ? { tag: b.tagName, text: b.textContent.trim() } : null;
  });
  ok(docBtn?.tag === 'BUTTON' && docBtn.text.includes('جواب.jpg'),
    `**باید بیفتد:** مدرک دکمه شد نه لینکِ مستقیم (${docBtn?.tag})`);
  ok(!body.includes('/documents/42/file') && !(await pg.content()).includes('documents/42/file'),
    '**نباید بیفتد:** نشانیِ فایل در HTML ننشست — پشتِ گارد می‌ماند');
  ok(body.includes('حالِ عمومی خوب'), 'فیلدِ متنیِ ساده مثلِ قبل دیده می‌شود');
  ok(c.errors.length === 0, c.errors.length ? 'خطای JS: ' + c.errors[0] : 'بدونِ خطای JS');
  await pg.screenshot({ path: 'scripts/e2e/.shots/w0-4-answers.png', fullPage: false });
  await c.context.close();
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
