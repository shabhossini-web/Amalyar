import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantRequestContext {
  tenantId: string;
  tenantSlug: string;
  databaseUrl: string;
}

@Injectable()
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<TenantRequestContext>();

  run<T>(context: TenantRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  current(): TenantRequestContext | undefined {
    return this.storage.getStore();
  }

  require(): TenantRequestContext {
    const tenant = this.current();
    if (!tenant) throw new Error('Tenant context is not available for this request');
    return tenant;
  }
}
