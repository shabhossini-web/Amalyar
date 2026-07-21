import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContext } from '../tenant/tenant-context';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly tenantClients = new Map<string, PrismaClient>();

  constructor(private readonly tenantContext: TenantContext) {
    // این client فقط برای حفظ typeهای Prisma ساخته می‌شود و به دیتابیس عملیاتی وصل نمی‌شود.
    super({ datasources: { db: { url: process.env.DATABASE_URL || 'postgresql://invalid:invalid@127.0.0.1:1/invalid' } } });

    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (
          typeof property === 'symbol' ||
          ['tenantContext', 'tenantClients', 'client', 'onModuleDestroy'].includes(String(property))
        ) {
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
