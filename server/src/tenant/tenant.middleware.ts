import { Injectable, NestMiddleware, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContext } from './tenant-context';
import { TenantRegistryService } from './tenant-registry.service';
import { TenantMigratorService } from './tenant-migrator.service';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly registry: TenantRegistryService,
    private readonly context: TenantContext,
    private readonly migrator: TenantMigratorService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    if (req.path === '/api/health' || req.path.startsWith('/api/platform/')) return next();

    // فقط Host واقعی درخواست پذیرفته می‌شود؛ URL دیتابیس یا tenant id هرگز از کاربر گرفته نمی‌شود.
    const hostname = (req.headers.host ?? '').split(':')[0].trim().toLowerCase();
    const tenant =
      (hostname ? await this.registry.resolveHostname(hostname) : null) ??
      /* ⚠️ میزبان به پیش‌فرض **پاس داده می‌شود** — بدونِ آن، بازگشتِ توسعه
         نمی‌تواند دامنهٔ واقعی را از loopback جدا کند و هر Hostِ ناشناخته
         دیتابیسِ تنانتِ پیش‌فرض را می‌گرفت. */
      (await this.registry.resolveDevelopmentDefault(hostname));

    if (!tenant) throw new NotFoundException('شرکت برای این دامنه یافت نشد');

    // دیتابیسی که migrationش اعمال نشده، schemaاش با کدِ در حالِ اجرا نمی‌خواند:
    // بعضی endpointها کار می‌کنند و بعضی ۵۰۰ می‌دهند، و کاربر صفحهٔ ناقصِ
    // بی‌توضیح می‌بیند. یک پیامِ روشن بهتر از آن آشفتگی است.
    if (this.migrator.isBroken(tenant.tenantSlug)) {
      throw new ServiceUnavailableException(
        'به‌روزرسانیِ دیتابیسِ این شرکت ناتمام مانده است؛ لطفاً با پشتیبانی تماس بگیرید.',
      );
    }
    // میزبانِ درخواست همراهِ context می‌رود تا سرویس‌های وابسته به دامنه
    // (پس‌کی و WebOTP) به‌جای یک دامنهٔ ثابت، دامنهٔ همان شرکت را ببینند.
    this.context.run({ ...tenant, hostname }, next);
  }
}
