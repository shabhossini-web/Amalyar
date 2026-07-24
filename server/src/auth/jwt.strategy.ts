import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';
import { requireJwtSecret } from '../common/security';
import { TenantContext } from '../tenant/tenant-context';

interface JwtPayload {
  sub: number;
  sid: string;
  level: number;
  tid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private auth: AuthService,
    private tenantContext: TenantContext,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    const tenant = this.tenantContext.require();
    if (!payload.tid || payload.tid !== tenant.tenantId) throw new UnauthorizedException();
    const account = await this.auth.validateSession(payload.sid, payload.sub);
    if (!account) throw new UnauthorizedException();
    return { ...account, sid: payload.sid, tenantId: tenant.tenantId, tenantSlug: tenant.tenantSlug };
  }
}
