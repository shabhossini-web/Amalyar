import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AccessService } from './access.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LevelGuard } from './level.guard';
import { FeatureGuard } from './feature.guard';
import { Feature } from './feature.decorator';
import { MinLevel } from './min-level.decorator';
import { CurrentUser } from './current-user.decorator';
import { LEVEL } from '../common/levels';

class AccessPatchDto {
  @IsOptional()
  @IsInt({ message: 'سطح باید عدد باشد' })
  @Min(1, { message: 'سطح نامعتبر است' })
  @Max(6, { message: 'سطح نامعتبر است' })
  minLevel?: number;

  @IsOptional()
  @IsBoolean({ message: 'وضعیتِ روشن/خاموش نامعتبر است' })
  enabled?: boolean;

  /**
   * نقش‌های مجاز — AND با سطح؛ آرایهٔ خالی = بدونِ قیدِ نقش.
   * ⚠️ باید در DTO اعلام شود وگرنه ValidationPipe با whitelist بی‌صدا دورش
   * می‌ریزد — همان تلهٔ همیشگیِ این مخزن. اعتبارِ کلیدها در سرویس است
   * (guardRoles) تا فهرستِ JOB_ROLES دوجا نوشته نشود.
   */
  @IsOptional()
  @IsArray({ message: 'نقش‌ها باید فهرست باشند' })
  @IsString({ each: true, message: 'نقشِ نامعتبر' })
  roles?: string[];
}

/**
 * ماتریسِ دسترسی — **تنها** مسیرِ نوشتنِ سطوحِ ماژول‌ها و مجوزها.
 *
 * ⚠️ `MinLevel(SUPER_ADMIN)` روی کلِ کنترلر است، حتی روی خواندن: خودِ ماتریس
 * نقشهٔ درهای سامانه است و نشان‌دادنش به سطحِ پایین‌تر یعنی گفتنِ «کدام در
 * ضعیف‌تر است». ماژولِ `access` هم اعلام شده تا اگر روزی لانچر یا نگهبانی
 * دنبالِ کلیدش گشت، همان یک منبع را ببیند.
 */
@Controller('access')
@UseGuards(JwtAuthGuard, FeatureGuard, LevelGuard)
@Feature('access')
@MinLevel(LEVEL.SUPER_ADMIN)
export class AccessController {
  constructor(private access: AccessService) {}

  @Get('matrix')
  matrix() {
    return this.access.matrix();
  }

  @Patch('features/:key')
  updateFeature(@Param('key') key: string, @Body() dto: AccessPatchDto, @CurrentUser() user: any) {
    return this.access.update('feature', key, dto, user);
  }

  @Patch('permissions/:key')
  updatePermission(@Param('key') key: string, @Body() dto: AccessPatchDto, @CurrentUser() user: any) {
    return this.access.update('permission', key, dto, user);
  }

  @Post('features/:key/reset')
  resetFeature(@Param('key') key: string, @CurrentUser() user: any) {
    return this.access.resetOne('feature', key, user);
  }

  @Post('permissions/:key/reset')
  resetPermission(@Param('key') key: string, @CurrentUser() user: any) {
    return this.access.resetOne('permission', key, user);
  }

  @Post('reset')
  resetAll(@CurrentUser() user: any) {
    return this.access.resetAll(user);
  }
}
