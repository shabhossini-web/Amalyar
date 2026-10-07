/**
 * نوعِ نصبِ هر شرکت (مطب / شرکتی) **از لحظهٔ ساخت** — فرمِ ساختِ پنلِ پلتفرم تا دیتابیسِ تازه.
 *
 * خواستهٔ مالک (۱۴۰۵/۰۷/۱۵): «مدلِ هر شرکت — مطب یا شرکتی — در خودِ شرکت تعیین شود». تا امروز هر نصبِ تازه
 * `ionm` بود و صاحبِ مطب باید پس از ثبت‌نام در تنظیمات عوضش می‌کرد؛ بنیان‌گذارِ مطب فقط وقتی `jobRole: doctor`
 * می‌گیرد که حوزه **پیش از ثبت‌نام** `clinic` باشد، پس هیچ مطبِ واقعی آن شرط را نداشت.
 *
 *  باید بیفتد:
 *   - درخواستِ ساخت نوعِ نصب را می‌پذیرد، **اعتبارسنجی** می‌کند و روی کار نگه می‌دارد
 *   - Worker بر دیتابیسِ **تازه‌مهاجرت‌شده** و پیش از هر حسابی `vertical` (و برای شرکت `services`) را می‌نویسد
 *   - شرکتِ ساخته‌شده به‌عنوانِ مطب: `/config` مطب می‌گوید و ماژول‌های شرکتی از روزِ اول خاموش‌اند
 *   - فهرستِ پنل نوعِ **فعلی** را از خودِ شرکت می‌خواند (نه رونوشتِ کهنه)
 *  نباید بیفتد:
 *   - درخواستِ قدیمی (بی‌نوع) رد شود یا چیزی بنویسد — همان پیش‌فرضِ نصب
 *   - «شرکتی» بی‌خدمت، «مطب» با خدمت، یا خدمتِ ناشناخته پذیرفته شود
 *   - رمزِ دیتابیس در پاسخِ پنل بیاید
 */
import { createRequire } from 'node:module';
import { execFileSync, execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '../../server');
const require = createRequire(new URL('../../server/package.json', import.meta.url));
require('reflect-metadata');
const { PlatformProvisioningService } = require('./dist/platform/platform.module');
const { TenantProfileProbe } = require('./dist/platform/tenant-profile-probe');
const { PrismaService } = require('./dist/prisma/prisma.service');
const { TenantContext } = require('./dist/tenant/tenant-context');
const { encryptDatabaseUrl } = require('./dist/tenant/tenant-crypto');
const { profileSettingRows, profileError, requestedProfile } = require('./dist/config/tenant-profile');
const { seedTenantProfile, assertJobProfile, parseProfileServices } = require('./dist/scripts/seed-profile');
const { PrismaClient: ControlClient } = require('./src/generated/control');
const { PrismaClient: TenantClient } = require('./node_modules/@prisma/client');
const bcrypt = require('./node_modules/bcryptjs');

const CTRL = process.env.E2E_CTRL_DB;
if (!CTRL || !['localhost', '127.0.0.1'].includes(new URL(CTRL).hostname)) throw new Error('فقط دیتابیسِ کنترلِ محلی');
const TENANT_DB = process.env.E2E_DB ?? process.env.DATABASE_URL;
if (!TENANT_DB) throw new Error('E2E_DB لازم است');
const API = new URL(process.env.E2E_API ?? 'http://localhost:3101/api');
const control = new ControlClient({ datasources: { db: { url: CTRL } } });

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };
const status = async (p) => { try { await p; return null; } catch (e) { return e?.getStatus?.() ?? String(e); } };
const msg = async (p) => { try { await p; return ''; } catch (e) { return String(e?.response?.message ?? e?.message ?? e); } };

const req = (method, path, host, body, token) => new Promise((resolveReq, reject) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const r = http.request({
    hostname: API.hostname, port: API.port, method, path: `${API.pathname.replace(/\/$/, '')}${path}`,
    headers: { host, accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
  }, (res) => {
    let raw = '';
    res.on('data', (c) => { raw += c; });
    res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* متنِ خام */ } resolveReq({ status: res.statusCode, json, raw }); });
  });
  r.on('error', reject);
  if (data) r.write(data);
  r.end();
});

const tag = 'pf' + randomBytes(3).toString('hex');
const ACTOR = 'h'.repeat(64), IP = 'i'.repeat(64);
const adminDb = new URL(TENANT_DB); adminDb.pathname = '/postgres';
const scratchName = `e2e_${tag}`;
const scratch = [];
const psql = (db, q) => execSync(`psql "${db}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim();
const madeJobs = [];
let tenantRow = null;

try {
  console.log('۱) قاعدهٔ خالص — ردیف‌هایی که نصبِ تازه می‌گیرد');
  const rowsOf = (kind, services) => JSON.stringify(profileSettingRows(kind, services));
  ok(rowsOf('clinic', []) === JSON.stringify([{ key: 'vertical', value: 'clinic' }]), 'مطب فقط `vertical=clinic` (بی‌ردیفِ خدمات)');
  ok(rowsOf('company', ['implant']) === JSON.stringify([{ key: 'vertical', value: 'implant' }, { key: 'services', value: '["implant"]' }]), 'شرکتِ فقط‌ایمپلنت: `vertical=implant` + `services`');
  ok(rowsOf('company', ['implant', 'ionm']) === JSON.stringify([{ key: 'vertical', value: 'ionm' }, { key: 'services', value: '["ionm","implant"]' }]),
    'شرکتِ دوخدمته: خدمتِ اصلی نورومانیتورینگ (ترتیبِ ثابت)، فهرست بی‌تکرار و مرتب');
  ok(!!profileError('company', []) && !!profileError('clinic', ['ionm']) && !!profileError('company', ['xyz']) && !!profileError('hospital', []),
    'ناسازگارها رد می‌شوند: شرکتیِ بی‌خدمت · مطبِ دارای خدمت · خدمتِ ناشناخته · نوعِ ناشناخته');
  ok(await status(Promise.resolve().then(() => assertJobProfile(null, null))) === null, 'کارِ قدیمی (بی‌نوع) از اعتبارسنجیِ Worker می‌گذرد');
  ok((() => { try { assertJobProfile('company', '[]'); return false; } catch (e) { return e.message === 'INVALID_PROFILE'; } })(), 'کارِ ناسازگار در Worker به `INVALID_PROFILE` می‌افتد (پیش از ساختنِ نقش و دیتابیس)');
  ok(JSON.stringify(parseProfileServices('{bad')) === '[]' && JSON.stringify(parseProfileServices('["ionm",3]')) === '["ionm"]', 'متنِ خرابِ خدمات «خالی» است، نه خطای ۵۰۰');

  console.log('\n۲) درخواستِ ساخت در پنل');
  const svc = new PlatformProvisioningService(control);
  const create = (extra, n) => svc.create({ slug: `${tag}-${n}`, name: `آزمونِ نوع ${n}`, hostname: `${tag}-${n}.example.com`, ...extra }, ACTOR, IP);
  const clinicJob = await create({ kind: 'clinic' }, 'c');
  madeJobs.push(clinicJob.id);
  ok(clinicJob.profile?.kind === 'clinic' && clinicJob.profile?.label === 'مطب / کلینیک' && clinicJob.profile?.services.length === 0, 'مطب: برچسبِ فارسی را **سرور** ساخته');
  const companyJob = await create({ kind: 'company', services: ['implant', 'ionm'] }, 'k');
  madeJobs.push(companyJob.id);
  ok(companyJob.profile?.kind === 'company' && companyJob.profile?.label === 'شرکتی — نورومانیتورینگ و ایمپلنت و تجهیزات', `شرکت: «${companyJob.profile?.label}»`);
  const legacy = await create({}, 'l');
  madeJobs.push(legacy.id);
  ok(legacy.profile === null, '**نباید بیفتد:** درخواستِ قدیمی (بی‌نوع) پذیرفته می‌شود و پروفایلی ندارد');
  ok(psql(CTRL, `SELECT coalesce(profile_kind,'-') || '|' || coalesce(profile_services,'-') FROM provisioning_jobs WHERE id='${clinicJob.id}'`) === 'clinic|-'
    && psql(CTRL, `SELECT coalesce(profile_kind,'-') || '|' || coalesce(profile_services,'-') FROM provisioning_jobs WHERE id='${companyJob.id}'`) === 'company|["ionm","implant"]',
    'در جدولِ کار: `clinic|-` و `company|["ionm","implant"]`');
  ok(/دست‌کم یک خدمت/.test(await msg(create({ kind: 'company', services: [] }, 'x1'))), 'شرکتیِ بی‌خدمت رد می‌شود (با پیامِ فارسی)');
  ok(/بستهٔ خدمات ندارد/.test(await msg(create({ kind: 'clinic', services: ['ionm'] }, 'x2'))), 'مطبِ دارای خدمت رد می‌شود');
  ok((await status(create({ kind: 'company', services: ['xyz'] }, 'x3'))) === 400, 'خدمتِ ناشناخته رد می‌شود');
  ok(psql(CTRL, `SELECT count(*) FROM provisioning_jobs WHERE slug LIKE '${tag}-x%'`) === '0', 'ردشده‌ها هیچ کاری در صف نساختند');
  const snap = await svc.snapshot();
  ok(snap.profileOptions?.kinds?.length === 2 && snap.profileOptions?.services?.length === 2
    && snap.profileOptions.kinds.some((k) => k.key === 'clinic' && k.label === 'مطب / کلینیک'), 'پنل گزینه‌ها را از سرور می‌گیرد (برچسب‌ها در کلاینت تکرار نمی‌شوند)');
  ok(snap.jobs.find((j) => j.id === clinicJob.id)?.profile?.label === 'مطب / کلینیک', 'و کارِ مطب در فهرست برچسبِ نوعش را دارد');
  ok(!JSON.stringify(snap).includes('postgresql://') && !('databaseUrlEncrypted' in (snap.tenants[0] ?? {})), '**نباید بیفتد:** رمز/آدرسِ دیتابیس در پاسخِ پنل نیست');

  console.log('\n۳) Worker: دیتابیسِ تازه‌مهاجرت‌شده، پیش از هر حسابی');
  const fresh = (name) => {
    psql(adminDb.toString(), `CREATE DATABASE "${name}"`);
    const u = new URL(TENANT_DB); u.pathname = `/${name}`;
    execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { cwd: serverDir, stdio: 'ignore', env: { ...process.env, DATABASE_URL: u.toString() } });
    scratch.push(name);
    return u.toString();
  };
  const feat = (url) => Object.fromEntries(psql(url, 'SELECT key || \'=\' || enabled FROM features ORDER BY key').split('\n').filter(Boolean).map((r) => r.split('=')));
  const t0 = Date.now();
  const clinicUrl = fresh(scratchName);
  console.log(`    (ساختِ دیتابیسِ تازه + migration ${Math.round((Date.now() - t0) / 1000)} ثانیه)`);
  ok(psql(clinicUrl, 'SELECT count(*) FROM accounts') === '0', 'دیتابیسِ تازه هنوز هیچ حسابی ندارد');
  ok(feat(clinicUrl).waitlist === 'false', 'پیش از seed، ردیفِ `waitlist` که migration ساخته **خاموش** است (همان تلهٔ واقعی)');
  await seedTenantProfile(clinicUrl, 'clinic', null);
  ok(psql(clinicUrl, `SELECT value FROM settings WHERE key='vertical'`) === 'clinic', '`vertical=clinic` **پیش از اولین حساب** نوشته شد (شرطِ «بنیان‌گذارِ مطب = پزشک»)');
  ok(psql(clinicUrl, `SELECT count(*) FROM settings WHERE key='services'`) === '0', 'و برای مطب ردیفِ `services` نیست');
  const fc = feat(clinicUrl);
  ok(fc.waitlist === 'true' && fc.surgeon === 'true' && fc.frontdesk === 'true', '**ماژول‌های مطب روشن شدند** — از جمله `waitlist` که migration خاموش ساخته بود');
  ok(fc.dispatch === 'false' && fc.tech === 'false' && fc.inventory === 'false' && fc.transport === 'false', 'و ماژول‌های شرکتی (چینش، کارشناسی، انبار، حمل‌ونقل) خاموش‌اند');
  await seedTenantProfile(clinicUrl, 'clinic', null);
  ok(psql(clinicUrl, `SELECT count(*) FROM settings WHERE key='vertical'`) === '1' && JSON.stringify(feat(clinicUrl)) === JSON.stringify(fc), 'تلاشِ مجدد (idempotent): نه ردیفِ دوم، نه تغییرِ ماژول‌ها');

  const companyUrl = fresh(`${scratchName}_c`);
  await seedTenantProfile(companyUrl, 'company', '["implant","ionm"]');
  const fk = feat(companyUrl);
  ok(psql(companyUrl, `SELECT value FROM settings WHERE key='vertical'`) === 'ionm' && psql(companyUrl, `SELECT value FROM settings WHERE key='services'`) === '["ionm","implant"]',
    'شرکتِ دوخدمته: `vertical=ionm` و `services=["ionm","implant"]`');
  ok(fk.dispatch === 'true' && fk.tech === 'true' && fk.inventory === 'true' && fk.waitlist === 'false', 'و ماژول‌های شرکتی روشن، `waitlist` خاموش');

  console.log('\n۴) شرکتِ ساخته‌شده از راهِ HTTP همان نوع است');
  const host = `${tag}.example.test`;
  tenantRow = await control.tenant.create({
    data: {
      slug: tag, name: `آزمونِ نوعِ ${tag}`, status: 'active', databaseUrlEncrypted: encryptDatabaseUrl(clinicUrl),
      domains: { create: { hostname: host, primary: true } },
    },
  });
  const tdb = new TenantClient({ datasources: { db: { url: clinicUrl } } });
  await tdb.account.create({ data: { username: 'admin', passwordHash: await bcrypt.hash('test1234', 12), level: 6, status: 'active', person: { create: { firstName: 'مدیر', lastName: 'مطب' } } } });
  await tdb.$disconnect();
  ok(await seedTenantProfile(clinicUrl, 'clinic', null).then(() => false, (e) => e.message === 'TENANT_NOT_FRESH'),
    '**نباید بیفتد:** روی نصبِ زنده (حساب دارد) seed رد می‌شود — راهِ درست «ذخیره» در تنظیماتِ خودِ شرکت است');
  const login = await req('POST', '/auth/login', host, { identifier: 'admin', password: 'test1234' });
  const token = login.json?.accessToken;
  ok(!!token, `ورود به شرکتِ تازه (${login.status})`);
  let cfg = (await req('GET', '/config', host, undefined, token)).json;
  ok(cfg?.vertical === 'clinic' && cfg?.kind === 'clinic', `/config: مطب است (vertical=${cfg?.vertical} kind=${cfg?.kind})`);
  const featsOf = async () => {
    const r = await req('GET', '/features', host, undefined, token);
    const rows = Array.isArray(r.json) ? r.json : (r.json?.features ?? []);
    return Object.fromEntries(rows.map((f) => [f.key, f.enabled]));
  };
  let ft = await featsOf();
  ok(ft.waitlist === true && ft.surgeon === true, 'لانچرِ مطب: فهرستِ انتظار و میزِ پزشک از روزِ اول روشن‌اند', JSON.stringify(ft));
  ok(ft.dispatch === false && ft.tech === false && ft.inventory === false, 'و چینش/کارشناسی/انبار از روزِ اول خاموش — بی‌دستکاریِ تنظیمات', JSON.stringify(ft));

  /* ⚠️ مسیرِ «ذخیره» در تنظیماتِ خودِ شرکت همچنان کار می‌کند (منطقِ گذار به `applyProfileFeatures` منتقل شد). */
  const sw = await req('PATCH', '/config/profile', host, { kind: 'company', services: ['ionm', 'implant'] }, token);
  ok(sw.status < 300, `شرکت خودش در تنظیمات به «شرکتی» عوض کرد (${sw.status})`);
  cfg = (await req('GET', '/config', host, undefined, token)).json;
  ok(cfg?.kind === 'company' && cfg?.vertical === 'ionm' && JSON.stringify(cfg?.services) === '["ionm","implant"]', `و /config دنبالش می‌آید: ${cfg?.kind}/${cfg?.vertical}`);
  ft = await featsOf();
  ok(ft.dispatch === true && ft.tech === true && ft.inventory === true && ft.waitlist === false, 'ماژول‌ها هم گذار کردند (چینش/کارشناسی/انبار روشن، فهرستِ انتظار خاموش)', JSON.stringify(ft));

  console.log('\n۵) فهرستِ پنل نوعِ **فعلی** را از خودِ شرکت می‌خواند');
  /* یک `TenantContext`ِ مشترک — در برنامه DI همین تک‌نمونه را می‌دهد؛ دو نمونه یعنی probe روی یکی می‌نویسد و
     PrismaService از دیگری می‌خواند و همه‌چیز بی‌صدا `null` می‌شود. */
  const sharedContext = new TenantContext();
  const probe = new TenantProfileProbe(new PrismaService(sharedContext), sharedContext);
  const snap2 = await new PlatformProvisioningService(control, probe).snapshot();
  const mine = snap2.tenants.find((t) => t.slug === tag);
  ok(!!mine, 'شرکتِ تازه در فهرست است');
  ok(mine?.profile?.kind === 'company' && mine?.profile?.label === 'شرکتی — نورومانیتورینگ و ایمپلنت و تجهیزات',
    `نوعِ فعلی از خودِ شرکت، نه رونوشتِ ساخت (${JSON.stringify(mine?.profile)})`);
  ok(mine?.profile && !('databaseUrl' in mine) && !('databaseUrlEncrypted' in mine), '**نباید بیفتد:** فیلدِ آدرسِ دیتابیس به ردیفِ شرکت نمی‌رود');
  const sw2 = await req('PATCH', '/config/profile', host, { kind: 'clinic', services: [] }, token);
  const probe2 = new TenantProfileProbe(new PrismaService(sharedContext), sharedContext);
  const again = (await new PlatformProvisioningService(control, probe2).snapshot()).tenants.find((t) => t.slug === tag);
  ok(sw2.status < 300 && again?.profile?.kind === 'clinic' && again?.profile?.label === 'مطب / کلینیک', `و پس از برگشت به مطب: ${again?.profile?.label} (رونوشتِ کهنه نیست)`);
} finally {
  try {
    if (madeJobs.length) await control.provisioningJob.deleteMany({ where: { id: { in: madeJobs } } });
    if (tenantRow) await control.tenant.deleteMany({ where: { id: tenantRow.id } });
    await control.platformAuditEvent.deleteMany({ where: { OR: [{ action: 'platform.provisioning.queued', metadata: { path: ['slug'], string_starts_with: tag } }] } }).catch(() => undefined);
    for (const name of scratch) {
      psql(adminDb.toString(), `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${name}'`);
      psql(adminDb.toString(), `DROP DATABASE IF EXISTS "${name}"`);
    }
  } catch (e) { console.log('پاک‌سازی ناقص ماند: ' + String(e).slice(0, 160)); }
  await control.$disconnect();
}

console.log(`\nقبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
