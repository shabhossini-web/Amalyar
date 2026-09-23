import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ConfigService } from './config.service';
import { VERTICALS } from './verticals';
import { LEVEL } from '../common/levels';
import { MinLevel } from '../auth/min-level.decorator';
import { LevelGuard } from '../auth/level.guard';

/**
 * نوعِ نصب + بستهٔ خدمات. ⚠️ هر دو فیلد اعلام شده‌اند: `ValidationPipe` با
 * `whitelist` فیلدِ نااعلام را **بی‌صدا** دور می‌ریزد و درخواست با بستهٔ خالی
 * به سرویس می‌رسید. قاعدهٔ «مطب بی‌خدمت / شرکت دست‌کم یک خدمت» در `profileError`
 * است (یک‌جا، فارسی)، نه این‌جا.
 */
class ProfileDto {
  @IsIn(['clinic', 'company'], { message: 'نوعِ نصب باید «مطب / کلینیک» یا «شرکتی» باشد' })
  kind!: string;

  @IsArray({ message: 'بستهٔ خدمات باید فهرست باشد' })
  @ArrayMaxSize(10, { message: 'بستهٔ خدمات بیش از حد بلند است' })
  @IsIn(['ionm', 'implant'], { each: true, message: 'خدمتِ انتخاب‌شده نامعتبر است' })
  services!: string[];
}

class VerticalDto {
  @IsIn(Object.keys(VERTICALS), { message: 'حوزهٔ کاری نامعتبر است' })
  vertical!: string;
}

@Controller('config')
@UseGuards(JwtAuthGuard)
export class ConfigController {
  constructor(private config: ConfigService) {}

  /// همهٔ کاربران می‌خوانند: واژگانِ رابط از همین می‌آید.
  @Get()
  get() {
    return this.config.get();
  }

  /** پیش‌نمایشِ اثرِ تغییرِ پروفایل — بی‌هیچ نوشتنی (ماژول‌ها، لینک‌های خدمتِ برداشته‌شده، واژگان). */
  @UseGuards(LevelGuard)
  @MinLevel(LEVEL.SUPER_ADMIN)
  @Post('profile/preview')
  previewProfile(@Body() dto: ProfileDto) {
    return this.config.previewProfile(dto.kind, dto.services);
  }

  @UseGuards(LevelGuard)
  @MinLevel(LEVEL.SUPER_ADMIN)
  @Patch('profile')
  setProfile(@Body() dto: ProfileDto, @CurrentUser() user: any) {
    return this.config.setProfile(dto.kind, dto.services, user);
  }

  @UseGuards(LevelGuard)
  @MinLevel(LEVEL.SUPER_ADMIN)
  @Patch('vertical')
  setVertical(@Body() dto: VerticalDto, @CurrentUser() user: any) {
    return this.config.setVertical(dto.vertical, user);
  }

  // ⚠️ نوشتنِ نامِ برند عمداً این‌جا نیست: `brand_name` یک تنظیمِ معمولی است و
  // نویسنده‌اش `PATCH /settings` است. دو مسیرِ نوشتن برای یک کلید یعنی یکی‌شان
  // کش را باطل نکند و صفحه مقدارِ کهنه نشان دهد.
}
