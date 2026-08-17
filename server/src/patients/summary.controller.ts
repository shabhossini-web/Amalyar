import { Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { LevelGuard } from '../auth/level.guard';
import { MinLevel } from '../auth/min-level.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { LEVEL } from '../common/levels';
import { SummaryService } from './summary.service';
import { PortalService } from './portal.service';
import { RemindersService } from './reminders.service';

/**
 * خلاصهٔ ویزیتِ **عمومی** — با توکن، بدونِ ورود. همان قراردادِ
 * PublicIntakeController: کنترلرِ جدا تا مسیرِ بی‌گارد از خودِ فایل پیدا باشد.
 * هیچ عددِ مالی و هیچ فیلدِ بخشِ نقش‌داری برنمی‌گردد (projection در سرویس).
 */
@Controller('public')
export class PublicSummaryController {
  constructor(private summary: SummaryService, private portal: PortalService) {}

  @Get('visit-summary/:token')
  view(@Param('token') token: string) {
    return this.summary.publicView(token);
  }

  /** پروندهٔ الکترونیکِ بیمار — لینکِ دائمی، بدونِ ورود. */
  @Get('portal/:token')
  portalView(@Param('token') token: string) {
    return this.portal.publicView(token);
  }
}

/** لینک/ارسالِ خلاصه + دفترِ یادآوری‌ها — پشتِ داشبورد. */
@Controller()
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard, LevelGuard)
@Feature('dashboard')
export class SummaryController {
  constructor(
    private summary: SummaryService,
    private reminders: RemindersService,
    private portal: PortalService,
  ) {}

  /** لینکِ دائمیِ پروندهٔ الکترونیکِ بیمار. */
  @RequirePermissions('patients.read')
  @Post('patients/:id/portal-link')
  portalLink(@Param('id', ParseIntPipe) id: number) {
    return this.portal.link(id);
  }

  /** پیامکِ لینکِ پرونده به بیمار — کنشِ بیرونی. */
  @RequirePermissions('patients.write')
  @Post('patients/:id/portal-sms')
  portalSms(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.portal.sendSms(id, user);
  }

  /** ساختِ (تنبلِ) لینکِ خلاصه — برای بازکردن/چاپ/PDF توسطِ خودِ ادمین. */
  @RequirePermissions('patients.read')
  @Post('visits/:id/summary-link')
  link(@Param('id', ParseIntPipe) id: number) {
    return this.summary.link(id);
  }

  /** پیامکِ لینکِ خلاصه به بیمار — کنشِ بیرونی، پس مجوزِ نوشتن. */
  @RequirePermissions('patients.write')
  @Post('visits/:id/summary-sms')
  sms(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.summary.sendSms(id, user);
  }

  /** دفترِ یادآوری‌ها — چه چیزی کی می‌رود / رفت / نرفت. */
  @RequirePermissions('patients.read')
  @Get('reminders')
  list() {
    return this.reminders.list();
  }

  /**
   * sweepِ دستیِ همین شرکت — برای آزمون و «همین حالا بفرست»ِ مدیر.
   * workerِ سراسری همین کار را هر چند دقیقه خودش می‌کند.
   */
  @MinLevel(LEVEL.SUPER_ADMIN)
  @RequirePermissions('patients.write')
  @Post('reminders/sweep')
  sweep() {
    return this.reminders.sweep();
  }
}
