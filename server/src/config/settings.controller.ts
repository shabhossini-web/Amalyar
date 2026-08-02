import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsNotEmptyObject, IsObject } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LevelGuard } from '../auth/level.guard';
import { MinLevel } from '../auth/min-level.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { LEVEL } from '../common/levels';
import { SettingsService } from './settings.service';

class SettingsPatchDto {
  /**
   * شکلِ آزاد است چون کلیدها در رجیستری‌اند نه در DTO — ولی **اعتبارسنجی
   * حذف نشده**، فقط جایش عوض شده: سرویس هر کلیدِ نااعلام را رد می‌کند و هر
   * مقدار را با نوعِ اعلام‌شده‌اش می‌سنجد.
   */
  @IsObject({ message: 'بدنهٔ درخواست نامعتبر است' })
  @IsNotEmptyObject({}, { message: 'چیزی برای ذخیره نیست' })
  values!: Record<string, unknown>;
}

/** تنظیماتِ اختصاصیِ همین شرکت. */
@Controller('settings')
@UseGuards(JwtAuthGuard, LevelGuard)
export class SettingsController {
  constructor(private settings: SettingsService) {}

  /// خواندن برای مدیر باز است: بیشترِ این‌ها روی اسنادِ چاپی دیده می‌شوند.
  @MinLevel(LEVEL.ADMIN)
  @Get()
  all() {
    return this.settings.all();
  }

  @MinLevel(LEVEL.SUPER_ADMIN)
  @Patch()
  update(@Body() dto: SettingsPatchDto, @CurrentUser() user: any) {
    return this.settings.update(dto.values, user);
  }
}
