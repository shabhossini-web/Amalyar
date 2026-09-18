/**
 * راه‌اندازیِ محیطِ e2eِ «سرورِ زنده» — از صفر، با یک دستور.
 *
 * ⚠️ **چرا این فایل هست.** سوییت‌هایی که با `E2E_API` کار می‌کنند (نه الگوی
 * `*-local.mjs`ِ PGlite) یک سرورِ واقعی، یک Postgresِ واقعی و یک حسابِ ادمین
 * می‌خواهند. تا امروز هیچ‌جا نوشته نبود این محیط چطور ساخته می‌شود؛ روی ماشینِ
 * هر ایجنت دستی بالا آمده بود. دو نتیجه داشت:
 *
 *  ۱. **CI نمی‌توانست این سوییت‌ها را بدواند** — و ۱۱۷ سوییت بیرونِ CI ماند.
 *     چهار موردِ بیات یا شکسته (`w2-1` · `follow-up` · `portal` · `postop-visit`)
 *     فقط وقتی پیدا شدند که کسی تصادفاً اجرایشان کرد.
 *  ۲. **دیتابیسِ آلوده سنجه را دروغ می‌کرد** — اجرای ناتمامِ قبلی سه فرمِ `fu*`
 *     با `followUp='general'` جا گذاشته بود و چون `followUpUrl` قدیمی‌ترین را
 *     برمی‌دارد، اجرای تازه به فرمِ بیاتِ اجرای قبلی می‌چسبید و قرمزِ دروغین
 *     می‌داد. دیتابیسِ تازه در هر اجرا این کلاس را کامل می‌بندد.
 *
 * idempotent است: دوباره اجرا کردنش چیزی را خراب نمی‌کند.
 *
 * ```bash
 * CONTROL_DATABASE_URL=postgresql://…/control \
 * DATABASE_URL=postgresql://…/tenant \
 * TENANT_DATABASE_ENCRYPTION_KEY=<base64 ۳۲ بایت> \
 * node scripts/e2e/bootstrap-env.mjs
 * ```
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../server');

const CONTROL_URL = process.env.CONTROL_DATABASE_URL;
const TENANT_URL = process.env.DATABASE_URL;
const SLUG = process.env.DEFAULT_TENANT_SLUG ?? 't1';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

if (!CONTROL_URL || !TENANT_URL) {
  console.error('CONTROL_DATABASE_URL و DATABASE_URL لازم‌اند');
  process.exit(1);
}
if (!process.env.TENANT_DATABASE_ENCRYPTION_KEY) {
  console.error('TENANT_DATABASE_ENCRYPTION_KEY لازم است (base64ِ ۳۲ بایت)');
  process.exit(1);
}

const run = (args, env) => execFileSync('npx', args, {
  cwd: serverDir, stdio: 'inherit', env: { ...process.env, ...env },
});

/* ۱) هر دو schema مهاجرت می‌کنند. `migrate deploy` خودش idempotent است. */
run(['prisma', 'migrate', 'deploy', '--schema', 'prisma/control/schema.prisma'], { CONTROL_DATABASE_URL: CONTROL_URL });
run(['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { DATABASE_URL: TENANT_URL });

/* ۲) ردیفِ شرکت در control-db. آدرسِ دیتابیس **رمزشده** ذخیره می‌شود — همان
   تابعِ سرور، نه یک پیاده‌سازیِ دوم که می‌تواند واگرا شود. */
const { encryptDatabaseUrl } = require(`${serverDir}/dist/tenant/tenant-crypto.js`);
/* کلاینتِ control جای دیگری تولید می‌شود (`output` در schemaِ خودش)، نه در
   `@prisma/client` — از همان‌جا که خودِ سرور می‌خواندش. */
const { PrismaClient: ControlClient } = require(`${serverDir}/src/generated/control`);
const control = new ControlClient({ datasources: { db: { url: CONTROL_URL } } });
await control.tenant.upsert({
  where: { slug: SLUG },
  update: { status: 'active', databaseUrlEncrypted: encryptDatabaseUrl(TENANT_URL) },
  create: { slug: SLUG, name: `آزمونِ ${SLUG}`, status: 'active', databaseUrlEncrypted: encryptDatabaseUrl(TENANT_URL) },
});
await control.$disconnect();

/* ۳) حسابِ ادمین. سطح ۶ و `active` صریح داده می‌شود: قاعدهٔ «اولین حساب خودکار
   سوپرادمین می‌شود» مسیرِ ثبت‌نام است، و اینجا مسیرِ ثبت‌نام طی نمی‌شود. */
const bcrypt = require(`${serverDir}/node_modules/bcryptjs`);
const { PrismaClient } = require(`${serverDir}/node_modules/@prisma/client`);
const tenant = new PrismaClient({ datasources: { db: { url: TENANT_URL } } });
const existing = await tenant.account.findUnique({ where: { username: USER } });
if (existing) {
  await tenant.account.update({
    where: { id: existing.id },
    data: { passwordHash: await bcrypt.hash(PASS, 12), level: 6, status: 'active' },
  });
} else {
  await tenant.account.create({
    data: {
      username: USER,
      passwordHash: await bcrypt.hash(PASS, 12),
      level: 6,
      status: 'active',
      person: { create: { firstName: 'مدیر', lastName: 'آزمون' } },
    },
  });
}
await tenant.$disconnect();

console.log(`✅ محیطِ e2e آماده است — شرکتِ «${SLUG}»، کاربرِ «${USER}»`);
