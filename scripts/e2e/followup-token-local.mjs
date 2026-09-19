/** Disposable real Nest + Prisma + PGlite server for the follow-up token invariant; no external services. */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
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
Object.assign(process.env, { DATABASE_URL: url(servers[0]), CONTROL_DATABASE_URL: url(servers[1]),
  TENANT_DATABASE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  JWT_SECRET: 'followup-ci-secret-at-least-32-characters',
  REMINDERS_DISABLED: '1', AUTO_MIGRATE_TENANTS: '0', NODE_ENV: 'test' });
const { PrismaClient } = require('@prisma/client');
const { PrismaClient: Control } = require('./src/generated/control');
const { encryptDatabaseUrl } = require('./dist/tenant/tenant-crypto');
const db = new PrismaClient(), ctl = new Control();
const tenantId = '00000000-0000-4000-8000-0000000000fa';
let app;
try {
  await ctl.tenant.create({ data: { id: tenantId, slug: 'futok', name: 'Follow-up token test', status: 'active',
    databaseUrlEncrypted: encryptDatabaseUrl(process.env.DATABASE_URL),
    domains: { create: { id: 'futokhost', hostname: 'localhost' } } } });
  await db.$disconnect(); await ctl.$disconnect();
  const { NestFactory } = require('@nestjs/core');
  // The unrelated national directory seed is excluded; every tested query is real.
  require('./dist/catalog/hospitals.seed.json').length = 0;
  const { AppModule } = require('./dist/app.module');
  const { ValidationPipe } = require('@nestjs/common');
  app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  /* HTTP هم بالا می‌آید: بخشِ ۸ پرشدنِ فرم را از مسیرِ **عمومیِ واقعی** می‌زند تا
     ثابت شود خودِ `fill()` هم‌گام‌سازی را صدا می‌زند — نه فقط PATCHِ ادمین. */
  await app.listen(0, '127.0.0.1');
  process.env.E2E_API = `http://localhost:${app.getHttpServer().address().port}/api`;
  /**
   * ⚠️ بخش‌های ۱–۷ عمداً از HTTP رد نمی‌شوند و `RemindersService.syncNextVisit`
   * را مستقیم صدا می‌زنند — و این **میانبر نیست**: باگ داخلِ خودِ همین تابع
   * است (حلقهٔ کاشتِ موج‌ها)، پس نقطهٔ ورودِ درست همین است. میانبر آن بود که
   * `followUpUrl` — تهِ خط — صدا زده شود؛ آن‌وقت سیم‌کشیِ حلقه اصلاً سنجیده
   * نمی‌شد. (درسِ سنجهٔ توخالیِ W1.10.) بخشِ ۸ برعکس از HTTP می‌رود، چون موضوعش
   * سیم‌کشیِ `fill()` به همین تابع است.
   *
   * `TenantContext.run` لازم است چون `PrismaService` بدونِ tenant-context
   * صریحاً throw می‌کند (قانون ۱۸) — همان کاری که middlewareِ HTTP می‌کند.
   */
  const { TenantContext } = require('./dist/tenant/tenant-context');
  const { RemindersService } = require('./dist/patients/reminders.service');
  const ctx = app.get(TenantContext), reminders = app.get(RemindersService);
  globalThis.__futok = {
    tenantId,
    sync: (visitId) => ctx.run(
      { tenantId, tenantSlug: 'futok', databaseUrl: process.env.DATABASE_URL, hostname: 'localhost' },
      () => reminders.syncNextVisit(visitId, true),
    ),
  };
  process.env.E2E_DB = process.env.DATABASE_URL;
  await import('./followup-token.mjs');
} finally {
  if (app) await app.close();
  await db.$disconnect().catch(() => undefined); await ctl.$disconnect().catch(() => undefined);
  for (const s of servers) s.close();
  await tenant.close(); await control.close();
}
