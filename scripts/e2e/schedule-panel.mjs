/**
 * **پنلِ برنامهٔ کاری** — `docs/BOOKING.md` مرحلهٔ ۲، سمتِ مرورگر.
 *
 * ⚠️ ادعا روی **حالتِ دیده‌شده** است، نه پاسخِ API: API از قبل با
 * `availability.mjs` سنجیده شده. سؤالِ این‌جا فرق دارد — آیا کاربر می‌تواند
 * یک روزِ کاری بسازد و **نتیجه‌اش را ببیند**؟ همان درسی که از باگِ هدفِ کلیکِ
 * کارت گرفتیم: یک آزمونِ سبزِ API چیزی دربارهٔ صفحه نمی‌گوید.
 *
 * تعریف و پیش‌نمایش عمداً روی یک صفحه‌اند: «شنبه ۱۶ تا ۲۰ هر ۱۵ دقیقه» یک
 * جملهٔ ساده است ولی نتیجه‌اش فقط با دیدن معلوم می‌شود.
 */
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — سرور را ری‌استارت کنید'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());

/* پاک‌سازیِ اولیه: اجرای کرش‌کردهٔ قبلی می‌تواند قاعده جا گذاشته باشد و
   «شنبه چند نوبت دارد» را بی‌ربط کند. */
const before = await get('/availability/rules');
for (const r of before) await fetch(API + `/availability/rules/${r.id}`, { method: 'DELETE', headers: A });

const b = await chromium.launch({
  executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const p = await (await b.newContext({ viewport: { width: 420, height: 900 }, locale: 'fa-IR' })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

try {
  await p.goto(UI + '/', { waitUntil: 'domcontentloaded' });
  await browserLogin(p, login.accessToken);

  console.log('۱) از لانچر می‌شود به برنامهٔ کاری رسید');
  await p.goto(UI + '/app', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  /* کاشی‌های لانچر `<button>`اند نه `<a>` (ناوبری با روتر)، پس با متن پیدا
     می‌شود نه با href — همان تفاوتی که اولین اجرای این آزمون رویش قرمز شد. */
  const tile = p.locator('.lx-tile, button', { hasText: 'برنامهٔ کاری' }).first();
  ok(await tile.count() > 0, 'کاشیِ «برنامهٔ کاری» در لانچر هست');
  await tile.click();
  await p.waitForTimeout(1600);
  ok(/\/app\/schedule/.test(p.url()), `صفحه باز شد (${p.url().split('/app')[1]})`);

  console.log('\n۲) روزِ کاریِ اسلاتی از خودِ صفحه ساخته می‌شود');
  await p.locator('.sc-add').click();
  await p.waitForTimeout(500);
  await p.locator('.sc-form select').first().selectOption('0'); // شنبه
  await p.locator('.sc-modes button', { hasText: 'ساعتِ دقیق' }).click();
  await p.locator('.sc-num').fill('20');
  await p.locator('.sc-save').click();
  await p.waitForTimeout(1800);

  const saved = await get('/availability/rules');
  ok(saved.length === 1, `دقیقاً یک قاعده ثبت شد (${saved.length})`);
  ok(saved[0]?.weekday === 0 && saved[0]?.mode === 'slot', `شنبه، حالتِ اسلاتی (${saved[0]?.weekday}/${saved[0]?.mode})`);
  ok(saved[0]?.slotMinutes === 20, `طولِ نوبت ۲۰ دقیقه ثبت شد (${saved[0]?.slotMinutes})`);
  ok(saved[0]?.slotsPerDay === 12, `۴ ساعت ÷ ۲۰ دقیقه = ۱۲ نوبت (${saved[0]?.slotsPerDay})`);

  console.log('\n۳) و بلافاصله روی خودِ صفحه دیده می‌شود');
  const week = await p.locator('.sc-week').innerText();
  ok(/شنبه/.test(week), 'ردیفِ شنبه در هفته هست');
  ok(/16:00–20:00|۱۶:۰۰/.test(week), `بازهٔ ساعت روی صفحه است («${week.split('\n').slice(0, 3).join(' | ')}»)`);
  ok(/۱۲ نوبت/.test(week), '**و تعدادِ نوبت — ۱۲ — روی صفحه نوشته شده**');

  console.log('\n۴) پیش‌نمایشِ ماه همان روزها را باز نشان می‌دهد');
  await p.waitForTimeout(600);
  /* ⚠️ عددِ ثابت ننویس: ماه ممکن است نیمه‌گذشته باشد و شمارِ شنبه‌های آینده
     با روزِ اجرا فرق کند. ادعا این است که **صفحه دقیقاً همان چیزی را نشان
     می‌دهد که سرور می‌گوید** — این هم date-independent است هم قوی‌تر. */
  const now = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', timeZone: 'UTC' })
    .formatToParts(new Date());
  const jy = Number(now.find((x) => x.type === 'year').value.replace(/[^\d]/g, ''));
  const jm = Number(now.find((x) => x.type === 'month').value);
  const srv = await get(`/availability/month?year=${jy}&month=${jm}`);
  const srvOpen = srv.days.filter((d) => d.open).length;
  const openCells = await p.locator('.sc-cell.open').count();
  ok(srvOpen > 0, `سرور ${srvOpen} روزِ باز می‌شمارد`);
  ok(openCells === srvOpen, `**صفحه هم دقیقاً همان ${srvOpen} روز را باز نشان می‌دهد** (${openCells})`);
  const anyOpen = p.locator('.jg-cell', { has: p.locator('.sc-cell.open') }).first();
  await anyOpen.click();
  await p.waitForTimeout(800);
  const detail = await p.locator('.sc-detail').innerText();
  ok(/شنبه/.test(detail), `جزئیاتِ روز نامِ شنبه را می‌گوید («${detail.split('\n')[0]}»)`);
  ok(await p.locator('.sc-slots span').count() === 12, `۱۲ خانهٔ ساعت کشیده شد (${await p.locator('.sc-slots span').count()})`);

  console.log('\n۵) تعطیل‌کردنِ یک روز فقط همان روز را می‌بندد');
  const openBefore = await p.locator('.sc-cell.open').count();
  await p.locator('.sc-mini', { hasText: 'تعطیل‌کردنِ این روز' }).click();
  await p.waitForTimeout(1800);
  ok(await p.locator('.sc-cell.shut').count() === 1, 'یک روز تعطیل شد');
  ok(await p.locator('.sc-cell.open').count() === openBefore - 1,
    `**و بقیهٔ شنبه‌ها باز ماندند** (${openBefore} → ${await p.locator('.sc-cell.open').count()})`);

  console.log('\n۶) برداشتنِ تعطیلی روز را برمی‌گرداند');
  await p.locator('.sc-mini', { hasText: 'برداشتنِ تعطیلی' }).click();
  await p.waitForTimeout(1800);
  ok(await p.locator('.sc-cell.shut').count() === 0, 'تعطیلی برداشته شد');
  ok(await p.locator('.sc-cell.open').count() === openBefore, 'و شمارِ روزهای باز به قبل برگشت');

  console.log('\n۷) حالتِ ظرفیتی هم از همان فرم ساخته می‌شود');
  await p.locator('.sc-add').click();
  await p.waitForTimeout(500);
  await p.locator('.sc-form select').first().selectOption('3'); // سه‌شنبه
  await p.locator('.sc-modes button', { hasText: 'ظرفیتِ روز' }).click();
  await p.waitForTimeout(300);
  await p.locator('.sc-num').fill('40');
  await p.locator('.sc-save').click();
  await p.waitForTimeout(1800);
  const both = await get('/availability/rules');
  const cap = both.find((r) => r.mode === 'capacity');
  ok(!!cap, 'قاعدهٔ ظرفیتی ثبت شد');
  ok(cap?.capacity === 40 && cap?.slotMinutes === null,
    `ظرفیت ۴۰ و بدونِ طولِ نوبت — دو مفهوم قاطی نشدند (${cap?.capacity}/${cap?.slotMinutes})`);
  ok(/ظرفیت ۴۰ نفر/.test(await p.locator('.sc-week').innerText()), 'و روی صفحه «ظرفیت ۴۰ نفر» نوشته شده');

  console.log('\n۸) قاعدهٔ بی‌معنی پیامِ قرمزِ ماندگار می‌گیرد');
  /* ⚠️ همان قرارِ پروندهٔ بیمار: شکست باید دیده شود و خودش نرود. */
  await p.locator('.sc-add').click();
  await p.waitForTimeout(400);
  await p.locator('.sc-modes button', { hasText: 'ساعتِ دقیق' }).click();
  await p.locator('.sc-num').fill('600');
  await p.locator('.sc-save').click();
  await p.waitForTimeout(1500);
  const t = p.locator('.sc-toast');
  ok((await t.getAttribute('class') ?? '').includes('bad'), 'پیام قرمز است');
  ok(/نوبت|بازه/.test(await t.innerText()), `و علت را می‌گوید («${(await t.innerText()).split('\n')[0]}»)`);
  await p.waitForTimeout(3200);
  ok(await p.locator('.sc-toast').count() === 1, 'بعد از ۳ ثانیه هنوز روی صفحه است');
  await t.click();
  await p.waitForTimeout(400);
  ok(await p.locator('.sc-toast').count() === 0, 'با کلیک بسته می‌شود');
} finally {
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
  await b.close();
  for (const r of await get('/availability/rules')) {
    await fetch(API + `/availability/rules/${r.id}`, { method: 'DELETE', headers: A });
  }
  for (const e of await get('/availability/exceptions')) {
    await fetch(API + `/availability/exceptions/${e.id}`, { method: 'DELETE', headers: A });
  }
}
process.exit(fail || errs.length ? 1 : 0);
