import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TheatreService } from './theatre.service';

class CheckDto {
  @IsString() @MaxLength(30, { message: 'مرحله نامعتبر است' }) stage!: string;
  @IsString() @MaxLength(30, { message: 'بند نامعتبر است' }) key!: string;
  @IsBoolean({ message: 'وضعیتِ تیک نامعتبر است' }) checked!: boolean;
}

/**
 * **نمای اتاقِ عمل** — یک عمل، یک صفحه، در لحظه.
 *
 * ⚠️ ماژولِ خودش (`theatre`) دارد و نه گیتِ `dashboard`: پرستار و کارشناسی که
 * داخلِ اتاق ایستاده‌اند سطحِ ۲ هستند و نباید برای دیدنِ چک‌لیستِ ایمنی دسترسیِ
 * مالیِ داشبورد بگیرند. همان استدلالِ `FrontDeskController`.
 *
 * ⚠️ **ساعت با مجوزِ موجودِ `visits.times` نوشته می‌شود، نه یک مجوزِ تازه.**
 * دقیقاً همان کاری است که `tech/visits/:id/times` می‌کند؛ مجوزِ دوم برای یک
 * عمل یعنی روزی یکی‌شان از قلم می‌افتد و کاربر در یک صفحه می‌تواند و در
 * صفحهٔ دیگر نه.
 */
@Controller('theatre')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('theatre')
export class TheatreController {
  constructor(private theatre: TheatreService) {}

  @RequirePermissions('theatre.read')
  @Get('day')
  day(@Query('date') date: string, @CurrentUser() user: any) {
    return this.theatre.day(date, user);
  }

  @RequirePermissions('theatre.read')
  @Get('visits/:id')
  card(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.theatre.card(id, user);
  }

  @RequirePermissions('theatre.checklist')
  @Post('visits/:id/check')
  check(@Param('id', ParseIntPipe) id: number, @Body() dto: CheckDto, @CurrentUser() user: any) {
    return this.theatre.setCheck(id, dto.stage, dto.key, dto.checked, user);
  }

  @RequirePermissions('visits.times')
  @Post('visits/:id/start')
  start(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.theatre.stamp(id, 'start', user);
  }

  @RequirePermissions('visits.times')
  @Post('visits/:id/finish')
  finish(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.theatre.stamp(id, 'finish', user);
  }
}
