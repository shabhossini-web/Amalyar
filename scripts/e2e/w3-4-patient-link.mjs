/**
 * W3.4 — لینکِ واحدِ بیمار (§۴.۶؛ یافته‌های U9 و D08).
 *
 * معیارِ پذیرشِ سند: **بیمار برای یک نتیجه بینِ لینک‌ها جابه‌جا نشود.**
 * یعنی `/p/<token>` باید هر کاری را که از بیمار خواسته شده یک‌جا نشان دهد و
 * مستقیم به همان `/f` · `/o` · `/s` ببرد.
 *
 * ⚠️ **این بسته عمداً ناقص است و دو بخشش این‌جا سنجیده نمی‌شود** چون
 * endpointشان هنوز ساخته نشده (هر دو لِینِ الف):
 *   - پیش‌نویسِ per-page → W1.8 (`POST /public/intake/form/:token/draft`)
 *   - آپلودِ عکس/PDF روی نتیجه → W0.5/W0.8 (گاردِ `publicAnswer` + آپلود)
 * ادعا نکردن بهتر از سنجهٔ سبزِ توخالی است.
 *
 *  باید بیفتد:
 *   - تبِ «کارهای شما» هر کارِ باز را با لینکِ درست نشان می‌دهد
 *   - کارِ عقب‌افتاده (فیش / ارسالِ دوباره) بالاتر از بقیه می‌نشیند
 *   - URL داخلِ متنِ پیام کلیک‌پذیر است
 *   - «ویزیتِ بعدی» و نوبتِ همان مراجعه **یک** کارت می‌شوند
 *  نباید بیفتد:
 *   - دو نوبتِ واقعیِ مستقل ادغام نشوند (`DECISIONS.md` #۵، جملهٔ دوم)
 *   - متنِ پیام هرگز به‌عنوانِ HTML تفسیر نشود (XSS روی صفحهٔ بی‌احراز)
 *   - وقتی کارِ بازی نیست، تبِ خالی پیش‌فرض نشود
 */
import { startVite, launch, mockContext } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

/** پاسخِ پرتال — همان شکلی که `portal.service.ts` می‌سازد. */
const portal = (over = {}) => ({
  brand: { name: 'کلینیکِ نمونه', phone: '02100000000', address: 'تهران' },
  patient: { fullName: 'بیمار آزمایشی', code: 'AM-0001' },
  tasks: [],
  upcoming: [],
  visits: [],
  surgeries: [],
  notices: [],
  ...over,
});

const handleFor = (payload) => ({ path, method }) => {
  if (path.startsWith('/public/portal/')) return payload;
  if (path === '/config') return { vertical: 'clinic', brand: { color: '#7c3aed' }, verticals: [] };
  if (path === '/auth/me') return { status: 401 };
  if (method !== 'GET') return {};
  return [];
};

const vite = await startVite(5291);
const browser = await launch();
const open = async (payload) => {
  const c = await mockContext(browser, handleFor(payload), { viewport: { width: 390, height: 844 } });
  const pg = await c.context.newPage();
  await pg.goto(vite.base + '/p/tok-test', { waitUntil: 'networkidle' });
  return { c, pg };
};

try {
  console.log('\n۱) «کارهای شما» — هر کار یک ردیف با لینکِ همان صفحه');
  const tasks = [
    { kind: 'intake', label: 'بارگذاریِ فیشِ واریزی', detail: 'مبلغِ ۵۰۰٬۰۰۰ تومان', url: '/f/tok-f', urgent: true },
    { kind: 'order', label: 'نتیجهٔ درخواستی', detail: 'CBC، قند خون', url: '/o/tok-o', urgent: false },
    { kind: 'survey', label: 'پاسخ به نظرسنجی', detail: null, url: '/s/tok-s', urgent: false },
  ];
  let { c, pg } = await open(portal({ tasks }));

  const rows = await pg.evaluate(() => [...document.querySelectorAll('.po-task')].map((a) => ({
    label: a.querySelector('b')?.textContent?.trim() ?? '',
    detail: a.querySelector('small')?.textContent?.trim() ?? null,
    href: a.getAttribute('href'),
    urgent: a.classList.contains('urgent'),
    hasSvg: !!a.querySelector('svg'),
  })));
  ok(rows.length === 3, `هر ۳ کار رندر شد (${rows.length})`);
  ok(rows.every((r) => /^\/[fos]\//.test(r.href ?? '')),
    `هر کار به «/f» «/o» «/s»ِ خودش لینک دارد (${rows.map((r) => r.href).join('، ')})`);
  ok(rows[0]?.urgent === true && rows[0]?.label.includes('فیش'),
    'کارِ عقب‌افتاده (فیش) اولِ فهرست است');
  ok(rows.every((r) => r.hasSvg), 'نشانگرِ هر ردیف SVG است نه گلیفِ متنی (قانونِ ۷)');

  const active = await pg.evaluate(() => document.querySelector('.po-tabs button.on')?.textContent?.trim() ?? '');
  ok(active.startsWith('کارهای شما'), `وقتی کارِ باز هست، همان تب باز می‌شود («${active}»)`);
  ok(c.errors.length === 0, c.errors.length ? 'خطای JS: ' + c.errors[0] : 'بدونِ خطای JS');
  await c.context.close();

  console.log('\n۲) متنِ پیام — لینکِ کلیک‌پذیر، ولی هرگز HTML (نیمهٔ UIِ W0.3)');
  ({ c, pg } = await open(portal({
    notices: [
      { kind: 'follow_up', status: 'sent', dateFa: '۱۴۰۵/۰۶/۲۰', upcoming: false,
        text: 'نتیجهٔ شما آماده است: https://example.com/r/9 — لطفاً ببینید.' },
      /* ⚠️ «نباید بیفتد»: اگر روزی کسی `dangerouslySetInnerHTML` بگذارد، این
         ردیف روی صفحهٔ **بی‌احراز** یک اسکریپت اجرا می‌کند. */
      { kind: 'note', status: 'sent', dateFa: '۱۴۰۵/۰۶/۲۱', upcoming: false,
        text: '<img src=x onerror="window.__xss=1"> سلام' },
    ],
  })));
  await pg.evaluate(() => [...document.querySelectorAll('.po-tabs button')]
    .find((b) => b.textContent.includes('پیام'))?.click());

  const link = await pg.evaluate(() => {
    const a = document.querySelector('.po-notice p a');
    return a ? { href: a.getAttribute('href'), text: a.textContent, rel: a.getAttribute('rel') } : null;
  });
  ok(link?.href === 'https://example.com/r/9', `URL داخلِ متن لینک شد (${link?.href ?? 'نشد'})`);
  ok((link?.rel ?? '').includes('noopener'), 'لینکِ بیرونی `noopener` دارد');
  ok(await pg.evaluate(() => document.body.innerText.includes('لطفاً ببینید.')),
    'بقیهٔ متن دست‌نخورده کنارِ لینک ماند');

  const xss = await pg.evaluate(() => ({
    fired: !!window.__xss,
    img: document.querySelectorAll('.po-notice img').length,
    shown: document.body.innerText.includes('<img src=x'),
  }));
  ok(!xss.fired && xss.img === 0, '**نباید بیفتد:** متنِ پیام به‌عنوانِ HTML اجرا نشد');
  ok(xss.shown, 'همان متن به‌صورتِ **متن** دیده می‌شود');
  ok(c.errors.length === 0, c.errors.length ? 'خطای JS: ' + c.errors[0] : 'بدونِ خطای JS');
  await c.context.close();

  console.log('\n۳) یک مرحله = یک کارت (`DECISIONS.md` #۵)');
  ({ c, pg } = await open(portal({
    upcoming: [
      { kind: 'next_visit_booked', dateFa: '۱۴۰۵/۰۷/۰۲', label: 'نوبتِ قطعیِ ویزیتِ بعدی',
        detail: 'ساعتِ ۱۰:۳۰ · توصیهٔ پزشک: ۱۴۰۵/۰۷/۰۱', booked: true },
    ],
  })));
  const merged = await pg.evaluate(() => [...document.querySelectorAll('.po-up')].map((d) => ({
    text: d.textContent.trim(), booked: d.classList.contains('booked'),
  })));
  ok(merged.length === 1, `یک کارت، نه دو ردیفِ رقیب (${merged.length})`);
  ok(merged[0]?.booked, 'کارتِ نوبت‌دار نشانهٔ خودش را دارد');
  ok(merged[0]?.text.includes('۱۴۰۵/۰۷/۰۲') && merged[0]?.text.includes('توصیهٔ پزشک'),
    'تاریخِ قطعی حرفِ اول است و توصیه زیرش توضیح می‌شود');
  await c.context.close();

  console.log('\n۴) نباید بیفتد — دو نوبتِ مستقل ادغام نمی‌شوند');
  ({ c, pg } = await open(portal({
    upcoming: [
      { kind: 'appointment', dateFa: '۱۴۰۵/۰۷/۰۲', label: 'نوبتِ قطعی', detail: 'ویزیت', booked: true },
      { kind: 'appointment', dateFa: '۱۴۰۵/۰۷/۰۹', label: 'نوبتِ قطعی', detail: 'فیزیوتراپی', booked: true },
    ],
  })));
  ok(await pg.evaluate(() => document.querySelectorAll('.po-up').length) === 2,
    '**نباید بیفتد:** دو نوبتِ جدا دو کارت ماندند');
  await c.context.close();

  console.log('\n۵) نباید بیفتد — تبِ خالی پیش‌فرض نمی‌شود');
  ({ c, pg } = await open(portal({
    visits: [{ code: 'AM-0001-V1', kind: 'clinic', kindTitle: 'ویزیت', dateFa: '۱۴۰۵/۰۵/۰۱',
               status: 'done', doctorName: 'دکتر نمونه', procedure: null, topicName: null, summaryUrl: '/v/tok-v' }],
  })));
  const tab = await pg.evaluate(() => document.querySelector('.po-tabs button.on')?.textContent?.trim() ?? '');
  ok(tab.startsWith('مراجعات'), `بی‌کار و بی‌برنامه → مستقیم مراجعات («${tab}»)`);
  ok(await pg.evaluate(() => document.querySelectorAll('.po-task').length) === 0, 'هیچ کارِ جعلی ساخته نشد');
  ok(c.errors.length === 0, c.errors.length ? 'خطای JS: ' + c.errors[0] : 'بدونِ خطای JS');

  await pg.screenshot({ path: 'scripts/e2e/.shots/w3-4-portal.png', fullPage: true });
  await c.context.close();
} finally {
  await browser.close();
  vite.stop();
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
