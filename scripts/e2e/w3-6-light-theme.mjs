/**
 * W3.6 — تمِ روشنِ بالینی + سوییچ + چگالی (§۴.۸ · `DECISIONS.md` #۳).
 *
 * مرورگرِ واقعی، API ساختگی (`lib/mock-ui.mjs`).
 *
 * معیارِ پذیرشِ سند: **کنتراستِ AA در هر دو تم برای هر برند** + اسکرین‌شاتِ هر دو تم.
 * کنتراست این‌جا از **رنگِ واقعیِ رندرشده** حساب می‌شود (`getComputedStyle`)، نه از
 * توکنی که نوشته‌ایم — یعنی اگر یک قاعدهٔ دیگر رنگ را بازنویسی کند، همین‌جا قرمز
 * می‌شود.
 *
 *  باید بیفتد:
 *   - حوزهٔ مطب پیش‌فرض روشن است؛ نورومانیتورینگ تیره (`DECISIONS.md` #۳)
 *   - سوییچ تم و چگالی کار می‌کند و روی رفرش می‌ماند
 *   - انتخابِ کاربر بر پیش‌فرضِ حوزه مقدم است (`/config` بازنویسی‌اش نمی‌کند)
 *   - در تمِ روشن زمینه واقعاً روشن است و متن تیره — با AA برای سه رنگِ برند
 *   - چگالیِ فشرده فاصله را کم می‌کند ولی اندازهٔ قلم را نه
 *  نباید بیفتد:
 *   - لانچر/ورود/لندینگ حتی با تمِ روشن تیره می‌مانند (ویترین، §۴.۸)
 *   - هیچ کادر یا حاشیه‌ای در تمِ روشن نامرئی نشود (پردهٔ سفیدِ جامانده)
 */
import { startVite, launch, mockContext } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

/** نسبتِ کنتراستِ WCAG بینِ دو رنگِ `rgb()`/`rgba()` رندرشده. */
const lum = ([r, g, b]) => {
  const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const ratio = (fg, bg) => {
  const [a, b] = [lum(parse(fg)), lum(parse(bg))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

const BRANDS = [
  { name: 'بنفشِ پیش‌فرض', color: '#7c3aed' },
  { name: 'سبزِ تیره', color: '#0f766e' },
  { name: 'نارنجی', color: '#ea580c' },
];

const visit = { id: 1, patientId: 1, kind: 'clinic', fullName: 'بیمار آزمایشی', code: 'AM-001', seq: 1, decisions: [], amount: 0, paid: 0, due: 0, opStatus: 'pending' };

const handleFor = (vertical, brandColor) => ({ path, method }) => {
  if (path === '/auth/me') return { id: 1, firstName: 'تست', lastName: 'مدیر', displayName: 'تست مدیر', levelName: 'سوپرادمین', level: 6, status: 'active' };
  if (path === '/auth/accounts') return [];
  if (path === '/config') return { vertical, brand: { color: brandColor }, verticals: [] };
  if (path === '/features') return [{ key: 'dashboard', allowed: true }, { key: 'work', allowed: true }, { key: 'formgen', allowed: true }];
  if (path === '/work/counts') return { mine: 0, role: 0, overdue: 0, total: 0 };
  /* ⚠️ `/work/today` یک **آبجکت** است نه آرایه. با `[]` صفحهٔ «امروز» موقعِ رندر
     می‌ترکید و سوییتِ تم روی صفحهٔ سفیدِ خطا ادعا می‌کرد — یعنی چکِ کنتراست
     عملاً چیزی را نمی‌دید. fixture باید شکلِ واقعی را بدهد. */
  if (path === '/work/today') return {
    brief: { greeting: 'روزِ خوش', line: '' },
    sections: { visits: true, appointments: true, intake: true, exceptions: true },
    work: [], visits: [visit], appointments: [],
    exceptions: {
      unowned: { count: 0, items: [] }, stuckEvents: { count: 0, items: [] },
      unreviewed: { count: 0, items: [] }, halfApproved: { count: 0, items: [] },
    },
  };
  if (path.startsWith('/work')) return [];
  if (path === '/visits') return { rows: [visit], total: 1, pages: 1, stats: { total: 1, pending: 1, today: 0, due: 0, kinds: [] } };
  if (path === '/forms/visit-kinds') return [{ key: 'clinic', title: 'ویزیت' }];
  if (path.startsWith('/forms')) return [];
  if (path === '/ai/status') return { enabled: false, stt: false };
  if (path === '/care-plan/timing') return {};
  if (method !== 'GET') return {};
  return [];
};

const vite = await startVite(5193);
const browser = await launch();
const shots = 'scripts/e2e/.shots';
try {
  const open = async (ctx, url) => {
    const page = await ctx.newPage();
    page.setDefaultTimeout(9000);
    await page.goto(`${vite.base}${url}`, { waitUntil: 'networkidle' });
    return page;
  };
  const themeOf = (page) => page.evaluate(() => document.documentElement.dataset.theme);
  const probe = (page) => page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    const el = document.querySelector('.db-list, .lx-shell, main, #root');
    return {
      bg: cs.backgroundColor, fg: cs.color,
      muted: el ? getComputedStyle(el).color : cs.color,
    };
  });

  console.log('۱) پیش‌فرضِ حوزه (DECISIONS #۳)');
  let m = await mockContext(browser, handleFor('clinic', '#7c3aed'), { viewport: { width: 1280, height: 860 } });
  let page = await open(m.context, '/app/dashboard');
  ok((await themeOf(page)) === 'light', `مطب → تمِ روشن (${await themeOf(page)})`);
  await m.context.close();

  m = await mockContext(browser, handleFor('ionm', '#7c3aed'), { viewport: { width: 1280, height: 860 } });
  page = await open(m.context, '/app/dashboard');
  ok((await themeOf(page)) === 'dark', `نورومانیتورینگ → تمِ تیره (${await themeOf(page)})`);
  await m.context.close();

  console.log('\n۲) کنتراستِ AA در هر دو تم، برای سه برند');
  for (const theme of ['light', 'dark']) {
    for (const b of BRANDS) {
      const c = await mockContext(browser, handleFor(theme === 'light' ? 'clinic' : 'ionm', b.color), { viewport: { width: 1280, height: 860 } });
      const p = await open(c.context, '/app/dashboard');
      const v = await probe(p);
      const r = ratio(v.fg, v.bg);
      const rm = ratio(v.muted, v.bg);
      ok(r >= 4.5, `${theme} · ${b.name} · متنِ اصلی ${r.toFixed(2)} (کفِ AA ۴.۵)`);
      ok(rm >= 4.5, `${theme} · ${b.name} · متنِ فرعی ${rm.toFixed(2)}`);
      await c.context.close();
    }
  }

  console.log('\n۳) تمِ روشن واقعاً روشن است');
  m = await mockContext(browser, handleFor('clinic', '#7c3aed'), { viewport: { width: 1280, height: 860 } });
  page = await open(m.context, '/app/dashboard');
  const light = await probe(page);
  ok(lum(parse(light.bg)) > 0.6, `زمینه روشن است (روشنایی ${lum(parse(light.bg)).toFixed(2)})`);
  ok(lum(parse(light.fg)) < 0.2, `متن تیره است (روشنایی ${lum(parse(light.fg)).toFixed(2)})`);
  await page.screenshot({ path: `${shots}/w3-6-light.png`, fullPage: false });

  console.log('\n۴) سوییچ و ماندگاری');
  await page.locator('.pm-chip').first().click();
  await page.locator('.pm-prefs').waitFor();
  await page.locator('.pm-seg').first().getByRole('button', { name: 'تیره' }).click();
  await page.waitForTimeout(250);
  ok((await themeOf(page)) === 'dark', 'سوییچ به تیره');
  ok((await page.locator('.pm-prefs').isVisible()), 'منو باز می‌ماند (نه یک کلیک، نه سه بار بازکردن)');
  await page.locator('.pm-seg').nth(1).getByRole('button', { name: 'فشرده' }).click();
  await page.waitForTimeout(200);
  const dens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { d: document.documentElement.dataset.density, gap: cs.getPropertyValue('--gap').trim(), font: getComputedStyle(document.body).fontSize };
  });
  ok(dens.d === 'compact' && dens.gap === '8px', `چگالیِ فشرده (gap=${dens.gap})`);
  await page.reload({ waitUntil: 'networkidle' });
  ok((await themeOf(page)) === 'dark', 'انتخابِ کاربر روی رفرش ماند');
  ok((await page.evaluate(() => getComputedStyle(document.body).fontSize)) === dens.font, 'چگالی اندازهٔ قلم را دست نزد');
  await page.screenshot({ path: `${shots}/w3-6-dark.png`, fullPage: false });

  console.log('\n۵) انتخابِ کاربر بر پیش‌فرضِ حوزه مقدم است (نباید بیفتد)');
  const p2 = await open(m.context, '/app/dashboard');
  await p2.waitForTimeout(400);
  ok((await themeOf(p2)) === 'dark', 'با وجودِ حوزهٔ مطب، تیره ماند');

  console.log('\n۶) ویترین همیشه تیره (§۴.۸ — نباید بیفتد)');
  /* ⚠️ لانچر و لندینگ با همین نشستِ واردشده باز می‌شوند، ولی صفحهٔ **ورود** با
     کاربرِ واردشده اصلاً رندر نمی‌شود (به اپ می‌پرد) — پس زمینهٔ خودش را
     می‌خواهد. نسخهٔ اولِ همین آزمون این را ندید و `.lg` را پیدا نمی‌کرد. */
  const veilOf = async (page, sel) => page.locator(sel).first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--veil-rgb').trim())
    .catch(() => null);
  for (const [url, sel, label] of [['/app/tools', '.lx', 'لانچر'], ['/', '.theme-dark', 'لندینگ']]) {
    const p3 = await open(m.context, url);
    const v = await veilOf(p3, sel);
    ok(v === '255, 255, 255', `${label} پردهٔ تیره را نگه داشت (${v})`);
  }
  await m.context.close();

  /* صفحهٔ ورود، با نشستِ **خارج‌شده** — همان چیزی که کاربر واقعاً می‌بیند. */
  const out = await mockContext(browser, ({ path }) => (path === '/config'
    ? { vertical: 'clinic', brand: { color: '#7c3aed' }, verticals: [] }
    : undefined), { viewport: { width: 1280, height: 860 } });
  const pOut = await open(out.context, '/login');
  await pOut.evaluate(() => { try { localStorage.setItem('amalyar_theme', 'light'); } catch { /* ناشناس */ } });
  await pOut.reload({ waitUntil: 'networkidle' });
  ok((await themeOf(pOut)) === 'light', 'کاربر تمِ روشن را انتخاب کرده');
  ok((await veilOf(pOut, '.lg')) === '255, 255, 255', 'ورود با وجودِ تمِ روشنِ کاربر تیره ماند');
  ok(out.errors.length === 0, out.errors.length ? 'خطای JSِ صفحهٔ ورود: ' + out.errors[0] : 'صفحهٔ ورود بدونِ خطای JS');
  await out.context.close();

  console.log('\n۷) در تمِ روشن هیچ متنی روی زمینه‌اش گم نمی‌شود');
  /* ⚠️ نسخهٔ اولِ این چک فقط رنگِ متن را با زمینهٔ `body` می‌سنجید و برای همین
     کور بود: متنِ سفیدِ هاردکدِ روی یک «پردهٔ» کم‌آلفا (`rgba(var(--veil-rgb),.06)`)
     در تمِ روشن سفیدِ روی سفید می‌شود ولی با زمینهٔ body یکی نیست. حالا زمینهٔ
     **مؤثر** حساب می‌شود: از خودِ المان بالا می‌رویم و هر لایهٔ نیمه‌شفاف را روی
     لایهٔ زیرش composite می‌کنیم — همان کاری که مرورگر می‌کند.
     آستانه عمداً ۳:۱ است نه ۴٫۵:۱ — این چک دنبالِ «نامرئی» است نه «کم‌کنتراست»؛
     کپشنِ کم‌رنگِ عمدی نباید کلِ سوییت را قرمز کند. */
  const c2 = await mockContext(browser, handleFor('clinic', '#7c3aed'), { viewport: { width: 1280, height: 860 } });
  const sweep = async (path) => {
    const pg = await open(c2.context, path);
    return pg.evaluate(() => {
      const px = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => {
        const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const cr = (fg, bg) => { const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
      /* رنگِ پیش‌زمینه روی پس‌زمینه — همان فرمولِ source-over مرورگر */
      const over = (fg, bg) => { const a = fg[3] ?? 1; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)); };
      /* زمینهٔ مؤثر: از والدها لایه‌لایه پایین می‌آییم تا اولین لایهٔ کاملاً مات */
      const covers = (r, t) => r.left <= t.left + 1 && r.right >= t.right - 1 && r.top <= t.top + 1 && r.bottom >= t.bottom - 1;
      const effBg = (el) => {
        const target = el.getBoundingClientRect();
        const stack = [];
        let unmeasurable = false;
        /* لایه را از پایین به بالا جمع می‌کنیم: خودِ المان، لایه‌های *پوشانندهٔ*
           پشتش، و بعد والدها. */
        const push = (n) => {
          const cs = getComputedStyle(n);
          const c = px(cs.backgroundColor);
          const a = c.length >= 3 ? (c[3] ?? 1) : 0;
          if (cs.backgroundImage && cs.backgroundImage !== 'none') {
            /* گرادیان را نمی‌شود با یک عدد سنجید. ولی اگر **رنگِ پایه‌اش مات**
               باشد (مثلِ `.lx-bg` که همان رنگِ زمینه است با یک هالهٔ کم‌آلفا
               رویش) همان پایه تقریبِ درستی است و walk ادامه می‌یابد.
               ⚠️ بدونِ این تفکیک، `.lx-bg`/`.lx-grid` — که روی **هر** صفحهٔ
               `/app` پهن‌اند — کلِ صفحه را «سنجش‌ناپذیر» می‌کردند و چک بی‌صدا
               هیچ‌چیز را نمی‌دید (سنجهٔ منفی همین را نشان داد).
               پایهٔ شفاف + گرادیان = دکمهٔ گرادیانیِ واقعی → سنجش‌ناپذیر. */
            if (a === 1) { stack.push(c); return true; }
            unmeasurable = true;
            return true;
          }
          if (a === 0) return false;
          stack.push(c);
          return a === 1;
        };
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          /* ترتیب مهم است: اول «سنجش‌ناپذیر؟» بعد «مات شد؟» — وگرنه خودِ دکمهٔ
             گرادیانی از حلقه بیرون می‌زند و گرادیانش نادیده می‌ماند. */
          const opaque = push(n);
          if (unmeasurable) return null;
          if (opaque) break;
          /* ⚠️ «قرصِ» تبِ فعال یک المانِ *برادرِ* absolute است که **پشتِ** دکمه
             کشیده می‌شود (`ui-tab-pill`)، نه پس‌زمینهٔ خودِ دکمه. بالا رفتن از
             والدها آن را نمی‌بیند و متنِ سفیدِ روی قرصِ بنفش «۲:۱» گزارش می‌شد.
             پس هر برادرِ positioned که کلِ المان را می‌پوشاند هم یک لایه است. */
          const parent = n.parentElement;
          if (!parent) continue;
          for (const sib of parent.children) {
            if (sib === n || sib.contains(el)) continue;
            const cs = getComputedStyle(sib);
            if (cs.position === 'static' || cs.visibility === 'hidden') continue;
            /* ⚠️ `z-index` منفی یعنی **پشتِ پس‌زمینهٔ خودِ والد** کشیده می‌شود، پس
               روی زمینهٔ مؤثرِ متن اثری ندارد. بدونِ این شرط `.glass-glow`
               (اسپاتلایتِ رادیالِ هر کارتِ شیشه‌ای، `z-index:-1`) «گرادیان =
               سنجش‌ناپذیر» می‌شد و **کلِ محتوای کارت‌ها از چک بیرون می‌افتاد** —
               سنجهٔ منفی همین را لو داد: با برگرداندنِ عمدیِ `#fbbf24` سوییت
               همچنان سبز ماند. */
            if (parseFloat(cs.zIndex) < 0) continue;
            if (!covers(sib.getBoundingClientRect(), target)) continue;
            const sibOpaque = push(sib);
            if (unmeasurable) break;
            if (sibOpaque) break;
          }
          if (unmeasurable) return null;
        }
        stack.push(px(getComputedStyle(document.body).backgroundColor).slice(0, 3).concat([1]));
        let bg = stack.pop().slice(0, 3);
        while (stack.length) bg = over(stack.pop(), bg);
        return bg;
      };
      const bad = [];
      for (const el of document.querySelectorAll('button, a, input, label, h1, h2, h3, p, span, small, b, td, th, li')) {
        if (el.getClientRects().length === 0) continue;
        /* فقط المانی که **خودش** متنِ دیدنی دارد، نه ظرفِ فرزندان */
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.15) continue;
        const fg = px(cs.color);
        if ((fg[3] ?? 1) < 0.15) continue;           /* عمداً محو */
        if (cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)') continue;  /* .grad-text */
        const bg = effBg(el);
        if (!bg) continue;                            /* زیرش گرادیان است — سنجش‌ناپذیر */
        const r = cr(over(fg, bg), bg);
        if (r < 3) bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} «${el.textContent.trim().slice(0, 18)}» ${r.toFixed(2)}:1`);
      }
      return bad;
    });
  };
  const routes = ['/app/dashboard', '/app', '/app/profile'];
  let badAll = [];
  for (const r of routes) badAll = badAll.concat((await sweep(r)).map((b) => `${r} → ${b}`));
  ok(badAll.length === 0, badAll.length ? `متنِ گم‌شده در تمِ روشن (${badAll.length}): ${badAll.slice(0, 6).join(' | ')}` : 'هیچ متنی روی زمینهٔ مؤثرش گم نشد');
  ok(c2.errors.length === 0, c2.errors.length ? 'خطای JS: ' + c2.errors[0] : 'بدونِ خطای JS');
  await c2.context.close();
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
