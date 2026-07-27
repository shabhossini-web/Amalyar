import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantContext } from '../tenant/tenant-context';

/**
 * مدل‌ها از خودِ schema خوانده می‌شوند، نه از یک فهرستِ دستی.
 *
 * ⚠️ درسِ گران: قبلاً این فهرست hardcode بود و هر مدلِ جدید که یادمان می‌رفت
 * اضافه کنیم، بی‌سروصدا از proxy رد می‌شد و به کلاینتِ پایه (آدرسِ نامعتبر)
 * می‌خورد. خطایش «Can't reach database server» بود که هیچ ربطی به علتِ واقعی
 * نداشت، و TypeScript هم نمی‌توانست بگیردش چون فهرست رشته‌ای و زمان‌اجراست.
 */
const MODEL_DELEGATES = new Set(
  Prisma.dmmf.datamodel.models.map((m) => m.name.charAt(0).toLowerCase() + m.name.slice(1)),
);

const TENANT_OPERATIONS = new Set([
  '$transaction',
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
]);

const isTenantScoped = (property: string) =>
  MODEL_DELEGATES.has(property) || TENANT_OPERATIONS.has(property);

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
        if (typeof property === 'symbol' || !isTenantScoped(String(property))) {
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
