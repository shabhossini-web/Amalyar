import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { LEVEL } from '../common/levels';
import { PERMISSIONS_KEY } from './permission.decorator';

export const PERMISSION_DEFAULTS: Record<string, number> = {
  'patients.read': LEVEL.TECH,
  'patients.read_all': LEVEL.SUPERVISOR,
  'patients.create': LEVEL.TECH_ADMIN,
  'patients.update': LEVEL.SUPERVISOR,
  'patients.status': LEVEL.SUPERVISOR,
  'patients.delete': LEVEL.SUPER_ADMIN,
  // بخشِ بالینیِ پرونده (حساسیت، سابقه، بیمه، شرح‌ها) از بخشِ هویتی جداست:
  // کارشناسی که برای چینشِ کار نامِ بیمار را می‌بیند، لازم نیست سابقهٔ پزشکی‌اش را ببیند.
  'patients.clinical.read': LEVEL.TECH_ADMIN,
  'patients.clinical.write': LEVEL.TECH_ADMIN,
  // آپلودِ گزارشِ عمل کارِ خودِ کارشناس است، پس نوشتن از سطحِ کارشناس باز است؛
  // دامنه‌اش با scope محدود می‌شود (فقط بیمارانی که در مراجعه‌شان بوده).
  'documents.read': LEVEL.TECH,
  'documents.write': LEVEL.TECH,
  'documents.delete': LEVEL.ADMIN,
  'definitions.read': LEVEL.TECH,
  'definitions.manage': LEVEL.ADMIN,
  'users.manage': LEVEL.SUPER_ADMIN,
};

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

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
