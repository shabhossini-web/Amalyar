import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { FEATURE_KEY } from './feature.decorator';
import { FEATURE_DEFAULTS } from '../features/features.service';
import { LEVEL } from '../common/levels';

/**
 * گاردِ دسترسیِ داینامیک — سطحِ لازم را از جدولِ features می‌خواند (منبعِ حقیقت DB).
 * ردیفِ غایب → پیش‌فرضِ FEATURE_DEFAULTS. سوپرادمین همیشه عبور می‌کند.
 * enabled=false یعنی ماژول (مثلاً در پلن/لایسنسِ مشتری) خاموش است.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!key) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('ابتدا وارد شوید');
    if ((user.level ?? 0) >= LEVEL.SUPER_ADMIN) return true;

    const row = await this.prisma.feature.findUnique({ where: { key } });
    const minLevel = row?.minLevel ?? FEATURE_DEFAULTS[key]?.minLevel ?? LEVEL.SUPER_ADMIN;
    const enabled = row?.enabled ?? true;
    if (!enabled) throw new ForbiddenException('این ماژول غیرفعال است');
    if ((user.level ?? 0) < minLevel) {
      throw new ForbiddenException('دسترسیِ کافی برای این بخش ندارید');
    }
    /* نقش — **AND** با سطح: دو نفرِ هم‌سطح می‌توانند دسترسیِ متفاوت داشته
       باشند. آرایهٔ خالی یعنی قیدی نیست؛ سوپرادمین بالاتر عبور کرده. */
    const roles = Array.isArray(row?.roles) ? (row!.roles as string[]) : [];
    if (roles.length && !roles.includes(user.jobRole ?? '')) {
      throw new ForbiddenException('این بخش برای نقشِ شغلیِ شما نیست');
    }
    return true;
  }
}
