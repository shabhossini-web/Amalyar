import { PrismaClient } from '../generated/control';
import { decryptDatabaseUrl, encryptDatabaseUrl } from '../tenant/tenant-crypto';

/**
 * **بازگردانی روی سرورِ تازه — نشانیِ دیتابیسِ شرکت‌ها را به Postgresِ جدید برگردان.**
 *
 * چرا لازم است (بازبینیِ ۱۴۰۵/۰۷/۱۹): نشانیِ اتصالِ دیتابیسِ هر شرکت — شاملِ میزبان و درگاهِ Postgres — هنگامِ ساخت از
 * `PROVISIONING_DATABASE_URL` ساخته و **رمزشده** در `tenants.database_url_encrypted`ِ دیتابیسِ مرکزی ذخیره می‌شود و
 * برنامه همان را عیناً به کار می‌برد. منبعِ Postgresِ تازه در Coolify نامِ داخلیِ تازه دارد؛ پس پس از بازگردانی، دیتابیسِ
 * مرکزی کار می‌کند ولی **هیچ شرکتی** باز نمی‌شود — همه به میزبانِ سرورِ مرده وصل می‌شوند.
 *
 * این اسکریپت فقط **میزبان و درگاه** را عوض می‌کند (نامِ دیتابیس، نقش و رمزِ نقش همان می‌ماند — همان‌ها که با
 * `globals.sql` و دامپ‌ها برگشته‌اند) و پیش از نوشتن، با نشانیِ تازه واقعاً وصل می‌شود.
 *
 * اجرا داخلِ کانتینرِ بک‌اند (همان‌جا که `CONTROL_DATABASE_URL` و `TENANT_DATABASE_ENCRYPTION_KEY` هست):
 *   node dist/scripts/rehost-tenants.js            # فقط نشان می‌دهد (پیش‌فرض) — هیچ چیز نوشته نمی‌شود
 *   node dist/scripts/rehost-tenants.js --apply    # می‌نویسد؛ فقط شرکت‌هایی که با نشانیِ تازه وصل شدند
 * میزبانِ مقصد: `TARGET_DATABASE_HOST` (مثلاً `pg-new:5432`)، وگرنه میزبانِ `PROVISIONING_DATABASE_URL`، وگرنه
 * میزبانِ `CONTROL_DATABASE_URL` — همان Postgresی که دیتابیسِ مرکزی رویش برگشته است.
 *
 * خروجی هرگز رمز یا نشانیِ کامل را چاپ نمی‌کند؛ فقط شناسهٔ شرکت، نامِ دیتابیس و میزبانِ قبل/بعد.
 */

const hostOf = (raw: string | undefined): string | null => {
  if (!raw) return null;
  try { const u = new URL(raw); return u.port ? `${u.hostname}:${u.port}` : u.hostname; } catch { return null; }
};

export function rehostUrl(url: string, target: string): string {
  const u = new URL(url);
  const [hostname, port] = target.split(':');
  u.hostname = hostname;
  u.port = port ?? '';
  return u.toString();
}

/** با همان نشانی (نقش و رمزِ همان شرکت) واقعاً وصل شو — کلاینتِ Prisma فقط برای `SELECT 1`، بی‌وابستگیِ تازه. */
async function canConnect(url: string): Promise<string | null> {
  const u = new URL(url);
  u.searchParams.set('connect_timeout', '8');
  const client = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    await client.$queryRawUnsafe('SELECT 1');
    return null;
  } catch (e: any) {
    /* فقط کدِ خطا (P1001 = میزبان در دسترس نیست، P1000 = رمز/نقش) — متنِ کاملِ خطای Prisma نشانی را چاپ می‌کند. */
    return String(e?.errorCode ?? e?.code ?? 'خطای اتصال').slice(0, 40);
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const target = process.env.TARGET_DATABASE_HOST?.trim()
    || hostOf(process.env.PROVISIONING_DATABASE_URL) || hostOf(process.env.CONTROL_DATABASE_URL);
  if (!target || !/^[A-Za-z0-9._-]+(:\d{1,5})?$/.test(target)) {
    throw new Error('میزبانِ مقصد معلوم نیست: TARGET_DATABASE_HOST=میزبان:درگاه بده (یا PROVISIONING_DATABASE_URL/CONTROL_DATABASE_URL)');
  }
  const control = new PrismaClient();
  let failed = 0; let changed = 0;
  try {
    const tenants = await control.tenant.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true, status: true, databaseUrlEncrypted: true },
    });
    console.log(`${apply ? 'نوشتن' : 'فقط نمایش (برای نوشتن --apply)'} — میزبانِ مقصد: ${target} — ${tenants.length} شرکت`);
    for (const t of tenants) {
      let url: string;
      try { url = decryptDatabaseUrl(t.databaseUrlEncrypted); } catch {
        failed++; console.log(`  ✘ ${t.slug}: نشانی رمزگشایی نشد — TENANT_DATABASE_ENCRYPTION_KEY همان مقدارِ قبلی نیست`); continue;
      }
      const before = hostOf(url) ?? '?';
      const db = new URL(url).pathname.replace(/^\//, '');
      if (before === target) {
        const err = await canConnect(url);
        if (err) failed++;
        console.log(`  ${err ? '✘' : '✔'} ${t.slug} (${db}): از قبل روی ${target}${err ? ` — اتصال نشد (${err})` : ''}`);
        continue;
      }
      const next = rehostUrl(url, target);
      const err = await canConnect(next);
      if (err) {
        failed++;
        console.log(`  ✘ ${t.slug} (${db}): ${before} → ${target} — با نشانیِ تازه وصل نشد (${err})؛ دست نخورد. نقش‌ها (globals.sql) و دامپِ همین دیتابیس برگشته‌اند؟`);
        continue;
      }
      if (apply) {
        await control.tenant.update({ where: { id: t.id }, data: { databaseUrlEncrypted: encryptDatabaseUrl(next) } });
        changed++;
      }
      console.log(`  ✔ ${t.slug} (${db}): ${before} → ${target}${apply ? ' — نوشته شد' : ' — وصل شد (هنوز نوشته نشده)'}${t.status !== 'active' ? ` [وضعیت: ${t.status}]` : ''}`);
    }
  } finally {
    await control.$disconnect();
  }
  console.log(apply ? `تمام شد — ${changed} شرکت به ${target} برگشت، ${failed} ناموفق` : `هیچ چیز نوشته نشد — ${failed} مورد ناموفق؛ اگر همه ✔ است با --apply دوباره اجرا کن`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
