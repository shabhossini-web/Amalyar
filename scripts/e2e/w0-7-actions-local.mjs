/**
 * Disposable real Prisma + PGlite database for W0.7; no external services.
 *
 * ⚠️ عمداً Nest را بالا نمی‌آورد. این سوییت سرویس‌ها را **مستقیم** می‌سازد
 * (اسکن/ترمیم HTTP ندارد که آزموده شود) و هر اتصالِ اضافی روی `pglite-server`
 * گران است — با بوتِ کاملِ اپ، ساختِ ردیف‌های آزمون با P1001 می‌مرد.
 */
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
const tenant = new PGlite();
for (const dir of (await readdir(root + 'server/prisma/migrations')).sort()) {
  if (dir.startsWith('20')) await tenant.exec(await readFile(root + 'server/prisma/migrations/' + dir + '/migration.sql', 'utf8'));
}
const server = createServer(tenant);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `postgresql://postgres:postgres@127.0.0.1:${server.address().port}/template1?connection_limit=1&statement_cache_size=0&connect_timeout=30`;
Object.assign(process.env, { DATABASE_URL: url, E2E_DB: url, NODE_ENV: 'test' });
try {
  await import('./w0-7-reminder-actions.mjs');
} finally {
  server.close();
  await tenant.close();
}
