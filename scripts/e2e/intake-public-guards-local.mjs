/** Disposable real Nest + Prisma + PGlite server for the public intake guards; no external services. */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'pglite-server';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const schemaSql = schema => execFileSync(process.execPath, [root + 'server/node_modules/prisma/build/index.js',
  'migrate', 'diff', '--from-empty', '--to-schema-datamodel', root + schema, '--script'], { encoding: 'utf8' });
const tenant = new PGlite(), control = new PGlite();
for (const dir of (await readdir(root + 'server/prisma/migrations')).sort()) {
  if (dir.startsWith('20')) await tenant.exec(await readFile(root + 'server/prisma/migrations/' + dir + '/migration.sql', 'utf8'));
}
await control.exec(schemaSql('server/prisma/control/schema.prisma'));
const servers = [createServer(tenant), createServer(control)];
await Promise.all(servers.map(s => new Promise(r => s.listen(0, '127.0.0.1', r))));
const url = s => `postgresql://postgres:postgres@127.0.0.1:${s.address().port}/template1?connection_limit=1&statement_cache_size=0&connect_timeout=30`;
/* فایل‌های آپلودی در یک پوشهٔ موقت می‌نشینند و آخرِ کار پاک می‌شوند. */
const storage = await mkdtemp(join(tmpdir(), 'amalyar-guards-'));
Object.assign(process.env, { DATABASE_URL: url(servers[0]), CONTROL_DATABASE_URL: url(servers[1]),
  TENANT_DATABASE_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64'),
  JWT_SECRET: 'guards-ci-secret-at-least-32-characters',
  STORAGE_ROOT: storage,
  REMINDERS_DISABLED: '1', AUTO_MIGRATE_TENANTS: '0', NODE_ENV: 'test' });
const { PrismaClient } = require('@prisma/client');
const { PrismaClient: Control } = require('./src/generated/control');
const { encryptDatabaseUrl } = require('./dist/tenant/tenant-crypto');
const db = new PrismaClient(), ctl = new Control();
const tenantId = '00000000-0000-4000-8000-0000000000cb';
let app;
try {
  await ctl.tenant.create({ data: { id: tenantId, slug: 'guards', name: 'Public intake guards test', status: 'active',
    databaseUrlEncrypted: encryptDatabaseUrl(process.env.DATABASE_URL),
    domains: { create: { id: 'guardshost', hostname: 'localhost' } } } });
  await db.$disconnect(); await ctl.$disconnect();
  const { NestFactory } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  // The unrelated national directory seed is excluded; every tested query is real.
  require('./dist/catalog/hospitals.seed.json').length = 0;
  const { AppModule } = require('./dist/app.module');
  const { PrismaExceptionFilter } = require('./dist/common/prisma-exception.filter');
  app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());
  await app.listen(0, '127.0.0.1');
  process.env.E2E_API = `http://localhost:${app.getHttpServer().address().port}/api`;
  process.env.E2E_DB = process.env.DATABASE_URL;
  await import('./intake-public-guards.mjs');
} finally {
  if (app) await app.close();
  await db.$disconnect().catch(() => undefined); await ctl.$disconnect().catch(() => undefined);
  for (const s of servers) s.close();
  await tenant.close(); await control.close();
  await rm(storage, { recursive: true, force: true }).catch(() => undefined);
}
