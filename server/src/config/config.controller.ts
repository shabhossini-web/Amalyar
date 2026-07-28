import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
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

class BrandDto {
  @IsOptional() @IsString() @MaxLength(60, { message: 'نامِ برند طولانی است' })
  brandName?: string;
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

  @UseGuards(LevelGuard)
  @MinLevel(LEVEL.SUPER_ADMIN)
  @Patch('brand')
  setBrand(@Body() dto: BrandDto, @CurrentUser() user: any) {
    return this.config.setBrandName(dto.brandName ?? null, user);
  }
}
