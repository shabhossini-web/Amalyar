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
 *   - (بازبینیِ ۱۴۰۵/۰۷/۱۹) همهٔ نقش‌ها سنجیده می‌شوند نه فقط اولی؛ شرکتِ فعال با نامِ دیتابیسش (یتیم جایش را پر نمی‌کند)؛
 *     فایل در پوشهٔ همان شرکت؛ رمزِ دارای $ ` ; # از فایلِ تنظیمات بی‌تفسیرِ شل؛ coolify-db کنار؛ شکستِ rclone ← کدِ ۳ و
 *     UPLOAD_FAILED (نه FAILED) و نگهداری پیش از آپلود
 *  نباید بیفتد:
 *   - نگهداری: پوشه‌های قدیمی پاک می‌شوند ولی سه‌تای تازه همیشه می‌مانند
 *   - دیتابیسِ `postgres`ِ خالی و قالب‌ها پشتیبان گرفته نمی‌شوند (`postgres`ِ دارای جدول — دیتابیسِ مرکزیِ نصبِ واقعی — گرفته می‌شود)
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
  psql(src, 'postgres', `CREATE ROLE bk_provisioner LOGIN CREATEDB CREATEROLE PASSWORD 'p1'; CREATE ROLE amalyar_acme_app LOGIN PASSWORD 'secret-acme'; CREATE ROLE amalyar_beta_app LOGIN PASSWORD 'secret-beta';`);
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
  psql(src, 'postgres', 'CREATE DATABASE amalyar_acme OWNER amalyar_acme_app');
  psql(src, 'amalyar_acme', `${tenantShape}
    INSERT INTO _prisma_migrations VALUES ('m1'),('m2');
    INSERT INTO patients (first_name) VALUES ('علی'),('مریم'),('رضا');
    INSERT INTO visits (patient_id) VALUES (1),(2);
    INSERT INTO documents (sha256) VALUES ${files.acme.map((f) => `('${f.h}')`).join(',')};
    INSERT INTO documents (sha256, deleted_at) VALUES ('${files.deleted}', now());
    INSERT INTO stop_proofs (sha256) VALUES ('${files.proof}');`);
  psql(src, 'postgres', 'CREATE DATABASE amalyar_beta OWNER amalyar_beta_app');
  psql(src, 'amalyar_beta', `${tenantShape}
    INSERT INTO _prisma_migrations VALUES ('m1');
    INSERT INTO patients (first_name) VALUES ('سارا');
    INSERT INTO documents (sha256) VALUES ('${files.beta[0].h}');`);
}
function writeStorage(dir, { skip, betaInto } = {}) {
  rmSync(dir, { recursive: true, force: true });
  const put = (tenant, hash, text) => {
    if (hash === skip) return;
    mkdirSync(join(dir, tenant, hash.slice(0, 2)), { recursive: true });
    writeFileSync(join(dir, tenant, hash.slice(0, 2), hash), text);
  };
  for (const f of files.acme) put(acme, f.h, `acme-${f.t}`);
  put(acme, files.proof, 'acme-proof');
  for (const f of files.beta) put(betaInto ?? beta, f.h, `beta-${f.t}`);
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
  let ctl = 'bk_control';
  const baseEnv = { ...srcEnv, BACKUP_DIR: BK, STORAGE_DIR: ST };
  ok(true, 'سرورها و داده آماده شد');

  console.log('\n۱) پشتیبانِ سالم');
  let b = run(BACKUP, baseEnv);
  ok(b.code === 0, 'backup.sh موفق', b.out);
  const latest = readFileSync(join(BK, 'LATEST'), 'utf8').trim();
  const dir = join(BK, latest);
  const names = readdirSync(dir).sort();
  ok(JSON.stringify(names) === JSON.stringify(['MANIFEST.txt', 'SHA256SUMS', 'amalyar_acme.dump', 'amalyar_beta.dump', 'bk_control.dump', 'globals.sql', 'storage.tar.gz']), `محتوای پوشه: ${names.join(' ')}`);
  ok(!names.some((n) => /^postgres\.dump$|template/.test(n)), 'دیتابیسِ postgres و قالب‌ها پشتیبان نمی‌شوند');
  ok(readFileSync(join(dir, 'globals.sql'), 'utf8').includes('amalyar_acme_app') && !readFileSync(join(dir, 'globals.sql'), 'utf8').includes('secret-acme'), 'نقش‌ها در globals هست (رمز به‌صورتِ چکیده، نه متنِ ساده)');
  ok(/دیتابیس‌ها \(3\)/.test(readFileSync(join(dir, 'MANIFEST.txt'), 'utf8')) && /رمزشده: خیر/.test(readFileSync(join(dir, 'MANIFEST.txt'), 'utf8')), 'خلاصه: سه دیتابیس، بی‌رمز');
  ok(!existsSync(join(dir, 'FAILED')), 'علامتِ FAILED نیست');
  ok(!readdirSync(BK).some((n) => n.startsWith('.tmp')), 'پوشهٔ موقت پاک شد');
  const tarList = sh('tar', ['-tzf', join(dir, 'storage.tar.gz')]).stdout;
  ok(tarList.includes(files.proof) && !tarList.includes('.ledger'), '**آرشیوِ فایل‌ها `.ledger` (اثباتِ ماندگاریِ volume) را ندارد** — بعد از بازگردانی اثبات از صفر شروع می‌شود، نه موروثی');

  console.log('\n۲) تمرینِ بازگردانی');
  let d = run(DRILL, await drillEnv({ BACKUP_DIR: BK }), [latest]);
  const df = flat(d.out);
  ok(d.code === 0 && /تمرین موفق/.test(d.out), '**تمرینِ بازگردانی موفق**', d.out);
  /* شمارِ نقش‌های گزارش‌شده باید دقیقاً همهٔ CREATE ROLEهای پشتیبان باشد — در حالتِ Docker، `docker exec -i` داخلِ حلقه
     بقیهٔ فهرست را می‌بلعید و فقط نقشِ اول سنجیده می‌شد. */
  const roleCount = (readFileSync(join(dir, 'globals.sql'), 'utf8').match(/^CREATE ROLE /gm) ?? []).length;
  ok(roleCount >= 3 && new RegExp(`نقش‌ها برگشتند \\(${roleCount} نقش\\)`).test(d.out), `**همهٔ ${roleCount} نقشِ پشتیبان سنجیده شد** (نه فقط اولی)`, d.out.match(/نقش‌ها[^\n]*/)?.[0]);
  ok(!/بی‌اجازهٔ ورود یا بی‌رمز/.test(d.out), 'نقشِ هر شرکت با اجازهٔ ورود و رمز برگشت');
  ok(/amalyar_acme 2 3 2 4/.test(df) && /amalyar_beta 1 1 0 1/.test(df), `**شمارِ ردیف‌ها بعد از بازگردانی درست است** (acme: ۲ migration، ۳ بیمار، ۲ مراجعه، ۴ مدرک؛ beta: ۱ migration، ۱ بیمار، ۰ مراجعه، ۱ مدرک)`, df.slice(df.indexOf('دیتابیس'), df.indexOf('دیتابیس') + 400));
  ok(/دیتابیسِ مرکزی: bk_control \(2 شرکتِ فعال\)/.test(d.out) && /همهٔ شرکت‌های فعال برگشت \(2 از 2، هرکدام با نامِ خودش\)/.test(d.out), '**دیتابیسِ هر شرکتِ فعال با نامِ خودش برگشت** (شرکتِ در حال حذف شمرده نمی‌شود)', d.out);
  ok(/همهٔ 4 فایلِ ارجاع‌شدهٔ amalyar_acme در پوشهٔ همان شرکت/.test(d.out) && /همهٔ 1 فایلِ ارجاع‌شدهٔ amalyar_beta در پوشهٔ همان شرکت/.test(d.out),
    '**هر فایلِ ارجاع‌شده در پوشهٔ همان شرکت هست** (آکمه: ۳ مدرک + یک اثبات؛ بتا: یک مدرک؛ مدرکِ حذف‌شده و دفترِ کانتینرها شمرده نمی‌شوند)', d.out);
  ok(!/ ! /.test(d.out) && /کامل برگشت/.test(d.out), 'بی‌هشدار — «کامل برگشت»', d.out);
  ok(/ثانیه/.test(d.out), 'زمانِ بازگردانی گزارش شد');
  if (MODE === 'docker') ok(sh('docker', ['ps', '-a', '--format', '{{.Names}}']).stdout.indexOf('amalyar-drill-') < 0, 'کانتینرِ تمرین پاک شد');

  console.log('\n۳) چیزی که باید قرمز شود');
  const dump = join(dir, 'amalyar_acme.dump');
  const original = readFileSync(dump);
  const flipped = Buffer.from(original); flipped[Math.floor(flipped.length / 2)] ^= 0xff;
  writeFileSync(dump, flipped);
  d = run(DRILL, await drillEnv({ BACKUP_DIR: BK }), [latest]);
  ok(d.code === 1 && /چکیده‌ها نمی‌خوانند/.test(d.out) && /تمرین ناموفق/.test(d.out), '**دامپِ دستکاری‌شده ← تمرین ناموفق (چکیده)**', d.out);
  writeFileSync(dump, original);

  /* فایلی که **همان لحظهٔ پشتیبان‌گیری** روی سرور نبود (پیش‌تر از دست رفته — اولین تمرینِ واقعی ۲۴ مدرکِ این‌چنینی داشت):
     پشتیبان ثبتش می‌کند و تمرین هشدار می‌دهد، نه «ناموفق» — وگرنه تمرین تا آپلودِ دوباره همیشه قرمز می‌ماند. */
  writeStorage(ST, { skip: files.acme[1].h });
  b = run(BACKUP, baseEnv);
  const latest2 = readFileSync(join(BK, 'LATEST'), 'utf8').trim();
  ok(b.code === 0 && latest2 !== latest, 'پشتیبانِ دوم (ذخیره‌گاهی که یک مدرکش از قبل نیست) گرفته شد', b.out);
  ok(/1 فایلِ ارجاع‌شده همین الان روی سرور نیست/.test(b.out) && /amalyar_acme: 1/.test(b.out), '**پشتیبان همان لحظه می‌گوید کدام شرکت چند مدرکِ ازدست‌رفته دارد**', b.out);
  const missingTxt = existsSync(join(BK, latest2, 'MISSING_FILES.txt')) ? readFileSync(join(BK, latest2, 'MISSING_FILES.txt'), 'utf8') : '';
  ok(missingTxt.trim() === `amalyar_acme ${files.acme[1].h}`, 'MISSING_FILES.txt فقط «دیتابیس چکیده» دارد (بی‌دادهٔ بیمار)', missingTxt);
  ok(readFileSync(join(BK, latest2, 'SHA256SUMS'), 'utf8').includes('MISSING_FILES.txt'), 'و در چکیده‌ها هست (دستکاری‌اش لو می‌رود)');
  d = run(DRILL, await drillEnv({ BACKUP_DIR: BK }), [latest2]);
  ok(d.code === 0 && /تمرین موفق با 1 هشدار/.test(d.out) && /1 فایلِ ارجاع‌شدهٔ amalyar_acme هنگامِ پشتیبان‌گیری هم روی سرور نبود/.test(d.out)
    && /فایل‌های ارجاع‌شدهٔ amalyar_acme برگشتند \(3 از 4\)/.test(d.out), '**«از قبل نبود» هشدار است، نه شکستِ پشتیبان**', d.out);
  writeStorage(ST);

  /* ولی فایلی که در سرور بود و در آرشیو نیست (یا در پوشهٔ شرکتِ دیگر است) همچنان «ناموفق» است: آرشیوِ پشتیبانِ سالمِ اول
     دستکاری می‌شود و چکیده‌ها از نو ساخته می‌شوند تا فقط سنجهٔ فایل‌ها بتواند بگیردش. */
  const tamper = (name, script) => {
    const dst = join(work, name); const x = join(work, `${name}-x`);
    sh('bash', ['-c', `set -e; cp -a "${dir}" "${dst}"; mkdir -p "${x}"; tar -xzf "${dst}/storage.tar.gz" -C "${x}"; ${script}; tar -C "${x}" -czf "${dst}/storage.tar.gz" .; cd "${dst}"; sha256sum -- $(ls | grep -v -e SHA256SUMS -e MANIFEST.txt) > SHA256SUMS`]);
    return dst;
  };
  const t1 = tamper('tampered-missing', `rm "${join(work, 'tampered-missing-x')}/${acme}/${files.acme[1].h.slice(0, 2)}/${files.acme[1].h}"`);
  d = run(DRILL, await drillEnv(), [t1]);
  ok(d.code === 1 && /1 فایلِ ارجاع‌شدهٔ amalyar_acme در پوشهٔ شرکتش نیست/.test(d.out) && !/هنگامِ پشتیبان‌گیری هم روی سرور نبود/.test(d.out), '**فایلی که در آرشیو جا ماند ← تمرین ناموفق** (پشتیبان آن را «از قبل نبود» ثبت نکرده بود)', d.out);
  const bh = files.beta[0].h;
  const t2 = tamper('tampered-folder', `mkdir -p "${join(work, 'tampered-folder-x')}/${acme}/${bh.slice(0, 2)}"; mv "${join(work, 'tampered-folder-x')}/${beta}/${bh.slice(0, 2)}/${bh}" "${join(work, 'tampered-folder-x')}/${acme}/${bh.slice(0, 2)}/"`);
  d = run(DRILL, await drillEnv(), [t2]);
  ok(d.code === 1 && /1 فایلِ ارجاع‌شدهٔ amalyar_beta در پوشهٔ شرکتش نیست/.test(d.out), '**فایلِ بتا در پوشهٔ آکمه جای فایلِ بتا را پر نمی‌کند** (سنجهٔ تمرین، پوشه‌به‌پوشه)', d.out);
  ok(!/دیتابیسِ .* برنگشت/.test(d.out), 'با این‌همه دیتابیس‌ها برگشته‌اند (فقط فایل کم است)');

  console.log('\n۴) سرورِ پُر = زنده: تمرین باید رد کند');
  if (MODE === 'local') {
    d = run(DRILL, { ...src.env, DRILL_LOCAL: 'yes', BACKUP_DIR: BK }, [latest]);
    ok(d.code === 2 && /سرورِ تمرین باید خالی باشد/.test(d.out) && /هرگز روی سرورِ زنده/.test(d.out), '**روی سرورِ پُر بازگردانی نمی‌کند** (کدِ ۲)', d.out);
    ok(psql(src, 'amalyar_acme', 'SELECT count(*) FROM patients') === '3', 'دیتابیسِ زنده دست‌نخورده ماند');
    const bare = { ...(await drillEnv()) }; delete bare.DRILL_LOCAL;
    d = run(DRILL, { ...bare, BACKUP_DIR: BK, PATH: '/usr/bin:/bin' }, [latest]);
    ok(d.code === 2 && /Docker|کانتینرِ تمرین بالا نیامد/.test(d.out), 'بدونِ DRILL_LOCAL=yes هرگز از PG* به‌عنوانِ سرورِ تمرین استفاده نمی‌کند', d.out);
    ok(psql({ env: bare }, 'postgres', "SELECT count(*) FROM pg_database WHERE datname LIKE 'bk_%' OR datname LIKE 'amalyar_%'") === '0', 'و چیزی روی آن سرور بازگردانی نشد');
  } else ok(true, '(حالتِ docker: سرورِ تمرین همیشه تازه است؛ ردِ سرورِ پُر فقط در حالتِ محلی معنا دارد)');

  console.log('\n۵) پشتیبانِ رمزشده');
  const BK2 = join(work, 'backups-enc');
  b = run(BACKUP, { ...baseEnv, BACKUP_DIR: BK2, BACKUP_PASSPHRASE: 'رمزِ-آزمون-۱۲۳' });
  ok(b.code === 0, 'پشتیبانِ رمزشده گرفته شد', b.out);
  const encDir = join(BK2, readFileSync(join(BK2, 'LATEST'), 'utf8').trim());
  const encNames = readdirSync(encDir).sort();
  ok(encNames.includes('amalyar_acme.dump.enc') && encNames.includes('globals.sql.enc') && encNames.includes('storage.tar.gz.enc'), `فایل‌ها .enc اند: ${encNames.join(' ')}`);
  ok(!encNames.some((n) => /\.dump$|globals\.sql$|\.tar\.gz$/.test(n)), '**هیچ دامپِ بی‌رمزی روی دیسک نماند**');
  ok(!readFileSync(join(encDir, 'amalyar_acme.dump.enc')).includes('first_name') && !readFileSync(join(encDir, 'amalyar_acme.dump.enc')).includes(Buffer.from('PGDMP')), 'محتوای دامپ خوانا نیست');
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
  ok(mode(newest) === '700' && mode(join(newest, 'amalyar_acme.dump')) === '600' && mode(join(newest, 'globals.sql')) === '600' && mode(join(newest, 'storage.tar.gz')) === '600',
    `**پوشه ۷۰۰ و فایل‌ها ۶۰۰** (کاربرِ دیگرِ سرور نمی‌خواند): ${mode(newest)} / ${mode(join(newest, 'amalyar_acme.dump'))}`);

  console.log('\n۷ج) فایلِ تنظیمات — رمزِ دارای نویسه‌های ویژه همان‌طور می‌ماند');
  /* ⚠️ دستورِ قبلیِ سند فایل را با heredocِ بی‌نقل می‌ساخت و cron با `. فایل` می‌خواندش: $ و ` هنگامِ نوشتن و فاصله/#/; هنگامِ
     خواندن عوض می‌شد و cron با رمزی جز رمزِ مدیرِ رمزِ مالک رمز می‌کرد. حالا فایل متنی خوانده می‌شود. */
  const BK4 = join(work, 'backups-envfile');
  const PASS = 'p@ss $HOME ' + '`id`' + ' ; # & (x) "q"';
  const envFile = join(work, 'amalyar-backup.env');
  writeFileSync(envFile, `# تنظیماتِ پشتیبان\nBACKUP_DIR=${BK4}\nBACKUP_PASSPHRASE='${PASS}'\nRETENTION_DAYS=14\n`, { mode: 0o600 });
  b = run(BACKUP, { ...srcEnv, STORAGE_DIR: ST, BACKUP_ENV: envFile });
  ok(b.code === 0 && existsSync(join(BK4, 'LATEST')), 'backup.sh پوشه و رمز را از فایل خواند', b.out);
  const envDir = join(BK4, readFileSync(join(BK4, 'LATEST'), 'utf8').trim());
  const dec = sh('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-pass', 'env:LIT', '-in', join(envDir, 'globals.sql.enc')], { env: { ...process.env, LIT: PASS } });
  ok(dec.status === 0 && /CREATE ROLE/.test(dec.stdout), '**با همان رمزِ نوشته‌شده در فایل باز می‌شود** (بی‌تفسیرِ شل)', dec.stderr);
  d = run(DRILL, await drillEnv({ BACKUP_ENV: envFile }), []);
  ok(d.code === 0 && /تمرین موفق/.test(d.out), '**تمرین رمز و پوشه را از همان فایل می‌خواند** (رمز در خطِ فرمان نمی‌آید)', d.out);
  writeFileSync(envFile, `BACKUP_DIR=${BK4}\nPG_CONTAINR=x\n`);
  b = run(BACKUP, { ...srcEnv, STORAGE_DIR: ST, BACKUP_ENV: envFile });
  ok(b.code !== 0 && /کلیدِ ناشناخته/.test(b.out) && /PG_CONTAINR/.test(b.out), 'کلیدِ غلط‌تایپی بی‌صدا نادیده گرفته نمی‌شود', b.out);

  console.log('\n۷د) میزبانِ Coolify: کانتینرِ coolify-db کنار گذاشته می‌شود');
  const fakeDocker = join(work, 'shim-docker'); mkdirSync(fakeDocker);
  const dockerShim = (lines) => writeFileSync(join(fakeDocker, 'docker'), `#!/bin/sh\nif [ "$1" = ps ]; then printf '${lines.join('\\n')}\\n'; exit 0; fi\nexit 1\n`, { mode: 0o755 });
  const noPg = { PATH: `${fakeDocker}:${process.env.PATH}`, PGHOST: '', PG_CONTAINER: '', BACKUP_DIR: join(work, 'backups-shim'), STORAGE_DIR: ST, BACKUP_ENV: '/nonexistent' };
  dockerShim(['coolify-db postgres:15-alpine', 'amalyar-pg-x postgres:18-alpine', 'coolify-redis redis:7-alpine']);
  b = run(BACKUP, noPg);
  ok(b.code !== 0 && /کانتینر «amalyar-pg-x»/.test(b.out) && !/یکتا پیدا کنم/.test(b.out), '**از میانِ coolify-db و Postgresِ عمل‌یار، دومی انتخاب شد**', b.out);
  dockerShim(['coolify-db postgres:15-alpine', 'pg-a postgres:18-alpine', 'pg-b postgres:18-alpine']);
  b = run(BACKUP, noPg);
  ok(b.code !== 0 && /یکتا پیدا کنم/.test(b.out) && /PG_CONTAINER/.test(b.out), 'دو Postgresِ غیرِ Coolify ← می‌ایستد و نام می‌خواهد (حدس نمی‌زند)', b.out);

  console.log('\n۷ه) آپلودِ بیرونی شکست خورد — پشتیبانِ محلی سالم می‌ماند');
  const fakeRclone = join(work, 'shim-rclone'); mkdirSync(fakeRclone);
  writeFileSync(join(fakeRclone, 'rclone'), '#!/bin/sh\necho "network down" >&2\nexit 1\n', { mode: 0o755 });
  const BK5 = join(work, 'backups-rclone'); mkdirSync(BK5);
  for (let i = 1; i <= 4; i++) {
    const old = join(BK5, `2020020${i}T000000Z`); mkdirSync(old); writeFileSync(join(old, 'x'), 'x');
    utimesSync(old, new Date('2020-02-0' + i), new Date('2020-02-0' + i));
  }
  const withRclone = { ...baseEnv, BACKUP_DIR: BK5, RCLONE_REMOTE: join(work, 'remote'), PATH: `${fakeRclone}:${process.env.PATH}` };
  b = run(BACKUP, withRclone);
  const rdir = join(BK5, readFileSync(join(BK5, 'LATEST'), 'utf8').trim());
  ok(b.code === 3 && /آپلود با rclone شکست خورد/.test(b.out) && /پشتیبانِ محلی کامل است/.test(b.out), 'کدِ خروجیِ ۳ و پیامِ روشن', b.out);
  ok(existsSync(join(rdir, 'UPLOAD_FAILED')) && !existsSync(join(rdir, 'FAILED')), '**پوشهٔ سالم «ناقص» علامت نخورد** (UPLOAD_FAILED، نه FAILED)');
  ok(existsSync(join(BK5, 'LAST_UPLOAD_FAILED')) && readFileSync(join(BK5, 'LAST_SUCCESS'), 'utf8').startsWith(rdir.split('/').pop()), 'LAST_UPLOAD_FAILED و LAST_SUCCESS کنارِ LATEST');
  ok(!existsSync(join(BK5, '20200201T000000Z')) && existsSync(join(BK5, '20200204T000000Z')), '**نگهداری پیش از آپلود دوید** (شکستِ شبکه دیسک را پر نمی‌کند)');
  d = run(DRILL, await drillEnv({ BACKUP_DIR: BK5 }), []);
  ok(d.code === 0 && /تمرین موفق/.test(d.out), 'همان پشتیبان در تمرین موفق است', d.out);
  writeFileSync(join(fakeRclone, 'rclone'), '#!/bin/sh\n[ "$1" = copy ] || exit 2\nmkdir -p "$3" && cp -R "$2"/. "$3"/\n', { mode: 0o755 });
  b = run(BACKUP, withRclone);
  const okStamp = readFileSync(join(BK5, 'LATEST'), 'utf8').trim();
  ok(b.code === 0 && !existsSync(join(BK5, 'LAST_UPLOAD_FAILED')) && existsSync(join(work, 'remote', okStamp, 'SHA256SUMS')), 'آپلودِ موفقِ بعدی LAST_UPLOAD_FAILED را پاک می‌کند و پوشه بیرون است', b.out);

  console.log('\n۷و) دیتابیسِ مرکزی در دیتابیسِ پیش‌فرضِ `postgres` (همان شکلِ نصبِ واقعی)');
  /* پشتیبانِ اولِ مالک (۱۴۰۵/۰۷/۲۰) هشت شرکت را گرفت ولی دیتابیسِ مرکزی را نه: Coolify آن را «Initial DB» یعنی `postgres`
     ساخته بود و اسکریپت `postgres` را همیشه کنار می‌گذاشت. */
  psql(src, 'postgres', `CREATE TABLE tenants (id uuid PRIMARY KEY, slug text, status text, database_url_encrypted text);
    CREATE TABLE tenant_domains (id serial PRIMARY KEY, tenant_id uuid, hostname text);
    INSERT INTO tenants VALUES ('${acme}','acme','active','x'),('${beta}','beta','active','x'),('${gone}','gone','deleting','x');
    INSERT INTO tenant_domains (tenant_id, hostname) VALUES ('${acme}','acme.example.com'),('${beta}','beta.example.com');`);
  psql(src, 'postgres', 'DROP DATABASE bk_control');
  ctl = 'postgres';
  const BK7 = join(work, 'backups-pgctl');
  b = run(BACKUP, { ...baseEnv, BACKUP_DIR: BK7 });
  const pgDir = join(BK7, readFileSync(join(BK7, 'LATEST'), 'utf8').trim());
  ok(b.code === 0 && readdirSync(pgDir).includes('postgres.dump') && /✔ postgres/.test(b.out), '**`postgres` که جدول دارد پشتیبان گرفته شد** (دیتابیسِ مرکزی جا نمی‌ماند)', b.out);
  d = run(DRILL, await drillEnv({ BACKUP_DIR: BK7 }), []);
  ok(d.code === 0 && /دیتابیسِ postgres برگشت/.test(d.out) && /دیتابیسِ مرکزی: postgres \(2 شرکتِ فعال\)/.test(d.out)
    && /همهٔ شرکت‌های فعال برگشت \(2 از 2، هرکدام با نامِ خودش\)/.test(d.out), '**تمرین `postgres` را در همان دیتابیسِ موجود برمی‌گرداند و مرکزی را پیدا می‌کند**', d.out);
  if (MODE === 'local') {
    const live = { ...(await drillEnv()) };
    psql({ env: live }, 'postgres', 'CREATE TABLE still_live (id int)');
    d = run(DRILL, { ...live, BACKUP_DIR: BK7 }, []);
    ok(d.code === 2 && /دیتابیسِ postgres 1 جدول دارد/.test(d.out), '**سرورِ تمرینی که فقط `postgres`ِ پُر دارد (مثلِ نصبِ واقعی) هم رد می‌شود**', d.out);
  }

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

  console.log('\n۹) شرکتِ گم‌شده پشتِ دیتابیسِ یتیم، و فایلِ شرکتی در پوشهٔ شرکتِ دیگر (باید قرمز شود)');
  /* شمارش «۳ دیتابیسِ شرکت ≥ ۳ شرکتِ فعال» را پاس می‌کرد و مجموعهٔ هش‌های همهٔ پوشه‌ها، فایلِ هم‌محتوای شرکتِ دیگر را
     جای فایلِ گم‌شده می‌پذیرفت. */
  psql(src, ctl, `INSERT INTO tenants VALUES ('${randomUUID()}','gamma','active','x')`);
  psql(src, 'postgres', 'CREATE DATABASE amalyar_old');
  psql(src, 'amalyar_old', `CREATE TABLE _prisma_migrations (id text PRIMARY KEY); INSERT INTO _prisma_migrations VALUES ('m1');
    CREATE TABLE patients (id serial PRIMARY KEY); CREATE TABLE documents (id serial PRIMARY KEY, sha256 text NOT NULL, deleted_at timestamptz);
    CREATE TABLE stop_proofs (id serial PRIMARY KEY, sha256 text NOT NULL);`);
  writeStorage(ST, { betaInto: acme });
  const BK6 = join(work, 'backups-orphan');
  b = run(BACKUP, { ...baseEnv, BACKUP_DIR: BK6 });
  ok(b.code === 0, 'پشتیبان گرفته شد', b.out);
  d = run(DRILL, await drillEnv({ BACKUP_DIR: BK6 }), []);
  ok(d.code === 1 && /دیتابیسِ این شرکت‌های فعال برنگشت: gamma/.test(d.out), '**دیتابیسِ یتیمِ amalyar_old جای شرکتِ گم‌شدهٔ gamma را پر نمی‌کند**', d.out);
  ok(/amalyar_old به هیچ شرکتِ فعالی نمی‌خورد/.test(d.out), 'و دیتابیسِ یتیم گزارش می‌شود');
  ok(/amalyar_beta: 1/.test(b.out) && /1 فایلِ ارجاع‌شدهٔ amalyar_beta هنگامِ پشتیبان‌گیری هم روی سرور نبود/.test(d.out),
    '**پشتیبان هم پوشه‌به‌پوشه می‌سنجد:** فایلِ بتا در پوشهٔ آکمه برای بتا «از قبل نبود» ثبت شد', `${b.out}\n${d.out}`);
} catch (e) {
  fails.push('استثنا: ' + (e?.stack ?? e));
  console.log('  ✘ استثنا: ' + (e?.stack ?? e));
} finally {
  stopAll();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\nسبز: ${pass}  قرمز: ${fails.length}`);
if (fails.length) process.exit(1);
