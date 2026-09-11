import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { csrfMatches, needsCsrf } from './session-cookie';

/**
 * احرازِ JWT + قفلِ CSRF.
 *
 * وقتی توکن از کوکی آمده و درخواست تغییردهنده است، هدرِ `X-CSRF-Token` باید
 * با کوکیِ خواندنیِ CSRF یکی باشد. درخواستِ Bearer و درخواست‌های خواندنی
 * (GET/HEAD/OPTIONS) از این قید معاف‌اند — اولی را سایتِ دیگر نمی‌تواند
 * بسازد، دومی چیزی را عوض نمی‌کند.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = await Promise.resolve(super.canActivate(context) as boolean | Promise<boolean>);
    if (!ok) return false;
    const req = context.switchToHttp().getRequest();
    if (needsCsrf(req) && !csrfMatches(req)) {
      throw new ForbiddenException('نشانِ امنیتیِ درخواست معتبر نیست؛ صفحه را تازه کنید و دوباره تلاش کنید');
    }
    return true;
  }
}
