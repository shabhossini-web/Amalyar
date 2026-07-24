import { execFileSync } from 'child_process';
import { PrismaClient } from '../generated/control';
import { decryptDatabaseUrl } from '../tenant/tenant-crypto';

async function main() {
  const apply = process.argv.includes('--apply');
  const control = new PrismaClient();
  const failures: string[] = [];

  try {
    const tenants = await control.tenant.findMany({
      where: { status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { slug: true, databaseUrlEncrypted: true },
    });

    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${tenants.length} active tenant database(s)`);
    if (!apply) {
      tenants.forEach((tenant) => console.log(`- ${tenant.slug}`));
      console.log('No database was changed. Re-run with --apply after backups are verified.');
      return;
    }

    for (const tenant of tenants) {
      process.stdout.write(`Migrating ${tenant.slug}... `);
      try {
        execFileSync(
          process.platform === 'win32' ? 'npx.cmd' : 'npx',
          ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
          {
            cwd: process.cwd(),
            stdio: 'inherit',
            env: {
              ...process.env,
              DATABASE_URL: decryptDatabaseUrl(tenant.databaseUrlEncrypted),
            },
          },
        );
        console.log('done');
      } catch {
        failures.push(tenant.slug);
        console.error('failed; stopping fleet migration');
        break;
      }
    }
  } finally {
    await control.$disconnect();
  }

  if (failures.length) throw new Error(`Tenant migration failed: ${failures.join(', ')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
