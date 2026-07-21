import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContext } from '../tenant/tenant-context';

const TENANT_PRISMA_PROPERTIES = new Set([
  'account',
  'surgeon',
  'hospital',
  'webauthnCredential',
  'session',
  'feature',
  'permission',
  'auditEvent',
  'patient',
  'visit',
  'otpCode',
  '$transaction',
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
]);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly tenantClients = new Map<string, PrismaClient>();

  constructor(private readonly tenantContext: TenantContext) {
    // This base client preserves generated Prisma types but is never used for tenant data.
    super({ datasources: { db: { url: process.env.DATABASE_URL || 'postgresql://invalid:invalid@127.0.0.1:1/invalid' } } });

    return new Proxy(this, {
      get: (target, property, receiver) => {
        // Nest probes properties such as "then" while constructing providers. Only actual
        // Prisma delegates/operations may require request-scoped tenant context.
        if (typeof property === 'symbol' || !TENANT_PRISMA_PROPERTIES.has(String(property))) {
          const own = Reflect.get(target, property, receiver);
          return typeof own === 'function' ? own.bind(target) : own;
        }
        const client = target.client();
        const value = (client as any)[property];
        return typeof value === 'function' ? value.bind(client) : value;
      },
    });
  }

  private client(): PrismaClient {
    const tenant = this.tenantContext.require();
    let client = this.tenantClients.get(tenant.tenantId);
    if (!client) {
      client = new PrismaClient({ datasources: { db: { url: tenant.databaseUrl } } });
      this.tenantClients.set(tenant.tenantId, client);
    }
    return client;
  }

  async onModuleDestroy() {
    await Promise.all([...this.tenantClients.values()].map((client) => client.$disconnect()));
    this.tenantClients.clear();
  }
}
