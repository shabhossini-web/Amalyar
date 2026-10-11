import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { promisify } from 'util';
import { PrismaClient } from '../generated/control';
import { decryptDatabaseUrl, encryptDatabaseUrl } from '../tenant/tenant-crypto';
import { endOfDayTehran, normalizePlan, tehranDatePlusDays } from '../tenant/tenant-access';
import { assertJobProfile, seedTenantProfile } from './seed-profile';

const execFileAsync = promisify(execFile);
let stopping = false;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateJob(job: { slug: string; name: string; hostname: string; profileKind?: string | null; profileServices?: string | null }) {
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(job.slug)) {
    throw new Error('INVALID_SLUG');
  }
  // پیش از ساختنِ نقش و دیتابیس: پروفایلِ ناسازگار نباید چیزی بسازد که بعد باید پاک شود.
  assertJobProfile(job.profileKind, job.profileServices);
  if (!job.name.trim() || !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(job.hostname)) {
    throw new Error('INVALID_TENANT_INPUT');
  }
}

/**
 * نام‌های دیتابیس/نقش پیش از رفتن داخلِ SQL باید به الگوی خودمان محدود باشند.
 * این نام‌ها را خودِ provisioning ساخته، ولی اعتبارسنجی دوباره جلوی هر مقدارِ
 * دستکاری‌شده در control-db را می‌گیرد (دفاع لایه‌ای، چون اینجا DROP اجرا می‌شود).
 */
const SAFE_PG_NAME = /^amalyar_[a-z0-9_]{1,60}$/;

function assertSafePgName(value: string, label: string) {
  if (!SAFE_PG_NAME.test(value)) throw new Error(`UNSAFE_${label}`);
  return value;
}

async function migrateTenant(databaseUrl: string) {
  await execFileAsync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}

async function claimNext(control: PrismaClient) {
  const candidate = await control.provisioningJob.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidate) return null;

  const claimed = await control.provisioningJob.updateMany({
    where: { id: candidate.id, status: 'queued' },
    data: {
      status: 'running',
      attempts: { increment: 1 },
      startedAt: new Date(),
      finishedAt: null,
      errorCode: null,
    },
  });
  if (claimed.count !== 1) return null;
  return control.provisioningJob.findUniqueOrThrow({ where: { id: candidate.id } });
}

async function provision(control: PrismaClient, job: Awaited<ReturnType<typeof claimNext>>) {
  if (!job) return;
  validateJob(job);

  const adminUrl = new URL(required('PROVISIONING_DATABASE_URL'));
  const suffix = job.slug.replace(/-/g, '_');
  const databaseName = `amalyar_${suffix}`;
  const roleName = `amalyar_${suffix}_app`;
  const rolePassword = randomBytes(32).toString('base64url');
  const tenantUrl = new URL(adminUrl.toString());
  tenantUrl.pathname = `/${databaseName}`;
  tenantUrl.username = roleName;
  tenantUrl.password = rolePassword;

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  let roleCreated = false;
  let databaseCreated = false;
  let tenantId: string | null = null;
  /* کدِ **مرحله**ای که شکست خورد — شمارشی و بی‌متنِ خطا (متنِ خطای Postgres/Prisma نشانی و رمز را لو می‌دهد). تا امروز همه
     «PROVISIONING_FAILED» بود و ناسازگاریِ نوعِ نصب از شکستِ migration یا ثبت در control-db جدا نمی‌شد. */
  let stage = 'CONFLICT_CHECK_FAILED';

  try {
    const conflict = await control.tenant.findFirst({
      where: { OR: [{ slug: job.slug }, { domains: { some: { hostname: job.hostname } } }] },
      select: { id: true },
    });
    if (conflict) throw new Error('TENANT_CONFLICT');

    stage = 'ROLE_CREATE_FAILED';
    await admin.$executeRawUnsafe(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${rolePassword}'`);
    roleCreated = true;
    stage = 'DATABASE_CREATE_FAILED';
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}" OWNER "${roleName}"`);
    databaseCreated = true;

    stage = 'MIGRATION_FAILED';
    await migrateTenant(tenantUrl.toString());

    /* نوعِ نصب (مطب/شرکتی) **پیش از** ثبتِ شرکت در control-db و پیش از اولین درخواست روی دیتابیسِ تازه
       نوشته می‌شود: لانچر و ساختِ تنبلِ ماژول‌ها از همین دو ردیف می‌آیند، و بنیان‌گذارِ مطب
       باید هنگامِ ثبت‌نام `jobRole: doctor` بگیرد (مالک، ۱۴۰۵/۰۷/۱۵). درخواستِ بی‌پروفایل (قدیمی)
       همان پیش‌فرضِ نصب را می‌گیرد. */
    stage = 'PROFILE_SEED_FAILED';
    if (job.profileKind) await seedTenantProfile(tenantUrl.toString(), job.profileKind, job.profileServices);

    stage = 'CONTROL_REGISTER_FAILED';

    const tenant = await control.$transaction(async (tx) => {
      /* نوعِ حساب و مهلتِ اولیه از خودِ درخواست می‌آید — دموی ۱۴ روزه از همین لحظه فعال است. */
      const accessDays = job.accessDays ?? null;
      const created = await tx.tenant.create({
        data: {
          slug: job.slug,
          name: job.name.trim(),
          status: 'active',
          databaseUrlEncrypted: encryptDatabaseUrl(tenantUrl.toString()),
          domains: { create: { hostname: job.hostname, primary: true } },
          plan: normalizePlan(job.plan),
          accessUntil: accessDays ? endOfDayTehran(tehranDatePlusDays(accessDays)) : null,
        },
        select: { id: true },
      });
      await tx.provisioningJob.update({
        where: { id: job.id },
        data: {
          status: 'succeeded',
          tenantId: created.id,
          errorCode: null,
          finishedAt: new Date(),
        },
      });
      await tx.platformAuditEvent.create({
        data: {
          actorHash: job.requestedByHash,
          action: 'platform.provisioning.succeeded',
          targetType: 'tenant',
          targetId: created.id,
          metadata: { jobId: job.id, slug: job.slug, hostname: job.hostname },
        },
      });
      return created;
    });
    tenantId = tenant.id;
    console.log(`Provisioning job ${job.id} succeeded`);
  } catch (e: any) {
    const reason = String(e?.message ?? '');
    const errorCode = ['TENANT_CONFLICT', 'TENANT_NOT_FRESH', 'INVALID_PROFILE'].find((c) => reason.includes(c)) ?? stage;
    console.error(`Provisioning job ${job.id} failed at ${errorCode}`);
    if (databaseCreated) {
      await admin.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
      ).catch(() => undefined);
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => undefined);
    }
    if (roleCreated) {
      await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${roleName}"`).catch(() => undefined);
    }

    await control.$transaction([
      control.provisioningJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          tenantId: null,
          errorCode,
          finishedAt: new Date(),
        },
      }),
      control.platformAuditEvent.create({
        data: {
          actorHash: job.requestedByHash,
          action: 'platform.provisioning.failed',
          targetType: 'provisioning_job',
          targetId: job.id,
          metadata: { errorCode: 'PROVISIONING_FAILED' },
        },
      }),
    ]);
    console.error(`Provisioning job ${job.id} failed`);
  } finally {
    await admin.$disconnect();
  }
}

async function claimNextDeletion(control: PrismaClient) {
  const candidate = await control.tenantDeletionJob.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidate) return null;

  const claimed = await control.tenantDeletionJob.updateMany({
    where: { id: candidate.id, status: 'queued' },
    data: {
      status: 'running',
      attempts: { increment: 1 },
      startedAt: new Date(),
      finishedAt: null,
      errorCode: null,
    },
  });
  if (claimed.count !== 1) return null;
  return control.tenantDeletionJob.findUniqueOrThrow({ where: { id: candidate.id } });
}

/**
 * حذفِ کاملِ یک شرکت: دیتابیس و نقشِ اختصاصی‌اش drop می‌شوند و رکوردِ tenant
 * (به‌همراهِ دامنه‌هایش با cascade) از control-db پاک می‌شود.
 *
 * نام دیتابیس/نقش از URLِ رمزگشایی‌شدهٔ خودِ tenant خوانده می‌شود، نه از روی slug —
 * چون URL منبعِ حقیقتِ اتصال است و اگر روزی الگوی نام‌گذاری عوض شود، حدس‌زدن از
 * روی slug می‌توانست دیتابیسِ اشتباهی را حذف کند.
 */
async function deprovision(control: PrismaClient, job: Awaited<ReturnType<typeof claimNextDeletion>>) {
  if (!job) return;

  const adminUrl = new URL(required('PROVISIONING_DATABASE_URL'));
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });

  try {
    const tenant = await control.tenant.findUnique({
      where: { id: job.tenantId },
      select: { id: true, databaseUrlEncrypted: true },
    });

    if (tenant) {
      const tenantUrl = new URL(decryptDatabaseUrl(tenant.databaseUrlEncrypted));
      const databaseName = assertSafePgName(tenantUrl.pathname.replace(/^\//, ''), 'DATABASE_NAME');
      const roleName = assertSafePgName(decodeURIComponent(tenantUrl.username), 'ROLE_NAME');

      // اتصال‌های باز مانعِ DROP DATABASE می‌شوند.
      await admin.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
      );
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${roleName}"`);
    }

    await control.$transaction(async (tx) => {
      // رکوردِ tenant ممکن است قبلاً نباشد (اجرای دوباره) — حذف باید idempotent بماند.
      await tx.tenant.deleteMany({ where: { id: job.tenantId } });
      await tx.provisioningJob.deleteMany({ where: { tenantId: job.tenantId } });
      await tx.tenantDeletionJob.update({
        where: { id: job.id },
        data: { status: 'succeeded', errorCode: null, finishedAt: new Date() },
      });
      await tx.platformAuditEvent.create({
        data: {
          actorHash: job.requestedByHash,
          action: 'platform.tenant.deleted',
          targetType: 'tenant',
          targetId: job.tenantId,
          metadata: { jobId: job.id, slug: job.slug, hostname: job.hostname },
        },
      });
    });
    console.log(`Tenant deletion job ${job.id} succeeded`);
  } catch {
    await control.$transaction([
      control.tenantDeletionJob.update({
        where: { id: job.id },
        data: { status: 'failed', errorCode: 'DELETION_FAILED', finishedAt: new Date() },
      }),
      // شرکت حذف نشد → از حالتِ «در حال حذف» برگردد تا معلق نماند.
      control.tenant.updateMany({ where: { id: job.tenantId, status: 'deleting' }, data: { status: 'active' } }),
      control.platformAuditEvent.create({
        data: {
          actorHash: job.requestedByHash,
          action: 'platform.tenant.deletion_failed',
          targetType: 'tenant',
          targetId: job.tenantId,
          metadata: { jobId: job.id, errorCode: 'DELETION_FAILED' },
        },
      }),
    ]);
    console.error(`Tenant deletion job ${job.id} failed`);
  } finally {
    await admin.$disconnect();
  }
}

async function main() {
  required('CONTROL_DATABASE_URL');
  required('PROVISIONING_DATABASE_URL');
  required('TENANT_DATABASE_ENCRYPTION_KEY');

  const control = new PrismaClient();
  const once = process.argv.includes('--once') || process.env.PROVISIONING_WORKER_ONCE === 'true';
  const pollMs = Math.min(Math.max(Number(process.env.PROVISIONING_POLL_MS) || 5000, 1000), 60_000);

  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });

  try {
    do {
      // ساخت مقدم بر حذف است تا یک صفِ حذفِ طولانی، راه‌اندازیِ شرکتِ تازه را عقب نیندازد.
      const job = await claimNext(control);
      if (job) await provision(control, job);
      const deletion = await claimNextDeletion(control);
      if (deletion) await deprovision(control, deletion);
      if (once) break;
      if (!job && !deletion) await new Promise((resolve) => setTimeout(resolve, pollMs));
    } while (!stopping);
  } finally {
    await control.$disconnect();
  }
}

main().catch(() => {
  console.error('Provisioning worker stopped because required configuration is missing or invalid');
  process.exitCode = 1;
});
