'use strict';

require('reflect-metadata');

const assert = require('node:assert/strict');
const { UnauthorizedException } = require('@nestjs/common');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { TenantContext } = require('../dist/tenant/tenant-context');
const { WebauthnService } = require('../dist/auth/webauthn.service');

const alpha = {
  tenantId: 'tenant-alpha',
  tenantSlug: 'alpha',
  databaseUrl: 'postgresql://tenant:tenant@127.0.0.1:1/alpha_ci',
  hostname: 'alpha.amalyar.com',
};

const beta = {
  tenantId: 'tenant-beta',
  tenantSlug: 'beta',
  databaseUrl: 'postgresql://tenant:tenant@127.0.0.1:1/beta_ci',
  hostname: 'beta.amalyar.com',
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

/**
 * پس‌کی باید به دامنهٔ همان شرکت قفل باشد. اگر rpID/origin دوباره به یک دامنهٔ
 * ثابت برگردد، تأییدِ پس‌کی روی زیردامنهٔ شرکت‌ها می‌شکند و اعتبارنامه بینِ
 * شرکت‌ها مشترک می‌شود؛ این گارد همان بازگشت را می‌گیرد.
 */
function verifyWebauthnBoundary(context) {
  const service = Object.create(WebauthnService.prototype);
  service.tenantContext = context;

  const alphaRp = context.run(alpha, () => service.rp());
  const betaRp = context.run(beta, () => service.rp());

  assert.equal(alphaRp.rpID, alpha.hostname, 'rpID must be the requesting tenant hostname');
  assert.deepEqual(alphaRp.origins, [`https://${alpha.hostname}`]);
  assert.equal(betaRp.rpID, beta.hostname);
  assert.notEqual(betaRp.rpID, alphaRp.rpID, 'Tenants must never share a passkey relying party');

  // بیرونِ context (توسعهٔ محلی) نباید دامنهٔ یک شرکت را جا بیندازد.
  const fallback = service.rp();
  assert.notEqual(fallback.rpID, alpha.hostname);
  assert.notEqual(fallback.rpID, beta.hostname);
}

/**
 * خطِ آخرِ پیامکِ OTP باید به میزبانِ همان صفحه گره بخورد. اگر دوباره روی یک
 * دامنهٔ ثابت بیفتد، مرورگر بی‌صدا اتوفیل نمی‌کند و کسی متوجه نمی‌شود.
 */
async function verifyWebOtpBinding() {
  const { SmsService } = require('../dist/sms/sms.service');
  const { sanitizeWebOtpHost } = require('../dist/common/webotp');

  assert.equal(sanitizeWebOtpHost('SAMPLE2.AMALYAR.COM.'), 'sample2.amalyar.com');
  assert.equal(sanitizeWebOtpHost('tenant.amalyar.com:443'), 'tenant.amalyar.com');
  // ورودیِ نامعتبر نباید به متنِ پیامک راه پیدا کند (ضدِّ تزریق در خطِ اتصال).
  assert.equal(sanitizeWebOtpHost('bad host\n@evil.com #000000'), null);
  assert.equal(sanitizeWebOtpHost('localhost'), null);

  const service = new SmsService();
  const sentTexts = [];
  service.send = async (_phone, text) => {
    sentTexts.push(text);
    return { sent: true, stub: false };
  };

  await service.sendOtp('09120000000', '123456', 'sample2.amalyar.com');
  await service.sendOtp('09120000000', '123456', undefined);

  assert.equal(
    sentTexts[0].split('\n').pop(),
    '@sample2.amalyar.com #123456',
    'The OTP SMS must bind to the requesting host, not a fixed domain',
  );
  assert.equal(sentTexts[1].split('\n').pop(), '@amalyar.com #123456');
}

/**
 * کدِ تأییدِ حذف نباید با کدِ ورود یکی باشد و نباید بینِ شرکت‌ها قابل‌استفاده باشد.
 * اگر دامنه‌بندی کد از بین برود، یک کدِ ورودِ لو رفته می‌تواند دیتابیس حذف کند.
 */
function verifyDeletionOtpScope() {
  const { createHmac } = require('node:crypto');
  const { platformOtpScopeHash } = require('../dist/platform/platform.config');

  const secret = 'ci-only-platform-secret-with-32-characters';
  const phone = '09000000000';
  const login = platformOtpScopeHash(secret, phone, 'login');
  const deleteA = platformOtpScopeHash(secret, phone, 'tenant-delete:tenant-a');
  const deleteB = platformOtpScopeHash(secret, phone, 'tenant-delete:tenant-b');

  assert.notEqual(deleteA, login, 'A deletion code must not share the login code scope');
  assert.notEqual(deleteA, deleteB, 'A deletion code must not be reusable on another tenant');

  // دامنهٔ ورود باید دقیقاً همان مقدارِ قبلی بماند، وگرنه همهٔ نشست‌های باز باطل می‌شوند.
  assert.equal(
    login,
    createHmac('sha256', secret).update(`phone:${phone}`).digest('hex'),
    'The login scope hash must stay byte-compatible with existing sessions',
  );
}

/**
 * هر مدلِ schema باید از طریقِ tenant proxy برود. اگر مدلی جا بیفتد، بی‌سروصدا
 * به کلاینتِ پایه (آدرسِ نامعتبر) می‌خورد و خطایش «Can't reach database server»
 * می‌شود که علت را پنهان می‌کند. این گارد دقیقاً همان را می‌گیرد.
 */
function verifyEveryModelIsTenantScoped(context) {
  const { Prisma } = require('@prisma/client');
  const { PrismaService } = require('../dist/prisma/prisma.service');

  const prisma = new PrismaService(context);
  try {
    const models = Prisma.dmmf.datamodel.models.map(
      (m) => m.name.charAt(0).toLowerCase() + m.name.slice(1),
    );
    assert.ok(models.length > 5, 'dmmf باید مدل‌ها را برگرداند');

    for (const model of models) {
      assert.throws(
        () => context.run(undefined, () => prisma[model]),
        /Tenant context is not available/,
        `مدل «${model}» از tenant proxy رد نمی‌شود — به کلاینتِ پایه می‌خورد`,
      );
    }

    // دو کلاینتِ متفاوت برای دو شرکت، روی یک مدلِ دلخواه
    const a = context.run(alpha, () => prisma[models[0]]);
    const b = context.run(beta, () => prisma[models[0]]);
    assert.notStrictEqual(a, b, 'مدل‌ها نباید بینِ شرکت‌ها کلاینتِ مشترک بگیرند');
  } finally {
    prisma.onModuleDestroy().catch(() => undefined);
  }
}

/**
 * پیش‌فرضِ توسعه نباید به هیچ دامنهٔ واقعی برسد.
 *
 * ⚠️ این گارد از یک نشتِ واقعی آمد: `resolveDevelopmentDefault` تنها با
 * `NODE_ENV !== 'production'` محافظت می‌شد، پس هر Hostی که در `tenant_domains`
 * پیدا نمی‌شد بی‌سروصدا دیتابیسِ `DEFAULT_TENANT_SLUG` را می‌گرفت. با کدِ
 * قبلی، درخواستی با `Host: ghost-clinic.example.com` روی سرورِ محلی
 * ۲۰۰ و **۵۰ مراجعهٔ تنانتِ دیگر** برگرداند. حالا ۴۰۴ می‌گیرد.
 *
 * ادعا روی هر سه قفل است، چون هر کدام جدا برداشته شود نشت برمی‌گردد.
 */
async function verifyDevelopmentFallbackStaysLoopback() {
  const { TenantRegistryService } = require('../dist/tenant/tenant-registry.service');

  let lookups = 0;
  const control = {
    tenant: {
      async findUnique() {
        lookups += 1;
        // اگر این اجرا شود یعنی قفل‌ها رد شده‌اند؛ DSN بی‌ربط است.
        return null;
      },
    },
  };
  const registry = new TenantRegistryService(control);

  const env = { ...process.env };
  try {
    process.env.DEFAULT_TENANT_SLUG = 'alpha';
    process.env.NODE_ENV = 'development';

    for (const host of ['beta.amalyar.com', 'reyteb.amalyar.com', 'evil.example', '127.0.0.1.nip.io']) {
      assert.equal(
        await registry.resolveDevelopmentDefault(host),
        null,
        `میزبانِ واقعی «${host}» هرگز نباید به تنانتِ پیش‌فرض بیفتد`,
      );
    }
    assert.equal(lookups, 0, 'برای میزبانِ غیرِloopback حتی نباید تنانتِ پیش‌فرض را جست‌وجو کند');

    // loopback هنوز کار می‌کند — وگرنه توسعهٔ محلی می‌شکند.
    for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '::1', '']) {
      await registry.resolveDevelopmentDefault(host);
    }
    assert.equal(lookups, 5, 'میزبانِ loopback باید همچنان به پیش‌فرضِ توسعه برسد');

    // قفلِ دوم: بدونِ DEFAULT_TENANT_SLUG هیچ‌چیز، حتی روی loopback.
    delete process.env.DEFAULT_TENANT_SLUG;
    assert.equal(await registry.resolveDevelopmentDefault('localhost'), null);

    // قفلِ اول: در production حتی با اسلاگِ ست‌شده و روی loopback.
    process.env.DEFAULT_TENANT_SLUG = 'alpha';
    process.env.NODE_ENV = 'production';
    assert.equal(await registry.resolveDevelopmentDefault('localhost'), null);
    assert.equal(lookups, 5, 'هیچ‌کدام از دو حالتِ آخر نباید به دیتابیسِ کنترل برسد');
  } finally {
    process.env = env;
  }
}

async function main() {
  const context = new TenantContext();
  await verifyJwtBoundary(context);
  await verifyPrismaBoundary(context);
  verifyWebauthnBoundary(context);
  await verifyWebOtpBinding();
  verifyDeletionOtpScope();
  verifyEveryModelIsTenantScoped(context);
  await verifyDevelopmentFallbackStaysLoopback();
  process.stdout.write('tenant isolation boundaries verified\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
