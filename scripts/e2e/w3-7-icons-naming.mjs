/**
 * W3.7 — آیکونِ یکتا به‌ازای هر ماژول + نام‌گذاریِ کارمحور + واژه‌نامهٔ
 * نوبت/مراجعه/کار (یافته‌های U14, U15, B2, B3 سندِ بازبینی).
 *
 * معیارِ پذیرشِ سند: **هیچ آیکونی برای دو ماژول.**
 *
 * دو لایه سنجیده می‌شود، چون هرکدام چیزِ متفاوتی را می‌گیرند:
 *  ۱) **ایستا** روی کاتالوگ — همان چیزی که `verify-module-icons.js` هم می‌گوید،
 *     ولی این‌جا کنارِ بقیهٔ ادعاها می‌ماند تا یک اجرا کلِ بسته را بگوید.
 *  ۲) **رندرشده** در مرورگرِ واقعی — چون یکتاییِ *نامِ* کامپوننت تضمین نمی‌کند
 *     که مسیرِ SVG هم فرق کند. دو آیکونِ هم‌شکل با دو نام، از چشمِ کاربر یکی‌اند.
 *     این‌جا خودِ `<path d="…">`ِ رندرشده مقایسه می‌شود.
 *
 * ⚠️ **ولی نامساوی‌بودنِ `d` کف است، نه اثبات.** اسکرین‌شاتِ همین بسته نشان داد
 * چهار کاشی همه «برگهٔ کاغذ» بودند و دو تا «تقویم» — با `d`های متفاوت و چکِ
 * سبز، ولی از چشمِ کاربر تفکیک‌ناپذیر؛ یعنی دقیقاً همان U14 که قرار بود حل شود.
 * سه آیکون بازطراحی شدند. **معیارِ نهایی همچنان نگاه‌کردن است** — هر تغییرِ
 * آیکون باید با `scripts/e2e/.shots/w3-7-tools.png` دیده شود، نه فقط اجرا.
 *
 *  باید بیفتد:
 *   - هر ماژول آیکونِ یکتا دارد (هم نام، هم شکلِ رندرشده)
 *   - نام‌ها کارمحورند: «بیماران» و «پذیرش» به‌جای «داشبورد مدیریت» و «ثبت‌نامِ بیماران»
 *   - واژهٔ حوزه‌ای در دکمهٔ میزِ پذیرش از `terms.js` می‌آید، نه هاردکد
 *  نباید بیفتد:
 *   - «ویزیت» به‌عنوانِ **نوعِ** مراجعه (`visit-kinds.js`) دست نخورده بماند —
 *     آن یک نوع است نه واژهٔ حوزه، و ترجمه‌اش باگ می‌سازد
 *   - آیکونِ `Grid` که کاشی نیست (دکمهٔ «همهٔ ابزارها») در شمارشِ یکتایی نیاید
 */
import fs from 'node:fs';
import { startVite, launch, mockContext } from './lib/mock-ui.mjs';
import { jToday } from '../../src/lib/jalali.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const catalog = fs.readFileSync('src/app/tools.jsx', 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const entries = [];
strip(catalog).split('\n').forEach((line) => {
  const k = line.match(/key: '([^']+)'/);
  const ic = line.match(/icon: ([A-Za-z][A-Za-z0-9]*)/);
  const lb = line.match(/label: '([^']+)'/);
  if (k && ic) entries.push({ key: k[1], icon: ic[1], label: lb ? lb[1] : '' });
});

console.log('\n۱) کاتالوگ — آیکونِ یکتا به‌ازای هر ماژول (معیارِ پذیرش)');
ok(entries.length >= 20, `کاتالوگ خوانده شد (${entries.length} ماژول)`);
const dupes = [...entries.reduce((m, e) => m.set(e.icon, (m.get(e.icon) ?? 0) + 1), new Map())]
  .filter(([, n]) => n > 1);
ok(dupes.length === 0, dupes.length
  ? `آیکونِ مشترک: ${dupes.map(([i, n]) => `${i}×${n}`).join('، ')}`
  : `هر ${entries.length} ماژول آیکونِ یکتا دارد`);

/* تکرارهای واقعیِ پیش از W3.7 — اگر یکی برگردد این‌جا نام می‌برد. */
for (const [icon, had] of [['Wave', 3], ['Book', 3], ['Chart', 2], ['Clock', 2]]) {
  const n = entries.filter((e) => e.icon === icon).length;
  ok(n <= 1, `«${icon}» که پیش از W3.7 برای ${had} ماژول بود، حالا ${n} تا`);
}

console.log('\n۲) نام بر پایهٔ کارِ کاربر (یافتهٔ B3)');
const labelOf = (k) => entries.find((e) => e.key === k)?.label;
ok(labelOf('dashboard') === 'بیماران', `داشبورد → «${labelOf('dashboard')}»`);
ok(labelOf('formgen') === 'پذیرش', `ثبت‌نام → «${labelOf('formgen')}»`);
const toolish = entries.filter((e) => /پرتالِ|پنلِ /.test(e.label));
ok(toolish.length === 0, toolish.length
  ? `هنوز نامِ ابزارمحور: ${toolish.map((e) => e.label).join('، ')}`
  : 'هیچ نامی با «پرتالِ/پنلِ » شروع نمی‌شود');

console.log('\n۳) واژه‌نامهٔ نوبت/مراجعه/کار (یافتهٔ U15)');
const terms = fs.readFileSync('src/lib/terms.js', 'utf8');
ok(/export const FLOW = \{/.test(terms), '`FLOW` سه مفهوم را جدا تعریف می‌کند');
ok(!/^\s*visit:/m.test(terms.slice(terms.indexOf('export const FLOW'), terms.indexOf('export const flowFor'))),
  '`visit` عمداً در `FLOW` نیست — تنها واژهٔ حوزه‌ایِ این سه‌تایی');
for (const v of ['مراجعه', 'عمل', 'ویزیت']) {
  ok(terms.includes(`visitStart: 'شروعِ ${v}'`), `«شروعِ ${v}» برای حوزهٔ خودش هست`);
}
const cal = fs.readFileSync('src/app/Calendar.jsx', 'utf8');
ok(!/'(بازکردنِ|شروعِ) ویزیت'/.test(cal), 'دکمهٔ میزِ پذیرش دیگر «ویزیت» را هاردکد ندارد');
ok(/t\.visitStart/.test(cal) && /t\.visitOpen/.test(cal), 'همان دکمه از `useTerms()` می‌خواند');

console.log('\n۴) نباید بیفتد — «ویزیت» به‌عنوانِ نوعِ مراجعه دست نخورده');
const kinds = fs.readFileSync('src/app/visit-kinds.js', 'utf8');
ok(/clinic:\s*\{\s*label: 'ویزیت'/.test(kinds),
  '`visit-kinds.js` هنوز نوعِ `clinic` را «ویزیت» می‌نامد (نوع است، نه واژهٔ حوزه)');

const vite = await startVite(5281);
const browser = await launch();
const visit = { id: 1, patientId: 1, kind: 'clinic', fullName: 'بیمار آزمایشی', code: 'AM-001', seq: 1, decisions: [], amount: 0, paid: 0, due: 0, opStatus: 'pending' };
const handle = ({ path, method }) => {
  if (path === '/auth/me') return { id: 1, displayName: 'تست مدیر', levelName: 'سوپرادمین', level: 6, status: 'active' };
  if (path === '/auth/accounts') return [];
  if (path === '/config') return { vertical: 'ionm', brand: { color: '#7c3aed' }, verticals: [] };
  /* همهٔ ماژول‌ها روشن، تا هر ۲۲ کاشی رندر شود. */
  if (path === '/features') return entries.map((e) => ({ key: e.key, allowed: true }));
  if (path === '/work/counts') return { mine: 0, role: 0, overdue: 0, total: 0 };
  if (path === '/visits') return { rows: [visit], total: 1, pages: 1, stats: { total: 1, pending: 1, today: 0, due: 0, kinds: [] } };
  if (path === '/forms/visit-kinds') return [{ key: 'clinic', title: 'ویزیت' }];
  if (path.startsWith('/forms')) return [];
  if (path === '/ai/status') return { enabled: false, stt: false };
  if (method !== 'GET') return {};
  return [];
};

try {
  console.log('\n۵) رندرشده — شکلِ آیکون‌ها هم باید فرق کند، نه فقط نامشان');
  const c = await mockContext(browser, handle, { viewport: { width: 1280, height: 900 } });
  const page = await c.context.newPage();
  await page.goto(vite.base + '/app/tools', { waitUntil: 'networkidle' });
  /* ⚠️ لانچر چانکِ lazy است (قانونِ ۲۱): روی Viteِ سردِ CI، `networkidle` می‌تواند
     پیش از سوارشدنِ چانک و رندرِ کاشی‌ها بیفتد و شمارش «۰ کاشی» بدهد (رانِ #74).
     تا اولین کاشی نیامده، شمردن معنی ندارد؛ نیامدنش را همان سنجهٔ پایین قرمز می‌کند. */
  await page.waitForSelector('.lx-hero-ic, .lx-card-ic, .lx-tile-ic', { timeout: 15000 }).catch(() => {});

  const shapes = await page.evaluate(() => {
    /* فقط آیکونِ **کاشی‌ها** — نه آیکونِ هدر/بازگشت/نصب. هر کاشی یک
       `.lx-hero-ic` | `.lx-card-ic` | `.lx-tile-ic` دارد. */
    const out = [];
    for (const box of document.querySelectorAll('.lx-hero-ic, .lx-card-ic, .lx-tile-ic')) {
      const svg = box.querySelector('svg');
      if (!svg) continue;
      const label = box.parentElement?.querySelector('.lx-hero-title, .lx-card-title, .lx-tile-label')?.textContent?.trim() ?? '?';
      out.push({ label, d: [...svg.querySelectorAll('path, circle, rect')].map((n) => n.getAttribute('d') || `${n.tagName}:${n.getAttribute('cx') ?? n.getAttribute('x')},${n.getAttribute('cy') ?? n.getAttribute('y')},${n.getAttribute('r') ?? n.getAttribute('width')}`).join('|') });
    }
    return out;
  });
  ok(shapes.length >= 20, `${shapes.length} کاشی رندر شد`);

  const seen = new Map();
  const same = [];
  for (const s of shapes) {
    if (seen.has(s.d)) same.push(`${seen.get(s.d)} = ${s.label}`);
    else seen.set(s.d, s.label);
  }
  ok(same.length === 0, same.length
    ? `دو کاشی شکلِ یکسان دارند: ${same.join('، ')}`
    : `هر ${shapes.length} کاشی شکلِ متمایز دارد`);

  ok(shapes.some((s) => s.label === 'بیماران'), 'کاشیِ «بیماران» روی صفحه است');
  ok(shapes.some((s) => s.label === 'پذیرش'), 'کاشیِ «پذیرش» روی صفحه است');
  ok(c.errors.length === 0, c.errors.length ? 'خطای JS: ' + c.errors[0] : 'بدونِ خطای JS');

  console.log('\n۶) نامِ کاشی و عنوانِ صفحه‌اش باید یکی باشد');
  /* ⚠️ این سنجه از یک اشتباهِ واقعیِ همین بسته آمد: اول فقط کاشی‌ها رنیم شدند،
     پس کاربر روی «بیماران» می‌زد و به صفحه‌ای با عنوانِ «داشبورد مدیریت»
     می‌رسید — ناهماهنگیِ **بدتر** از نامِ ابزارمحورِ قبلی. رنیمِ نیمه‌کاره
     بدترین حالت است. */
  for (const [key, path] of [['dashboard', '/app/dashboard'], ['formgen', '/app/intake']]) {
    const want = labelOf(key);
    const pg = await c.context.newPage();
    await pg.goto(vite.base + path, { waitUntil: 'networkidle' });
    const h1 = await pg.evaluate(() => document.querySelector('h1')?.textContent?.trim() ?? '');
    ok(h1 === want, `${path}: عنوانِ صفحه «${h1}» = نامِ کاشی «${want}»`);
    await pg.close();
  }

  console.log('\n۷) واژهٔ حوزه در دکمهٔ میزِ پذیرش — رندرشده در هر سه حوزه');
  /* ⚠️ نسخهٔ اولِ این گام فقط می‌گفت «واژهٔ حوزهٔ دیگری روی صفحه نیست» و چون
     fixture شکلِ غلط داشت (`appointments` در ریشه به‌جای `days[].appointments`)
     دکمه اصلاً رندر نمی‌شد — یعنی سه سنجهٔ سبز که هیچ‌چیز را نمی‌دیدند. حالا
     **وجودِ** واژهٔ درست هم ادعا می‌شود. */
  const [jy, jm, jd] = jToday();
  /* ⚠️ `canStart`/`nextOptions` جزوِ قراردادِ ردیفِ نوبت‌اند و سرور همیشه
     می‌فرستدشان؛ fixture بدونشان یعنی دکمه اصلاً رندر نمی‌شود و سه سنجهٔ
     این بند دوباره چیزی را نمی‌بینند (همان تلهٔ بندِ بالا، از راهِ دیگر). */
  const appt = {
    id: 7, fullName: 'بیمار آزمایشی', status: 'confirmed', statusLabel: 'قطعی', time: '10:00', seq: 1,
    next: ['arrived'], nextOptions: [{ status: 'arrived', label: 'رسید' }],
    canStart: true, startHint: null,
    visitId: null, topicName: '', patientCode: 'AM-001', phone: '',
  };
  for (const [vertical, want] of [['ionm', 'شروعِ مراجعه'], ['implant', 'شروعِ عمل'], ['clinic', 'شروعِ ویزیت']]) {
    const cv = await mockContext(browser, ({ path, method }) => {
      if (path === '/config') return { vertical, brand: { color: '#7c3aed' }, verticals: [] };
      if (path.startsWith('/calendar')) return {
        days: [{ day: jd, counts: { pending: 0, done: 0, cancelled: 0, appointments: 1 }, visits: [], appointments: [appt] }],
      };
      return handle({ path, method });
    }, { viewport: { width: 1280, height: 900 } });
    const cal2 = await cv.context.newPage();
    await cal2.goto(vite.base + '/app/calendar', { waitUntil: 'networkidle' });
    await cal2.waitForSelector('.cal-appt-go', { timeout: 5000 }).catch(() => {});
    const txt = await cal2.evaluate(() => document.body.innerText);
    ok(txt.includes(want), `حوزهٔ ${vertical} (${jy}/${jm}): دکمه «${want}» را نشان می‌دهد`);
    const wrong = ['شروعِ مراجعه', 'شروعِ عمل', 'شروعِ ویزیت'].filter((w) => w !== want && txt.includes(w));
    ok(wrong.length === 0, wrong.length
      ? `حوزهٔ ${vertical}: واژهٔ حوزهٔ دیگر هم دیده شد (${wrong.join('، ')})`
      : `حوزهٔ ${vertical}: هیچ واژهٔ حوزهٔ دیگری روی صفحه نیست`);
    ok(cv.errors.length === 0, cv.errors.length ? `خطای JS (${vertical}): ` + cv.errors[0] : `حوزهٔ ${vertical} بدونِ خطای JS`);
    await cv.context.close();
  }

  await c.context.close();
} finally {
  await browser.close();
  vite.stop();
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
