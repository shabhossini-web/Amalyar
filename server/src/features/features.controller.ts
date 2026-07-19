import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { FeaturesService } from './features.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LevelGuard } from '../auth/level.guard';
import { MinLevel } from '../auth/min-level.decorator';
import { LEVEL } from '../common/levels';

class FeaturePatchDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  minLevel?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

@Controller('features')
@UseGuards(JwtAuthGuard)
export class FeaturesController {
  constructor(private features: FeaturesService) {}

  /// همهٔ کاربرانِ واردشده — لانچر از همین گیت می‌شود
  @Get()
  list() {
    return this.features.list();
  }

  @UseGuards(LevelGuard)
  @MinLevel(LEVEL.SUPER_ADMIN)
  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: FeaturePatchDto) {
    return this.features.update(key, dto);
  }

  @UseGuards(LevelGuard)
  @MinLevel(LEVEL.SUPER_ADMIN)
  @Post('reset')
  reset() {
    return this.features.reset();
  }
}
