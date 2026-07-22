import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { promisify } from 'util';
import { PrismaClient } from '../generated/control';
import { encryptDatabaseUrl } from '../tenant/tenant-crypto';

const execFileAsync = promisify(execFile);
let stopping = false;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateJob(job: { slug: string; name: string; hostname: string }) {
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(job.slug)) {
    throw new Error('INVALID_SLUG');
  }
  if (!job.name.trim() || !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(job.hostname)) {
    throw new Error('INVALID_TENANT_INPUT');
  }
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

  try {
    const conflict = await control.tenant.findFirst({
      where: { OR: [{ slug: job.slug }, { domains: { some: { hostname: job.hostname } } }] },
      select: { id: true },
    });
    if (conflict) throw new Error('TENANT_CONFLICT');

    await admin.$executeRawUnsafe(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${rolePassword}'`);
    roleCreated = true;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}" OWNER "${roleName}"`);
    databaseCreated = true;

    await migrateTenant(tenantUrl.toString());

    const tenant = await control.tenant.create({
      data: {
        slug: job.slug,
        name: job.name.trim(),
        status: 'active',
        databaseUrlEncrypted: encryptDatabaseUrl(tenantUrl.toString()),
        domains: { create: { hostname: job.hostname, primary: true } },
      },
      select: { id: true },
    });
    tenantId = tenant.id;

    await control.$transaction([
      control.provisioningJob.update({
        where: { id: job.id },
        data: {
          status: 'succeeded',
          tenantId,
          errorCode: null,
          finishedAt: new Date(),
        },
      }),
      control.platformAuditEvent.create({
        data: {
          actorHash: job.requestedByHash,
          action: 'platform.provisioning.succeeded',
          targetType: 'tenant',
          targetId: tenantId,
          metadata: { jobId: job.id, slug: job.slug, hostname: job.hostname },
        },
      }),
    ]);
    console.log(`Provisioning job ${job.id} succeeded`);
  } catch {
    if (tenantId) {
      await control.tenant.deleteMany({ where: { id: tenantId, status: { not: 'active' } } }).catch(() => undefined);
    }
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
          errorCode: 'PROVISIONING_FAILED',
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
      const job = await claimNext(control);
      if (job) await provision(control, job);
      if (once) break;
      if (!job) await new Promise((resolve) => setTimeout(resolve, pollMs));
    } while (!stopping);
  } finally {
    await control.$disconnect();
  }
}

main().catch(() => {
  console.error('Provisioning worker stopped because required configuration is missing or invalid');
  process.exitCode = 1;
});
