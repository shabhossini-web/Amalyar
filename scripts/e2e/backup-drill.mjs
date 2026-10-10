/**
 * پشتیبان‌گیری و تمرینِ بازگردانی (`scripts/ops/backup.sh` و `restore-drill.sh`) روی **Postgresِ واقعی**.
 *
 * زمینه (گزارشِ آمادگیِ فروش، بندِ ۲): هیچ روالی برای پشتیبان نبود، و پشتیبانی که هرگز بازگردانده نشده فقط یک فایل است.
 * این سنجه همان کاری را می‌کند که شبِ فاجعه لازم می‌شود، روی یک نصبِ کوچکِ ساختگی: نقش‌ها، دیتابیسِ مرکزی (tenants)،
 * دو دیتابیسِ شرکت و پوشهٔ فایل‌ها را پشتیبان می‌گیرد، در یک سرورِ **دیگر و خالی** برمی‌گرداند و می‌سنجد.
 *
 * دو حالت (خودکار انتخاب می‌شود؛ `E2E_BACKUP_MODE=docker|local` اجبارش می‌کند):
 *   docker — دو کانتینرِ postgres:18-alpine (همان مسیرِ production: `docker exec` + volume)؛ CI گیت‌هاب.
 *   local  — دو cluster با initdb روی دیسکِ موقت (سندباکس بی‌Docker).
 *
 *  باید بیفتد:
 *   - پشتیبانِ سالم: نقش‌ها، سه دیتابیس، آرشیوِ فایل‌ها، چکیده‌ها؛ تمرین موفق با شمارِ ردیف‌های درست
 *   - فایلِ دامپِ دستکاری‌شده ← تمرین ناموفق (چکیده)
 *   - فایلی که دیتابیس به آن ارجاع می‌دهد ولی در آرشیو نیست ← ناموفق (ردیفِ حذف‌شده‌ی نرم‌افزاری نه)
 *   - پشتیبانِ رمزشده: بی‌رمز و با رمزِ غلط ناموفق، با رمزِ درست موفق، و هیچ دامپِ بی‌رمز روی دیسک نمی‌ماند
 *   - تمرین روی سرورِ پُر (زنده) **رد می‌شود** (هرگز روی دیتابیسِ زنده بازگردانی نمی‌کند)
 *   - پشتیبانِ نیمه‌کاره: فایلِ FAILED، کدِ خروجیِ غیرصفر، LATEST عوض نمی‌شود، و تمرین آن را ناقص می‌داند
 *  نباید بیفتد:
 *   - نگهداری: پوشه‌های قدیمی پاک می‌شوند ولی سه‌تای تازه همیشه می‌مانند
 *   - دیتابیسِ `postgres` و قالب‌ها پشتیبان گرفته نمی‌شوند
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BACKUP = resolve(root, 'scripts/ops/backup.sh');
const DRILL = resolve(root, 'scripts/ops/restore-drill.sh');

let pass = 0; const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fails.push(m); console.log('  ✘ ' + m + (d ? ' — ' + String(d).slice(0, 600) : '')); } };

const dockerOk = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const PGBIN = (existsSync('/usr/lib/postgresql') ? readdirSync('/usr/lib/postgresql') : []).sort().reverse()
  .map((v) => `/usr/lib/postgresql/${v}/bin`).find((b) => existsSync(`${b}/initdb`));
const MODE = process.env.E2E_BACKUP_MODE ?? (dockerOk ? 'docker' : PGBIN ? 'local' : null);
if (!MODE) { console.log('SKIP: نه Docker هست نه Postgresِ سروری؛ این سنجه اجرا نشد'); process.exit(0); }
console.log(`حالتِ اجرا: ${MODE}`);

const work = mkdtempSync(join(tmpdir(), 'bkdrill-'));
chmodSync(work, 0o755); // کاربرِ postgres (حالتِ local با root) باید بتواند از آن رد شود
const isRoot = process.getuid?.() === 0;
const asPg = (cmd, args, opts = {}) => (isRoot ? spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], opts) : spawnSync(cmd, args, opts));
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── سرورها ── */
const servers = [];
async function startServer(name, port) {
  if (MODE === 'docker') {
    const cname = `ad-${name}-${process.pid}`;
    const r = sh('docker', ['run', '-d', '--rm', '--name', cname, '-e', 'POSTGRES_PASSWORD=pw', process.env.DRILL_IMAGE ?? 'postgres:18-alpine']);
    if (r.status !== 0) throw new Error('کانتینر بالا نیامد: ' + r.stderr);
    servers.push({ kind: 'docker', name: cname });
    for (let i = 0; i < 90; i++) {
      const logs = sh('docker', ['logs', cname]);
      const ready = ((logs.stdout ?? '') + (logs.stderr ?? '')).split('database system is ready to accept connections').length - 1;
      if (ready >= 2 && sh('docker', ['exec', cname, 'psql', '-U', 'postgres', '-qAt', '-c', 'SELECT 1']).status === 0) return { container: cname };
      await sleep(1000);
    }
    throw new Error('سرور آماده نشد');
  }
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  if (isRoot) sh('chown', ['postgres:postgres', dir]);
  chmodSync(dir, 0o755);
  const init = asPg(`${PGBIN}/initdb`, ['-D', join(dir, 'data'), '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C'], { encoding: 'utf8' });
  if (init.status !== 0) throw new Error('initdb: ' + init.stderr);
  const start = asPg(`${PGBIN}/pg_ctl`, ['-D', join(dir, 'data'), '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, 'log'), '-w', 'start'], { encoding: 'utf8' });
  if (start.status !== 0) throw new Error('pg_ctl: ' + start.stderr);
  servers.push({ kind: 'local', dir });
  return { env: { PGHOST: dir, PGPORT: String(port), PGUSER: 'postgres' }, dir };
}
const psql = (srv, db, sql) => {
  const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql];
  const r = srv.container
    ? sh('docker', ['exec', '-i', srv.container, 'psql', '-U', 'postgres', ...args])
    : sh(`${PGBIN}/psql`, ['-h', srv.env.PGHOST, '-p', srv.env.PGPORT, '-U', 'postgres', ...args]);
  if (r.status !== 0) throw new Error(`psql ${db}: ${r.stderr}\n${sql.slice(0, 200)}`);
  return r.stdout.trim();
};
const stopServer = (s) => {
  if (s.kind === 'docker') sh('docker', ['rm', '-f', s.name]);
  else asPg(`${PGBIN}/pg_ctl`, ['-D', join(s.dir, 'data'), '-m', 'immediate', 'stop'], { encoding: 'utf8' });
};
const stopAll = () => { for (const s of servers.splice(0)) stopServer(s); };
/* هر تمرین یک سرورِ **تازه** می‌خواهد (دیتابیس‌های برگشته می‌مانند). docker: خودِ اسکریپت کانتینرِ تازه می‌سازد. */
let scratchNo = 0; let currentScratch = null;
async function drillEnv(extra = {}) {
  if (MODE === 'docker') return { ...extra };
  if (currentScratch) { stopServer(currentScratch); servers.splice(servers.indexOf(currentScratch), 1); }
  const started = await startServer(`scratch${++scratchNo}`, 55440 + scratchNo);
  currentScratch = servers[servers.length - 1];
  return { ...started.env, DRILL_LOCAL: 'yes', ...extra };
}

/* ── داده‌ی ساختگیِ یک نصب ── */
const sha = (text) => createHash('sha256').update(text).digest('hex');
const acme = randomUUID(); const beta = randomUUID(); const gone = randomUUID();
const files = { acme: ['a1', 'a2', 'a3'].map((t) => ({ t, h: sha(`acme-${t}`) })), beta: [{ t: 'b1', h: sha('beta-b1') }], proof: sha('acme-proof'), deleted: sha('acme-deleted') };
function seed(src) {
  psql(src, 'postgres', `CREATE ROLE bk_provisioner LOGIN CREATEDB CREATEROLE PASSWORD 'p1'; CREATE ROLE bk_acme LOGIN PASSWORD 'secret-acme'; CREATE ROLE bk_beta LOGIN PASSWORD 'secret-beta';`);
  psql(src, 'postgres', 'CREATE DATABASE bk_control OWNER bk_provisioner');
  psql(src, 'bk_control', `CREATE TABLE tenants (id uuid PRIMARY KEY, slug text, status text, database_url_encrypted text);
    CREATE TABLE tenant_domains (id serial PRIMARY KEY, tenant_id uuid, hostname text);
    INSERT INTO tenants VALUES ('${acme}','acme','active','x'),('${beta}','beta','active','x'),('${gone}','gone','deleting','x');
    INSERT INTO tenant_domains (tenant_id, hostname) VALUES ('${acme}','acme.example.com'),('${beta}','beta.example.com');`);
  const tenantShape = `CREATE TABLE _prisma_migrations (id text PRIMARY KEY);
    CREATE TABLE patients (id serial PRIMARY KEY, first_name text);
    CREATE TABLE visits (id serial PRIMARY KEY, patient_id int);
    CREATE TABLE documents (id serial PRIMARY KEY, sha256 text NOT NULL, deleted_at timestamptz);
    CREATE TABLE stop_proofs (id serial PRIMARY KEY, sha256 text NOT NULL);`;
  psql(src, 'postgres', 'CREATE DATABASE bk_acme OWNER bk_acme');
  psql(src, 'bk_acme', `${tenantShape}
    INSERT INTO _prisma_migrations VALUES ('m1'),('m2');
    INSERT INTO patients (first_name) VALUES ('علی'),('مریم'),('رضا');
    INSERT INTO visits (patient_id) VALUES (1),(2);
    INSERT INTO documents (sha256) VALUES ${files.acme.map((f) => `('${f.h}')`).join(',')};
    INSERT INTO documents (sha256, deleted_at) VALUES ('${files.deleted}', now());
    INSERT INTO stop_proofs (sha256) VALUES ('${files.proof}');`);
  psql(src, 'postgres', 'CREATE DATABASE bk_beta OWNER bk_beta');
  psql(src, 'bk_beta', `${tenantShape}
    INSERT INTO _prisma_migrations VALUES ('m1');
    INSERT INTO patients (first_name) VALUES ('سارا');
    INSERT INTO documents (sha256) VALUES ('${files.beta[0].h}');`);
}
function writeStorage(dir, { skip } = {}) {
  rmSync(dir, { recursive: true, force: true });
  const put = (tenant, hash, text) => {
    if (hash === skip) return;
    mkdirSync(join(dir, tenant, hash.slice(0, 2)), { recursive: true });
    writeFileSync(join(dir, tenant, hash.slice(0, 2), hash), text);
  };
  for (const f of files.acme) put(acme, f.h, `acme-${f.t}`);
  put(acme, files.proof, 'acme-proof');
  for (const f of files.beta) put(beta, f.h, `beta-${f.t}`);
  mkdirSync(join(dir, '.ledger'), { recursive: true });
  writeFileSync(join(dir, '.ledger', 'containers.json'), '{"v":1,"first":"x","seen":[]}'); // نباید ارجاعِ فایل حساب شود
}

/* ── اجرای اسکریپت‌ها ── */
const run = (script, env, args = []) => {
  const r = sh('bash', [script, ...args], { env: { ...process.env, ...env }, input: '' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const flat = (s) => s.replace(/\s+/g, ' ');

try {
  console.log('۰) آماده‌سازی: دو سرورِ جدا (مبدأ و تمرین) و یک نصبِ ساختگی');
  const src = await startServer('src', 55431);
  seed(src);
  const BK = join(work, 'backups'); const ST = join(work, 'storage');
  writeStorage(ST);
  const srcEnv = MODE === 'docker' ? { PG_CONTAINER: src.container } : src.env;
  const baseEnv = { ...srcEnv, BACKUP_DIR: BK, STORAGE_DIR: ST };
  ok(true, 'سرورها و داده آماده شد');

  console.log('\n۱) پشتیبانِ سالم');
  let b = run(BACKUP, baseEnv);
  ok(b.code === 0, 'backup.sh موفق', b.out);
  const latest = readFileSync(join(BK, 'LATEST'), 'utf8').trim();
  const dir = join(BK, latest);
  const names = readdirSync(dir).sort();
  ok(JSON.stringify(names) === JSON.stringify(['MANIFEST.txt', 'SHA256SUMS', 'bk_acme.dump', 'bk_beta.dump', 'bk_control.dump', 'globals.sql', 'storage.tar.gz']), `محتوای پوشه: ${names.join(' ')}`);
  ok(!names.some((n) => /^postgres\.dump$|template/.test(n)), 'دیتابیسِ postgres و قالب‌ها پشتیبان نمی‌شوند');
  ok(readFileSync(join(dir, 'globals.sql'), 'utf8').includes('bk_acme') && !readFileSync(join(dir, 'globals.sql'), 'utf8').includes('secret-acme'), 'نقش‌ها در globals هست (رمز به‌صورتِ چکیده، نه متنِ ساده)');
  ok(/دیتابیس‌ها \(3\)/.test(readFileSync(join(dir, 'MANIFEST.txt'), 'utf8')) && /رمزشده: خیر/.test(readFileSync(join(dir, 'MANIFEST.txt'), 'utf8')), 'خلاصه: سه دیتابیس، بی‌رمز');
  ok(!existsSync(join(dir, 'FAILED')), 'علامتِ FAILED نیست');
  ok(!readdirSync(BK).some((n) => n.startsWith('.tmp')), 'پوشهٔ موقت پاک شد');
  const tarList = sh('tar', ['-tzf', join(dir, 'storage.tar.gz')]).stdout;
  ok(tarList.includes(files.proof) && !tarList.includes('.ledger'), '**آرشیوِ فایل‌ها `.ledger` (اثباتِ ماندگاریِ volume) را ندارد** — بعد از بازگردانی اثبات از صفر شروع می‌شود، نه موروثی');

  console.log('\n۲) تمرینِ بازگردانی');
  let d = run(DRILL, await drillEnv({ BACKUP_DIR: BK }), [latest]);
  const df = flat(d.out);
  ok(d.code === 0 && /تمرین موفق/.test(d.out), '**تمرینِ بازگردانی موفق**', d.out);
  ok(/نقش‌ها برگشتند \(3 نقش|نقش‌ها برگشتند \(\d+ نقش\)/.test(d.out), 'نقش‌ها برگشتند');
  ok(/bk_acme 2 3 2 4/.test(df) && /bk_beta 1 1 0 1/.test(df), `**شمارِ ردیف‌ها بعد از بازگردانی درست است** (acme: ۲ migration، ۳ بیمار، ۲ مراجعه، ۴ مدرک؛ beta: ۱ migration، ۱ بیمار، ۰ مراجعه، ۱ مدرک)`, df.slice(df.indexOf('دیتابیس'), df.indexOf('دیتابیس') + 400));
  ok(/دیتابیسِ مرکزی: bk_control \(2 شرکتِ فعال\)/.test(d.out) && /همهٔ شرکت‌های فعال برگشت \(2 از 2\)/.test(d.out), 'مرکزی و دیتابیسِ هر شرکتِ فعال برگشت (شرکتِ در حال حذف شمرده نمی‌شود)');
  ok(/همهٔ 5 فایلِ ارجاع‌شده/.test(d.out), '**هر فایلِ ارجاع‌شده در آرشیو هست** (۳ مدرکِ آکمه + یک مدرکِ بتا + یک اثبات = ۵؛ مدرکِ حذف‌شده و دفترِ کانتینرها شمرده نمی‌شوند)', d.out);
  ok(/ثانیه/.test(d.out), 'زمانِ بازگردانی گزارش شد');
  if (MODE === 'docker') ok(sh('docker', ['ps', '-a', '--format', '{{.Names}}']).stdout.indexOf('amalyar-drill-') < 0, 'کانتینرِ تمرین پاک شد');

  console.log('\n۳) چیزی که باید قرمز شود');
  const dump = join(dir, 'bk_acme.dump');
  const original = readFileSync(dump);
  const flipped = Buffer.from(original); flipped[Math.floor(flipped.length / 2)] ^= 0xff;
  writeFileSync(dump, flipped);
  d = run(DRILL, await drillEnv({ BACKUP_DIR: BK }), [latest]);
  ok(d.code === 1 && /چکیده‌ها نمی‌خوانند/.test(d.out) && /تمرین ناموفق/.test(d.out), '**دامپِ دستکاری‌شده ← تمرین ناموفق (چکیده)**', d.out);
  writeFileSync(dump, original);

  // فایلِ ارجاع‌شده‌ای که در آرشیو نیست: پشتیبانِ تازه از ذخیره‌گاهِ ناقص
  writeStorage(ST, { skip: files.acme[1].h });
  b = run(BACKUP, baseEnv);
  ok(b.code === 0, 'پشتیبانِ دوم (ذخیره‌گاهِ ناقص) گرفته شد', b.out);
  const latest2 = readFileSync(join(BK, 'LATEST'), 'utf8').trim();
  ok(latest2 !== latest, 'LATEST جلو رفت');
  d = run(DRILL, await drillEnv({ BACKUP_DIR: BK }), [latest2]);
  ok(d.code === 1 && /1 فایلِ ارجاع‌شده در آرشیوِ فایل‌ها نیست/.test(d.out), '**فایلِ گم‌شده‌ی ارجاع‌شده ← تمرین ناموفق** (DB و فایل‌ها هم‌خوان نیستند)', d.out);
  ok(!/دیتابیسِ .* برنگشت/.test(d.out), 'با این‌همه دیتابیس‌ها برگشته‌اند (فقط فایل کم است)');
  writeStorage(ST);

  console.log('\n۴) سرورِ پُر = زنده: تمرین باید رد کند');
  if (MODE === 'local') {
    d = run(DRILL, { ...src.env, DRILL_LOCAL: 'yes', BACKUP_DIR: BK }, [latest]);
    ok(d.code === 2 && /سرورِ تمرین باید خالی باشد/.test(d.out) && /هرگز روی سرورِ زنده/.test(d.out), '**روی سرورِ پُر بازگردانی نمی‌کند** (کدِ ۲)', d.out);
    ok(psql(src, 'bk_acme', 'SELECT count(*) FROM patients') === '3', 'دیتابیسِ زنده دست‌نخورده ماند');
    const bare = { ...(await drillEnv()) }; delete bare.DRILL_LOCAL;
    d = run(DRILL, { ...bare, BACKUP_DIR: BK, PATH: '/usr/bin:/bin' }, [latest]);
    ok(d.code === 2 && /Docker|کانتینرِ تمرین بالا نیامد/.test(d.out), 'بدونِ DRILL_LOCAL=yes هرگز از PG* به‌عنوانِ سرورِ تمرین استفاده نمی‌کند', d.out);
    ok(psql({ env: bare }, 'postgres', "SELECT count(*) FROM pg_database WHERE datname LIKE 'bk_%'") === '0', 'و چیزی روی آن سرور بازگردانی نشد');
  } else ok(true, '(حالتِ docker: سرورِ تمرین همیشه تازه است؛ ردِ سرورِ پُر فقط در حالتِ محلی معنا دارد)');

  console.log('\n۵) پشتیبانِ رمزشده');
  const BK2 = join(work, 'backups-enc');
  b = run(BACKUP, { ...baseEnv, BACKUP_DIR: BK2, BACKUP_PASSPHRASE: 'رمزِ-آزمون-۱۲۳' });
  ok(b.code === 0, 'پشتیبانِ رمزشده گرفته شد', b.out);
  const encDir = join(BK2, readFileSync(join(BK2, 'LATEST'), 'utf8').trim());
  const encNames = readdirSync(encDir).sort();
  ok(encNames.includes('bk_acme.dump.enc') && encNames.includes('globals.sql.enc') && encNames.includes('storage.tar.gz.enc'), `فایل‌ها .enc اند: ${encNames.join(' ')}`);
  ok(!encNames.some((n) => /\.dump$|globals\.sql$|\.tar\.gz$/.test(n)), '**هیچ دامپِ بی‌رمزی روی دیسک نماند**');
  ok(!readFileSync(join(encDir, 'bk_acme.dump.enc')).includes('first_name') && !readFileSync(join(encDir, 'bk_acme.dump.enc')).includes(Buffer.from('PGDMP')), 'محتوای دامپ خوانا نیست');
  ok(/رمزشده: بله/.test(readFileSync(join(encDir, 'MANIFEST.txt'), 'utf8')), 'خلاصه می‌گوید رمزشده');
  const encName = encDir.split('/').pop();
  d = run(DRILL, await drillEnv({ BACKUP_DIR: BK2 }), [encName]);
  ok(d.code === 2 && /BACKUP_PASSPHRASE/.test(d.out), 'بی‌رمز: می‌ایستد و رمز را می‌خواهد', d.out);
  d = run(DRILL, await drillEnv({ BACKUP_DIR: BK2, BACKUP_PASSPHRASE: 'غلط' }), [encName]);
  ok(d.code === 1 && /رمزگشایی .* شکست/.test(d.out), 'رمزِ غلط ← ناموفق', d.out);
  d = run(DRILL, await drillEnv({ BACKUP_DIR: BK2, BACKUP_PASSPHRASE: 'رمزِ-آزمون-۱۲۳' }), [encName]);
  ok(d.code === 0 && /تمرین موفق/.test(d.out), '**رمزِ درست ← تمرین موفق**', d.out);

  console.log('\n۶) پشتیبانِ نیمه‌کاره و خطا');
  const before = readFileSync(join(BK, 'LATEST'), 'utf8');
  b = run(BACKUP, { ...baseEnv, STORAGE_DIR: join(work, 'nope') });
  ok(b.code !== 0 && /پوشهٔ فایل‌ها پیدا نشد/.test(b.out), 'نبودنِ پوشهٔ فایل‌ها خطاست، نه هشدارِ بی‌صدا', b.out);
  const failedDirs = readdirSync(BK).filter((n) => /^\d{8}T\d{6}Z$/.test(n) && existsSync(join(BK, n, 'FAILED')));
  ok(failedDirs.length === 1, '**فایلِ FAILED کنارِ پشتیبانِ ناقص نشست**');
  ok(readFileSync(join(BK, 'LATEST'), 'utf8') === before, 'LATEST به پشتیبانِ ناقص اشاره نمی‌کند');
  d = run(DRILL, await drillEnv({ BACKUP_DIR: BK }), [failedDirs[0]]);
  ok(d.code === 1 && /ناقص علامت خورده/.test(d.out), 'تمرین پشتیبانِ ناقص را ناقص می‌داند', d.out);
  b = run(BACKUP, { ...baseEnv, ...(MODE === 'docker' ? { PG_CONTAINER: 'no-such-container-xyz' } : { PGPORT: '59999' }) });
  ok(b.code !== 0 && /به Postgres وصل نشدم/.test(b.out), 'قطعِ Postgres ← خطای روشن و کدِ غیرصفر', b.out);
  b = run(BACKUP, { ...baseEnv, SKIP_STORAGE: '1', STORAGE_DIR: '' , BACKUP_DIR: join(work, 'backups-nostorage') });
  ok(b.code === 0 && !readdirSync(join(work, 'backups-nostorage', readFileSync(join(work, 'backups-nostorage', 'LATEST'), 'utf8').trim())).includes('storage.tar.gz'), 'SKIP_STORAGE=1 فقط دیتابیس را می‌گیرد', b.out);

  console.log('\n۷) نگهداری');
  /* ⚠️ نامِ پوشه فاصله دارد و «همسایه»ی قدیمی‌اش (`backups`) هست: با `for d in $(ls …)` شکستنِ کلمه‌ها یک مسیرِ دیگر را
     (`…/backups`) به `rm -rf` می‌داد. */
  const BK3 = join(work, 'backups retention');
  mkdirSync(BK3, { recursive: true });
  for (let i = 1; i <= 5; i++) {
    const old = join(BK3, `2020010${i}T000000Z`);
    mkdirSync(old); writeFileSync(join(old, 'x'), 'x');
    utimesSync(old, new Date('2020-01-0' + i), new Date('2020-01-0' + i));
  }
  utimesSync(BK, new Date('2020-01-01'), new Date('2020-01-01'));
  b = run(BACKUP, { ...baseEnv, BACKUP_DIR: BK3, RETENTION_DAYS: '14' });
  const left = readdirSync(BK3).filter((n) => /^\d{8}T\d{6}Z$/.test(n)).sort();
  ok(b.code === 0 && left.length === 3 && left.includes('20200105T000000Z') && left.includes('20200104T000000Z') && !left.includes('20200101T000000Z'), `قدیمی‌ها پاک شدند ولی سه‌تای تازه ماند: ${left.join(' ')}`, b.out);
  ok(existsSync(BK) && existsSync(join(BK, 'LATEST')), '**نامِ پوشه با فاصله مسیرِ همسایه را پاک نکرد** (شکستنِ کلمه‌ها `rm -rf` را به جای دیگر نمی‌برد)');

  console.log('\n۷ب) دسترسیِ فایل‌ها — دامپ مدرکِ بیمار است');
  const newest = join(BK3, readFileSync(join(BK3, 'LATEST'), 'utf8').trim());
  const mode = (p) => (statSync(p).mode & 0o777).toString(8);
  ok(mode(newest) === '700' && mode(join(newest, 'bk_acme.dump')) === '600' && mode(join(newest, 'globals.sql')) === '600' && mode(join(newest, 'storage.tar.gz')) === '600',
    `**پوشه ۷۰۰ و فایل‌ها ۶۰۰** (کاربرِ دیگرِ سرور نمی‌خواند): ${mode(newest)} / ${mode(join(newest, 'bk_acme.dump'))}`);

  if (MODE === 'docker') {
    console.log('\n۸) volume (مسیرِ production)');
    const vol = `ad-vol-${process.pid}`;
    sh('docker', ['volume', 'create', vol]);
    writeStorage(ST);
    const cp = sh('docker', ['run', '--rm', '-v', `${vol}:/data`, '-v', `${ST}:/src:ro`, 'alpine', 'sh', '-c', 'cp -a /src/. /data/']);
    ok(cp.status === 0, 'volume با فایل‌ها پُر شد', cp.stderr);
    b = run(BACKUP, { ...srcEnv, BACKUP_DIR: join(work, 'backups-vol'), STORAGE_VOLUME: vol });
    const vdir = join(work, 'backups-vol', readFileSync(join(work, 'backups-vol', 'LATEST'), 'utf8').trim());
    const listing = sh('tar', ['-tzf', join(vdir, 'storage.tar.gz')]).stdout;
    ok(b.code === 0 && listing.includes(files.proof), 'پشتیبانِ volume (docker run alpine tar) فایل‌ها را دارد', b.out);
    sh('docker', ['volume', 'rm', '-f', vol]);
  }
} catch (e) {
  fails.push('استثنا: ' + (e?.stack ?? e));
  console.log('  ✘ استثنا: ' + (e?.stack ?? e));
} finally {
  stopAll();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\nسبز: ${pass}  قرمز: ${fails.length}`);
if (fails.length) process.exit(1);
