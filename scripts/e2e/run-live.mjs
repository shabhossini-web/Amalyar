/**
 * رانرِ سوییت‌های «سرورِ زنده» — همان چیزی که CI صدا می‌زند.
 *
 * چرا یک رانر و نه ۱۱۷ گامِ جدا در workflow:
 *
 *  ۱. **سطلِ ورود.** `auth.service` هر IP را به ۱۲ و هر نامِ کاربری را به ۸
 *     ورود در ۱۵ دقیقه محدود می‌کند و سطل در **حافظهٔ پروسه** است. هر سوییت یک
 *     ورود می‌زند، پس بیش از ۸ سوییت پشتِ هم روی یک پروسه با `ورود نشد`
 *     می‌افتد. تنها راهِ بی‌دست‌زدن به محصول: سرور را هر چند سوییت **از نو**
 *     بالا آوردن — همان کاری که این رانر می‌کند (`--batch`).
 *  ۲. **هم‌هاست‌بودنِ API و UI.** کوکیِ نشست `SameSite=Lax` است؛ اگر Vite با
 *     `127.0.0.1` بالا باشد و آزمون `localhost` صدا بزند، همهٔ سوییت‌های
 *     مرورگری به `/login` می‌افتند. رانر هر دو را روی یک هاست می‌بندد.
 *  ۳. **نشانی‌های هاردکد.** ۱۸ سوییت `localhost:3101` را برای API و
 *     `127.0.0.1:5199` را برای UI هاردکد کرده‌اند (نه `E2E_API`/`E2E_UI`). پس
 *     پیش‌فرضِ پورت‌ها همان دو عدد است، Vite همیشه روی همان پورت بالا می‌آید و
 *     بین دسته‌ها **نمی‌میرد**؛ فقط API می‌میرد و روی همان پورت برمی‌گردد تا
 *     `VITE_API_BASE` معتبر بماند.
 *  ۴. **سوییتِ افتاده نباید بقیه را قرمز کند.** اگر سوییتی سرور را انداخت،
 *     پیش از سوییتِ بعدی دوباره بالا می‌آید و stderrِ سرور در `api-<n>.log`
 *     می‌ماند تا مقصر پیدا شود — نه یک `ECONNREFUSED` بی‌نام در سوییتِ بعدی.
 *  ۵. **هر سوییت دیتابیسِ خودش را می‌گیرد** (پیش‌فرض؛ `--no-isolate` خاموشش
 *     می‌کند). بعد از bootstrap و گرم‌کردنِ seedها از هر دیتابیسِ تنانت یک
 *     **قالب** (`<db>_tpl`) گرفته می‌شود و پیش از هر سوییت دیتابیس از روی همان
 *     قالب از نو ساخته می‌شود (`CREATE DATABASE … TEMPLATE`، زیرِ یک ثانیه).
 *     چرا: ۹ سوییت فرمِ پیگیری می‌سازند و بعضی‌شان پاک نمی‌کنند؛ `followUpUrl`
 *     قدیمی‌ترین فرمِ فعال را برمی‌دارد، پس `follow-up` بسته به اینکه **قبلش**
 *     چه کسی دویده سبز یا قرمز می‌شد؛ `availability` قاعده‌های به‌جامانده را
 *     می‌دید؛ و شاردبندیِ CI ترتیب را عوض می‌کند — یعنی همان سوییت در یک شارد
 *     سبز و در شاردِ دیگر قرمز. با دیتابیسِ تازه هیچ سوییتی به ترتیب وابسته
 *     نیست، و چون سرور هم برای هر سوییت تازه است، سطلِ ورود هم دیگر پر نمی‌شود.
 *  ۶. **ناوردای داده بعد از هر سوییت** (بستهٔ ۷). جدول‌های `visit_other_*` را فقط
 *     `visit-coding.ts` می‌نویسد و ناورداهایش را فقط همان نگه می‌دارد؛ یک SQL
 *     پیش از بازسازیِ دیتابیس هر نوشتنِ دورزننده را — از هر سوییتی — قرمز می‌کند
 *     (`CODING_INVARIANT_SQL` پایین‌تر).
 *
 * ```bash
 * DATABASE_URL=… CONTROL_DATABASE_URL=… TENANT_DATABASE_ENCRYPTION_KEY=… JWT_SECRET=… \
 * node scripts/e2e/run-live.mjs --manifest scripts/e2e/ci-live.txt [--shard 2/4]
 * node scripts/e2e/run-live.mjs follow-up portal          # چند سوییتِ مشخص
 * node scripts/e2e/run-live.mjs --all                     # همهٔ سوییت‌های سرورِ زندهٔ بیرونِ CI
 * node scripts/e2e/run-live.mjs --all --resume            # ادامهٔ اجرای قبلی (لاگ‌دارها رد می‌شوند)
 * node scripts/e2e/run-live.mjs --no-isolate --batch 4 …  # بدونِ دیتابیسِ تازه به‌ازای هر سوییت (سریع‌تر، آلوده‌شدنی)
 * ```
 *
 * `--shard i/n` هر nاُمین خطِ manifest را برمی‌دارد (از iاُم) — CI با ماتریس
 * چند شارد را موازی می‌دواند تا ۱۰۰+ سوییت در یک جاب ۹۰ دقیقه نشود.
 *
 * خروجی: یک خطِ `PASS`/`FAIL` به‌ازای هر سوییت + جمع‌بندی؛ لاگِ کاملِ هر سوییت در
 * `--log-dir` (پیش‌فرض `.e2e-logs/`). کدِ خروجی غیرصفر اگر حتی یکی افتاد.
 */
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const serverDir = resolve(root, 'server');

/* ── آرگومان‌ها ── */
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(name);
const BATCH = Number(opt('--batch', 6));            // زیرِ سقفِ ۸ ورود، با حاشیه
const API_PORT = Number(opt('--api-port', 3101));   // ۱۸ سوییت `localhost:3101` را هاردکد کرده‌اند
const UI_PORT = Number(opt('--ui-port', 5199));     // و `127.0.0.1:5199` را
const HOST = '127.0.0.1';                           // نه localhost — قاعدهٔ کوکی
const LOG_DIR = resolve(root, opt('--log-dir', '.e2e-logs'));
const TIMEOUT_MS = Number(opt('--timeout', 600)) * 1000;
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const env = (k) => { const v = process.env[k]; if (!v) { console.error(`${k} لازم است`); process.exit(2); } return v; };
const DATABASE_URL = env('DATABASE_URL');
const CONTROL_DATABASE_URL = env('CONTROL_DATABASE_URL');
env('TENANT_DATABASE_ENCRYPTION_KEY'); env('JWT_SECRET');

/* ── فهرستِ سوییت‌ها ── */
const source = (s) => readFileSync(resolve(here, `${s}.mjs`), 'utf8');
/* مرورگر + APIِ ساختگی، Vite را خودش بالا می‌آورد — سرور نمی‌خواهد و روی
   پورتِ Viteِ رانر هم می‌افتد (`orders-ai-ui` همان ۵۱۹۹ را می‌گیرد). این‌ها
   گامِ مستقیمِ CI اند، نه کارِ این رانر. */
const selfContained = (t) => /lib\/mock-ui|vite\/bin\/vite\.js/.test(t);
const needsLive = (t) => /E2E_API|E2E_DB|E2E_UI|E2E_CTRL_DB|E2E_PORT|localhost:3101|127\.0\.0\.1:5199/.test(t);
let suites;
if (flag('--all')) {
  const inCi = readFileSync(resolve(root, '.github/workflows/security-ci.yml'), 'utf8');
  const all = readdirSync(here).filter((f) => f.endsWith('.mjs') && !inCi.includes(f))
    .map((f) => f.replace(/\.mjs$/, '')).filter((s) => !['bootstrap-env', 'run-live'].includes(s));
  const skipped = [];
  suites = all.filter((s) => {
    const t = source(s);
    if (!selfContained(t) && needsLive(t)) return true;
    skipped.push(`${s}${selfContained(t) ? ' (خودکفا)' : ' (نامشخص)'}`);
    return false;
  });
  if (skipped.length) console.log(`[رانر] بیرونِ این رانر: ${skipped.join(' · ')}`);
} else if (opt('--manifest')) {
  suites = readFileSync(opt('--manifest'), 'utf8').split('\n')
    .map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const shard = opt('--shard');
  if (shard) {
    const [i, n] = shard.split('/').map(Number);
    if (!(i >= 1 && n >= i)) { console.error('--shard باید به شکلِ i/n باشد (۱ ≤ i ≤ n)'); process.exit(2); }
    suites = suites.filter((_, k) => k % n === i - 1);
    console.log(`[رانر] شاردِ ${i}/${n}: ${suites.length} سوییت`);
  }
} else {
  suites = argv.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a) && !a.includes('/'))
    .filter((a) => existsSync(resolve(here, `${a}.mjs`)));
}
/* `--resume`: سوییتی که لاگش در `--log-dir` هست دوباره اجرا نمی‌شود — برای
   ادامه‌دادنِ اجرای درازی که وسطش ماشین/کانتینر افتاد. */
if (flag('--resume')) {
  const before = suites.length;
  suites = suites.filter((s) => !existsSync(resolve(LOG_DIR, `${s}.mjs`.replace(/\.mjs$/, '.log'))));
  console.log(`[رانر] ادامه: ${before - suites.length} سوییت لاگ داشتند و رد شدند`);
}
if (!suites.length) { console.error('سوییتی داده نشد'); process.exit(2); }
const missing = suites.filter((s) => !existsSync(resolve(here, `${s}.mjs`)));
if (missing.length) { console.error(`سوییتِ ناموجود: ${missing.join(' ')}`); process.exit(2); }

mkdirSync(LOG_DIR, { recursive: true });

/* ── پروسه‌ها ── */
const waitHttp = async (url, ms = 90_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await fetch(url); return true; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  return false;
};
const childEnv = {
  ...process.env,
  DATABASE_URL, CONTROL_DATABASE_URL,
  DEFAULT_TENANT_SLUG: process.env.DEFAULT_TENANT_SLUG ?? 't1',
  NODE_ENV: 'test',
  PORT: String(API_PORT),
  RP_ID: HOST,
  WEBAUTHN_ORIGINS: `http://${HOST}:${UI_PORT}`,
  CORS_ORIGINS: `http://${HOST}:${UI_PORT}`,
};
/* ── جداسازیِ دیتابیس (بندِ ۵ بالا) ── */
const ISOLATE = !flag('--no-isolate');
const dbName = (url) => decodeURIComponent(new URL(url).pathname.slice(1));
const adminUrl = (url) => { const u = new URL(url); u.pathname = '/postgres'; u.search = ''; return u.toString(); };
const psql = (url, sql) => execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAtc', sql], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const TENANT_DBS = [DATABASE_URL, process.env.E2E_TENANT2_DATABASE_URL].filter(Boolean)
  .map((url) => ({ name: dbName(url), tpl: `${dbName(url)}_tpl`, admin: adminUrl(url), url: url.replace(/\?.*$/, '') }));
/* `WITH (FORCE)` اتصال‌های جامانده از سرورِ تازه‌کشته‌شده را می‌بندد؛ منبعِ
   `TEMPLATE` اما باید بی‌اتصال باشد، پس چند بار تلاش می‌شود. */
const recreate = (d, from) => {
  for (let i = 0; ; i++) {
    try {
      psql(d.admin, `DROP DATABASE IF EXISTS "${d.name}" WITH (FORCE)`);
      psql(d.admin, `CREATE DATABASE "${d.name}" TEMPLATE "${from}"`);
      return;
    } catch (e) { if (i >= 9) throw e; execFileSync('sleep', ['0.5']); }
  }
};
const snapshotDbs = () => { for (const d of TENANT_DBS) recreate({ ...d, name: d.tpl }, d.name); };
const restoreDbs = () => { for (const d of TENANT_DBS) recreate(d, d.tpl); };

/* ── ناوردای کدگذاریِ مراجعه (بستهٔ ۷، سندِ بسته §۷.۲) ──
   اصلیِ تشخیص/عمل در ستونِ `visits` است و سایرین (رتبهٔ ۲ به بعد) در
   `visit_other_*`. دیتابیس فقط `rank >= 2` را می‌بیند؛ بقیه را — «سایر هرگز
   برابرِ اصلی نیست»، «بی‌اصلی، سایر هم نیست»، «رتبه‌ها ۲..n پیوسته‌اند» — فقط
   `planCoding`/`writeOthers`ِ `visit-coding.ts` نگه می‌دارند. نگهبانِ ایستای C3
   نویسندهٔ دوم را در کد می‌گیرد؛ این یکی **دادهٔ واقعیِ هر سوییت** را می‌سنجد،
   پس هر نوشتنی که از آن تابع رد نشده باشد — از هر سوییتی، از هر مسیری —
   همان سوییت را قرمز می‌کند نه اینکه بی‌صدا در دیتابیس بماند.
   ⚠️ پیش از `restoreDbs()`ِ دورِ بعد اجرا می‌شود؛ بعد از آن دیتابیس از قالب
   برگشته و شاهد رفته است. */
const CODING_INVARIANT_SQL = `SELECT
    (SELECT count(*) FROM visit_other_diagnoses o JOIN visits v ON v.id = o.visit_id
      WHERE v.diagnosis_id IS NULL OR v.diagnosis_id = o.diagnosis_id)
  + (SELECT count(*) FROM visit_other_procedures o JOIN visits v ON v.id = o.visit_id
      WHERE v.procedure_type_id IS NULL OR v.procedure_type_id = o.procedure_type_id)
  + (SELECT count(*) FROM (SELECT visit_id FROM visit_other_diagnoses GROUP BY visit_id
      HAVING min(rank) <> 2 OR max(rank) <> count(*) + 1) a)
  + (SELECT count(*) FROM (SELECT visit_id FROM visit_other_procedures GROUP BY visit_id
      HAVING min(rank) <> 2 OR max(rank) <> count(*) + 1) b)`;
/* شمارِ ردیف‌های ناسازگار در هر دیتابیسِ تنانت. خطای psql هم «شکست» است، نه
   «صفر»: نگهبانی که وقتی نمی‌تواند بسنجد سبز بماند دروغ می‌گوید. */
const codingViolations = () => TENANT_DBS.map((d) => {
  try {
    return { db: d.name, n: Number(psql(d.url, CODING_INVARIANT_SQL).trim()) };
  } catch (e) {
    return { db: d.name, n: NaN, err: (e?.stderr?.toString() || e?.message || String(e)).trim().split('\n')[0] };
  }
});
/* با `--no-isolate` دیتابیس بینِ سوییت‌ها پاک نمی‌شود؛ پس ملاک «بیشتر از پیش
   از این سوییت» است، وگرنه یک خرابی همهٔ سوییت‌های بعدی را هم قرمز می‌کرد و
   مقصر لای بی‌گناه‌ها گم می‌شد. با دیتابیسِ تازه (پیش‌فرض) ملاک همان صفر است. */
const codingInvariantError = (before) => {
  const msgs = [];
  for (const v of codingViolations()) {
    const base = before?.find((b) => b.db === v.db)?.n;
    if (Number.isNaN(v.n)) {
      msgs.push(`ناوردای کدگذاریِ مراجعه روی «${v.db}» سنجیده نشد: ${v.err}`);
    } else if (v.n > (Number.isFinite(base) ? base : 0)) {
      msgs.push(`ناوردای کدگذاریِ مراجعه شکست — ${v.n} ردیفِ ناسازگار در visit_other_* روی «${v.db}»: `
        + 'سایرِ برابرِ اصلی، سایر بدونِ اصلی، یا رتبهٔ گسسته. یعنی جایی بیرون از visit-coding.ts (planCoding/writeOthers) در این جدول‌ها نوشته است');
    }
  }
  return msgs.length ? msgs.join(' ⏎ ') : null;
};

let api = null, apiGen = 0, apiAlive = false;
const startApi = async () => {
  const gen = ++apiGen;
  /* stderrِ سرور به فایل می‌رود: اگر سوییتی سرور را انداخت باید بشود دید چرا،
     وگرنه فقط یک `ECONNREFUSED` در سوییتِ بعدی می‌ماند و مقصر گم می‌شود. */
  const apiLog = createWriteStream(resolve(LOG_DIR, `api-${gen}.log`));
  api = spawn(process.execPath, ['dist/main.js'], { cwd: serverDir, env: childEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  api.stderr.pipe(apiLog, { end: false });          // end: false — خطِ خروج بعد از بسته‌شدنِ stderr هم باید نوشته شود
  apiAlive = true;
  api.once('exit', (code, sig) => { apiAlive = false; apiLog.end(`\n[رانر] سرور خارج شد code=${code} signal=${sig}\n`); });
  if (!(await waitHttp(`http://${HOST}:${API_PORT}/api/config`))) {
    console.error(`API بالا نیامد — ببین ${LOG_DIR}/api-${gen}.log`); process.exit(2);
  }
};
/* ⚠️ پروسه را **در همین لحظه** بگیر و تایمر را پاک کن. نسخهٔ اول `api?.kill('SIGKILL')`
   را ۵ ثانیه بعد صدا می‌زد — و تا آن موقع `api` سرورِ **دستهٔ بعدی** بود: هر
   دسته پنج ثانیه بعد از شروع سرورش را از دست می‌داد و اولین سوییتِ درازش با
   «other side closed» قرمز می‌شد، بی‌آنکه لاگی از سرور بماند. */
const stopApi = () => new Promise((r) => {
  if (!api || !apiAlive) return r();
  const p = api;
  const hammer = setTimeout(() => p.kill('SIGKILL'), 5000);
  p.once('exit', () => { clearTimeout(hammer); r(); });
  p.kill('SIGTERM');
});
/* پیش از هر سوییت: اگر سرور مرده (سوییتِ قبلی انداخته‌اش) دوباره بالا بیاور،
   وگرنه بقیهٔ دسته بی‌گناه با ECONNREFUSED قرمز می‌شوند و مقصرِ واقعی
   لای آن‌ها گم می‌شود. */
const ensureApi = async () => {
  if (apiAlive) { try { await fetch(`http://${HOST}:${API_PORT}/api/config`); return; } catch { /* افتاده */ } }
  console.log(`[رانر] سرور در دسترس نیست — دوباره بالا می‌آید (نگاه کن api-${apiGen}.log)`);
  await stopApi(); await startApi();
};

/* مستقیم، نه از راهِ `npx`: کشتنِ wrapperِ npx خودِ Vite را نمی‌کشد و یک Viteِ
   یتیم روی ۵۱۹۹ می‌ماند که اجرای بعدی را با `--strictPort` می‌اندازد. */
/* `VITE_TENANT_UI=true`: روی loopback اپ پیش‌فرض «هاستِ بازاریابی» است و ریشه
   لندینگِ عمل‌یار را نشان می‌دهد؛ این سوییت‌ها همه سوییت‌های **تنانت**‌اند و
   ریشه باید سایتِ شرکت (یا `/login`) باشد — همان چیزی که `tenant-site` می‌سنجد.
   بقیه از `/` فقط برای نشاندنِ کوکی استفاده می‌کنند. */
const vite = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--port', String(UI_PORT), '--host', HOST, '--strictPort'], {
  cwd: root, env: { ...process.env, VITE_API_BASE: `http://${HOST}:${API_PORT}/api`, VITE_TENANT_UI: 'true' }, stdio: 'ignore',
});
process.on('exit', () => { vite.kill('SIGTERM'); api?.kill('SIGTERM'); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

/* ── اجرا ── */
const suiteEnv = {
  ...process.env,
  E2E_API: `http://${HOST}:${API_PORT}/api`,
  E2E_UI: `http://${HOST}:${UI_PORT}`,
  E2E_WEB: `http://${HOST}:${UI_PORT}`,           // `tenant-site` نامِ دیگری برای همان UI دارد
  E2E_PORT: String(API_PORT),                     // `tenant-isolation` پورت را جدا می‌گیرد
  E2E_HOST_A: HOST,
  E2E_HOST_B: process.env.E2E_HOST_B ?? '127.0.0.2', // تنانتِ دوم — `bootstrap-env.mjs` همین میزبان را ثبت می‌کند
  E2E_DB: DATABASE_URL.replace(/\?.*$/, ''),      // psql پارامترِ schema را نمی‌فهمد
  E2E_CTRL_DB: CONTROL_DATABASE_URL.replace(/\?.*$/, ''),   // سه سوییت control-db را مستقیم می‌خوانند
  E2E_CHROME: CHROME,
  E2E_SHOTS: LOG_DIR,                             // اسکرین‌شات‌ها کنارِ لاگ‌ها بمانند (آرتیفکتِ CI)
  E2E_USER: process.env.E2E_USER ?? 'admin',
  E2E_PASS: process.env.E2E_PASS ?? 'test1234',
};
const runOne = (name) => new Promise((done) => {
  const t0 = Date.now();
  const p = spawn('node', [resolve(here, `${name}.mjs`)], { cwd: root, env: suiteEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const grab = (d) => { out += d; };
  p.stdout.on('data', grab); p.stderr.on('data', grab);
  const killer = setTimeout(() => { out += `\n[رانر] مهلتِ ${TIMEOUT_MS / 1000}s تمام شد\n`; p.kill('SIGKILL'); }, TIMEOUT_MS);
  p.on('exit', (code) => {
    clearTimeout(killer);
    writeFileSync(resolve(LOG_DIR, `${name}.log`), out);
    /* بعضی سوییت‌ها با کدِ صفر «ورود نشد» می‌گویند؛ آن را هم شکست بگیر. */
    const failed = code !== 0 || /ورود نشد/.test(out);
    done({ name, ok: !failed, code, secs: Math.round((Date.now() - t0) / 1000), tail: out.trim().split('\n').slice(-3).join(' ⏎ ') });
  });
});

if (!(await waitHttp(`http://${HOST}:${UI_PORT}/`, 120_000))) { console.error('Vite بالا نیامد'); process.exit(2); }

/* گرم‌کردنِ seedهای تنبل. قالب‌های فرم فقط وقتی «هیچ فرمی نیست» seed می‌شوند
   (`FormsService.ensureSeeded`) و با اولین **خواندن**. اگر اولین تماسِ دیتابیسِ
   بکر یک POST باشد — سوییتِ اولِ فهرست فرم می‌سازد — قالب‌ها هرگز نمی‌آیند و
   ده‌ها سوییتِ بی‌گناه قرمز می‌شوند («فرمِ جراحی نیست»، `survey` نیست، نوعِ
   پیش‌فرض عوض می‌شود). نصبِ واقعی اول می‌خواند؛ این‌جا هم همان — روی یک
   سرورِ جداگانه تا سطلِ ورودِ دستهٔ اول را نخورد. میزبانِ دوم اختیاری است. */
const warmUp = async () => {
  await startApi();
  for (const host of [HOST, suiteEnv.E2E_HOST_B]) {
    const base = `http://${host}:${API_PORT}/api`;
    try {
      const login = await fetch(`${base}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: suiteEnv.E2E_USER, password: suiteEnv.E2E_PASS }),
      }).then((r) => r.json());
      if (!login?.accessToken) { console.log(`[رانر] گرم‌کردن روی ${host}: ورود نشد (${JSON.stringify(login).slice(0, 120)})`); continue; }
      const headers = { Authorization: `Bearer ${login.accessToken}` };
      for (const path of ['/forms', '/forms/visit-kinds', '/features']) await fetch(base + path, { headers });
      console.log(`[رانر] گرم‌کردنِ seedها روی ${host}: انجام شد`);
    } catch (e) { console.log(`[رانر] گرم‌کردن روی ${host}: ${e?.cause?.code ?? e?.message ?? e}`); }
  }
  await stopApi();
};
await warmUp();

const results = [];
const record = async (name) => {
  const codingBefore = ISOLATE ? null : codingViolations();
  let r = await runOne(name);
  /* سطلِ ورود پر شد (سوییت‌های چندورودی در یک دسته) → سرورِ تازه و یک بارِ
     دیگر. فقط برای همین نشانه؛ قرمزِ واقعی دوباره اجرا نمی‌شود. */
  if (!r.ok && /ورود نشد|429/.test(r.tail)) {
    console.log(`[رانر] ${name}: سطلِ ورود پر بود — سرورِ تازه و اجرای دوباره`);
    await stopApi(); await startApi();
    r = await runOne(name);
  }
  /* ناوردای کدگذاری (بالا) — پیش از restoreDbs()ِ سوییتِ بعد. سوییتِ سبز هم
     با آن قرمز می‌شود و پیام به لاگِ همان سوییت (آرتیفکتِ CI) هم می‌رود. */
  const coding = codingInvariantError(codingBefore);
  if (coding) {
    r = { ...r, ok: false, tail: `${coding}${r.tail ? ` ⏎ ${r.tail}` : ''}` };
    try { appendFileSync(resolve(LOG_DIR, `${name}.log`), `\n[رانر] ${coding}\n`); } catch { /* لاگ نشد؛ خطِ FAIL همچنان چاپ می‌شود */ }
  }
  results.push(r);
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${name} (${r.secs}s)${r.ok ? '' : ' — ' + r.tail.slice(0, 200)}`);
};

if (ISOLATE) {
  snapshotDbs();                                     // قالب: بعد از bootstrap و گرم‌کردن
  console.log(`[رانر] قالبِ دیتابیس گرفته شد (${TENANT_DBS.map((d) => d.tpl).join('، ')}) — هر سوییت دیتابیس و سرورِ تازه می‌گیرد`);
  for (const name of suites) {
    restoreDbs();
    await startApi();
    await record(name);
    await stopApi();
  }
} else {
  for (let i = 0; i < suites.length; i += BATCH) {
    await startApi();                                // سطلِ ورودِ تازه
    for (const name of suites.slice(i, i + BATCH)) {
      await ensureApi();
      await record(name);
    }
    await stopApi();
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} سبز · ${failed.length} قرمز`);
if (failed.length) console.log('قرمزها: ' + failed.map((r) => r.name).join(' '));
process.exit(failed.length ? 1 : 0);
