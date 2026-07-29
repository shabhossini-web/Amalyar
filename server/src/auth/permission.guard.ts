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
  // ثبتِ ساعتِ عمل کارِ کسی است که سرِ عمل حاضر است — کارشناس. جدا از
  // patients.update نگه داشته شده تا این اجازه، اجازهٔ ویرایشِ مالی نشود.
  'visits.times': LEVEL.TECH,
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
  // مالی از بالینی جداست: سوپروایزری که وضعیتِ عمل را می‌بندد لازم نیست
  // صورت‌حساب را ببیند، و حسابدار لازم نیست سابقهٔ پزشکی را.
  'billing.read': LEVEL.SUPERVISOR,
  'billing.write': LEVEL.ADMIN,
  // انبار کارِ روزمرهٔ کارشناس و انباردار است نه کارِ مدیر، پس نوشتنش پایین‌تر
  // از مالی است. ولی انبارگردانی جداست: با یک عدد موجودیِ هر لاتی بازنویسی
  // می‌شود و اختلافش دیگر قابلِ ردیابی نیست — آن یکی سطحِ سوپروایزر می‌خواهد.
  'inventory.read': LEVEL.TECH,
  'inventory.write': LEVEL.TECH_ADMIN,
  'inventory.adjust': LEVEL.SUPERVISOR,
  'definitions.read': LEVEL.TECH,
  'definitions.manage': LEVEL.ADMIN,
  'users.manage': LEVEL.SUPER_ADMIN,
  // وارد کردنِ دادهٔ سامانهٔ قبلی کلِ دیتابیسِ شرکت را دست می‌زند.
  'import.run': LEVEL.SUPER_ADMIN,
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
