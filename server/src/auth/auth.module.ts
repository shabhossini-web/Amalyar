import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { WebauthnService } from './webauthn.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { requireJwtSecret } from '../common/security';
import { RateLimitService } from '../common/rate-limit.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: requireJwtSecret(),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, WebauthnService, JwtStrategy, RateLimitService],
  exports: [AuthService],
})
export class AuthModule {}
