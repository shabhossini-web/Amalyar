/**
 * خودسنجیِ ماندگاریِ فایل‌ها و آمادگیِ سامانه (`server/src/storage/storage-health.ts`، `platform/platform-health.ts`).
 * خالص؛ بدونِ سرور و دیتابیس — فقط دیسکِ موقت (کدِ سرور با esbuild بسته می‌شود، مثلِ `tenant-profile-unit.mjs`).
 *
 * زمینه (گزارشِ آمادگیِ فروش، بندِ ۱): ایمیجِ سرور `VOLUME` ندارد و ماندگاریِ عکس‌ها و مدارکِ بیماران فقط به
 * volumeای بستگی دارد که در Coolify سوار می‌شود. مسیرِ اشتباه یعنی **هر دیپلوی همهٔ فایل‌ها را بی‌صدا پاک می‌کند.**
 * «ماندگار است؟» نباید آزمونِ دستی بخواهد؛ برنامه خودش با دفترِ کانتینرها ثابتش می‌کند.
 *
 *  باید بیفتد:
 *   - دو کانتینرِ متفاوت روی یک ریشه ← `ok` (اثبات)، حتی بدونِ تشخیصِ mount
 *   - یک کانتینر + mountِ جدا ← `unproven`؛ یک کانتینر + بی‌mount در production ← `ephemeral`
 *   - ریشه‌ای که نوشتنی نیست ← `broken` (و بوت نمی‌شکند)
 *   - mountinfo: طولانی‌ترین mountِ پیشوند برنده است و `\040` در مسیر درست خوانده می‌شود
 *   - دفترِ خراب/ناشناخته = دفترِ تازه، نه خطا
 *   - پیامک: بی‌کلید یا بی‌خط ← `configured:false`؛ و هیچ مقدارِ رازی در پاسخ نیست
 *  نباید بیفتد:
 *   - بوتِ دوباره‌ی همان کانتینر دفتر را بزرگ نمی‌کند (ری‌استارت ≠ دیپلوی)
 *   - بیرون از production «نیست‌ماندگار» هشدار نمی‌شود (`dev`)
 *   - سقفِ ۵۰ ورودی
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = mkdtempSync(join(tmpdir(), 'sh-'));
const bundle = (rel, name) => {
  const file = join(out, `${name}.mjs`);
  execFileSync('npx', ['--yes', 'esbuild', resolve(root, rel), '--bundle', '--platform=node', '--format=esm',
    `--outfile=${file}`, '--log-level=error'], { stdio: 'inherit' });
  return import(pathToFileURL(file).href);
};
const S = await bundle('server/src/storage/storage-health.ts', 'storage-health');
const H = await bundle('server/src/platform/platform-health.ts', 'platform-health');

let pass = 0; const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fails.push(m); console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };
const NOW = new Date('2026-10-07T10:00:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60_000);

console.log('۱) حکم از روی شواهد (خالص)');
const J = (o) => S.judgeStorage({ writable: true, separateMount: false, deploys: 1, production: true, ...o });
ok(J({ writable: false }).verdict === 'broken', 'نوشتنی نیست ← broken');
ok(J({ deploys: 2, separateMount: false }).verdict === 'ok', '**دو کانتینر ← ok حتی بی‌mountِ جدا** (اثبات از خودِ دفتر است)');
ok(J({ deploys: 3, separateMount: null }).verdict === 'ok', 'سه کانتینر و mountِ نامعلوم ← ok');
ok(J({ separateMount: true }).verdict === 'unproven', 'یک کانتینر + volumeِ جدا ← unproven (اثبات با دیپلوی بعدی)');
ok(J({ separateMount: false }).verdict === 'ephemeral', '**یک کانتینر + بی‌volume در production ← ephemeral**');
ok(J({ separateMount: null }).verdict === 'ephemeral' && /قابل‌تشخیص نبود/.test(J({ separateMount: null }).message), 'mountِ نامعلوم در production ← ephemeral با علتِ روشن');
ok(J({ separateMount: false, production: false }).verdict === 'dev', 'بیرون از production ← dev، نه هشدار');
ok(/\/app\/storage/.test(J({ separateMount: false }).message), 'پیامِ ephemeral نشانیِ سوارشدن را می‌گوید');
ok(J({ writable: false, deploys: 5, separateMount: true }).verdict === 'broken', 'نوشتنی‌نبودن بر هر شاهدِ دیگر مقدم است');

console.log('\n۲) mountinfo');
const mi = [
  '25 1 8:1 / / rw,relatime shared:1 - overlay overlay rw,lowerdir=/x',
  '40 25 8:16 / /app/storage rw,relatime shared:2 - ext4 /dev/sdb rw',
  '41 25 8:17 / /app/storage/deep\\040dir rw - xfs /dev/sdc rw',
  '42 25 0:5 / /dev rw - tmpfs tmpfs rw',
].join('\n');
ok(S.mountFor('/app/storage/abc', mi)?.mountPoint === '/app/storage' && S.mountFor('/app/storage/abc', mi)?.fsType === 'ext4', 'ریشهٔ زیرِ /app/storage ← mountِ /app/storage (ext4)');
ok(S.mountFor('/app/storage', mi)?.mountPoint === '/app/storage', 'خودِ مسیرِ mount');
ok(S.mountFor('/app/other', mi)?.mountPoint === '/', 'بیرونِ volume ← ریشهٔ overlay (جدا نیست)');
ok(S.mountFor('/app/storage/deep dir/x', mi)?.mountPoint === '/app/storage/deep dir', '`\\040` در مسیرِ mount به فاصله برمی‌گردد و طولانی‌ترین برنده است');
ok(S.mountFor('/app/storageX/a', mi)?.mountPoint === '/', 'پیشوندِ ناقص (/app/storageX) ≠ mountِ /app/storage');
ok(S.mountFor('/x', '') === null, 'mountinfoِ خالی ← null (نه خطا)');

console.log('\n۳) دفترِ کانتینرها');
ok(S.parseLedger('{not json', NOW).seen.length === 0, 'JSONِ خراب ← دفترِ تازه');
ok(S.parseLedger('{"v":2,"first":"x","seen":[]}', NOW).seen.length === 0, 'نسخهٔ ناشناخته ← دفترِ تازه');
ok(S.parseLedger(null, NOW).first === NOW.toISOString(), 'نبود ← first همین حالا');
let L = S.parseLedger(null, NOW);
L = S.withBoot(L, 'c1', NOW);
ok(L.seen.length === 1, 'کانتینرِ اول ثبت شد');
ok(S.withBoot(L, 'c1', later(5)).seen.length === 1, '**ری‌استارتِ همان کانتینر دفتر را بزرگ نمی‌کند**');
ok(S.withBoot(L, 'c2', later(5)).seen.length === 2, 'کانتینرِ دوم ثبت شد');
let big = S.parseLedger(null, NOW);
for (let i = 0; i < 80; i++) big = S.withBoot(big, `c${i}`, later(i));
ok(big.seen.length === 50 && big.seen[49].id === 'c79' && big.seen[0].id === 'c30', 'سقفِ ۵۰ ورودی، تازه‌ترین‌ها می‌مانند');
ok(S.parseLedger(JSON.stringify({ v: 1, first: 'f', seen: [{ id: 'a', at: 't' }, { id: 5 }, null, { at: 'x' }] }), NOW).seen.length === 1, 'ورودیِ ناقص دور ریخته می‌شود');

console.log('\n۴) روی دیسکِ واقعی — دو «دیپلوی» روی یک ریشه');
const dir = join(out, 'storage');
mkdirSync(dir, { recursive: true });
process.env.NODE_ENV = 'production';
await S.touchStorageLedger(dir, NOW, 'container-A');
let h = await S.storageHealth(dir, NOW);
ok(h.writable && h.deploys === 1 && h.verdict !== 'ok' && h.verdict !== 'broken', `دیپلوی ۱: هنوز اثبات نشده (${h.verdict})`);
ok(h.firstSeenAt === NOW.toISOString() && h.lastDeployAt === NOW.toISOString(), 'زمانِ نخستین و آخرین ثبت');
await S.touchStorageLedger(dir, later(1), 'container-A');
h = await S.storageHealth(dir, later(1));
ok(h.deploys === 1, '**ری‌استارت (همان کانتینر) اثبات نمی‌سازد**');
await S.touchStorageLedger(dir, later(60), 'container-B');
h = await S.storageHealth(dir, later(60));
ok(h.deploys === 2 && h.verdict === 'ok' && /ماندگارند/.test(h.message), `**دیپلوی ۲ ← ok «${h.message}»**`);
ok(h.lastDeployAt === later(60).toISOString() && h.firstSeenAt === NOW.toISOString(), 'first ثابت می‌ماند و last جلو می‌رود');
writeFileSync(join(dir, '.ledger', 'containers.json'), '{garbage');
h = await S.storageHealth(dir, later(61));
ok(h.deploys === 0 && h.verdict !== 'ok', 'دفترِ خراب شده ← صفرِ اثبات (نه ok)');
await S.touchStorageLedger(dir, later(62), 'container-C');
ok(JSON.parse(readFileSync(join(dir, '.ledger', 'containers.json'), 'utf8')).seen[0].id === 'container-C', 'بوتِ بعدی دفترِ خراب را از نو می‌سازد');

console.log('\n۵) ریشهٔ نوشتنی‌نشدنی و بوتِ بی‌خطا');
const blocker = join(out, 'a-file');
writeFileSync(blocker, 'x');
const bad = join(blocker, 'storage'); // زیرِ یک فایل — mkdir ENOTDIR
let threw = false;
let touched;
try { touched = await S.touchStorageLedger(bad, NOW, 'x'); } catch { threw = true; }
ok(!threw && touched === null, '**touch روی ریشهٔ خراب خطا نمی‌دهد (بوت نمی‌شکند)**');
h = await S.storageHealth(bad, NOW);
ok(h.verdict === 'broken' && h.writable === false && /قابلِ نوشتن نیست/.test(h.message), 'ریشهٔ خراب ← broken با علتِ فارسی');

console.log('\n۶) پیامکِ مشترک و بستهٔ آمادگی');
const smsOf = (env) => H.smsReadiness(env);
ok(smsOf({}).configured === false && /MELI_API_KEY/.test(smsOf({}).message), 'بی‌کلید ← تنظیم نیست، با نامِ متغیرها');
ok(smsOf({ MELI_API_KEY: 'k' }).configured === false, 'کلید بدونِ خط ← تنظیم نیست');
ok(smsOf({ MELI_FROM: 'l' }).configured === false, 'خط بدونِ کلید ← تنظیم نیست');
const good = smsOf({ MELI_API_KEY: 'SECRET-KEY-123', MELI_FROM: '3000SECRET' });
ok(good.configured === true && good.shared === true, 'کلید و خط ← آماده و مشترک');
ok(!JSON.stringify(good).includes('SECRET'), '**هیچ مقدارِ رازی در پاسخ نیست**');
process.env.STORAGE_ROOT = dir;
const full = await H.platformHealth(later(120), { NODE_ENV: 'production', SOURCE_COMMIT: 'abcdef1234567890', MELI_API_KEY: 'k', MELI_FROM: 'f' });
ok(full.runtime.commit === 'abcdef1' && full.runtime.environment === 'production', 'کامیتِ کوتاه + محیط');
ok(full.storage.root === dir && ['ok', 'unproven', 'ephemeral', 'dev', 'broken'].includes(full.storage.verdict), 'storage از ریشهٔ STORAGE_ROOT خوانده می‌شود');
ok(!isNaN(Date.parse(full.runtime.bootedAt)), 'bootedAt تاریخِ معتبر است');
const none = await H.platformHealth(later(120), { NODE_ENV: 'production' });
ok(none.runtime.commit === null, 'بی‌SOURCE_COMMIT ← null (نه رشتهٔ خالی)');
ok(!JSON.stringify(full).includes('"k"') && !JSON.stringify(full).includes('"f"'), 'مقدارِ کلید/خط در بستهٔ آمادگی نیست');

console.log(`\nسبز: ${pass}  قرمز: ${fails.length}`);
if (fails.length) process.exit(1);
