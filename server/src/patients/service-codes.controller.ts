import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsString, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { LevelGuard } from '../auth/level.guard';
import { MinLevel } from '../auth/min-level.decorator';
import { LEVEL } from '../common/levels';
import { SECTORS, ServiceCodesService } from './service-codes.service';

class TariffDto {
  @Matches(/^\d{4}$/, { message: 'سال باید چهار رقم باشد' })
  year!: string;

  @IsIn(SECTORS as unknown as string[], { message: 'بخشِ تعرفه نامعتبر است' })
  sector!: string;

  @Type(() => Number) @IsInt({ message: 'ضریب باید عددِ صحیح باشد' }) @Min(0)
  professional!: number;

  @Type(() => Number) @IsInt({ message: 'ضریب باید عددِ صحیح باشد' }) @Min(0)
  technical!: number;

  @Type(() => Number) @IsInt({ message: 'ضریب باید عددِ صحیح باشد' }) @Min(0)
  anesthesia!: number;
}

/**
 * کتابِ ارزش نسبی و ضریبِ ریالی.
 *
 * جستجو با همان مجوزِ تعاریف پایه است (هرکس فرم پر می‌کند باید کد پیدا کند)،
 * ولی وارد کردنِ کتاب و تعیینِ ضریب کارِ سوپرادمین است.
 */
@Controller('service-codes')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ServiceCodesController {
  constructor(private codes: ServiceCodesService) {}

  @RequirePermissions('definitions.read')
  @Get()
  search(@Query('q') q?: string) {
    return this.codes.search(q);
  }

  @RequirePermissions('definitions.read')
  @Get('status')
  status() {
    return this.codes.count();
  }

  @RequirePermissions('definitions.read')
  @Get('price')
  price(@Query('code') code: string, @Query('year') year?: string, @Query('sector') sector?: string) {
    return this.codes.priceOf(code, year, sector || 'private');
  }

  @UseGuards(LevelGuard)
  @MinLevel(LEVEL.SUPER_ADMIN)
  @Post('import')
  import() {
    return this.codes.importCatalog();
  }

  @RequirePermissions('definitions.read')
  @Get('tariffs')
  tariffs() {
    return this.codes.tariffs();
  }

  @UseGuards(LevelGuard)
  @MinLevel(LEVEL.SUPER_ADMIN)
  @Post('tariffs')
  setTariff(@Body() dto: TariffDto) {
    return this.codes.setTariff(dto);
  }
}
