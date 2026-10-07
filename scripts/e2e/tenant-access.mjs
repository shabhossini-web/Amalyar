/**
 * چرخهٔ عمرِ تجاریِ شرکت (خواستهٔ مالک ۱۴۰۵/۰۷/۱۵) — فعال/معلق، دمو/اشتراک، مهلت، یادداشت —
 * روی دیتابیسِ کنترلِ **واقعی** و با همان سرویسِ پنل، و اعمالش از مسیرِ HTTP با Hostِ همان شرکت.
 *
 * باید بیفتد:
 *   - شرکتِ معلق به هر مسیری ۴۰۳ می‌دهد (با پیامِ فارسی)، جز `setup-status` که علت را می‌گوید
 *   - شرکتِ منقضی: خواندن ۲۰۰، نوشتن ۴۰۳؛ ولی ورود/خروج همچنان نوشتنِ مجاز است
 *   - تاریخِ نامعتبر (۳۰ فوریه) رد می‌شود؛ شرکتِ ناشناخته ۴۰۴؛ شرکتِ در حالِ حذف ۴۰۹
 *   - هر تغییر یک رویدادِ ممیزی با قبل/بعد دارد
 *   - درخواستِ ساخت نوعِ حساب و مهلتِ اولیه را حمل می‌کند
 *  نباید بیفتد:
 *   - شرکتِ فعالِ بی‌مهلت: هیچ تغییری در رفتار (۴۰۱ همان ۴۰۱ است، نه ۴۰۳)
 *   - شرکتِ دیگر (همسایه) از تعلیقِ این یکی اثر نگیرد
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import http from 'node:http';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
require('reflect-metadata');
const { PlatformProvisioningService } = require('./dist/platform/platform.module');
const { TenantRegistryService } = require('./dist/tenant/tenant-registry.service');
const { encryptDatabaseUrl } = require('./dist/tenant/tenant-crypto');
const { tenantAccess, endOfDayTehran, readOnlyAllows, tehranDatePlusDays } = require('./dist/tenant/tenant-access');
const { PrismaClient: ControlClient } = require('./src/generated/control');

const CTRL = process.env.E2E_CTRL_DB;
if (!CTRL || !['localhost', '127.0.0.1'].includes(new URL(CTRL).hostname)) throw new Error('فقط دیتابیسِ کنترلِ محلی');
const TENANT_DB = process.env.E2E_DB ?? process.env.DATABASE_URL;
if (!TENANT_DB) throw new Error('E2E_DB لازم است');
const API = new URL(process.env.E2E_API ?? 'http://localhost:3101/api');
const control = new ControlClient({ datasources: { db: { url: CTRL } } });
const svc = new PlatformProvisioningService(control);
const registry = new TenantRegistryService(control);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const status = async (p) => { try { await p; return null; } catch (e) { return e?.getStatus?.() ?? String(e); } };

/** درخواستِ HTTP با Hostِ دلخواه — `fetch` سرآیندِ Host را دور می‌ریزد، `http.request` نه. */
const req = (method, path, host, body) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const r = http.request({
    hostname: API.hostname, port: API.port, method, path: `${API.pathname.replace(/\/$/, '')}${path}`,
    headers: { host, accept: 'application/json', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
  }, (res) => {
    let raw = '';
    res.on('data', (c) => { raw += c; });
    res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* متنِ خام */ } resolve({ status: res.statusCode, json, raw }); });
  });
  r.on('error', reject);
  if (data) r.write(data);
  r.end();
});

const tag = 'ta' + randomBytes(3).toString('hex');
const ACTOR = 'h'.repeat(64), IP = 'i'.repeat(64);
const made = [];
const mk = async (slug) => {
  const t = await control.tenant.create({ data: {
    slug, name: 'آزمونِ ' + slug, status: 'active',
    databaseUrlEncrypted: encryptDatabaseUrl(TENANT_DB),
    domains: { create: { hostname: `${slug}.example.com`, primary: true } },
  } });
  made.push(t.id);
  return { ...t, host: `${slug}.example.com` };
};
const audits = (id) => control.platformAuditEvent.findMany({ where: { targetId: id, action: 'platform.tenant.access_changed' }, orderBy: { createdAt: 'asc' } });

try {
  console.log('۰) تابعِ خالص');
  const soon = endOfDayTehran(tehranDatePlusDays(3));
  ok(tenantAccess({ plan: 'demo', accessUntil: soon }).daysLeft === 3 && tenantAccess({ plan: 'demo', accessUntil: soon }).state === 'active', 'دموی «تا سه روزِ دیگر»: فعال، ۳ روز مانده (تفاضلِ تقویمی)');
  const tonight = endOfDayTehran(tehranDatePlusDays(0));
  ok(tenantAccess({ accessUntil: tonight }).daysLeft === 0 && tenantAccess({ accessUntil: tonight }).state === 'active', 'مهلتِ امروز: صفر روز مانده ولی هنوز فعال');
  ok(tenantAccess({ accessUntil: new Date(Date.now() - 1000) }).readOnly === true, 'یک ثانیه بعد از مهلت: فقط‌خواندنی');
  ok(tenantAccess({ suspendedAt: new Date(), accessUntil: soon }).state === 'suspended', 'تعلیق بر مهلت مقدم است');
  ok(tenantAccess({}).message === null && tenantAccess({}).daysLeft === null, 'بی‌مهلت و فعال: نه پیام، نه شمارش');
  ok(endOfDayTehran('2026-02-30') === null && endOfDayTehran('nope') === null, '۳۰ فوریه و متنِ خام رد می‌شوند');
  const eod = endOfDayTehran('2026-10-20');
  ok(eod && eod.toISOString() === '2026-10-20T20:29:59.999Z', 'پایانِ روزِ تهران = ۲۰:۲۹:۵۹ UTC');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(tehranDatePlusDays(14)), 'تاریخِ ۱۴ روزِ بعد به شکلِ YYYY-MM-DD');
  ok(readOnlyAllows('GET', '/api/patients') && readOnlyAllows('POST', '/api/auth/login') && readOnlyAllows('POST', '/api/auth/logout'), 'خواندن و ورود/خروج در فقط‌خواندنی مجازند');
  ok(!readOnlyAllows('POST', '/api/patients') && !readOnlyAllows('PATCH', '/api/auth/prefs') && !readOnlyAllows('POST', '/api/auth/signup/request-otp'), 'نوشتنِ بالینی، ترجیحات و ثبت‌نام مجاز نیستند');

  const A = await mk(tag + 'a');
  const B = await mk(tag + 'b');

  console.log('\n۱) پیش از هر تغییری: فعال و بی‌مهلت، رفتارِ عادی');
  const r0 = await req('GET', '/auth/setup-status', A.host);
  ok(r0.status === 200 && r0.json?.access?.state === 'active' && r0.json.access.plan === 'paid', `setup-status: فعال/اشتراک (${r0.status})`);
  ok((await req('GET', '/auth/me', A.host)).status === 401, 'بی‌نشست ۴۰۱ است، نه ۴۰۳');

  console.log('\n۲) تعلیق از پنل → همه‌چیز ۴۰۳ جز setup-status');
  const s1 = await svc.setAccess(A.id, { suspended: true, note: 'بدهیِ معوق' }, ACTOR, IP);
  ok(s1.access.state === 'suspended' && s1.suspendedAt && s1.accessNote === 'بدهیِ معوق', 'پاسخِ سرویس: معلق + یادداشت');
  const r1 = await req('GET', '/auth/setup-status', A.host);
  ok(r1.status === 200 && r1.json?.access?.state === 'suspended' && /غیرفعال/.test(r1.json.access.message) && r1.json.needsSetup === false,
    'setup-status همچنان ۲۰۰ و علت را می‌گوید');
  const r2 = await req('GET', '/auth/me', A.host);
  ok(r2.status === 403 && r2.json?.code === 'tenant_suspended' && /غیرفعال/.test(r2.json?.message ?? ''), `بقیه ۴۰۳ با پیامِ فارسی (${r2.status})`);
  ok((await req('POST', '/auth/login', A.host, { identifier: 'x', password: 'y' })).status === 403, 'حتی ورود ۴۰۳ است');
  ok((await req('GET', '/auth/me', B.host)).status === 401, 'همسایه (B) دست‌نخورده: همان ۴۰۱');
  ok((await registry.resolveHostname(A.host))?.suspendedAt instanceof Date, 'رجیستری شرکتِ معلق را با suspendedAt برمی‌گرداند (نه null)');

  console.log('\n۳) رفعِ تعلیق + دموی ۳ روزه');
  const in3 = tehranDatePlusDays(3);
  const s2 = await svc.setAccess(A.id, { suspended: false, plan: 'demo', accessUntil: in3 }, ACTOR, IP);
  ok(s2.access.state === 'active' && s2.access.plan === 'demo' && s2.suspendedAt === null && s2.access.daysLeft === 3,
    `دمو، فعال، ${s2.access.daysLeft} روز مانده`);
  const r3 = await req('GET', '/auth/setup-status', A.host);
  ok(r3.status === 200 && r3.json.access.plan === 'demo' && r3.json.access.daysLeft === s2.access.daysLeft, 'setup-status همان روزهای مانده را می‌دهد');
  ok((await req('GET', '/auth/me', A.host)).status === 401, 'دموی فعال مثلِ عادی رفتار می‌کند');

  console.log('\n۴) منقضی → خواندن آزاد، نوشتن ۴۰۳، ورود/خروج مجاز');
  await control.tenant.update({ where: { id: A.id }, data: { accessUntil: new Date(Date.now() - 60_000) } });
  const r4 = await req('GET', '/auth/setup-status', A.host);
  ok(r4.status === 200 && r4.json.access.state === 'expired' && r4.json.access.readOnly === true, 'setup-status: منقضی/فقط‌خواندنی');
  const w = await req('POST', '/auth/signup/request-otp', A.host, { phone: '09120000000' });
  ok(w.status === 403 && w.json?.code === 'tenant_read_only' && /مهلت/.test(w.json?.message ?? ''), `نوشتن ۴۰۳ با پیامِ مهلت (${w.status})`);
  const l = await req('POST', '/auth/login', A.host, { identifier: 'nobody', password: 'wrong' });
  ok(l.status !== 403, `ورود از فقط‌خواندنی رد نمی‌شود (${l.status})`);
  ok((await req('POST', '/auth/logout', A.host, {})).status !== 403, 'خروج هم');
  ok((await req('GET', '/auth/me', A.host)).status === 401, 'خواندنِ بی‌نشست همان ۴۰۱');

  console.log('\n۵) اعتبارسنجی و ممیزی');
  ok((await status(svc.setAccess(A.id, { accessUntil: '2026-02-30' }, ACTOR, IP))) === 400, '۳۰ فوریه → ۴۰۰');
  ok((await status(svc.setAccess('00000000-0000-0000-0000-000000000000', { suspended: true }, ACTOR, IP))) === 404, 'شرکتِ ناشناخته → ۴۰۴');
  await control.tenant.update({ where: { id: B.id }, data: { status: 'deleting' } });
  ok((await status(svc.setAccess(B.id, { suspended: true }, ACTOR, IP))) === 409, 'شرکتِ در حالِ حذف → ۴۰۹');
  await control.tenant.update({ where: { id: B.id }, data: { status: 'active' } });
  const s5 = await svc.setAccess(A.id, { accessUntil: null, plan: 'paid', note: null }, ACTOR, IP);
  ok(s5.access.state === 'active' && s5.access.accessUntil === null && s5.accessNote === null, 'بی‌مهلت‌کردن: فعال، بی‌شمارش، یادداشت پاک');
  const au = await audits(A.id);
  ok(au.length === 3, `سه تغییر، سه رویدادِ ممیزی (${au.length})`);
  ok(au[0]?.metadata?.before?.suspendedAt === null && au[0]?.metadata?.after?.suspendedAt && au[0].actorHash === ACTOR, 'ممیزیِ اول: قبل/بعدِ تعلیق با کنشگر');
  ok(au[2]?.metadata?.after?.accessUntil === null && au[2]?.metadata?.before?.plan === 'demo', 'ممیزیِ سوم: قبل دمو بود، بعد بی‌مهلت');
  const snap = await svc.snapshot();
  const row = snap.tenants.find((t) => t.id === A.id);
  ok(row && row.access?.state === 'active' && row.plan === 'paid' && !('databaseUrlEncrypted' in row), 'snapshot همان شکل را دارد، بی‌رشتهٔ اتصال');

  console.log('\n۶) درخواستِ ساخت نوعِ حساب و مهلت را حمل می‌کند');
  const job = await svc.create({ slug: `${tag}-new`, name: 'دموی تازه', hostname: `${tag}-new.example.com`, plan: 'demo', accessDays: 14 }, ACTOR, IP);
  ok(job.plan === 'demo' && job.accessDays === 14, 'plan=demo، accessDays=14 روی کار');
  const job2 = await svc.create({ slug: `${tag}-paid`, name: 'اشتراکِ تازه', hostname: `${tag}-paid.example.com` }, ACTOR, IP);
  ok(job2.plan === 'paid' && job2.accessDays === null, 'پیش‌فرض: اشتراکِ بی‌مهلت');
  await control.provisioningJob.deleteMany({ where: { slug: { startsWith: tag } } });
} finally {
  await control.platformAuditEvent.deleteMany({ where: { targetId: { in: made } } }).catch(() => {});
  await control.tenant.deleteMany({ where: { id: { in: made } } }).catch(() => {});
  await control.provisioningJob.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => {});
  await control.$disconnect();
}
console.log(`\n${pass} سبز · ${fail} قرمز`);
process.exit(fail ? 1 : 0);
