/**
 * راهنمای دستیارِ هوشمند — **به‌روز و مخصوصِ نوعِ همین نصب** (`server/src/ai/assistant-knowledge.ts`).
 * خالص؛ بدونِ سرور و دیتابیس (کدِ سرور با esbuild بسته می‌شود، مثلِ `tenant-profile-unit.mjs`).
 *
 * زمینه (مالک، ۱۴۰۵/۰۷/۱۵): «دستیارِ هوشمندِ سایت را چک کن به‌روز باشد و گیج نزند.» دو ریشه:
 *  ۱. راهنما برای همه یکی بود: مدیرِ مطب دربارهٔ چینشِ نیروها/حمل‌ونقل/انبار می‌شنید و مدیرِ شرکت دربارهٔ
 *     «فهرستِ انتظارِ عمل» — صفحه‌ای که کاربر هرگز نمی‌دید.
 *  ۲. ماژول‌های تازه (میزِ پذیرش، اتاقِ عمل، فهرستِ انتظار، مسیرِ درمان، کارهای من، سایت) فقط یک خطِ بی‌نشانی
 *     داشتند؛ دستیار نمی‌دانست «میزِ پذیرش کجاست».
 *
 *  باید بیفتد:
 *   - هر ماژولِ رجیستری مسیر دارد، و آن مسیر در `App.jsx` هست (راهنما به صفحهٔ ناموجود ارجاع نمی‌دهد)
 *   - هر `/app/...`ی که در متنِ راهنما آمده در برنامه هست
 *   - بندِ یک‌ماژوله با خاموش‌شدنِ همان ماژول از راهنما می‌افتد
 *   - هیچ نصبی نشانیِ ماژولِ **خاموشِ** خودش را در راهنما نمی‌بیند (مطب: بی‌چینش/حمل/انبار؛ شرکت: بی‌فهرستِ انتظار)
 *   - پیشنهادهای شروعِ رابط دو دسته دارند و واژگانِ نوعِ دیگر را نمی‌آورند
 *   - سرور راهنما را از `assistantGuide(...)` می‌سازد، نه متنِ ثابت
 *  نباید بیفتد:
 *   - مطب بندِ فهرستِ انتظار و میزِ پذیرش را دارد؛ شرکت بندِ چینش، حمل‌ونقل و انبار را
 *   - بندِ بی‌نوع/بی‌ماژول (پروفایل، تعاریف) همیشه می‌آید
 *   - اندازهٔ راهنما از سقفِ پنجرهٔ زمینه کمتر می‌ماند
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = (rel, name) => {
  const out = join(mkdtempSync(join(tmpdir(), 'ag-')), `${name}.mjs`);
  execFileSync('npx', ['--yes', 'esbuild', resolve(root, rel), '--bundle', '--platform=node', '--format=esm',
    `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' });
  return import(pathToFileURL(out).href);
};
const K = await bundle('server/src/ai/assistant-knowledge.ts', 'knowledge');
const R = await bundle('server/src/auth/access-registry.ts', 'registry');
const P = await bundle('server/src/config/tenant-profile.ts', 'profile');
const L = await bundle('server/src/patients/labels.ts', 'labels');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

let pass = 0; const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fails.push(m); console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

/* مسیرهای واقعیِ برنامه: `path="/app/..."` در `App.jsx` — `:id` به‌صورتِ پیشوند. */
const appSrc = read('src/App.jsx');
const appRoutes = new Set([...appSrc.matchAll(/path="(\/app[^"]*)"/g)].map((m) => m[1]));
const routeExists = (p) => appRoutes.has(p)
  || [...appRoutes].some((r) => r.includes('/:') && p.replace(/\/$/, '') === r.slice(0, r.indexOf('/:')));
const pathsIn = (text) => [...text.matchAll(/\/app\/[a-z0-9_/-]*[a-z0-9_]/g)].map((m) => m[0]);

console.log('۱) ماژول‌ها و مسیرها — راهنما با برنامه یکی است');
const moduleKeys = R.FEATURES.filter((f) => f.group === 'modules').map((f) => f.key);
ok(moduleKeys.length >= 15, `رجیستری ${moduleKeys.length} ماژول دارد`);
const noRoute = moduleKeys.filter((k) => !K.FEATURE_ROUTES[k]);
ok(noRoute.length === 0, '**هر ماژولِ رجیستری مسیر دارد** (دستیار نمی‌پرسد «کجاست»)', noRoute.join(','));
const extra = Object.keys(K.FEATURE_ROUTES).filter((k) => !moduleKeys.includes(k));
ok(extra.length === 0, 'مسیرِ بی‌ماژول نداریم', extra.join(','));
const missingInApp = Object.entries(K.FEATURE_ROUTES).filter(([, p]) => !routeExists(p)).map(([k, p]) => `${k}:${p}`);
ok(missingInApp.length === 0, '**هر مسیرِ ماژول در App.jsx هست**', missingInApp.join(' '));
const stray = [...new Set(K.GUIDE.flatMap((e) => pathsIn(e.text)))].filter((p) => !routeExists(p));
ok(stray.length === 0, '**هر /app/... در متنِ راهنما صفحهٔ واقعی است**', stray.join(' '));
const badMods = K.GUIDE.flatMap((e) => e.modules ?? []).filter((m) => !moduleKeys.includes(m));
ok(badMods.length === 0, 'کلیدِ ماژولِ هر بند در رجیستری هست', badMods.join(','));
ok(K.GUIDE.every((e) => !e.kind || e.kind === 'clinic' || e.kind === 'company'), 'نوعِ هر بند clinic یا company است');
ok(K.GUIDE.every((e) => e.text && e.text.length > 20), 'هر بند متن دارد');

console.log('\n۲) هر نصب فقط راهنمای خودش را می‌گیرد');
const profiles = [
  ['مطب', 'clinic', []],
  ['شرکت — نورومانیتورینگ', 'company', ['ionm']],
  ['شرکت — ایمپلنت', 'company', ['implant']],
  ['شرکت — هر دو خدمت', 'company', ['ionm', 'implant']],
];
const ctxOf = (kind, services) => ({ kind, services, enabled: new Set(Object.keys(P.featurePlanForProfile(kind, services))) });
const guides = {};
for (const [label, kind, services] of profiles) {
  const ctx = ctxOf(kind, services);
  const g = K.assistantGuide(ctx);
  guides[label] = g;
  const offRoutes = Object.entries(K.FEATURE_ROUTES).filter(([k]) => !ctx.enabled.has(k));
  const leaked = offRoutes.filter(([, p]) => new RegExp(`${p.replace(/[/]/g, '\\/')}(?![a-z0-9_-])`).test(g)).map(([k, p]) => `${k}:${p}`);
  ok(leaked.length === 0, `${label}: **هیچ نشانیِ ماژولِ خاموش در راهنما نیست**`, leaked.join(' '));
  const stray2 = [...new Set(pathsIn(g))].filter((p) => !routeExists(p));
  ok(stray2.length === 0, `${label}: همهٔ نشانی‌ها واقعی‌اند`, stray2.join(' '));
  ok(g.length < 24000, `${label}: اندازهٔ راهنما در سقف (${g.length} نویسه)`);
  ok(/\/app\/profile/.test(g) && /\/app\/definitions/.test(g) && /\/app\/settings/.test(g), `${label}: بندهای همیشگیِ پروفایل/تعاریف/تنظیمات هست`);
}
const clinic = guides['مطب'];
const ionm = guides['شرکت — نورومانیتورینگ'];
ok(/\/app\/waitlist/.test(clinic) && /\/app\/frontdesk/.test(clinic), 'مطب: فهرستِ انتظار و میزِ پذیرش را می‌داند');
ok(!/\/app\/(dispatch|transport|inventory|tech)\b/.test(clinic), '**مطب: چینش/حمل/انبار/پنلِ کارشناسی را نمی‌شنود**');
/* «ست‌ها» زیرنویسِ «نشست‌ها» هم هست — پیشوندِ فاصله/نقل‌قول لازم است تا همان را نگیرد. */
const clinicRest = clinic.split('\n').filter((l) => !l.startsWith('/app/settings')).join('\n');
ok(!/ایمپلنت|نورومانیتورینگ|(^|[\s«(])ست‌ها|حواله/.test(clinicRest),
  '**مطب: واژگانِ شرکتیِ خدمات/ست/حواله در راهنما نیست** (جز توضیحِ تعویضِ نوعِ نصب)',
  clinicRest.split('\n').filter((l) => /ایمپلنت|نورومانیتورینگ|(^|[\s«(])ست‌ها|حواله/.test(l)).map((l) => l.slice(0, 60)).join(' || '));
ok(/^میزِ پزشک \(\/app\/surgeon\)/m.test(clinic) && !/شرکت‌های نورو/.test(clinic), 'مطب: سطرِ پرتالِ جراح «میزِ پزشک» است نه متنِ شرکتی');
ok(/\/app\/dispatch/.test(ionm) && /\/app\/inventory/.test(ionm) && /\/app\/transport/.test(ionm), 'شرکت: چینش، انبار و حمل‌ونقل را می‌داند');
ok(!/\/app\/waitlist|فهرستِ انتظارِ عمل/.test(ionm), '**شرکت: فهرستِ انتظارِ عمل را نمی‌شنود**');
ok(/تحویل دوطرفه/.test(ionm) && /ست = یک بستهٔ موجودی/.test(ionm), 'شرکت: تحویلِ دوطرفه و ستِ موجودی را می‌داند');
ok(/«نامِ فرم»/.test(clinic) && /09…/.test(clinic), 'مطب: «نامِ فرم» و قاعدهٔ +98 را می‌داند');
ok(/نوبتِ شما ثبت شد/.test(clinic) && /نوبتِ شما ثبت شد/.test(ionm), 'هر دو: تأییدِ نوبتِ انتخاب‌شده را می‌دانند');
ok(/پاسخ و پیوست‌ها/.test(clinic) && /پاسخ و پیوست‌ها/.test(ionm), 'هر دو: ویسِ مشاوره زیرِ «پاسخ و پیوست‌ها» را می‌دانند');
ok(/چرخهٔ عمر|نسخهٔ آزمایشی/.test(clinic) && /نسخهٔ آزمایشی/.test(ionm), 'هر دو: چرخهٔ عمرِ حساب (دمو/مهلت) را می‌دانند');
/* بازبینیِ ۱۴۰۵/۰۷/۱۹: ماژول کافی نبود — «فاکتورِ نورو» به `dashboard` بسته بود که شرکتِ فقط‌ایمپلنت هم دارد. */
const implant = guides['شرکت — ایمپلنت'];
/* نامِ خدمت («نورومانیتورینگ») در توضیحِ نوعِ نصب مجاز است؛ چیزی که نباید بیاید صفحه/قابلیتِ مخصوصِ نورو است. */
const NEURO_ONLY = /فاکتور نورو|پیش‌فرض نورو/;
ok(!NEURO_ONLY.test(implant), '**شرکتِ فقط‌ایمپلنت دربارهٔ فاکتور/مصرفیِ نورو نمی‌شنود**',
  implant.split('\n').filter((l) => NEURO_ONLY.test(l)).map((l) => l.slice(0, 70)).join(' || '));
ok(/فاکتور نورو/.test(ionm) && /فاکتور نورو/.test(guides['شرکت — هر دو خدمت']), 'شرکتِ نورو (تنها یا با ایمپلنت) فاکتورِ نورو را می‌داند');
const waitLine = clinic.split('\n').find((l) => l.startsWith('/app/waitlist')) ?? '';
const missingStatus = Object.values(L.WAITLIST_LABELS).filter((x) => !waitLine.includes(x));
ok(missingStatus.length === 0, '**فهرستِ انتظار همهٔ وضعیت‌های خودِ کد را می‌گوید** (از WAITLIST_LABELS)', missingStatus.join(' | '));
ok(/بستنِ تصمیم انتخابِ دلیل می‌خواهد/.test(waitLine) && /بازکردنِ دوباره‌اش دلیل نمی‌خواهد/.test(waitLine), 'فقط بستنِ تصمیم دلیل می‌خواهد، نه بازکردنش');
/* هر «…» در راهنما که شبیهِ وضعیتِ سفارش است باید برچسبِ واقعیِ ORDER_LABELS باشد. */
const orderish = [...new Set(K.GUIDE.flatMap((e) => [...e.text.matchAll(/«([^»]*(?:پاسخ آمد|نتیجه آمد)[^»]*)»/g)].map((m) => m[1])))];
ok(orderish.length > 0 && orderish.every((x) => Object.values(L.ORDER_LABELS).includes(x)), '**وضعیتِ سفارشِ نقل‌شده در راهنما برچسبِ واقعیِ کد است**', orderish.join(' | '));
ok(!/پاسخِ سفارش\) شمارهٔ موبایل|نوبت، پاسخِ سفارش/.test(clinic), 'ادعای «+98» فقط برای فرم‌هایی است که واقعاً شماره می‌گیرند');
const noDash = K.assistantGuide({ kind: 'clinic', services: [], enabled: new Set([...ctxOf('clinic', []).enabled].filter((x) => x !== 'dashboard')) });
ok(/\/app\/settings — سربرگ/.test(noDash), '**تنظیمات به ماژولِ داشبورد بسته نیست** (با خاموشیِ آن هم راهنمایش می‌ماند)');

console.log('\n۳) بندِ یک‌ماژوله با خاموش‌شدنِ همان ماژول می‌افتد (باید بیفتد)');
for (const [label, kind, services] of profiles) {
  const ctx = ctxOf(kind, services);
  const baseline = K.assistantGuide(ctx);
  let checked = 0; const bad = [];
  for (const m of ctx.enabled) {
    const without = K.assistantGuide({ kind, services, enabled: new Set([...ctx.enabled].filter((x) => x !== m)) });
    /* هر بندی که m جزوِ شرطش است، با خاموشیِ m باید بیفتد («همه» نه «یکی از»). */
    const lost = K.GUIDE.filter((e) => e.modules?.includes(m) && K.guideApplies(e, ctx));
    for (const e of lost) { checked++; if (without.includes(e.text) || !baseline.includes(e.text)) bad.push(`${m}`); }
    /* سطرِ ماژول با نشانیِ پرانتزی‌اش شناخته می‌شود، نه برچسب — همان‌طور سطرِ جایگزینِ مطب («میزِ پزشک (/app/surgeon)») هم سنجیده می‌شود. */
    if (K.FEATURE_ROUTES[m]) {
      checked++;
      if (!baseline.includes(`(${K.FEATURE_ROUTES[m]})`)) bad.push(`${m}:سطرِ ماژول نبود`);
      if (without.includes(`(${K.FEATURE_ROUTES[m]})`)) bad.push(`${m}:سطرِ ماژول ماند`);
    }
  }
  ok(bad.length === 0 && checked > 0, `${label}: خاموشیِ هر ماژول بندهایش را برمی‌دارد (${checked} سنجه)`, bad.join(',') || `checked=${checked}`);
}
const none = K.assistantGuide({ kind: 'company', enabled: new Set() });
ok(!/\/app\/(dispatch|waitlist|inventory)/.test(none) && /\/app\/profile/.test(none), 'نصبِ بی‌ماژول فقط بندهای همیشگی را می‌گیرد، نه همه را');
ok(K.assistantGuide(ctxOf('clinic', [])) === K.assistantGuide(ctxOf('clinic', [])), 'خروجی قطعی است (دو بار یکی)');

console.log('\n۴) رابط و سرور با همین راهنما سیم‌کشی‌اند');
const ai = read('server/src/ai/ai.service.ts');
ok(/assistantGuide\(\s*\{\s*kind: profile\.kind, enabled, services: profile\.services \}\s*\)/.test(ai), '**سرور راهنما را از assistantGuide(...) با نوع، ماژول‌ها و خدمات می‌سازد**');
ok(!/ASSISTANT_GUIDE/.test(ai), 'متنِ ثابتِ ASSISTANT_GUIDE برنگشته');
ok(!/سامانهٔ مدیریتِ کلینیک هستی/.test(ai), 'هویتِ دستیار «کلینیک»ِ ثابت نیست (از نوعِ نصب می‌آید)');
ok(/seedFeatureRows\(this\.prisma, profile\)/.test(ai), 'ماژولِ نصبِ تازه (ردیفِ نساخته) هم به پلانِ نوعش دیده می‌شود');
const asst = read('src/app/Assistant.jsx');
const block = asst.slice(asst.indexOf('const STARTERS = {'), asst.indexOf('};', asst.indexOf('const STARTERS = {')));
const starterRows = (k) => [...(block.split(new RegExp(`\\b${k}: \\[`))[1] ?? '').split('\n  ],')[0]
  .matchAll(/\{ text: '([^']+)'(?:, services: \[([^\]]*)\])? \}/g)].map((m) => ({ text: m[1], services: m[2] ? [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]) : null }));
const startersOf = (k) => starterRows(k).map((r) => r.text);
const sc = startersOf('clinic'); const sy = startersOf('company');
/* شرکتِ فقط‌ایمپلنت چینش و پنلِ کارشناسی ندارد — پیشنهادِ کارشناسان فقط با خدمتِ نورو. */
const forImplant = starterRows('company').filter((r) => !r.services || r.services.includes('implant')).map((r) => r.text);
ok(forImplant.length >= 3 && !forImplant.some((q) => /کارشناس|تحویل/.test(q)), '**پیشنهادهای شرکتِ فقط‌ایمپلنت از کارشناسان/تحویل نمی‌پرسند**', forImplant.join(' | '));
ok(/startersFor\(kind, services\)/.test(asst), 'رابط پیشنهاد را با خدماتِ /config می‌چیند');
ok(sc.length >= 3 && sy.length >= 3, `پیشنهادهای شروع برای هر دو نوع هست (${sc.length} / ${sy.length})`);
ok(!sc.some((q) => /چینش|حمل|کارشناسان|ست |مصرفی/.test(q)), '**پیشنهادهای مطب واژگانِ شرکت را ندارند**', sc.join(' | '));
ok(!sy.some((q) => /انتظارِ عمل|میزِ پذیرش|اتاقِ عمل/.test(q)), '**پیشنهادهای شرکت واژگانِ مطب را ندارند**', sy.join(' | '));
ok(/STARTERS\[kind\] \?\? STARTERS\.company/.test(asst), 'رابط پیشنهاد را از kindِ /config می‌خواند');

console.log(`\nسبز: ${pass}  قرمز: ${fails.length}`);
if (fails.length) process.exit(1);
