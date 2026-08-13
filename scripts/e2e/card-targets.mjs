/**
 * کارتِ داشبورد **دو مقصد** دارد و این آزمون نگهبانِ تفکیکشان است:
 *
 * - کلیک روی بدنهٔ کارت → خودِ **مراجعه** باز می‌شود (دیدن/تکمیل)
 * - کلیک روی **نام** → پروندهٔ بیمار
 *
 * ⚠️ تا دیروز لینکِ نام تمامِ عرضِ پنل را می‌گرفت، پس کلیک روی هر جای کارت
 * «پرونده» را باز می‌کرد و تنها راهِ بازکردنِ خودِ مراجعه آیکونِ کوچکِ مداد
 * بود — پرتکرارترین کارِ صفحه، پشتِ کوچک‌ترین هدفِ صفحه.
 */
import { chromium } from 'playwright-core';

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

/* فیکسچرِ اختصاصی و تازه: «اولین کارتِ فهرست» می‌تواند ساختهٔ اجرای قبلیِ
   همین آزمون باشد و آن‌وقت بارِ دوم چیزِ دیگری سنجیده می‌شود. */
const [kinds, sur, hos] = await Promise.all([
  fetch(API + '/forms/visit-kinds', { headers: A }).then((r) => r.json()),
  fetch(API + '/surgeons', { headers: A }).then((r) => r.json()),
  fetch(API + '/hospitals', { headers: A }).then((r) => r.json()),
]);
const sList = sur.rows ?? sur, hList = hos.rows ?? hos;
const made = await fetch(API + '/visits', {
  method: 'POST', headers: A,
  body: JSON.stringify({
    kind: kinds[0]?.kind, firstName: 'هدفِ', lastName: 'کلیک',
    surgeonId: sList[0]?.id, hospitalId: hList[0]?.id,
    amount: 1_000_000, opDate: new Date().toISOString(),
  }),
}).then((r) => r.json());
if (!made.id) { console.error('فیکسچر ساخته نشد:', JSON.stringify(made)); process.exit(1); }

const b = await chromium.launch({
  executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const p = await (await b.newContext({ viewport: { width: 420, height: 900 }, locale: 'fa-IR' })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
const home = async () => { await p.goto(UI + '/app/dashboard', { waitUntil: 'networkidle' }); await p.waitForTimeout(1600); };
await p.goto(UI + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate((t) => localStorage.setItem('amalyar_token', t), login.accessToken);
await home();

try {
  console.log('۱) کلیک روی بدنهٔ کارت → خودِ مراجعه');
  await p.locator('.db-card').first().locator('.db-facts').click({ position: { x: 5, y: 5 }, force: true });
  await p.waitForTimeout(1200);
  ok(await p.locator('.db-sheet').count() > 0, 'شیتِ مراجعه باز شد');
  ok(!p.url().includes('/patients/'), 'به پرونده **نرفت**');
  const head = await p.locator('.db-sheet-head b').innerText().catch(() => '');
  ok(/ویرایش/.test(head), `شیت در حالتِ ویرایش است (${head})`);
  await p.locator('.db-x').click();
  await p.waitForTimeout(900);
  ok(await p.locator('[class*="overlay"]').count() === 0, 'بعد از بستن overlayی نماند');

  console.log('\n۲) کلیک روی نام → پروندهٔ بیمار');
  await p.locator('.db-name').first().click();
  await p.waitForTimeout(1600);
  ok(/\/app\/patients\/\d+/.test(p.url()), `URL به پرونده رفت (${p.url().split('/app')[1]})`);

  console.log('\n۳) فضای خالیِ کنارِ نام هم «مراجعه» است، نه «پرونده»');
  await home();
  const t = await p.locator('.db-title').first().boundingBox();
  const panel = await p.locator('.db-panel').first().boundingBox();
  ok(t.width < panel.width - 40, `نام تمامِ عرضِ پنل را نمی‌گیرد (${Math.round(t.width)} از ${Math.round(panel.width)})`);
  await p.mouse.click(panel.x + 12, t.y + t.height / 2);
  await p.waitForTimeout(1200);
  ok(await p.locator('.db-sheet').count() > 0, 'کلیکِ کنارِ نام مراجعه را باز کرد');
  ok(!p.url().includes('/patients/'), 'و به پرونده نرفت');

  console.log('\n۴) هدفِ کلیک با صفحه‌کلید هم قابلِ رسیدن است');
  await p.locator('.db-x').click();
  await p.waitForTimeout(900);
  const focusable = await p.locator('.db-card').first().locator('.db-open').count();
  ok(focusable === 1, 'دکمهٔ پوششی یک `button` واقعی است (نه onClick روی div)');
  const lab = await p.locator('.db-card').first().locator('.db-open').getAttribute('aria-label');
  ok(!!lab && lab.length > 5, `و برچسبِ خواندنی دارد («${lab}»)`);

  console.log('\n۵) نقشهٔ ضربهٔ کلِ کارت — نه اندازه‌گیریِ عرض');
  /* ⚠️ این بند بعد از یک شکایتِ دوباره اضافه شد: «رو کارت می‌زنیم پرونده باز
     می‌شه». ادعاهای بالا سبز بودند چون **عرضِ** نام را می‌سنجیدند، در حالی
     که مسئله عرض نبود:
       ۱. `.db-panel-top` با `z-index: 2` بالای دکمهٔ پوششی می‌نشست، پس تمامِ
          نوارِ بالای کارت **منطقهٔ مرده** بود — ضربه می‌خورد و هیچ نمی‌شد.
       ۲. کلِ بلوکِ عنوان (نام + کد + بالشتک) لینکِ پرونده بود، پس روی
          کارتِ کم‌ارتفاع مرکزِ هندسی هم روی «پرونده» می‌افتاد.
     هیچ‌کدام با «عرضِ نام از پنل کمتر است» گرفته نمی‌شد. پس حالا کلِ سطحِ
     کارت نقطه‌به‌نقطه hit-test می‌شود. */
  await home();
  const map = await p.locator('.db-card').first().evaluate((el) => {
    const panel = el.querySelector('.db-panel');
    const r = panel.getBoundingClientRect();
    const at = (x, y) => {
      const e = document.elementFromPoint(x, y);
      if (!e) return 'out';
      if (e.closest('.db-name')) return 'record';
      if (e.closest('.db-open')) return 'visit';
      return 'dead';
    };
    /* نمونه‌برداری **داخلِ** پنل: آخرین ردیف/ستون دقیقاً روی لبه می‌افتاد و
       `elementFromPoint` والد را برمی‌گرداند — مصنوعِ اندازه‌گیری، نه نقطهٔ
       مرده. ۳ پیکسل حاشیه هم گوشه‌های گردشده را کنار می‌گذارد. */
    let visit = 0, record = 0, dead = 0;
    for (let y = 3; y <= r.height - 4; y += 5) {
      for (let x = 3; x <= r.width - 4; x += 5) {
        const k = at(r.x + x, r.y + y);
        if (k === 'visit') visit++; else if (k === 'record') record++; else if (k === 'dead') dead++;
      }
    }
    const total = visit + record + dead;
    return { visit, record, dead, total, top: at(r.x + r.width / 2, r.y + 10) };
  });
  ok(map.dead === 0, `هیچ نقطهٔ مرده‌ای روی کارت نیست (${map.dead} از ${map.total})`);
  ok(map.top === 'visit', `نوارِ بالای کارت (تاریخ/نوع) هم مراجعه را باز می‌کند، نه هیچ (${map.top})`);
  const share = Math.round((map.visit / map.total) * 100);
  ok(share >= 85, `**دستِ‌کم ۸۵٪ سطحِ کارت مراجعه را باز می‌کند** (${share}٪)`);
  ok(map.record > 0, 'و نام همچنان مقصدِ پرونده است، صفر نشده');

  console.log('\n۶) هدفِ مطمئنِ پرونده در ردیفِ ابزار');
  /* نامِ وسطِ کارت یک میان‌بُر است و روی موبایل با ضربهٔ «وسط» قاطی می‌شود؛
     باید یک هدفِ بی‌ابهام هم باشد که هرگز قاطی نشود. */
  const pid = await p.locator('.db-card').first().getAttribute('data-visit-id').catch(() => null);
  const rec = p.locator('.db-card').first().locator('.db-tools a.db-ico');
  ok(await rec.count() === 1, 'یک لینکِ پرونده در ردیفِ ابزار هست');
  ok(/\/app\/patients\/\d+/.test(await rec.getAttribute('href') ?? ''), `و به پرونده اشاره می‌کند (${await rec.getAttribute('href')})`);
  void pid;
  await rec.click();
  await p.waitForTimeout(1600);
  ok(/\/app\/patients\/\d+/.test(p.url()), `و واقعاً پرونده را باز می‌کند (${p.url().split('/app')[1]})`);
} finally {
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
  await b.close();
  await fetch(API + `/visits/${made.id}`, { method: 'DELETE', headers: A });
}
process.exit(fail || errs.length ? 1 : 0);
