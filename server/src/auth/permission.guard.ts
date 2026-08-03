import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { LEVEL } from '../common/levels';
import { PERMISSIONS_KEY } from './permission.decorator';
import { PERMISSION_DEFAULT_LEVELS } from './access-registry';

/**
 * پیش‌فرضِ سطحِ هر مجوز.
 *
 * ⚠️ فهرست دیگر این‌جا نوشته نمی‌شود: هر مجوز در `access-registry.ts` با
 * **برچسبِ فارسی** اعلام می‌شود و این نگاشت از رویش ساخته می‌شود. دلیلش این
 * است که تا دیروز مجوزها فقط یک `Record<string, number>` بودند — مدیر نه
 * می‌دید چه مجوزهایی هست، نه می‌فهمید `stock.consume` یعنی چه، و تغییرشان
 * فقط با deploy ممکن بود. برگرداندنِ یک فهرستِ بی‌برچسب به این‌جا یعنی
 * برگشتن به همان وضع؛ نگهبانِ CI جلویش را می‌گیرد.
 */
export const PERMISSION_DEFAULTS: Record<string, number> = PERMISSION_DEFAULT_LEVELS;

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  /**
   * ⚠️ عمداً **بدونِ کش**: سطحِ هر مجوز در همین درخواست از DB خوانده می‌شود.
   * کشِ چنددقیقه‌ای یعنی مدیری که همین الان دری را بست، تا انقضای کش باور کند
   * بسته است در حالی که باز است. برای یک تغییرِ امنیتی، «به‌نظر انجام‌شده»
   * بدترین حالتِ ممکن است. هزینهٔ یک `findUnique` روی کلیدِ یکتا ناچیز است؛
   * هزینهٔ درِ باز نه.
   */
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const user = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('ابتدا وارد شوید');
    if ((user.level ?? 0) >= LEVEL.SUPER_ADMIN) return true;

    for (const key of required) {
      const fallback = PERMISSION_DEFAULTS[key];
      if (!fallback) throw new ForbiddenException('مجوز این عملیات تعریف نشده است');
      const row = await this.prisma.permission.findUnique({ where: { key } });
      const enabled = row?.enabled ?? true;
      const minLevel = row?.minLevel ?? fallback;
      if (!enabled || (user.level ?? 0) < minLevel) {
        throw new ForbiddenException('اجازهٔ انجام این عملیات را ندارید');
      }
    }
    return true;
  }
}
