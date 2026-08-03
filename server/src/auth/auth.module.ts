import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { WebauthnService } from './webauthn.service';
import { AuthController } from './auth.controller';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { JwtStrategy } from './jwt.strategy';
import { LevelGuard } from './level.guard';
import { FeatureGuard } from './feature.guard';
import { requireJwtSecret } from '../common/security';
import { RateLimitService } from '../common/rate-limit.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: requireJwtSecret(),
    }),
  ],
  controllers: [AuthController, AccessController],
  providers: [
    AuthService,
    WebauthnService,
    JwtStrategy,
    RateLimitService,
    AccessService,
    // گاردها این‌جا provider می‌شوند چون با `@UseGuards(Class)` نمونه‌شان را
    // خودِ Nest از همین ماژول می‌سازد و به Prisma/Reflector نیاز دارند.
    LevelGuard,
    FeatureGuard,
  ],
  exports: [AuthService],
})
export class AuthModule {}
