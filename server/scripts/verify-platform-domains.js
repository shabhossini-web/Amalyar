'use strict';

/**
 * پنلِ پلتفرم نباید هیچ دامنه‌ای را پنهان کند.
 *
 * ⚠️ این گارد از یک نقطهٔ کورِ واقعی آمد. `snapshot()` دامنه‌ها را با
 * `where: { primary: true }, take: 1` می‌خواند، پس اگر دو نشانی به یک
 * `tenant_id` نگاشت شده بودند، دومی در پنل **اصلاً وجود نداشت**. از بیرون
 * این حالت دقیقاً شبیهِ نشتِ بین‌شرکتی است («چرا این دو دامنه یک داده نشان
 * می‌دهند؟») و تنها راهِ پاسخ‌دادنش باز کردنِ psql روی دیتابیسِ کنترل بود.
 *
 * اینجا به دیتابیس نیازی نیست: کلاینتِ کنترل قلاب می‌شود و هم **کوئری**
 * سنجیده می‌شود هم **نگاشتِ خروجی**.
 */

require('reflect-metadata');

const assert = require('node:assert/strict');
const { PlatformProvisioningService } = require('../dist/platform/platform.module');

const DOMAINS = [
  { hostname: 'reyteb.amalyar.com', primary: false },
  { hostname: 'dual.amalyar.com', primary: true },
];

async function main() {
  let tenantArgs = null;
  const control = {
    tenant: {
      async findMany(args) {
        tenantArgs = args;
        return [
          {
            id: 't-dual', slug: 'dual', name: 'دو‌دامنه', status: 'active',
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            // به همان ترتیبی که orderByِ درخواستی می‌دهد: primary اول.
            domains: [DOMAINS[1], DOMAINS[0]],
          },
          {
            id: 't-solo', slug: 'solo', name: 'تک‌دامنه', status: 'active',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            domains: [{ hostname: 'solo.amalyar.com', primary: true }],
          },
          {
            id: 't-none', slug: 'none', name: 'بی‌دامنه', status: 'provisioning',
            createdAt: new Date('2026-01-03T00:00:00.000Z'),
            domains: [],
          },
        ];
      },
    },
    provisioningJob: { async findMany() { return []; } },
    tenantDeletionJob: { async findMany() { return []; } },
  };

  const service = new PlatformProvisioningService(control);
  const snap = await service.snapshot();

  // ۱) کوئری نباید دامنه‌ای را کنار بگذارد.
  const sel = tenantArgs?.select?.domains;
  assert.ok(sel, 'snapshot باید دامنه‌ها را select کند');
  assert.equal(sel.where, undefined, 'دامنه‌ها نباید با where فیلتر شوند — دامنهٔ غیرِprimary هم باید بیاید');
  assert.equal(sel.take, undefined, 'take روی دامنه‌ها یعنی پنهان‌کردنِ بقیهٔ نشانی‌ها');
  assert.equal(sel.select?.primary, true, 'primary باید برگردد تا نشانیِ اصلی قابلِ تشخیص باشد');

  const [dual, solo, none] = snap.tenants;

  // ۲) هر دو نشانی در خروجی هستند.
  assert.deepEqual(
    dual.domains.map((d) => d.hostname).sort(),
    ['dual.amalyar.com', 'reyteb.amalyar.com'],
    'هر دو دامنهٔ شرکت باید در snapshot باشند',
  );

  // ۳) پرچمِ اشتراک مشتقِ سمتِ سرور است (قانون ۱۵)، نه استنتاجِ کلاینت.
  assert.equal(dual.shared, true, 'شرکتِ دو‌دامنه باید shared باشد');
  assert.equal(solo.shared, false, 'شرکتِ تک‌دامنه نباید shared باشد — هشدارِ همیشگی هشدار نیست');
  assert.equal(none.shared, false);

  // ۴) `hostname` باید همچنان primary باشد، نه صرفاً اولین ردیف.
  assert.equal(dual.hostname, 'dual.amalyar.com', 'hostname باید دامنهٔ اصلی بماند');
  assert.equal(none.hostname, null, 'شرکتِ بی‌دامنه باید null بدهد، نه خطا');

  // ۵) هیچ فیلدِ حساسی همراهِ دامنه‌ها بیرون نرود.
  const leaked = JSON.stringify(snap).match(/postgres(ql)?:\/\/|databaseUrl/i);
  assert.equal(leaked, null, 'snapshot نباید هیچ DSN یا فیلدِ رمزشده‌ای را بیرون بدهد');

  process.stdout.write('platform domain visibility verified\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
