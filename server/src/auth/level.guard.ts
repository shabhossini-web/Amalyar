import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MIN_LEVEL_KEY } from './min-level.decorator';

@Injectable()
export class LevelGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const min = this.reflector.getAllAndOverride<number>(MIN_LEVEL_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!min) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || (user.level ?? 0) < min) {
      throw new ForbiddenException('دسترسیِ کافی برای این بخش ندارید');
    }
    return true;
  }
}
