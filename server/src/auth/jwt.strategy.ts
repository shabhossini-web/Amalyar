import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { requireJwtSecret } from '../common/security';
import { TenantContext } from '../tenant/tenant-context';
import { SESSION_COOKIE, readCookie } from './session-cookie';

interface JwtPayload {
  sub: number;
  sid: string;
  level: number;
  tid: string;
}

/**
 * توکن از دو جا می‌آید و **منبعش روی درخواست ثبت می‌شود** (`req.authVia`):
 * - `Authorization: Bearer` — کلاینتِ غیرمرورگری. صریح است، پس مقدم است؛ و
 *   چون سایتِ دیگری نمی‌تواند این هدر را بدونِ CORS بفرستد، CSRF ندارد.
 * - کوکیِ HttpOnly — اپِ مرورگر. مرورگر خودش می‌فرستد؛ پس درخواستِ
 *   تغییردهنده باید نشانِ CSRF هم داشته باشد (در `JwtAuthGuard`).
 */
const bearer = ExtractJwt.fromAuthHeaderAsBearerToken();
const fromBearer = (req: Request) => {
  const t = bearer(req);
  if (t) (req as any).authVia = 'bearer';
  return t;
};
const fromCookie = (req: Request) => {
  const t = readCookie(req, SESSION_COOKIE);
  if (t) (req as any).authVia = 'cookie';
  return t;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private auth: AuthService,
    private tenantContext: TenantContext,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([fromBearer, fromCookie]),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    const tenant = this.tenantContext.require();
    if (!payload.tid || payload.tid !== tenant.tenantId) throw new UnauthorizedException();
    // کوکیِ مجموعهٔ نشست‌ها (`s`) هم با همین کلید امضا شده؛ به‌عنوانِ توکنِ دسترسی معتبر نیست.
    if (!payload.sid || !payload.sub) throw new UnauthorizedException();
    const account = await this.auth.validateSession(payload.sid, payload.sub);
    if (!account) throw new UnauthorizedException();
    return { ...account, sid: payload.sid, tenantId: tenant.tenantId, tenantSlug: tenant.tenantSlug };
  }
}
