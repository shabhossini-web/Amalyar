import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import type { TenantAccess } from './tenant-access';

export interface TenantRequestContext {
  tenantId: string;
  tenantSlug: string;
  tenantName?: string;
  databaseUrl: string;
  /** میزبانِ واقعیِ همین درخواست — مبنای rpIDِ پس‌کی و هاستِ WebOTP. */
  hostname: string;
  /** چرخهٔ عمرِ تجاری (معلق/دمو/مهلت) — یک‌بار در میان‌افزار حساب شده؛ `/config` و بنر همین را می‌خوانند. */
  access?: TenantAccess;
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
