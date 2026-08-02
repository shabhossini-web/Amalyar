import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ConfigService } from './config.service';
import { VERTICALS } from './verticals';
import { LEVEL } from '../common/levels';
import { MinLevel } from '../auth/min-level.decorator';
import { LevelGuard } from '../auth/level.guard';

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
