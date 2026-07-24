import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { PrismaClient } from '../generated/control';
import { encryptDatabaseUrl } from '../tenant/tenant-crypto';

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const [slugRaw, nameRaw, hostnameRaw] = process.argv.slice(2);
  const slug = (slugRaw ?? '').trim().toLowerCase();
  const name = (nameRaw ?? '').trim();
  const hostname = (hostnameRaw ?? '').trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(slug)) {
    throw new Error('slug must be 3-63 lowercase letters, digits, or internal hyphens');
  }
  if (!name || !/^[a-z0-9.-]+$/.test(hostname) || hostname.includes('..')) {
    throw new Error('A valid company name and hostname are required');
  }

  const controlUrl = required('CONTROL_DATABASE_URL');
  const adminUrl = new URL(required('PROVISIONING_DATABASE_URL'));
  const suffix = slug.replace(/-/g, '_');
  const databaseName = `amalyar_${suffix}`;
  const roleName = `amalyar_${suffix}_app`;
  const rolePassword = randomBytes(32).toString('base64url');
  const tenantUrl = new URL(adminUrl.toString());
  tenantUrl.pathname = `/${databaseName}`;
  tenantUrl.username = roleName;
  tenantUrl.password = rolePassword;

  const control = new PrismaClient({ datasources: { db: { url: controlUrl } } });
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  let roleCreated = false;
  let databaseCreated = false;

  try {
    const conflict = await control.tenant.findFirst({
      where: { OR: [{ slug }, { domains: { some: { hostname } } }] },
    });
    if (conflict) throw new Error('Tenant slug or hostname already exists');

    // All interpolated identifiers are derived from the restricted slug alphabet.
    await admin.$executeRawUnsafe(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${rolePassword}'`);
    roleCreated = true;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}" OWNER "${roleName}"`);
    databaseCreated = true;

    execFileSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: tenantUrl.toString() },
      },
    );

    const tenant = await control.tenant.create({
      data: {
        slug,
        name,
        status: 'active',
        databaseUrlEncrypted: encryptDatabaseUrl(tenantUrl.toString()),
        domains: { create: { hostname, primary: true } },
      },
      select: { id: true, slug: true, name: true, status: true },
    });
    console.log(JSON.stringify(tenant));
  } catch (error) {
    // Rollback is restricted to the exact validated names created in this invocation.
    if (databaseCreated) {
      await admin.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
      );
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
    }
    if (roleCreated) await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${roleName}"`);
    throw error;
  } finally {
    await Promise.all([control.$disconnect(), admin.$disconnect()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
