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
 *
 * ⚡ **هم‌زمانی — از حدودِ یک ساعت به حدودِ ۲۵ دقیقه (۱۴۰۵/۰۷/۰۳).** اجرای
 * پشت‌سرِهم ۳۴ دقیقه جابِ build و ۲۸ دقیقه جابِ live می‌برد و مالک گفت «یک ساعت
 * زیاد است». هیچ گامی کم نشده؛ فقط هم‌زمان می‌دوند:
 *   • گام‌های جابِ build در یک استخرِ `--jobs` تایی (پیش‌فرض ۳). گامی که
 *     `npm ci`/build می‌زند «سد» است و تنها اجرا می‌شود؛ دو گامی که یک پورتِ
 *     ثابت دارند هرگز هم‌زمان نمی‌شوند؛ گامِ مرورگری سقفِ جدا دارد. ترتیب
 *     «درازترین اول» است، از روی زمان‌های اجرای قبل (`timings.json`).
 *   • جابِ live بین `--shards` شاردِ موازی (پیش‌فرض ۳) پخش می‌شود، هرکدام با
 *     دیتابیس و پورتِ خودش — همان کاری که CI با ماتریس روی چند ماشین می‌کند.
 *     سوییت‌هایی که یک پورتِ ثابت را `listen` می‌کنند (سرورِ ساختگیِ AI روی
 *     ۳۱۹۹) با هم در یک شارد می‌مانند، و سوییتی که پورتِ پیش‌فرضِ API/UI را
 *     ثابت نوشته باشد فقط در شاردِ ۰ جا دارد (با هشدار) — تشخیص از خودِ متنِ
 *     سوییت است، نه از یک فهرستِ دستی.
 *   • تلاشِ دومِ افتاده‌ها **بعد از** خالی‌شدنِ استخر و تنها انجام می‌شود:
 *     قرمزِ ناشی از بار، زیرِ همان بار دوباره قرمز می‌شود.
 *   • `--jobs 1 --shards 1` همان اجرای قدیمیِ پشت‌سرِهم است.
 *
 * اجرا:
 *   node scripts/local-ci.mjs              # همه: build + live
 *   node scripts/local-ci.mjs --part build # فقط گام‌های جابِ build
 *   node scripts/local-ci.mjs --part live  # فقط سوییت‌های زندهٔ ci-live.txt
 *   node scripts/local-ci.mjs --from 40    # ادامه از گامِ ۴۰ (بعد از رفعِ یک قرمز)
 *   node scripts/local-ci.mjs --jobs 2     # چند گامِ build هم‌زمان (پیش‌فرض: min(3, هسته‌ها − ۱))
 *   node scripts/local-ci.mjs --shards 2   # چند شاردِ live هم‌زمان (پیش‌فرض: همان --jobs)
 *   node scripts/local-ci.mjs --keep-db    # دیتابیس را پاک نکن (اشکال‌زدایی؛ قرمزها قابلِ‌اعتماد نیستند)
 *   node scripts/local-ci.mjs --no-retry   # تلاشِ دوم نزن (برای دیدنِ خودِ فلیک)
 *
 * گامِ افتاده **یک بار** دوباره اجرا می‌شود و اگر سبز شد با برچسبِ «فلیک» در
 * خلاصه جدا شمرده می‌شود — سبزِ تلاشِ دوم یک هشدار است، نه سبز.
 *
 * پیش‌نیاز: Postgres بالا باشد و این متغیرها ست باشند —
 *   DATABASE_URL · CONTROL_DATABASE_URL · E2E_TENANT2_DATABASE_URL
 *   TENANT_DATABASE_ENCRYPTION_KEY · JWT_SECRET · DEFAULT_TENANT_SLUG
 * شاردِ k ≥ ۱ همان دیتابیس‌ها را با پسوندِ `_s<k>` می‌سازد (کاربرِ Postgres باید
 * CREATEDB داشته باشد — همان‌طور که `resetDatabases` از قبل لازم داشت).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus } from 'node:os';
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
const JOBS = Math.max(1, Math.floor(Number(opt('--jobs', Math.min(3, Math.max(1, cpus().length - 1))))) || 1);
const SHARDS = Math.max(1, Math.floor(Number(opt('--shards', JOBS))) || 1);
/* مرورگر (Chromium + Vite) سنگین‌ترین نوعِ گام است و آزمون‌های زمان‌حساس (بسته‌شدنِ
   شیت در ۵۰۰ms، انیمیشن) زیرِ بارِ سه مرورگرِ هم‌زمان می‌لغزند؛ یک جا برای
   گام‌های سبک‌تر (pglite، نگهبان‌های ایستا) خالی می‌ماند. */
const BROWSER_MAX = Math.max(1, JOBS - 1);
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
 * **پاک می‌کند** (و در شاردهای بعدی، همان‌ها با پسوندِ `_s<k>`). آن‌ها دیتابیسِ
 * e2e‌اند و صاحبشان همین ابزار است؛ اگر لازم شد حالتِ قبلی بماند: `--keep-db`
 * (ولی آن‌وقت قرمزها را باور نکنید).
 */
const resetDatabases = (urls) => {
  for (const u of urls.filter(Boolean)) {
    const name = decodeURIComponent(new URL(u).pathname.slice(1));
    const admin = new URL(u); admin.pathname = '/postgres'; admin.search = '';
    const psql = (sql) => execFileSync('psql', [admin.toString(), '-v', 'ON_ERROR_STOP=1', '-qAtc', sql],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    if (KEEP_DB) { try { psql(`CREATE DATABASE "${name}"`); } catch { /* از قبل هست */ } continue; }
    /* `WITH (FORCE)` اتصال‌های جاماندهٔ سرورِ اجرای قبلی را می‌بندد. */
    psql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    psql(`CREATE DATABASE "${name}"`);
    console.log(`  ↻ ${name} از صفر`);
  }
};
const wf = yaml.load(readFileSync(resolve(root, '.github/workflows/security-ci.yml'), 'utf8'));

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

/* ── زمان‌های اجرای قبل — فقط برای ترتیب و تقسیم، هرگز برای داوری ──
   از گام/سوییتِ سبزِ تلاشِ اول نوشته می‌شود؛ نبودنش فقط تقسیم را کمی ناهموار
   می‌کند، نه نتیجه را. */
const TIMINGS = resolve(LOG_DIR, 'timings.json');
const timings = (() => { try { return JSON.parse(readFileSync(TIMINGS, 'utf8')); } catch { return {}; } })();
timings.build ??= {}; timings.live ??= {};

const results = [];
/* هر گام گروهِ پروسهٔ خودش را دارد (`detached`) تا با کشتنِ گروه، نوه‌ها هم
   بروند — Viteِ یتیم روی یک پورتِ ثابت گامِ بعدیِ همان پورت را می‌انداخت. */
const children = new Set();
const killTree = (p) => { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* رفته */ } };
const mins = (ms) => `${(ms / 60000).toFixed(1)} دقیقه`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const runOnce = (run, env, cwd) => new Promise((done) => {
  const started = Date.now();
  const p = spawn('bash', ['-lc', run], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(p);
  const out = { stdout: '', stderr: '' };
  p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
  p.stdout.on('data', (d) => { out.stdout += d; });
  p.stderr.on('data', (d) => { out.stderr += d; });
  let code = null, finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    children.delete(p);
    killTree(p);
    done({ ok: code === 0, r: out, secs: Math.round((Date.now() - started) / 1000) });
  };
  /* نوه‌ای که stdout را باز نگه دارد `close` را تا ابد عقب می‌اندازد؛ پس پس از
     `exit` حداکثر کمی برای بقیهٔ خروجی صبر می‌شود. */
  p.once('exit', (c) => { code = c ?? 1; setTimeout(finish, 1500).unref(); });
  p.once('close', (c) => { if (code === null) code = c ?? 1; finish(); });
  p.once('error', () => { code = 1; finish(); });
});

const stepEnv = (step, jobEnv, extraEnv) => ({
  ...process.env, ...(jobEnv ?? {}), ...(step.env ?? {}),
  ...localOverrides, ...extraEnv, E2E_CHROME: CHROME, CI: '1',
});
const stepCwd = (step) => (step['working-directory'] ? resolve(root, step['working-directory']) : root);

const report = ({ idx, name, run, cwd, ok, flaky, secs, outputs }) => {
  if (!ok || flaky) {
    /* لاگِ کاملِ گام نگه داشته می‌شود — چه افتاده باشد چه فلیک: خروجیِ
       کوتاه‌شده در ترمینال معمولاً همان خطی را می‌بُرد که علت در آن است.
       فلیک هر دو تلاش را دارد: علت در خروجیِ تلاشِ **اول** است. */
    const body = outputs.map((r, i) => `${outputs.length > 1 ? `\n=== تلاشِ ${i === 0 ? 'اول' : 'دوم'} ===\n` : ''}`
      + `--- stdout ---\n${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\n`).join('');
    writeFileSync(resolve(LOG_DIR, `step-${String(idx).padStart(3, '0')}.log`),
      `# ${name}${flaky ? ' (فلیک — تلاشِ دوم سبز شد)' : ''}\n# cwd=${cwd}\n\n$ ${run}\n\n${body}`);
  }
  results.push({ idx, name, ok, flaky, secs });
  const mark = flaky ? '⚠' : ok ? '✓' : '✗';
  console.log(`${mark} [${String(idx).padStart(3, ' ')}] ${name}${flaky ? ' — فلیک، تلاشِ دوم سبز' : ''}${secs > 2 ? ` (${secs}s)` : ''}`);
};

/* یک گام با تلاشِ دومِ **بلافاصله** — برای گام‌هایی که تنها اجرا می‌شوند (سدها،
   آماده‌سازیِ شارد)؛ آن‌جا باری نیست که تلاشِ دوم را هم بیندازد. */
const runStep = async (step, idx, jobEnv, extraEnv = {}) => {
  const name = step.name ?? `گام ${idx}`;
  const env = stepEnv(step, jobEnv, extraEnv);
  const cwd = stepCwd(step);
  const first = await runOnce(step.run, env, cwd);
  let ok = first.ok, flaky = false, secs = first.secs;
  const outputs = [first.r];
  if (!ok && !NO_RETRY) {
    console.log(`  ↻ تلاشِ دوم: ${name}`);
    const again = await runOnce(step.run, env, cwd);
    outputs.push(again.r); secs += again.secs;
    if (again.ok) { ok = true; flaky = true; }
  }
  report({ idx, name, run: step.run, cwd, ok, flaky, secs, outputs });
  if (ok && !flaky) timings.build[name] = first.secs;
  return ok;
};

/* ── منابعِ هر گام: پورت‌های ثابت و مرورگر — از متنِ خودِ کد، نه از فهرستِ دستی ──
   متن = دستورِ گام + هر فایلِ `scripts/…` که صدا می‌زند + libهایی که آن فایل
   import می‌کند. توضیح‌ها و مقدارِ پیش‌فرضِ `process.env.X ?? '…'` حذف می‌شوند:
   سوییتی که پورت را از env می‌گیرد پورتی قفل نمی‌کند. */
const codeOf = (run, cwd) => {
  let text = run;
  for (const m of run.matchAll(/scripts\/[\w/.-]+\.m?js/g)) {
    const f = [resolve(cwd, m[0]), resolve(root, m[0])].find((c) => existsSync(c));
    if (f) text += `\n${fileWithLibs(f)}`;
  }
  return text;
};
const fileWithLibs = (f) => {
  const src = readFileSync(f, 'utf8');
  let text = src;
  for (const l of src.matchAll(/from\s+'(\.\/lib\/[\w.-]+\.mjs)'/g)) {
    const lf = resolve(dirname(f), l[1]);
    if (existsSync(lf)) text += `\n${readFileSync(lf, 'utf8')}`;
  }
  return text;
};
const stripForScan = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1')
  .replace(/process\.env\.\w+\s*\?\?\s*(['"`])[^'"`]*\1/g, '');
const PORT_RES = [
  /(?:listen|startVite)\(\s*(\d{4,5})\b/g,
  /--port['"`,\s]+(\d{4,5})\b/g,
  /(?:localhost|127\.0\.0\.\d{1,3}|0\.0\.0\.0):(\d{4,5})\b/g,
  /\b[A-Z_]*PORT\s*=\s*['"`]?(\d{4,5})\b/g,
];
const portsIn = (text) => {
  const t = stripForScan(text);
  const ports = new Set();
  for (const re of PORT_RES) for (const m of t.matchAll(re)) ports.add(m[1]);
  return ports;
};
const BROWSER_RE = /playwright|chromium\.launch|lib\/mock-ui|lib\/browser-login/;
/* سد: گامی که پوشهٔ مشترک را از نو می‌سازد (node_modules، dist، کلاینتِ prisma).
   هم‌زمان با آن هر گامِ دیگری ممکن است به فایلی برسد که لحظه‌ای نیست — همان
   قرمزِ `Cannot find package` بالا. */
const BARRIER_RE = /\bnpm (?:ci|install|run build)\b|\bprisma (?:generate|migrate)\b|playwright@[\d.]+ install/;

/* استخر: تا `jobs` گامِ هم‌زمان؛ گامی که با گامِ در حالِ اجرا پورتِ مشترک دارد،
   یا مرورگری است و سقفِ مرورگر پر است، منتظر می‌ماند. وقتی هیچ گامی در حالِ
   اجرا نیست همه چیز جا می‌شود، پس بن‌بست ندارد. */
const pool = (items, jobs) => new Promise((done) => {
  const queue = [...items];
  const running = new Set();
  const fits = (it) => {
    if (it.res.browser && [...running].filter((x) => x.res.browser).length >= BROWSER_MAX) return false;
    return ![...running].some((x) => [...it.res.ports].some((p) => x.res.ports.has(p)));
  };
  const pump = () => {
    if (!queue.length && !running.size) { done(); return; }
    while (running.size < jobs) {
      const k = queue.findIndex(fits);
      if (k < 0) break;
      const it = queue.splice(k, 1)[0];
      running.add(it);
      /* گامی که خودِ اجراکننده‌اش خطا بدهد نباید استخر را برای همیشه نیمه‌پر نگه دارد. */
      it.exec().catch((e) => { console.error(`✗ خطای اجراکننده: ${e?.stack ?? e}`); results.push({ idx: '!', name: String(e?.message ?? e), ok: false }); })
        .finally(() => { running.delete(it); pump(); });
    }
  };
  pump();
});

/* تکه‌ای از گام‌های بی‌سد: هم‌زمان، «درازترین اول» (LPT)، و افتاده‌ها بعد از
   خالی‌شدنِ استخر یکی‌یکی و تنها دوباره. */
const runSegment = async (seg, jobEnv) => {
  const weight = (it) => timings.build[it.step.name] ?? (/scripts\/e2e\//.test(it.step.run) ? 30 : 2);
  const deferred = [];
  const items = [...seg].sort((a, b) => weight(b) - weight(a)).map((it) => {
    const cwd = stepCwd(it.step);
    const text = codeOf(it.step.run, cwd);
    return {
      res: { ports: portsIn(text), browser: BROWSER_RE.test(text) },
      exec: async () => {
        const name = it.step.name ?? `گام ${it.idx}`;
        const env = stepEnv(it.step, jobEnv, {});
        const first = await runOnce(it.step.run, env, cwd);
        if (first.ok) {
          timings.build[name] = first.secs;
          report({ idx: it.idx, name, run: it.step.run, cwd, ok: true, flaky: false, secs: first.secs, outputs: [first.r] });
        } else if (NO_RETRY) {
          report({ idx: it.idx, name, run: it.step.run, cwd, ok: false, flaky: false, secs: first.secs, outputs: [first.r] });
        } else {
          console.log(`  ⏸ [${String(it.idx).padStart(3, ' ')}] ${name} — افتاد؛ تلاشِ دوم بعد از خالی‌شدنِ استخر، تنها`);
          deferred.push({ it, name, env, cwd, first });
        }
      },
    };
  });
  await pool(items, JOBS);
  for (const d of deferred.sort((a, b) => a.it.idx - b.it.idx)) {
    console.log(`  ↻ تلاشِ دوم (تنها): ${d.name}`);
    const again = await runOnce(d.it.step.run, d.env, d.cwd);
    report({ idx: d.it.idx, name: d.name, run: d.it.step.run, cwd: d.cwd, ok: again.ok, flaky: again.ok,
      secs: d.first.secs + again.secs, outputs: [d.first.r, again.r] });
  }
};

/* ── شاردهای live ──
   شاردِ ۰ پورت‌ها و دیتابیس‌های پیش‌فرض را دارد (۳۱۰۱/۵۱۹۹). شاردِ k ≥ ۱ روی
   API `3101 + 20k` و UI `5401 + 20k` (۳۱۲۱/۵۴۲۱، ۳۱۴۱/۵۴۴۱، …) با دیتابیس‌های
   `<نام>_s<k>` — هیچ سوییت و هیچ گامِ buildی این پورت‌ها را نمی‌گیرد.
   ⚠️ تا ۱۴۰۵/۰۷/۰۳، ۴۲ سوییت `localhost:3101`/`127.0.0.1:5199` را ثابت نوشته
   بودند و همه به شاردِ ۰ می‌رفتند؛ حالا همه `process.env.E2E_API`/`E2E_UI`
   می‌خوانند. اگر سوییتِ تازه‌ای دوباره ثابت بنویسد، این‌جا به شاردِ ۰ بسته
   می‌شود و نقشه هشدار می‌دهد — درست کار می‌کند، فقط تقسیم ناهموار می‌شود. */
const DEFAULT_PORTS = new Set(['3101', '5199']);
/* فاصلهٔ شروعِ شاردها: بالاآمدنِ سردِ سه Vite و سه گرم‌کردنِ seed در یک لحظه،
   اولین سوییتِ هر شارد را کند و زمان‌حساس‌ها را قرمز می‌کرد. */
const STAGGER_S = 15;
const shardPorts = (k) => (k === 0 ? { api: 3101, ui: 5199 } : { api: 3101 + 20 * k, ui: 5401 + 20 * k });
const shardUrl = (url, k) => {
  if (!url || k === 0) return url;
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(`${decodeURIComponent(u.pathname.slice(1))}_s${k}`)}`;
  return u.toString();
};
const shardEnv = (k) => Object.fromEntries(['DATABASE_URL', 'CONTROL_DATABASE_URL', 'E2E_TENANT2_DATABASE_URL']
  .filter((key) => localOverrides[key]).map((key) => [key, shardUrl(localOverrides[key], k)]));
const portFree = (port) => new Promise((r) => {
  const s = createServer();
  s.once('error', () => r(false));
  s.listen(port, '127.0.0.1', () => s.close(() => r(true)));
});

/* هر سوییت: آیا پورتِ پیش‌فرض را ثابت نوشته (← فقط شاردِ ۰)، و کدام پورت‌های
   ثابتِ دیگر را می‌گیرد (← هم‌گروه با هر سوییتِ دیگری که همان را می‌گیرد).
   بارِ اولیهٔ شاردِ k همان تأخیرِ شروعش است (`k × STAGGER`) تا همه با هم تمام
   شوند، نه اینکه آخری سی ثانیه دیرتر. */
const planShards = (suites, n) => {
  const info = suites.map((name, order) => {
    const ports = portsIn(fileWithLibs(resolve(root, 'scripts/e2e', `${name}.mjs`)));
    return { name, order, pinned: [...ports].some((p) => DEFAULT_PORTS.has(p)),
      fixed: [...ports].filter((p) => !DEFAULT_PORTS.has(p)) };
  });
  /* گروه‌ها با union-find روی پورتِ مشترک */
  const parent = info.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  info.forEach((s, i) => s.fixed.forEach((p) => {
    if (owner.has(p)) parent[find(i)] = find(owner.get(p)); else owner.set(p, i);
  }));
  const units = new Map();
  info.forEach((s, i) => {
    const r = find(i);
    const u = units.get(r) ?? { members: [], pinned: false, weight: 0 };
    u.members.push(s); u.pinned ||= s.pinned;
    /* ~۳.۵ ثانیه سربارِ هر سوییت: بازسازیِ دیتابیس از قالب + بالا/پایین‌آمدنِ API */
    u.weight += (timings.live[s.name] ?? 12) + 3.5;
    units.set(r, u);
  });
  const lists = Array.from({ length: n }, () => []);
  const loads = Array.from({ length: n }, (_, k) => k * STAGGER_S);
  const all = [...units.values()];
  for (const u of all.filter((x) => x.pinned)) { lists[0].push(...u.members); loads[0] += u.weight; }
  for (const u of all.filter((x) => !x.pinned).sort((a, b) => b.weight - a.weight)) {
    const k = loads.indexOf(Math.min(...loads));
    lists[k].push(...u.members); loads[k] += u.weight;
  }
  return {
    shards: lists.map((l, k) => ({ k, suites: l.sort((a, b) => a.order - b.order).map((s) => s.name), load: loads[k] })),
    pinned: info.filter((s) => s.pinned).map((s) => s.name),
  };
};

const warnPinned = (pinned) => {
  if (!pinned.length) return;
  console.log(`  ⚠ ${pinned.length} سوییت پورتِ پیش‌فرضِ API/UI را ثابت نوشته‌اند و فقط در شاردِ ۰ جا دارند: ${pinned.join(' ')}`);
  console.log("    به‌جایش: process.env.E2E_API ?? 'http://localhost:3101/api' و process.env.E2E_UI ?? 'http://127.0.0.1:5199'");
};

/* یک رانِ `run-live.mjs`: خروجی با پیشوندِ شارد در ترمینال و کامل در لاگ؛ هر خطِ
   PASS/FAIL نتیجهٔ یک سوییت است. */
const runLive = (label, k, manifest, jobEnv, logDir) => new Promise((done) => {
  const { api, ui } = shardPorts(k);
  const p = spawn(process.execPath, [
    resolve(root, 'scripts/e2e/run-live.mjs'),
    '--manifest', manifest, '--log-dir', logDir, '--api-port', String(api), '--ui-port', String(ui),
    /* ⚠️ `job.env` این‌جا هم لازم است، نه فقط در `runStep`. کلیدهای مالِ
       اجراکننده (اتصال‌ها) با `localOverrides` برمی‌گردند، ولی بقیه —
       از جمله `TZ: Asia/Tehran` — باید به سوییت‌های زنده هم برسند؛ وگرنه
       رانرِ UTC و سرورِ ساعتِ‌مطب هر شب سه‌ونیم ساعت یک روز فرق دارند. */
  ], { cwd: root, env: { ...process.env, ...(jobEnv ?? {}), ...localOverrides, ...shardEnv(k), E2E_CHROME: CHROME },
    detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(p);
  const log = createWriteStream(resolve(LOG_DIR, `${label}.log`));
  const seen = new Map();
  let buf = '';
  const onData = (d) => {
    log.write(d);
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      console.log(`[${label}] ${line}`);
      const m = /^(PASS|FAIL) (\S+) \((\d+)s\)/.exec(line);
      if (m) seen.set(m[2], { ok: m[1] === 'PASS', secs: Number(m[3]) });
    }
  };
  p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
  p.stdout.on('data', onData); p.stderr.on('data', onData);
  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    children.delete(p);
    killTree(p);
    if (buf) onData('\n');
    log.end();
    done({ code, seen });
  };
  p.once('exit', (code) => { setTimeout(() => finish(code), 3000).unref(); });
  p.once('close', (code) => finish(code));
});

/* `--plan`: فقط نقشه را نشان بده — منابعِ هر گامِ build و تقسیمِ سوییت‌ها بین
   شاردها — بی‌آنکه چیزی اجرا شود، دیتابیسی دست بخورد یا قفل گرفته شود. */
if (argv.includes('--plan')) {
  const job = wf.jobs.build;
  const steps = job.steps.filter((s) => s.run && !s.uses && !SKIP_NAMES.includes(s.name));
  console.log(`جابِ build: ${steps.length} گام، ${JOBS} هم‌زمان، سقفِ مرورگر ${BROWSER_MAX}`);
  for (const [i, step] of steps.entries()) {
    const text = codeOf(step.run, stepCwd(step));
    const ports = [...portsIn(text)];
    const tags = [BARRIER_RE.test(step.run) ? 'سد' : '', BROWSER_RE.test(text) ? 'مرورگر' : '',
      ports.length ? `پورت ${ports.join(',')}` : ''].filter(Boolean);
    if (tags.length) console.log(`  [${String(i + 1).padStart(3, ' ')}] ${tags.join(' · ')} — ${step.name}`);
  }
  const suites = readFileSync(resolve(root, 'scripts/e2e/ci-live.txt'), 'utf8').split('\n')
    .map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  console.log(`\nجابِ live: ${suites.length} سوییت در ${SHARDS} شارد`);
  const { shards, pinned } = planShards(suites, SHARDS);
  warnPinned(pinned);
  for (const sh of shards) {
    const { api, ui } = shardPorts(sh.k);
    console.log(`  شاردِ ${sh.k} (API ${api} · UI ${ui}): ${sh.suites.length} سوییت، حدودِ ${mins(sh.load * 1000)}`);
    console.log(`    ${sh.suites.join(' ')}`);
  }
  process.exit(0);
}

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
 * باشد، پیام می‌گوید چه چیزی را پاک کند. (هم‌زمانیِ **داخلِ** یک اجرا فرق
 * دارد: همین اسکریپت می‌داند کدام گام‌ها «سد»اند و آن‌ها را تنها اجرا می‌کند.)
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
process.on('exit', () => { for (const p of children) killTree(p); unlock(); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

const REQUIRED = ['DATABASE_URL', 'CONTROL_DATABASE_URL', 'TENANT_DATABASE_ENCRYPTION_KEY', 'JWT_SECRET'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`✗ متغیرهای لازم ست نیستند: ${missing.join(' · ')}`);
  process.exit(2);
}

const started = Date.now();
const partTimes = [];

if (PART === 'all' || PART === 'build') {
  const t0 = Date.now();
  const job = wf.jobs.build;
  const steps = job.steps.filter((s) => s.run && !s.uses && !SKIP_NAMES.includes(s.name));
  console.log(`\n══ جابِ build — ${steps.length} گام (از ${job.steps.length} گامِ workflow)، ${JOBS} هم‌زمان ══\n`);
  let seg = [];
  const flush = async () => { if (seg.length) { const s = seg; seg = []; await runSegment(s, job.env); } };
  for (const [i, step] of steps.entries()) {
    const idx = i + 1;
    if (idx < FROM) continue;
    if (JOBS > 1 && !BARRIER_RE.test(step.run)) { seg.push({ idx, step }); continue; }
    await flush();
    await runStep(step, idx, job.env);
  }
  await flush();
  partTimes.push(`جابِ build: ${mins(Date.now() - t0)}`);
}

if (PART === 'all' || PART === 'live') {
  const t0 = Date.now();
  const job = wf.jobs.live;
  /* گامِ «Run shard» جایگزین می‌شود؛ بقیهٔ گام‌های `run:` همان‌طور که در
     workflow هستند اجرا می‌شوند. آن‌هایی که پوشهٔ مشترک می‌سازند (نصب، build)
     یک‌بار، و بقیه — از جمله `bootstrap-env.mjs` که قالبِ دیتابیس را می‌سازد —
     یک‌بار **برای هر شارد** با دیتابیس‌های همان شارد. */
  const prep = job.steps.filter((s) => s.run && !s.uses && !SKIP_NAMES.includes(s.name)
    && !s.name?.startsWith('Run shard'));
  const shared = prep.filter((s) => BARRIER_RE.test(s.run));
  const perShard = prep.filter((s) => !BARRIER_RE.test(s.run));
  const manifestPath = resolve(root, 'scripts/e2e/ci-live.txt');
  const suites = readFileSync(manifestPath, 'utf8').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const { shards, pinned } = planShards(suites, SHARDS);
  const plan = shards.filter((s) => s.suites.length);
  console.log(`\n══ جابِ live — ${prep.length} گامِ آماده‌سازی + ${suites.length} سوییتِ ci-live.txt در ${plan.length} شاردِ موازی ══`);
  warnPinned(pinned);
  for (const s of plan) {
    const { api, ui } = shardPorts(s.k);
    console.log(`  شاردِ ${s.k}: ${s.suites.length} سوییت، حدودِ ${mins(s.load * 1000)} — API ${api} · UI ${ui}`);
  }
  console.log('');

  const busy = [];
  for (const s of plan) for (const port of Object.values(shardPorts(s.k))) if (!(await portFree(port))) busy.push(port);
  if (busy.length) {
    console.error(`✗ پورتِ ${busy.join('، ')} اشغال است — احتمالاً پروسه‌ای از اجرای کشته‌شدهٔ قبلی.`);
    console.error('  سوییت‌ها روی سرورِ اشتباه می‌دوند و قرمزِ دروغین می‌سازند؛ اول آن پروسه را ببندید.');
    process.exit(2);
  }

  let prepOk = true;
  for (const [i, s] of shared.entries()) if (!(await runStep(s, `L${i + 1}`, job.env))) prepOk = false;
  const prepShard = async (k, tag) => {
    resetDatabases(Object.values(shardEnv(k)));
    let ok = true;
    for (const [i, s] of perShard.entries()) {
      if (!(await runStep(s, `L${shared.length + i + 1}${tag}`, job.env, shardEnv(k)))) ok = false;
    }
    return ok;
  };
  if (prepOk) prepOk = (await Promise.all(plan.map((s) => prepShard(s.k, plan.length > 1 ? `·s${s.k}` : '')))).every(Boolean);
  if (!prepOk) {
    console.error('\n✗ آماده‌سازیِ محیط شکست — سوییت‌ها اجرا نمی‌شوند، وگرنه همه با «ورود نشد» قرمز می‌شوند.');
    console.log(`لاگ: ${LOG_DIR}`);
    process.exit(1);
  }

  const runs = [];
  for (const [n, s] of plan.entries()) {
    if (n) await sleep(STAGGER_S * 1000);
    const manifest = resolve(LOG_DIR, `live-s${s.k}.txt`);
    writeFileSync(manifest, `${s.suites.join('\n')}\n`);
    runs.push(runLive(plan.length > 1 ? `s${s.k}` : 'live', s.k, manifest, job.env,
      resolve(LOG_DIR, plan.length > 1 ? `live-s${s.k}` : 'live')).then((r) => ({ ...r, s })));
  }
  const outcomes = await Promise.all(runs);

  /* سوییتی که خطِ PASS/FAIL ندارد (رانر پیش از رسیدن به آن مرد) «اجرا نشد» است و
     قرمز شمرده می‌شود — سکوت سبز نیست. */
  const verdicts = new Map();
  for (const o of outcomes) {
    for (const name of o.s.suites) {
      const v = o.seen.get(name);
      verdicts.set(name, { shard: o.s.k, ok: !!v?.ok, secs: v?.secs ?? 0, ran: !!v });
      if (v?.ok) timings.live[name] = v.secs;
    }
  }
  const redNames = [...verdicts].filter(([, v]) => !v.ok).map(([n]) => n);
  const retried = new Map();
  if (redNames.length && !NO_RETRY) {
    /* تلاشِ دوم: تنها، روی شاردِ ۰ با دیتابیسِ **از صفر** — دیتابیسِ شاردِ ۰ حالا
       ته‌ماندهٔ آخرین سوییتش را دارد و `run-live` قالبِ تازه را از همان می‌گرفت. */
    console.log(`\n  ↻ تلاشِ دوم (تنها، بی‌بار): ${redNames.join(' ')}`);
    if (await prepShard(0, '·retry')) {
      const manifest = resolve(LOG_DIR, 'live-retry.txt');
      writeFileSync(manifest, `${redNames.join('\n')}\n`);
      const again = await runLive('retry', 0, manifest, job.env, resolve(LOG_DIR, 'live-retry'));
      for (const [name, v] of again.seen) retried.set(name, v);
    }
  }
  for (const [name, v] of verdicts) {
    const again = retried.get(name);
    const flaky = !v.ok && !!again?.ok;
    results.push({ idx: `s${v.shard}`, name: `${name}${v.ran || again ? '' : ' — اجرا نشد'}`,
      ok: v.ok || flaky, flaky, secs: v.secs + (again?.secs ?? 0) });
  }
  const green = [...verdicts.values()].filter((v) => v.ok).length;
  console.log(`\n  سوییت‌های زنده: ${green} سبز در تلاشِ اول از ${verdicts.size}`);
  partTimes.push(`جابِ live: ${mins(Date.now() - t0)}`);
}

try { writeFileSync(TIMINGS, `${JSON.stringify(timings, null, 1)}\n`); } catch { /* فقط برای ترتیب است */ }

const red = results.filter((x) => !x.ok);
const flakes = results.filter((x) => x.flaky);
console.log(`\n${'─'.repeat(54)}`);
console.log(`سبز: ${results.length - red.length}   قرمز: ${red.length}   فلیک: ${flakes.length}`);
console.log(`زمان: ${[...partTimes, `کل: ${mins(Date.now() - started)}`].join(' · ')}`);
if (flakes.length) {
  console.log(`⚠ در تلاشِ دوم سبز شدند — اگر تکرار شد، خودِ سوییت باید مقاوم شود:\n${flakes.map((x) => `  [${x.idx}] ${x.name}`).join('\n')}`);
}
if (red.length) {
  console.log(`قرمزها:\n${red.map((x) => `  [${x.idx}] ${x.name}`).join('\n')}`);
  console.log(`لاگِ کاملِ هر گامِ افتاده: ${LOG_DIR}`);
}
process.exit(red.length ? 1 : 0);
