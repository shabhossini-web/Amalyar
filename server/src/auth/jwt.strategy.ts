import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';
import { requireJwtSecret } from '../common/security';

interface JwtPayload {
  sub: number;
  sid: string;
  level: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private auth: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    const account = await this.auth.validateSession(payload.sid, payload.sub);
    if (!account) throw new UnauthorizedException();
    return { ...account, sid: payload.sid };
  }
}
