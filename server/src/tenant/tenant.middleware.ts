import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContext } from './tenant-context';
import { TenantRegistryService } from './tenant-registry.service';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly registry: TenantRegistryService,
    private readonly context: TenantContext,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    if (req.path === '/api/health' || req.path.startsWith('/api/platform/')) return next();

    // فقط Host واقعی درخواست پذیرفته می‌شود؛ URL دیتابیس یا tenant id هرگز از کاربر گرفته نمی‌شود.
    const hostname = (req.headers.host ?? '').split(':')[0].trim().toLowerCase();
    const tenant =
      (hostname ? await this.registry.resolveHostname(hostname) : null) ??
      (await this.registry.resolveDevelopmentDefault());

    if (!tenant) throw new NotFoundException('شرکت برای این دامنه یافت نشد');
    this.context.run(tenant, next);
  }
}
