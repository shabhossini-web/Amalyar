/**
 * تغییرِ نشانیِ سایتِ شرکت از پنلِ پلتفرم (۱۴۰۵/۰۷/۰۴، درخواستِ مشتری) — روی دیتابیسِ
 * کنترلِ **واقعی**، با همان سرویسی که پنل صدا می‌زند.
 *
 * باید بیفتد:
 *   - نشانیِ تازه اضافه و اصلی شود، ممیزی با نشانیِ قبلی ثبت شود
 *   - نشانیِ قبلی **همچنان** به همان شرکت برسد (لینک‌های پیامک‌شده نشکنند)
 *   - برگشت به نشانیِ قبلی = اصلی‌کردنِ دوباره‌اش؛ همیشه دقیقاً یک اصلی
 *   - حذفِ نشانیِ فرعی → آن Host دیگر به هیچ شرکتی نمی‌رسد
 *  نباید بیفتد:
 *   - نشانیِ شرکتِ دیگر، نشانیِ خودِ پلتفرم (api، admin، ریشه، نشانیِ پنل) یا قالبِ خراب
 *   - حذفِ نشانیِ اصلی، یا دست‌زدن به نشانیِ شرکتِ غیرِفعال
 *   - هیچ اثری روی شرکتِ دیگر
 *   - مسیرِ HTTP بی‌نشستِ پنل (۴۰۱، یا ۴۰۴ وقتی پنل خاموش است)
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
require('reflect-metadata');
const { PlatformProvisioningService, normalizeTenantHostname } = require('./dist/platform/platform.module');
const { TenantRegistryService } = require('./dist/tenant/tenant-registry.service');
const { encryptDatabaseUrl } = require('./dist/tenant/tenant-crypto');
const { PrismaClient: ControlClient } = require('./src/generated/control');

const CTRL = process.env.E2E_CTRL_DB;
if (!CTRL || !['localhost', '127.0.0.1'].includes(new URL(CTRL).hostname)) throw new Error('فقط دیتابیسِ کنترلِ محلی');
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const control = new ControlClient({ datasources: { db: { url: CTRL } } });
const svc = new PlatformProvisioningService(control);
const registry = new TenantRegistryService(control);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
/** خطای Nest با کدِ HTTP؛ اگر خطا نداد، `null`. */
const status = async (p) => { try { await p; return null; } catch (e) { return e?.getStatus?.() ?? String(e); } };

const tag = 'pd' + randomBytes(3).toString('hex');
const host = (x) => `${tag}-${x}.example.com`;
const ACTOR = 'h'.repeat(64), IP = 'i'.repeat(64);
const made = [];
const tenant = async (slug, hostname) => {
  const t = await control.tenant.create({ data: {
    slug, name: 'آزمونِ ' + slug, status: 'active',
    databaseUrlEncrypted: encryptDatabaseUrl('postgresql://x:x@localhost:5432/none'),
    domains: { create: { hostname, primary: true } },
  } });
  made.push(t.id);
  return t;
};
const domainsOf = async (id) => (await control.tenantDomain.findMany({ where: { tenantId: id }, orderBy: { hostname: 'asc' } }))
  .map((d) => `${d.hostname}${d.primary ? '*' : ''}`).join(' ');

try {
  const A = await tenant(tag + 'a', host('old'));
  const B = await tenant(tag + 'b', host('b'));

  console.log('۱) نشانیِ تازه اضافه و اصلی می‌شود');
  const r1 = await svc.addDomain(A.id, host('new'), true, 'admin.example.org', ACTOR, IP);
  ok(r1.hostname === host('new') && r1.domains.length === 2 && r1.shared === true,
    `پاسخ همان شکلِ کارت را دارد (${r1.domains.map((d) => d.hostname + (d.primary ? '*' : '')).join(' ')})`);
  ok(await domainsOf(A.id) === `${host('new')}* ${host('old')}`, 'در دیتابیس: تازه اصلی، قبلی فرعی');
  ok(r1.added?.hostname === host('new') && r1.added?.automatic === false,
    'دامنهٔ بیرون از amalyar.com: «خودکار نیست» (DNS و Coolify لازم است)');
  const audit = await control.platformAuditEvent.findFirst({ where: { targetId: A.id, action: 'platform.tenant.domain_added' } });
  ok(audit?.metadata?.hostname === host('new') && audit?.metadata?.previous === host('old'),
    'ممیزی نشانیِ تازه و نشانیِ قبلی را دارد');

  const sub = `${tag}-sub.amalyar.com`;
  const r1b = await svc.addDomain(A.id, sub, false, null, ACTOR, IP);
  ok(r1b.added?.automatic === true && r1b.hostname === host('new'),
    'زیردامنهٔ یک‌سطحیِ amalyar.com «خودکار» است؛ بی «اصلی» نشانیِ اصلی عوض نشد');
  ok((await svc.addDomain(A.id, `a.${tag}.amalyar.com`, false, null, ACTOR, IP)).added?.automatic === false,
    'زیردامنهٔ دوسطحی را گواهیِ wildcard نمی‌پوشاند — «خودکار نیست»');
  await svc.removeDomain(A.id, sub, ACTOR, IP);
  await svc.removeDomain(A.id, `a.${tag}.amalyar.com`, ACTOR, IP);

  console.log('\n۲) نشانیِ قبلی **همچنان** به همان شرکت می‌رسد');
  ok((await registry.resolveHostname(host('old')))?.tenantId === A.id, 'نشانیِ قبلی → همان شرکت (لینک‌های قبلی نمی‌شکنند)');
  ok((await registry.resolveHostname(host('new')))?.tenantId === A.id, 'نشانیِ تازه → همان شرکت');

  console.log('\n۳) نباید بیفتد — نشانیِ شرکتِ دیگر، نشانیِ پلتفرم، قالبِ خراب');
  ok(await status(svc.addDomain(A.id, host('b'), true, null, ACTOR, IP)) === 409, 'نشانیِ شرکتِ دیگر: ۴۰۹');
  for (const bad of ['api.amalyar.com', 'amalyar.com', 'www.amalyar.com', 'admin-staging.amalyar.com', 'api-staging.amalyar.com']) {
    ok(await status(svc.addDomain(A.id, bad, true, null, ACTOR, IP)) === 400, `نشانیِ خودِ پلتفرم رد شد: ${bad}`);
  }
  ok(await status(svc.addDomain(A.id, 'admin.example.org', true, 'admin.example.org', ACTOR, IP)) === 400,
    'نشانیِ خودِ همین پنل رد شد');
  ok(await status(svc.addDomain(A.id, 'api.example.org', true, 'admin.example.org', ACTOR, IP)) === 400,
    'زیرساختِ کنارِ همان دامنهٔ پنل هم رد شد');
  for (const bad of ['bad host', 'a..b.com', 'نشانی.com', 'x', '-a.example.com']) {
    ok(await status(svc.addDomain(A.id, bad, true, null, ACTOR, IP)) === 400, `قالبِ خراب رد شد: «${bad}»`);
  }
  ok(normalizeTenantHostname(`HTTPS://${host('Norm').toUpperCase()}/login?x=1`) === host('norm'),
    'نشانیِ کپی‌شده از نوارِ مرورگر یکدست شد');
  ok(await status(svc.addDomain(A.id, host('new'), true, null, ACTOR, IP)) === 409, 'نشانیِ فعلیِ اصلی دوباره ثبت نمی‌شود');

  console.log('\n۴) برگشت به نشانیِ قبلی — همیشه دقیقاً یک اصلی');
  const r2 = await svc.setPrimaryDomain(A.id, host('old'), ACTOR, IP);
  ok(r2.hostname === host('old') && await domainsOf(A.id) === `${host('new')} ${host('old')}*`, 'نشانیِ قبلی دوباره اصلی شد');
  ok(await control.tenantDomain.count({ where: { tenantId: A.id, primary: true } }) === 1, 'دقیقاً یک نشانیِ اصلی');
  const r3 = await svc.addDomain(A.id, host('new'), true, null, ACTOR, IP);
  ok(r3.hostname === host('new'), 'افزودنِ نشانیِ فرعیِ موجود با «اصلی» = همان اصلی‌کردن');

  console.log('\n۵) حذفِ نشانیِ فرعی؛ نشانیِ اصلی حذف نمی‌شود');
  ok(await status(svc.removeDomain(A.id, host('new'), ACTOR, IP)) === 409, 'نشانیِ اصلی حذف نمی‌شود: ۴۰۹');
  await svc.setPrimaryDomain(A.id, host('old'), ACTOR, IP);
  const r4 = await svc.removeDomain(A.id, host('new'), ACTOR, IP);
  ok(r4.domains.length === 1 && r4.shared === false && r4.hostname === host('old'), 'نشانیِ فرعی حذف شد');
  ok(await registry.resolveHostname(host('new')) === null, 'نشانیِ حذف‌شده دیگر به هیچ شرکتی نمی‌رسد');
  ok(await status(svc.removeDomain(A.id, host('b'), ACTOR, IP)) === 404, 'حذفِ نشانیِ شرکتِ دیگر از این شرکت: ۴۰۴');

  console.log('\n۶) شرکتِ غیرِفعال و شرکتِ دیگر');
  await control.tenant.update({ where: { id: B.id }, data: { status: 'deleting' } });
  ok(await status(svc.addDomain(B.id, host('b2'), true, null, ACTOR, IP)) === 409, 'نشانیِ شرکتِ غیرِفعال عوض نمی‌شود');
  ok(await domainsOf(B.id) === `${host('b')}*`, '**هیچ اثری روی شرکتِ دیگر**');
  ok(await status(svc.create({ slug: tag + 'c', name: 'ت', hostname: 'api.amalyar.com' }, ACTOR, IP)) === 400,
    'ساختِ شرکتِ تازه هم نشانیِ پلتفرم را نمی‌گیرد');

  console.log('\n۷) مسیرِ HTTP بی‌نشستِ پنل');
  const res = await fetch(`${API}/platform/tenants/${A.id}/domains`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostname: host('x') }),
  });
  /* بی `PLATFORM_ADMIN_ENABLED` مسیرِ پلتفرم اصلاً نیست (۴۰۴)؛ روشن و بی‌نشست ۴۰۱ — هر دو «بسته»
     (همان قراردادِ `central-tariffs` و `ai-central`). */
  ok(res.status === 401 || res.status === 404, `بی‌نشستِ پنل بسته است (${res.status})`);
  ok(await domainsOf(A.id) === `${host('old')}*`, 'درخواستِ بی‌نشست هیچ نشانی‌ای اضافه نکرد');
} finally {
  await control.platformAuditEvent.deleteMany({ where: { targetId: { in: made } } }).catch(() => {});
  await control.tenant.deleteMany({ where: { id: { in: made } } }).catch(() => {});
  await control.$disconnect();
}
console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
