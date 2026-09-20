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
 * [E2E_TENANT2_DATABASE_URL=postgresql://…/tenant2]   # فقط برای tenant-isolation.mjs
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
/* تنانتِ دوم — اختیاری. فقط `tenant-isolation.mjs` لازمش دارد: ادعایش مرزِ
   دیتابیس است و با یک دیتابیس بی‌معنی سبز می‌شود. میزبانش در `tenant_domains`
   ثبت می‌شود تا از راهِ اصلی (Host دقیق) resolve شود، نه fallbackِ توسعه. */
const TENANT2_URL = process.env.E2E_TENANT2_DATABASE_URL;
const TENANT2_SLUG = process.env.E2E_TENANT2_SLUG ?? 'uitest2';
const TENANT2_HOST = process.env.E2E_HOST_B ?? '127.0.0.2';

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
if (TENANT2_URL) run(['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { DATABASE_URL: TENANT2_URL });

/* ۲) ردیفِ شرکت در control-db. آدرسِ دیتابیس **رمزشده** ذخیره می‌شود — همان
   تابعِ سرور، نه یک پیاده‌سازیِ دوم که می‌تواند واگرا شود. */
const { encryptDatabaseUrl } = require(`${serverDir}/dist/tenant/tenant-crypto.js`);
/* کلاینتِ control جای دیگری تولید می‌شود (`output` در schemaِ خودش)، نه در
   `@prisma/client` — از همان‌جا که خودِ سرور می‌خواندش. */
const { PrismaClient: ControlClient } = require(`${serverDir}/src/generated/control`);
const control = new ControlClient({ datasources: { db: { url: CONTROL_URL } } });
const upsertTenant = async (slug, url, hostname) => {
  const row = await control.tenant.upsert({
    where: { slug },
    update: { status: 'active', databaseUrlEncrypted: encryptDatabaseUrl(url) },
    create: { slug, name: `آزمونِ ${slug}`, status: 'active', databaseUrlEncrypted: encryptDatabaseUrl(url) },
  });
  if (hostname) {
    await control.tenantDomain.upsert({
      where: { hostname },
      update: { tenantId: row.id, primary: true },
      create: { hostname, tenantId: row.id, primary: true },
    });
  }
};
/* تنانتِ اول روی loopback از `DEFAULT_TENANT_SLUG` resolve می‌شود (همان مسیری
   که بندِ ۶ِ `tenant-isolation` می‌سنجد)، ولی یک دامنهٔ **واقعی** هم می‌گیرد:
   `tenant-seo` مثلِ nginx با `Host: clinic.localhost` می‌آید و canonical/og:url
   باید از همان میزبان ساخته شود — میزبانِ ثبت‌نشدهٔ غیرِ loopback عمداً ۴۰۴ است. */
await upsertTenant(SLUG, TENANT_URL, process.env.E2E_HOST_T1 ?? 'clinic.localhost');
if (TENANT2_URL) await upsertTenant(TENANT2_SLUG, TENANT2_URL, TENANT2_HOST);
await control.$disconnect();

/* ۳) حسابِ ادمین (+ تعریف‌های پایه، بندِ ۴ پایین). سطح ۶ و `active` صریح داده می‌شود: قاعدهٔ «اولین حساب خودکار
   سوپرادمین می‌شود» مسیرِ ثبت‌نام است، و اینجا مسیرِ ثبت‌نام طی نمی‌شود. */
const bcrypt = require(`${serverDir}/node_modules/bcryptjs`);
const { PrismaClient } = require(`${serverDir}/node_modules/@prisma/client`);
const seedAdmin = async (url) => {
  const tenant = new PrismaClient({ datasources: { db: { url } } });
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
  /* ۴) تعریف‌های پایهٔ کمینه — یک جراح و یک بیمارستان. نصبِ واقعی پیش از
     اولین مراجعه این‌ها را دارد و ۱۱ سوییت «اولین جراح/بیمارستانِ فهرست» را
     برمی‌دارند؛ روی دیتابیسِ بکر با «جراح را کامل کنید» می‌افتادند. */
  if (!await tenant.surgeon.findFirst({ where: { person: { firstName: 'دکتر', lastName: 'آزمون' } } })) {
    await tenant.surgeon.create({ data: { active: true, specialty: 'جراحی', person: { create: { firstName: 'دکتر', lastName: 'آزمون' } } } });
  }
  if (!await tenant.hospital.findFirst({ where: { name: 'بیمارستان آزمون' } })) {
    await tenant.hospital.create({ data: { name: 'بیمارستان آزمون', city: 'تهران', sector: 'private', active: true } });
  }
  await tenant.$disconnect();
};
await seedAdmin(TENANT_URL);
if (TENANT2_URL) await seedAdmin(TENANT2_URL);

console.log(`✅ محیطِ e2e آماده است — شرکتِ «${SLUG}»${TENANT2_URL ? ` + «${TENANT2_SLUG}» روی ${TENANT2_HOST}` : ''}، کاربرِ «${USER}»`);
