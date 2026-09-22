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
 *   • ساختِ دیتابیس‌های CI و `bootstrap-env` — رانرِ `run-live.mjs` خودش
 *     دیتابیسِ هر سوییت را از قالب می‌سازد.
 *   • شاردبندی — CI کار را بین چند رانر پخش می‌کند تا زودتر تمام شود؛ این‌جا
 *     یک ماشین است، پس کلِ مانیفست یک‌جا می‌دود.
 *
 * اجرا:
 *   node scripts/local-ci.mjs              # همه: build + live
 *   node scripts/local-ci.mjs --part build # فقط گام‌های جابِ build
 *   node scripts/local-ci.mjs --part live  # فقط سوییت‌های زندهٔ ci-live.txt
 *   node scripts/local-ci.mjs --from 40    # ادامه از گامِ ۴۰ (بعد از رفعِ یک قرمز)
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
  'Databases for the control plane and the second tenant',
  'Bootstrap a fresh environment',
];

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

const REQUIRED = ['DATABASE_URL', 'CONTROL_DATABASE_URL', 'TENANT_DATABASE_ENCRYPTION_KEY', 'JWT_SECRET'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`✗ متغیرهای لازم ست نیستند: ${missing.join(' · ')}`);
  process.exit(2);
}

const results = [];
const runStep = (step, idx, jobEnv) => {
  const name = step.name ?? `گام ${idx}`;
  const env = { ...process.env, ...(jobEnv ?? {}), ...(step.env ?? {}), E2E_CHROME: CHROME, CI: '1' };
  const cwd = step['working-directory'] ? resolve(root, step['working-directory']) : root;
  const started = Date.now();
  const r = spawnSync('bash', ['-lc', step.run], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const secs = Math.round((Date.now() - started) / 1000);
  const okStep = r.status === 0;
  if (!okStep) {
    /* لاگِ کاملِ گامِ افتاده نگه داشته می‌شود: خروجیِ کوتاه‌شده در ترمینال
       معمولاً همان خطی را می‌بُرد که علت در آن است. */
    writeFileSync(resolve(LOG_DIR, `step-${String(idx).padStart(3, '0')}.log`),
      `# ${name}\n# cwd=${cwd}\n\n$ ${step.run}\n\n--- stdout ---\n${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\n`);
  }
  results.push({ idx, name, ok: okStep, secs });
  console.log(`${okStep ? '✓' : '✗'} [${String(idx).padStart(3, ' ')}] ${name}${secs > 2 ? ` (${secs}s)` : ''}`);
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
  console.log('\n══ جابِ live — کلِ مانیفستِ ci-live.txt، بدونِ شارد ══\n');
  const r = spawnSync(process.execPath, [
    resolve(root, 'scripts/e2e/run-live.mjs'),
    '--manifest', resolve(root, 'scripts/e2e/ci-live.txt'),
    '--log-dir', resolve(LOG_DIR, 'live'),
  ], { cwd: root, env: { ...process.env, E2E_CHROME: CHROME }, stdio: 'inherit' });
  if (r.status !== 0) failed += 1;
  results.push({ idx: '—', name: 'run-live.mjs (کلِ مانیفست)', ok: r.status === 0, secs: 0 });
}

const red = results.filter((x) => !x.ok);
console.log(`\n${'─'.repeat(54)}`);
console.log(`سبز: ${results.length - red.length}   قرمز: ${red.length}`);
if (red.length) {
  console.log(`قرمزها:\n${red.map((x) => `  [${x.idx}] ${x.name}`).join('\n')}`);
  console.log(`لاگِ کاملِ هر گامِ افتاده: ${LOG_DIR}`);
}
process.exit(failed ? 1 : 0);
