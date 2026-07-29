import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { PrismaClient } from '@prisma/client';
import { ControlPrismaService } from './control-prisma.service';
import { decryptDatabaseUrl } from './tenant-crypto';

const run = promisify(execFile);

/** کلیدِ قفلِ مشورتیِ Postgres — عددی دلخواه ولی ثابت. */
const LOCK_KEY = 4_120_777;

export type TenantMigrationState = 'up-to-date' | 'migrated' | 'failed' | 'unknown';
export type TenantMigrationRow = {
  slug: string;
  state: TenantMigrationState;
  pending: string[];
  error?: string;
};

/**
 * هم‌گام نگه‌داشتنِ دیتابیسِ شرکت‌ها با migrationها.
 *
 * ⚠️ چرا وجود دارد: تا امروز migrationِ شرکت‌ها دستی بود
 * (`npm run tenants:migrate -- --apply`) و یک‌بار فراموش شد. نتیجه‌اش هیچ خطای
 * آشکاری نداشت — فقط جدول‌های تازه غایب بودند، پس بعضی endpointها ۵۰۰ می‌دادند
 * و صفحه‌ها **بی‌هیچ پیامی** ناقص دیده می‌شدند. هر مرحله‌ای که به آدم تکیه کند
 * بالاخره یک بار فراموش می‌شود، پس این مرحله باید خودکار باشد.
 *
 * ایمیجِ production هم CLIِ prisma دارد هم پوشهٔ migrations (Dockerfile هر دو
 * را کپی می‌کند و همین حالا دیتابیسِ مرکزی را در CMD مهاجرت می‌دهد)، پس این
 * کار زیرساختِ تازه‌ای لازم ندارد.
 */
@Injectable()
export class TenantMigratorService {
  private readonly log = new Logger(TenantMigratorService.name);
  private report: TenantMigrationRow[] = [];
  private ranAt: Date | null = null;

  constructor(private readonly control: ControlPrismaService) {}

  /** نامِ همهٔ migrationهای موجود روی دیسک، به ترتیب. */
  private expected(): string[] {
    const dir = join(process.cwd(), 'prisma', 'migrations');
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'migration.sql')))
      .map((e) => e.name)
      .sort();
  }

  /**
   * migrationهای اعمال‌نشدهٔ یک دیتابیس.
   *
   * نبودِ جدولِ `_prisma_migrations` یعنی هیچ‌کدام اعمال نشده — نه اینکه خطا
   * بدهیم؛ دیتابیسِ تازه‌ساخته دقیقاً همین حالت را دارد.
   */
  async pendingFor(databaseUrl: string): Promise<string[]> {
    const expected = this.expected();
    if (!expected.length) return [];
    const client = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
    try {
      const rows = await client.$queryRawUnsafe<{ migration_name: string }[]>(
        `SELECT migration_name FROM "_prisma_migrations"
         WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      );
      const applied = new Set(rows.map((r) => r.migration_name));
      return expected.filter((name) => !applied.has(name));
    } catch (e: any) {
      // 42P01 = undefined_table
      if (e?.meta?.code === '42P01' || /_prisma_migrations/.test(String(e?.message))) return expected;
      throw e;
    } finally {
      await client.$disconnect().catch(() => undefined);
    }
  }

  private async migrateOne(databaseUrl: string) {
    await run(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, timeout: 180_000 },
    );
  }

  /**
   * همهٔ شرکت‌های فعال را جلو می‌برد.
   *
   * ⚠️ برخلافِ ابزارِ دستی، با اولین خطا متوقف نمی‌شود: هنگامِ بالا آمدنِ سرویس،
   * یک شرکتِ خراب نباید جلوی به‌روزرسانیِ بقیه را بگیرد. خطا ثبت می‌شود و
   * درخواست‌های همان شرکت با پیامِ روشن رد می‌شوند.
   */
  async runAll(): Promise<TenantMigrationRow[]> {
    const locked = await this.acquireLock();
    if (!locked) {
      // نسخهٔ دیگری از سرویس دارد همین کار را می‌کند (دیپلویِ چرخشی).
      this.log.log('migrationِ شرکت‌ها روی نمونهٔ دیگری در جریان است؛ فقط وضعیت خوانده می‌شود');
    }

    const tenants = await this.control.tenant.findMany({
      where: { status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { slug: true, databaseUrlEncrypted: true },
    });

    const out: TenantMigrationRow[] = [];
    for (const t of tenants) {
      let url: string;
      try {
        url = decryptDatabaseUrl(t.databaseUrlEncrypted);
      } catch (e: any) {
        out.push({ slug: t.slug, state: 'failed', pending: [], error: 'رمزگشاییِ آدرسِ دیتابیس شکست خورد' });
        continue;
      }
      try {
        const pending = await this.pendingFor(url);
        if (!pending.length) { out.push({ slug: t.slug, state: 'up-to-date', pending: [] }); continue; }
        if (!locked) { out.push({ slug: t.slug, state: 'unknown', pending }); continue; }

        this.log.log(`${t.slug}: ${pending.length} migrationِ اعمال‌نشده — در حال اجرا`);
        await this.migrateOne(url);
        const left = await this.pendingFor(url);
        out.push(
          left.length
            ? { slug: t.slug, state: 'failed', pending: left, error: 'پس از اجرا هنوز اعمال‌نشده مانده' }
            : { slug: t.slug, state: 'migrated', pending: [] },
        );
      } catch (e: any) {
        const error = String(e?.stderr || e?.message || e).slice(0, 400);
        this.log.error(`${t.slug}: migration شکست خورد — ${error}`);
        out.push({ slug: t.slug, state: 'failed', pending: [], error });
      }
    }

    if (locked) await this.releaseLock();
    this.report = out;
    this.ranAt = new Date();

    const behind = out.filter((r) => r.state === 'failed' || r.state === 'unknown');
    const migrated = out.filter((r) => r.state === 'migrated');
    if (migrated.length) this.log.log(`${migrated.length} شرکت به‌روز شد: ${migrated.map((r) => r.slug).join('، ')}`);
    if (behind.length) this.log.error(`${behind.length} شرکت عقب ماند: ${behind.map((r) => r.slug).join('، ')}`);
    else this.log.log(`همهٔ ${out.length} شرکت هم‌گام‌اند`);
    return out;
  }

  /** برای middleware: این شرکت قابلِ سرویس‌دهی هست یا نه. */
  isBroken(slug: string): boolean {
    return this.report.some((r) => r.slug === slug && r.state === 'failed');
  }

  /** خلاصهٔ بی‌نام برای `/health` — نامِ شرکت‌ها بیرون نمی‌رود. */
  summary() {
    const count = (s: TenantMigrationState) => this.report.filter((r) => r.state === s).length;
    return {
      ranAt: this.ranAt,
      tenants: this.report.length,
      upToDate: count('up-to-date') + count('migrated'),
      failed: count('failed'),
      unknown: count('unknown'),
    };
  }

  /** گزارشِ کامل — فقط برای کنسولِ پلتفرم. */
  details(): TenantMigrationRow[] {
    return this.report;
  }

  private async acquireLock(): Promise<boolean> {
    try {
      const rows = await this.control.$queryRawUnsafe<{ locked: boolean }[]>(
        `SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`,
      );
      return !!rows[0]?.locked;
    } catch {
      return false;
    }
  }

  private async releaseLock() {
    await this.control
      .$queryRawUnsafe(`SELECT pg_advisory_unlock(${LOCK_KEY})`)
      .catch(() => undefined);
  }
}
