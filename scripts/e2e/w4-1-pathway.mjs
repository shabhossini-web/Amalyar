/**
 * W4.1 — مسیرِ درمان (یافتهٔ A4).
 *
 * امروز کلِ «اتوماسیونِ مسیر» `syncPostOpVisit()` + کاشتِ یادآوری است و هر دو
 * قفلِ `kind === 'surgery'`اند؛ مطب، IVF و فیزیوتراپی هیچ مسیری ندارند. این
 * بسته همان مفهوم را داده می‌کند: الگو → نسخه → دوره → گام.
 *
 * معیارِ پذیرشِ سند:
 *   «بیمارِ دوره‌دار مراحلش را با **مسئول و موعد** ببیند»
 *   «**نسخهٔ جدید سابقه را بازنویسی نکند**»
 *
 * «نباید بیفتد»:
 *   انتشارِ نسخهٔ تازه گام‌های دورهٔ در جریان را عوض کند ·
 *   شروعِ دوره با الگویی که نسخهٔ منتشرشده ندارد ·
 *   روزِ نسبیِ منفی («۷ روز پیش از عمل») موعدِ گذشته نسازد ·
 *   نوشتن روی گامِ دورهٔ بسته‌شده ·
 *   بستنِ دوره گام‌های باز را خودکار «انجام‌شده» کند ·
 *   بالاآمدنِ دوباره الگوی ویرایش‌شدهٔ شرکت را بازنویسی کند ·
 *   گامِ بی‌کلید یا روزِ نسبیِ نجومی از اعتبارسنجی رد شود
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { browserLogin } from './lib/browser-login.mjs';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.E2E_SHOTS ?? 'docs/plan/shots';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));
const okStatus = (s) => s >= 200 && s < 300;

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'pw' + randomBytes(3).toString('hex');
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const trash = { visits: [], forms: [], episodes: [], templates: [] };
let pid = 0;

try {
  console.log('۱) الگوهای آماده خودشان می‌نشینند — فقط الگوهای حوزهٔ همین نصب، به‌علاوهٔ الگوی بی‌حوزه');
  /* بازبینیِ UX (clinic-daily-16): مطب «عملِ نورومانیتورینگ» و «کیسِ ایمپلنت» را هم می‌دید. حوزه از
     پروفایلِ نصب است نه فقط `vertical`: شرکتِ دوخدمته هر دو خدمتش را دارد. */
  const cfg = (await send('/config', 'GET')).json;
  const mine = cfg.kind === 'clinic' ? ['clinic'] : (cfg.services?.length ? cfg.services : [cfg.vertical]);
  const REG = { 'clinic-visit': 'clinic', 'ionm-surgery': 'ionm', 'implant-case': 'implant', 'followup-course': null };
  const want = Object.keys(REG).filter((k) => REG[k] === null || mine.includes(REG[k]));
  const foreign = Object.keys(REG).filter((k) => REG[k] !== null && !mine.includes(REG[k]));
  const templates = (await send('/pathway/templates', 'GET')).json;
  ok(Array.isArray(templates) && templates.length >= want.length, `الگوها آمدند (${templates?.length})`);
  const keys = new Set(templates.map((t) => t.key));
  ok(want.every((k) => keys.has(k)), `الگوهای حوزهٔ این نصب (${mine.join('+')}) هستند: ${want.join('، ')}`);
  ok(foreign.every((k) => !keys.has(k)), `🔴 **نباید بیفتد:** الگوی حوزهٔ دیگر در فهرست بیاید (${foreign.join('، ') || '—'})`);
  ok(templates.every((t) => t.publishedVersion?.steps?.length), 'هرکدام نسخهٔ منتشرشده با گام دارند');
  const ionm = templates.find((t) => t.key === 'ionm-surgery');
  ok(ionm.publishedVersion.steps.some((s) => s.offsetDays < 0),
    'الگوی عمل گامِ «پیش از عمل» با روزِ نسبیِ منفی دارد');

  console.log('۲) دوره از مراجعه شروع می‌شود و مبدأش تاریخِ عمل است');
  const form = (await send('/forms', 'POST', { key: tag, title: `عملِ ${tag}`, scope: 'visit' })).json;
  if (form?.id) trash.forms.push(form.id);
  const v = (await send('/visits', 'POST', {
    kind: tag, firstName: 'نرگسِ', lastName: `مسیر${tag}`, phone: '09120000951',
    opDate: `${day(10)}T00:00:00.000Z`,
  })).json;
  if (!v?.id) { console.error('مراجعه ساخته نشد', v); process.exit(1); }
  trash.visits.push(v.id);
  pid = num(`SELECT patient_id FROM visits WHERE id=${v.id}`);

  const started = await send('/pathway/episodes', 'POST', { patientId: pid, templateId: ionm.id, visitId: v.id });
  ok(okStatus(started.status), `دوره شروع شد (${started.status})`);
  const ep = started.json;
  trash.episodes.push(ep.id);
  ok(ep.steps.length === ionm.publishedVersion.steps.length, `همهٔ گام‌ها کپی شدند (${ep.steps.length})`);
  ok(ep.startedAt.slice(0, 10) === day(10), `مبدأ تاریخِ عمل است نه امروز (${ep.startedAt.slice(0, 10)})`);
  /* 🔴 نباید بیفتد: روزِ نسبیِ منفی موعدِ گذشته بسازد. عمل ۱۰ روزِ دیگر است و
     «۷ روز پیش از عمل» یعنی ۳ روزِ دیگر — نه هفتهٔ پیش. */
  const consent = ep.steps.find((s) => s.key === 'consent');
  ok(consent.dueAt.slice(0, 10) === day(3), `گامِ «−۷ روز» روی ${consent.dueAt.slice(0, 10)} نشست (انتظار ${day(3)})`);

  console.log('۳) مسئول و موعد دیده می‌شوند — معیارِ پذیرشِ سند');
  ok(ep.steps.every((s) => s.dueAt), 'هر گام موعد دارد');
  ok(ep.steps.every((s) => s.ownerRoleFa), 'هر گام مسئولِ فارسی‌شده دارد');
  ok(consent.ownerRoleFa === 'منشی', `نقش از JOB_ROLES ترجمه شد (${consent.ownerRoleFa})`);
  ok(ep.percent === 0 && ep.counts.total === ep.steps.length, 'درصد و شمارش از سرور می‌آید');
  ok(ep.nextStep?.key === 'consent', 'گامِ بعدی نزدیک‌ترین موعدِ باز است');

  console.log('۴) 🔴 انتشارِ نسخهٔ تازه سابقه را بازنویسی نمی‌کند');
  const before = sql(`SELECT string_agg(title, '|' ORDER BY seq) FROM episode_steps WHERE episode_id=${ep.id}`);
  const pub = await send(`/pathway/templates/${ionm.id}/publish`, 'POST', {
    steps: [{ key: 'only', title: `تنها گامِ ${tag}`, offsetDays: 0, ownerRole: 'doctor' }],
  });
  ok(okStatus(pub.status), `نسخهٔ ۲ منتشر شد (${pub.status})`);
  ok(pub.json.version === 2, `شمارهٔ نسخه بالا رفت (${pub.json.version})`);
  const after = sql(`SELECT string_agg(title, '|' ORDER BY seq) FROM episode_steps WHERE episode_id=${ep.id}`);
  ok(before === after, 'گام‌های دورهٔ در جریان **ذره‌ای** عوض نشدند');
  ok(num(`SELECT version_id FROM episodes WHERE id=${ep.id}`) === ionm.publishedVersion.id,
    'دوره هنوز به نسخهٔ ۱ اشاره می‌کند — «با کدام نسخه شروع شد؟» جواب دارد');
  ok(sql(`SELECT status FROM pathway_versions WHERE id=${ionm.publishedVersion.id}`) === 'retired',
    'نسخهٔ قبلی بازنشسته شد، نه حذف');

  console.log('۵) دورهٔ تازه نسخهٔ تازه را می‌گیرد');
  const ep2 = (await send('/pathway/episodes', 'POST', { patientId: pid, templateId: ionm.id })).json;
  trash.episodes.push(ep2.id);
  ok(ep2.steps.length === 1 && ep2.steps[0].key === 'only', 'گام‌های دورهٔ تازه از نسخهٔ ۲ آمدند');
  ok(ep2.version === 2, `دوره می‌داند با نسخهٔ ${ep2.version} شروع شده`);
  ok(ep2.startedAt.slice(0, 10) === day(0), 'بدونِ مراجعه، مبدأ امروز است');

  console.log('۶) ثبتِ مرحله — همان «برنامهٔ اختصاصیِ بیمار»');
  const marked = await send(`/pathway/steps/${consent.id}`, 'PATCH', { status: 'done' });
  ok(okStatus(marked.status), 'مرحله انجام‌شده شد');
  ok(marked.json.percent > 0, `درصد بالا رفت (${marked.json.percent}٪)`);
  ok(marked.json.nextStep?.key !== 'consent', 'گامِ بعدی جلو رفت');
  const moved = await send(`/pathway/steps/${ep.steps[1].id}`, 'PATCH', { dueAt: `${day(30)}T00:00:00.000Z`, title: `عنوانِ اختصاصیِ ${tag}` });
  ok(okStatus(moved.status), 'موعد و عنوانِ همان بیمار جابه‌جا شد');
  ok(sql(`SELECT title FROM episode_steps WHERE id=${ep.steps[1].id}`) === `عنوانِ اختصاصیِ ${tag}`,
    'override روی گامِ همین بیمار نشست');
  /* 🔴 نباید بیفتد: override روی الگو یا دورهٔ دیگری اثر بگذارد. */
  ok(sql(`SELECT title FROM episode_steps WHERE episode_id=${ep2.id} ORDER BY seq LIMIT 1`) === `تنها گامِ ${tag}`,
    'دورهٔ دیگر دست‌نخورده ماند');

  console.log('۷) بستنِ دوره');
  const openBefore = num(`SELECT count(*) FROM episode_steps WHERE episode_id=${ep.id} AND status='pending'`);
  const closed = await send(`/pathway/episodes/${ep.id}/close`, 'POST', { status: 'done' });
  ok(okStatus(closed.status), 'دوره بسته شد');
  /* 🔴 نباید بیفتد: بستنِ دوره گام‌های باز را خودکار «انجام‌شده» کند — گزارشِ
     «چند درصدِ دوره‌ها کامل شدند» برای همیشه دروغ می‌شد. */
  ok(num(`SELECT count(*) FROM episode_steps WHERE episode_id=${ep.id} AND status='pending'`) === openBefore,
    `گام‌های باز همان‌طور ماندند (${openBefore} تا)`);
  const late = await send(`/pathway/steps/${ep.steps[2].id}`, 'PATCH', { status: 'done' });
  ok(late.status === 403, `نوشتن روی گامِ دورهٔ بسته رد شد (${late.status})`);

  console.log('۸) اعتبارسنجیِ الگو — همان تابع برای کد و کاربر');
  const bad = [
    [[], 'فهرستِ خالی'],
    [[{ key: 'a b', title: 'x', offsetDays: 0 }], 'کلیدِ نامعتبر'],
    [[{ key: 'a', title: '', offsetDays: 0 }], 'عنوانِ خالی'],
    [[{ key: 'a', title: 'x', offsetDays: 99999 }], 'روزِ نسبیِ نجومی'],
    [[{ key: 'a', title: 'x', offsetDays: 0 }, { key: 'a', title: 'y', offsetDays: 1 }], 'کلیدِ تکراری'],
  ];
  for (const [steps, why] of bad) {
    const r = await send(`/pathway/templates/${ionm.id}/publish`, 'POST', { steps });
    ok(r.status === 400, `${why} رد شد (${r.status})`);
  }
  /* 🔴 نباید بیفتد: روزِ نسبیِ منفیِ **معقول** هم رد شود — آن یکی معنی‌دار است. */
  const negative = await send(`/pathway/templates/${ionm.id}/publish`, 'POST', {
    steps: [{ key: 'pre', title: 'آماده‌سازی', offsetDays: -14, ownerRole: 'nurse' }],
  });
  ok(okStatus(negative.status), `روزِ نسبیِ −۱۴ پذیرفته شد (${negative.status})`);

  console.log('۹) بالاآمدنِ دوباره الگوی شرکت را بازنویسی نمی‌کند');
  const again = (await send('/pathway/templates', 'GET')).json.find((t) => t.key === 'ionm-surgery');
  /* 🔴 نباید بیفتد: خودسیدکردن روی نسخهٔ منتشرشدهٔ شرکت بریزد. */
  ok(again.publishedVersion.steps.length === 1 && again.publishedVersion.steps[0].key === 'pre',
    'نسخهٔ منتشرشدهٔ شرکت سرِ جایش ماند، نه گام‌های کارخانه');

  console.log('۱۰) شروع بدونِ نسخهٔ منتشرشده');
  const drafty = num(`INSERT INTO pathway_templates(key, title, builtin, active, created_at, updated_at)
    VALUES ('draft-${tag}', 'الگوی بی‌نسخهٔ ${tag}', false, true, now(), now()) RETURNING id`);
  trash.templates.push(drafty);
  const noVersion = await send('/pathway/episodes', 'POST', { patientId: pid, templateId: drafty });
  ok(noVersion.status === 400, `شروع با الگوی بی‌نسخه رد شد (${noVersion.status})`);
  ok(String(noVersion.json?.message ?? '').includes('نسخه'), 'پیام فارسی و دربارهٔ نسخه است');

  console.log('۱۱) پرونده — مرحله‌ها با مسئول و موعد دیده می‌شوند');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    /* دورهٔ تازه روی همان بیمار، چون دورهٔ بخشِ ۷ بسته شد و دکمه نمی‌خواهد.
       ⚠️ الگوی **بی‌حوزه** («دورهٔ پیگیری»): فهرست حالا با حوزهٔ نصب فیلتر می‌شود و «ویزیتِ مطب»
       در نصبِ نورومانیتورینگ نیست. */
    const clinic = (await send('/pathway/templates', 'GET')).json.find((t) => t.key === 'followup-course');
    const shown = (await send('/pathway/episodes', 'POST', { patientId: pid, templateId: clinic.id })).json;
    trash.episodes.push(shown.id);

    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const noise = [];
    page.on('console', (m) => { if (m.type() === 'error') noise.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) noise.push(`${r.status()} ${r.url()}`); });
    await browserLogin(page, login.accessToken, { ui: UI });
    await page.goto(`${UI}/app/patients/${pid}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.rc-path', { timeout: 15000 });

    /* ⚠️ این بیمار **چند دوره** دارد و هر کدام بخشِ خودش را می‌گیرد؛ شمردنِ
       `.rc-path-step` روی کلِ صفحه جمعِ همه را می‌دهد. سنجه باید به بخشِ
       همان دوره مقید باشد — وگرنه با هر دورهٔ تازه بی‌ربط قرمز می‌شود. */
    const sections = await page.locator('.rc-path').count();
    ok(sections === (await send(`/pathway/episodes?patientId=${pid}`, 'GET')).json.length,
      `هر دوره بخشِ خودش را دارد (${sections})`);
    const box = page.locator('.rc-path').first();   // تازه‌ترین دوره اول است
    const steps = await box.locator('.rc-path-step').count();
    ok(steps === clinic.publishedVersion.steps.length, `مرحله‌های همان دوره رندر شدند (${steps})`);
    /* 🔴 نباید بیفتد: بخشِ تازه از عرضِ محتوای صفحه بیرون بزند. عرض در
       `record.css` یک قاعدهٔ مشترک است (`.rc-stage, .rc-next, .rc-tl`) و
       جاافتادن از آن فقط با چشم دیده می‌شود — این سنجه همان چشم است. */
    const widths = await page.evaluate(() => {
      const w = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().width) : 0; };
      return { path: w('.rc-path'), next: w('.rc-next'), stage: w('.rc-stage') };
    });
    ok(widths.path > 0 && Math.abs(widths.path - (widths.next || widths.stage)) <= 2,
      `عرضِ بخش با بقیهٔ صفحه یکی است (${widths.path} در برابر ${widths.next || widths.stage})`);
    const first = await box.locator('.rc-path-step').first().innerText();
    ok(/پزشک|منشی|پرستار|دستیار|کارشناس/.test(first), `مسئول دیده می‌شود — «${first.replace(/\s+/g, ' ').slice(0, 48)}»`);
    ok(/\d|[۰-۹]/.test(first), 'موعد دیده می‌شود');

    /* ثبت از خودِ پرونده، نه فقط API. */
    await box.locator('.rc-path-step').first().getByRole('button', { name: 'انجام شد' }).click();
    await page.waitForFunction(() => document.querySelector('.rc-path-step.st-done'), null, { timeout: 8000 });
    ok(true, 'مرحله از خودِ پرونده ثبت شد');

    /* «دیده می‌شود؟» را `getComputedStyle` جواب نمی‌دهد — هر دو تم (قانون ۲۳). */
    const probe = () => page.evaluate(() => {
      const px = (c) => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d);
        const v = getComputedStyle(d).color; d.remove();
        const m = v.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
      const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
      const lum = (c) => { const g = (u) => { u /= 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * g(c.r) + 0.7152 * g(c.g) + 0.0722 * g(c.b); };
      const stack = (el) => { let bg = px(getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#000');
        const chain = []; for (let n = el; n; n = n.parentElement) chain.unshift(n);
        for (const n of chain) { const c = px(getComputedStyle(n).backgroundColor); if (c.a > 0) bg = over(c, bg); } return bg; };
      const ratio = (sel) => { const el = document.querySelector(sel); if (!el) return 0;
        const L1 = lum(over(px(getComputedStyle(el).color), stack(el.parentElement))), L2 = lum(stack(el));
        return Math.round((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) * 100) / 100; };
      return {
        title: ratio('.rc-path-head b'), count: ratio('.rc-path-head small'),
        step: ratio('.rc-path-main b'), owner: ratio('.rc-path-when small'),
        act: ratio('.rc-path-acts button'),
      };
    });
    for (const theme of ['dark', 'light']) {
      await page.evaluate((x) => document.documentElement.setAttribute('data-theme', x), theme);
      await page.waitForTimeout(220);
      const r = await probe();
      await page.screenshot({ path: `${SHOTS}/w4-1-pathway-${theme}.png` });
      for (const [k, val] of Object.entries(r)) {
        /* متنِ کمکی (شمارش/مسئول) عمداً کم‌رنگ‌تر است — کفش ۴٫۵ نیست. */
        const floor = k === 'count' || k === 'owner' ? 3.5 : 4.5;
        ok(val >= floor, `تمِ ${theme === 'dark' ? 'تیره' : 'روشن'}: ${k} = ${val}`);
      }
    }
    ok(noise.length === 0, `بدونِ خطای کنسول/شبکه${noise.length ? ' — ' + noise.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
  }
} finally {
  for (const id of trash.episodes) sql(`DELETE FROM episodes WHERE id=${id}`);
  if (pid) sql(`DELETE FROM episodes WHERE patient_id=${pid}`);
  for (const id of trash.templates) sql(`DELETE FROM pathway_templates WHERE id=${id}`);
  /* الگوهای کارخانه‌ای که این تست نسخه‌شان را عوض کرد، تا اجرای بعدی تمیز شوند. */
  sql(`DELETE FROM pathway_templates WHERE key IN ('clinic-visit','ionm-surgery','implant-case','followup-course')`);
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
}

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
