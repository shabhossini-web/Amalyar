'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { UnauthorizedException } = require('@nestjs/common');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { TenantContext } = require('../dist/tenant/tenant-context');

const alpha = {
  tenantId: 'tenant-alpha',
  tenantSlug: 'alpha',
  databaseUrl: 'postgresql://tenant:tenant@127.0.0.1:1/alpha_ci',
};

const beta = {
  tenantId: 'tenant-beta',
  tenantSlug: 'beta',
  databaseUrl: 'postgresql://tenant:tenant@127.0.0.1:1/beta_ci',
};

async function verifyJwtBoundary(context) {
  let sessionLookups = 0;
  const strategy = Object.create(JwtStrategy.prototype);
  strategy.tenantContext = context;
  strategy.auth = {
    async validateSession(sid, sub) {
      sessionLookups += 1;
      assert.equal(sid, 'session-alpha');
      assert.equal(sub, 7);
      return { id: sub, status: 'active' };
    },
  };

  await assert.rejects(
    () =>
      context.run(beta, () =>
        strategy.validate({
          sub: 7,
          sid: 'session-alpha',
          level: 6,
          tid: alpha.tenantId,
        }),
      ),
    (error) => error instanceof UnauthorizedException && error.getStatus() === 401,
    'A token issued for Alpha must be rejected in the Beta tenant context',
  );
  assert.equal(
    sessionLookups,
    0,
    'A cross-tenant token must be rejected before querying the current tenant database',
  );

  const account = await context.run(alpha, () =>
    strategy.validate({
      sub: 7,
      sid: 'session-alpha',
      level: 6,
      tid: alpha.tenantId,
    }),
  );
  assert.equal(sessionLookups, 1);
  assert.equal(account.tenantId, alpha.tenantId);
  assert.equal(account.tenantSlug, alpha.tenantSlug);

  await assert.rejects(
    () =>
      strategy.validate({
        sub: 7,
        sid: 'session-alpha',
        level: 6,
        tid: alpha.tenantId,
      }),
    /Tenant context is not available/,
    'JWT validation must fail closed outside a resolved tenant request',
  );
}

async function verifyPrismaBoundary(context) {
  const prisma = new PrismaService(context);
  try {
    assert.throws(
      () => prisma.client(),
      /Tenant context is not available/,
      'Prisma must fail closed when no tenant has been resolved',
    );

    const alphaClient = context.run(alpha, () => prisma.client());
    const alphaClientAgain = context.run(alpha, () => prisma.client());
    const betaClient = context.run(beta, () => prisma.client());

    assert.strictEqual(
      alphaClientAgain,
      alphaClient,
      'The same tenant should reuse its own cached Prisma client',
    );
    assert.notStrictEqual(
      betaClient,
      alphaClient,
      'Different tenants must never share a Prisma client/database route',
    );
  } finally {
    await prisma.onModuleDestroy();
  }
}

async function main() {
  const context = new TenantContext();
  await verifyJwtBoundary(context);
  await verifyPrismaBoundary(context);
  process.stdout.write('tenant isolation boundaries verified\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
