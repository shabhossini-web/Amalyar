/**
 * **CI محلی — همان گام‌های `security-ci.yml`، روی همین ماشین.**
 *
 * ⚠️ چرا لازم شد (۱۴۰۵/۰۶/۳۱): سهمیهٔ Actionsِ حساب تمام شد و گیت‌هاب به هیچ
 * جابی رانر نداد — ران ساخته می‌شد و در ۳ ثانیه با `runner_id: 0` می‌مرد. تا
 * برگشتنِ سهمیه، تأییدِ هر تغییر با همین اسکریپت انجام می‌شود و مرج دستی است.
 *
 * ⚠️ **گام‌ها از خودِ فایلِ workflow خوانده می‌شوند، نه از یک کپیِ دستی.** اگر
 * کپی می‌کردیم، اولین گامی که به CI اضافه می‌شد این‌جا جا می‌افتاد و اسکریپت
 * بی‌صدا کمتر از CI می‌سنجید — یعنی نگهبانی که دروغ می‌گوید. همان تله‌ای که
 * `--shard i/n` با مخرجِ ثابت داشت.
 *
 * چه چیزی عمداً اجرا نمی‌شود (و چرا):
 *   • گام‌های `uses:` — checkout / setup-node / cache / upload-artifact.
 *     این‌جا مخزن از قبل هست و کش معنایی ندارد.
 *   • نصبِ chromium و بسته‌هایش — سندباکس مرورگر را در `/opt/pw-browsers`
 *     دارد؛ به‌جایش همان سیم‌لینک‌هایی ساخته می‌شود که گامِ «Expose chromium»
 *     در CI می‌سازد، چون ۳۱ سوییت مسیر را هاردکد کرده‌اند.
 *   • گامِ «ساختِ دیتابیس»ِ CI — چون `ci:ci@localhost/tenant_ci` را هاردکد
 *     کرده؛ جایگزینش `resetDatabases()` است که از `DATABASE_URL` می‌خوانَد.
 *     ⚠️ `bootstrap-env.mjs` **اجرا می‌شود** (نسخهٔ اول ردش می‌کرد و ۱۰۴
 *     سوییت با «ورود نشد» قرمز شدند — توضیحِ کامل کنارِ `resetDatabases`).
 *   • شاردبندی — CI کار را بین چند رانر پخش می‌کند تا زودتر تمام شود؛ این‌جا
 *     یک ماشین است، پس کلِ مانیفست یک‌جا می‌دود.
 *
 * اجرا:
 *   node scripts/local-ci.mjs              # همه: build + live
 *   node scripts/local-ci.mjs --part build # فقط گام‌های جابِ build
 *   node scripts/local-ci.mjs --part live  # فقط سوییت‌های زندهٔ ci-live.txt
 *   node scripts/local-ci.mjs --from 40    # ادامه از گامِ ۴۰ (بعد از رفعِ یک قرمز)
 *   node scripts/local-ci.mjs --keep-db    # دیتابیس را پاک نکن (اشکال‌زدایی؛ قرمزها قابلِ‌اعتماد نیستند)
 *   node scripts/local-ci.mjs --no-retry   # تلاشِ دوم نزن (برای دیدنِ خودِ فلیک)
 *
 * گامِ افتاده **یک بار** دوباره اجرا می‌شود و اگر سبز شد با برچسبِ «فلیک» در
 * خلاصه جدا شمرده می‌شود — سبزِ تلاشِ دوم یک هشدار است، نه سبز.
 *
 * پیش‌نیاز: Postgres بالا باشد و این متغیرها ست باشند —
 *   DATABASE_URL · CONTROL_DATABASE_URL · E2E_TENANT2_DATABASE_URL
 *   TENANT_DATABASE_ENCRYPTION_KEY · JWT_SECRET · DEFAULT_TENANT_SLUG
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const PART = opt('--part', 'all');
const FROM = Number(opt('--from', 0));
const KEEP_DB = argv.includes('--keep-db');
const NO_RETRY = argv.includes('--no-retry');
const LOG_DIR = resolve(root, '.e2e-logs/local-ci');
mkdirSync(LOG_DIR, { recursive: true });

/* ⚠️ نامِ گام ملاکِ رد‌کردن است، نه شمارهٔ آن: شماره با هر گامِ تازه‌ای که به
   CI اضافه شود جابه‌جا می‌شود و بی‌صدا گامِ اشتباهی را رد می‌کند. */
const SKIP_NAMES = [
  'Install chromium for the browser suite',
  'System deps for the cached chromium',
  'Install chromium',
  'Expose chromium where the suites expect it',
  'Cache the playwright browser',
  'Keep the logs when something fails',
  /* 🔴 این یکی رد می‌شود ولی **جایگزین دارد** (`resetDatabases` پایین‌تر):
     دستورش `ci:ci@localhost/tenant_ci` را هاردکد کرده که فقط اسمِ سرویسِ
     Postgresِ CI است، و `CREATE DATABASE` تکراری هم خطا می‌دهد. */
  'Databases for the control plane and the second tenant',
];

/**
 * 🔴 **دیتابیس‌ها از صفر ساخته می‌شوند — دو درس که هر دو با قرمزشدن گرفته شدند.**
 *
 * ① نسخهٔ اول `bootstrap-env.mjs` را رد می‌کرد، با این فرضِ غلط که «رانر خودش
 *    محیط را می‌سازد». رانر فقط دیتابیسِ هر سوییت را از **قالب** بازمی‌سازد؛
 *    خودِ قالب را کسِ دیگری باید ساخته باشد. وقتی یک اجرا وسطِ کار کشته شد و
 *    قالب خراب ماند، **۱۰۴ سوییت از ۱۱۲** با «ورود نشد — ۴۰۱» قرمز شدند.
 *
 * ② نسخهٔ دوم دیتابیس را «اگر نبود بساز» می‌کرد. ولی `bootstrap-env` روی
 *    دیتابیسِ **دست‌خورده** یک ادمینِ دوم می‌سازد و ته‌ماندهٔ اجرای قبلی سرِ
 *    جایش می‌مانَد. نتیجه: `reserved-date-keys` گفت «سوپرادمینِ فعال: ۲» و
 *    منطقِ بنیان‌گذار عمداً حدس نزد؛ `desk-day` گفت «جراح یافت نشد»؛
 *    `tenant-seo` گفت سایتِ شرکت از قبل منتشر است. **چهار قرمزِ دروغین، هر
 *    چهار از یک ریشه.**
 *
 * درس: جانشینِ CI باید همان **نقطهٔ شروعِ** CI را بازتولید کند. سرویسِ
 * Postgresِ گیت‌هاب هر ران **خالی** بالا می‌آید؛ پس این هم هر بار از صفر.
 *
 * ⚠️ یعنی این تابع دیتابیس‌های نام‌برده در `DATABASE_URL` و دو خواهرش را
 * **پاک می‌کند**. آن‌ها دیتابیسِ e2e‌اند و صاحبشان همین ابزار است؛ اگر لازم
 * شد حالتِ قبلی بماند: `--keep-db` (ولی آن‌وقت قرمزها را باور نکنید).
 */
const resetDatabases = () => {
  const urls = [process.env.DATABASE_URL, process.env.CONTROL_DATABASE_URL, process.env.E2E_TENANT2_DATABASE_URL]
    .filter(Boolean);
  for (const u of urls) {
    const name = decodeURIComponent(new URL(u).pathname.slice(1));
    const admin = new URL(u); admin.pathname = '/postgres'; admin.search = '';
    const psql = (sql) => execFileSync('psql', [admin.toString(), '-v', 'ON_ERROR_STOP=1', '-qAtc', sql],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    if (KEEP_DB) { try { psql(`CREATE DATABASE "${name}"`); } catch { /* از قبل هست */ } continue; }
    /* `WITH (FORCE)` اتصال‌های جاماندهٔ سرورِ اجرای قبلی را می‌بندد. */
    psql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    psql(`CREATE DATABASE "${name}"`);
    console.log(`  \u21bb ${name} از صفر`);
  }
};
const wf = yaml.load(readFileSync(resolve(root, '.github/workflows/security-ci.yml'), 'utf8'));

/* مرورگر را همان‌جایی بگذار که سوییت‌ها دنبالش می‌گردند — آینهٔ گامِ
   «Expose chromium» در CI. */
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';
if (!existsSync(CHROME)) {
  console.error(`✗ chromium پیدا نشد: ${CHROME}\n  E2E_CHROME را ست کنید یا playwright را نصب کنید.`);
  process.exit(2);
}
for (const p of ['/tmp/chromium']) {
  try { execFileSync('ln', ['-sfn', CHROME, p]); } catch { /* اگر نشد، سوییت‌هایی که E2E_CHROME را می‌خوانند باز هم کار می‌کنند */ }
}

/**
 * 🔴 **دو اجرای هم‌زمان ممنوع — سومین قرمزِ دروغینِ همین ابزار.**
 *
 * یک‌بار سهواً دو نسخه هم‌زمان اجرا شد و نتیجه‌اش چهار گامِ قرمز بود با پیامِ
 * `Cannot find package '@electric-sql/pglite'` — بسته‌ای که سالم نصب بود.
 * علتش این است که `npm ci` پوشهٔ `node_modules` را **پاک و از نو** می‌سازد،
 * پس اجرای دوم دقیقاً وسطِ همان پنجره به بسته‌ای رسید که لحظه‌ای وجود نداشت.
 * دیتابیس‌ها هم همین‌طور: هر دو `DROP`/`CREATE` می‌کنند.
 *
 * تشخیصِ چنین قرمزی از قرمزِ واقعی سخت است و وقت می‌برد — پس همان اول جلویش
 * گرفته می‌شود. قفل با `wx` باز می‌شود (اتمی)؛ اگر مانده از اجرای کشته‌شده
 * باشد، پیام می‌گوید چه چیزی را پاک کند.
 */
const LOCK = resolve(LOG_DIR, 'running.lock');
try {
  writeFileSync(LOCK, `pid=${process.pid}\n`, { flag: 'wx' });
} catch {
  console.error(`✗ یک اجرای دیگر در جریان است (${LOCK}).`);
  console.error('  دو اجرای هم‌زمان `npm ci` و دیتابیس را زیرِ پای هم می‌کشند و قرمزِ دروغین می‌سازند.');
  console.error(`  اگر از اجرای کشته‌شده مانده: rm ${LOCK}`);
  process.exit(2);
}
const unlock = () => { try { execFileSync('rm', ['-f', LOCK]); } catch { /* رفته */ } };
process.on('exit', unlock);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { unlock(); process.exit(130); });

const REQUIRED = ['DATABASE_URL', 'CONTROL_DATABASE_URL', 'TENANT_DATABASE_ENCRYPTION_KEY', 'JWT_SECRET'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`✗ متغیرهای لازم ست نیستند: ${missing.join(' · ')}`);
  process.exit(2);
}

/**
 * 🔴 **آدرسِ اتصال‌ها همیشه از محیطِ اجراکننده می‌آید، نه از workflow.**
 *
 * جابِ `live` بلوکِ `env` خودش را دارد با مقادیرِ CI
 * (`postgresql://ci:ci@localhost:5432/control_ci`) — یعنی نامِ سرویسِ Postgresِ
 * گیت‌هاب. نسخهٔ اول env جاب را **روی** محیطِ محلی می‌ریخت و نتیجه‌اش این شد:
 * `P1010: User 'ci' was denied access on the database 'control_ci'`.
 *
 * پس این کلیدها مالِ اجراکننده‌اند و هرگز از workflow گرفته نمی‌شوند؛ بقیهٔ
 * متغیرها (مثلِ `NODE_ENV`) از خودِ workflow می‌آیند تا رفتار همان باشد.
 */
const OPERATOR_OWNED = new Set([
  'DATABASE_URL', 'CONTROL_DATABASE_URL', 'E2E_TENANT2_DATABASE_URL',
  'TENANT_DATABASE_ENCRYPTION_KEY', 'JWT_SECRET', 'DEFAULT_TENANT_SLUG',
  'E2E_CHROME', 'PGHOST', 'PGUSER', 'PGPASSWORD',
]);
const localOverrides = Object.fromEntries(
  [...OPERATOR_OWNED].filter((k) => process.env[k] != null).map((k) => [k, process.env[k]]));

const results = [];

/**
 * 🔴 **تلاشِ دوم برای گامِ افتاده — دیدنی، نه پنهان.**
 *
 * دو سوییتِ مرورگری (`tenant-site` و `company-operations-ui`) زیرِ بارِ اجرای
 * کامل می‌افتند و تنها که اجرا شوند ۴۴/۴۴ و ۷/۷ سبزند. علتش رقابت بر سرِ
 * منابع روی **یک** ماشین است؛ CI همین کار را بین چند رانر پخش می‌کند و به
 * این تنگنا نمی‌خورد. هر بار تشخیصِ این قرمز از قرمزِ واقعی چند دقیقه گرفت.
 *
 * ⚠️ ولی تلاشِ دوم **قرمز را نمی‌بلعد**: نتیجه با برچسبِ «فلیک» می‌مانَد و در
 * خلاصه جدا شمرده می‌شود. اگر تکرار شد، یعنی باید خودِ سوییت مقاوم شود — نه
 * اینکه هر بار دوباره اجرا شود. «سبز در تلاشِ دوم» یک **هشدار** است، نه سبز.
 */
const runOnce = (step, env, cwd) => {
  const started = Date.now();
  const r = spawnSync('bash', ['-lc', step.run], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, r, secs: Math.round((Date.now() - started) / 1000) };
};

const runStep = (step, idx, jobEnv) => {
  const name = step.name ?? `گام ${idx}`;
  const env = {
    ...process.env, ...(jobEnv ?? {}), ...(step.env ?? {}),
    ...localOverrides, E2E_CHROME: CHROME, CI: '1',
  };
  const cwd = step['working-directory'] ? resolve(root, step['working-directory']) : root;
  let { ok: okStep, r, secs } = runOnce(step, env, cwd);
  let flaky = false;
  if (!okStep && !NO_RETRY) {
    console.log(`  ↻ تلاشِ دوم: ${name}`);
    const again = runOnce(step, env, cwd);
    if (again.ok) { flaky = true; okStep = true; }
    r = again.r; secs += again.secs;
  }
  if (!okStep || flaky) {
    /* لاگِ کاملِ گام نگه داشته می‌شود — چه افتاده باشد چه فلیک: خروجیِ
       کوتاه‌شده در ترمینال معمولاً همان خطی را می‌بُرد که علت در آن است. */
    writeFileSync(resolve(LOG_DIR, `step-${String(idx).padStart(3, '0')}.log`),
      `# ${name}${flaky ? ' (فلیک — تلاشِ دوم سبز شد)' : ''}\n# cwd=${cwd}\n\n$ ${step.run}\n\n--- stdout ---\n${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\n`);
  }
  results.push({ idx, name, ok: okStep, flaky, secs });
  const mark = flaky ? '⚠' : okStep ? '✓' : '✗';
  console.log(`${mark} [${String(idx).padStart(3, ' ')}] ${name}${flaky ? ' — فلیک، تلاشِ دوم سبز' : ''}${secs > 2 ? ` (${secs}s)` : ''}`);
  return okStep;
};

let failed = 0;

if (PART === 'all' || PART === 'build') {
  const job = wf.jobs.build;
  const steps = job.steps.filter((s) => s.run && !s.uses && !SKIP_NAMES.includes(s.name));
  console.log(`\n══ جابِ build — ${steps.length} گام (از ${job.steps.length} گامِ workflow) ══\n`);
  steps.forEach((s, i) => {
    const idx = i + 1;
    if (idx < FROM) return;
    if (!runStep(s, idx, job.env)) failed += 1;
  });
}

if (PART === 'all' || PART === 'live') {
  const job = wf.jobs.live;
  /* گامِ شارد این‌جا **جایگزین** می‌شود (یک ماشین، کلِ مانیفست)، بقیهٔ گام‌های
     `run:` همان‌طور که در workflow هستند اجرا می‌شوند — از جمله
     `bootstrap-env.mjs` که قالبِ دیتابیس را می‌سازد. */
  const steps = job.steps.filter((s) => s.run && !s.uses && !SKIP_NAMES.includes(s.name)
    && !s.name?.startsWith('Run shard'));
  console.log(`\n══ جابِ live — ${steps.length} گامِ آماده‌سازی + کلِ مانیفستِ ci-live.txt ══\n`);
  resetDatabases();
  let prepOk = true;
  steps.forEach((s, i) => {
    const idx = `L${i + 1}`;
    if (!runStep(s, idx, job.env)) { prepOk = false; failed += 1; }
  });
  if (!prepOk) {
    console.error('\n✗ آماده‌سازیِ محیط شکست — سوییت‌ها اجرا نمی‌شوند، وگرنه همه با «ورود نشد» قرمز می‌شوند.');
    console.log(`لاگ: ${LOG_DIR}`);
    process.exit(1);
  }
  const r = spawnSync(process.execPath, [
    resolve(root, 'scripts/e2e/run-live.mjs'),
    '--manifest', resolve(root, 'scripts/e2e/ci-live.txt'),
    '--log-dir', resolve(LOG_DIR, 'live'),
  ], { cwd: root, env: { ...process.env, E2E_CHROME: CHROME }, stdio: 'inherit' });
  if (r.status !== 0) failed += 1;
  results.push({ idx: '—', name: 'run-live.mjs (کلِ مانیفست)', ok: r.status === 0, secs: 0 });
}

const red = results.filter((x) => !x.ok);
const flakes = results.filter((x) => x.flaky);
console.log(`\n${'─'.repeat(54)}`);
console.log(`سبز: ${results.length - red.length}   قرمز: ${red.length}   فلیک: ${flakes.length}`);
if (flakes.length) {
  console.log(`⚠ در تلاشِ دوم سبز شدند — اگر تکرار شد، خودِ سوییت باید مقاوم شود:\n${flakes.map((x) => `  [${x.idx}] ${x.name}`).join('\n')}`);
}
if (red.length) {
  console.log(`قرمزها:\n${red.map((x) => `  [${x.idx}] ${x.name}`).join('\n')}`);
  console.log(`لاگِ کاملِ هر گامِ افتاده: ${LOG_DIR}`);
}
process.exit(failed ? 1 : 0);
