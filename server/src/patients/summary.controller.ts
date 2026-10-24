import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
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
  list(@Query('patientId') patientId?: string) {
    return this.reminders.list(patientId ? Number(patientId) : undefined);
  }

  /**
   * عیب‌یابیِ پیامک — گزارشِ **متنیِ فارسی** (نه JSON) تا مالک همان را از روی گوشی
   * باز کند، بخواند و بفرستد: خطِ زمانیِ هر تلاشِ ارسال، «ارسالِ دوباره»های دستی و زمانِ
   * روشن‌شدنِ سرور. متنِ پیام و شمارهٔ بیمار در آن نیست؛ باز هم فقط برای ادمین به بالا.
   */
  @MinLevel(LEVEL.ADMIN)
  @RequirePermissions('patients.read')
  @Get('reminders/diagnostics')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  diagnostics() {
    return this.reminders.diagnostics();
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

  /**
   * اقدامِ تک‌ردیفی (W0.7/U10) — تا امروز تنها اهرم «sweepِ همه» بود.
   *
   * ⚠️ سطحش عمداً **سوپرادمین نیست** (برخلافِ sweep): sweep کلِ صف را تکان
   * می‌دهد، ولی «این یکی را دوباره بفرست» کارِ روزمرهٔ همان کسی است که دفتر را
   * می‌بیند. گاردِ واقعی در سرویس است: پیامِ **فرستاده‌شده** نه دوباره می‌رود
   * نه لغو می‌شود.
   */
  @RequirePermissions('patients.write')
  @Post('reminders/:id/retry')
  retryOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.reminders.retry(id, user);
  }

  /**
   * «کدام کلمه فیلتر شد؟» — پیامِ آزمایشی فقط به موبایلِ **تأییدشدهٔ خودِ کاربر** (هرگز بیمار). `info` پیش از
   * شروع می‌گوید به کدام شماره و چند آزمایش مانده؛ `filter-probe` یک آزمایش می‌فرستد؛ `replace-word` کلمه را در
   * فهرستِ جایگزینیِ مطب می‌گذارد و پیام‌های گیرکرده را دوباره می‌فرستد.
   */
  @RequirePermissions('patients.write')
  @Get('reminders/filter-probe/info')
  probeInfo(@CurrentUser() user: any) {
    return this.reminders.filterProbeInfo(user);
  }

  @RequirePermissions('patients.write')
  @Post('reminders/replace-word')
  replaceWord(@Body() dto: any, @CurrentUser() user: any) {
    return this.reminders.replaceWord(dto ?? {}, user);
  }

  @RequirePermissions('patients.write')
  @Post('reminders/:id/filter-probe')
  filterProbe(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: any) {
    return this.reminders.filterProbe(id, dto ?? {}, user);
  }

  @RequirePermissions('patients.write')
  @Post('reminders/:id/cancel')
  cancelOne(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: any) {
    return this.reminders.cancel(id, user, typeof dto?.reason === 'string' ? dto.reason : undefined);
  }
}
