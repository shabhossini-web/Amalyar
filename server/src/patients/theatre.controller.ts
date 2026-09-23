import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DISPOSITION_KEYS } from './labels';
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
 * شرحِ وضعیتِ بیمار هنگامِ ترخیص — **اجباری**.
 *
 * ⚠️ `MinLength` دارد چون ترخیصِ بی‌شرح سطری است که می‌گوید بیمار رفت و
 * نمی‌گوید در چه حالی؛ و همان سطر بعداً سندِ پرونده می‌شود. خودِ سرویس هم
 * `trim` شده‌اش را دوباره می‌سنجد (کلاینت یکی نیست).
 */
/** شرحِ عمل — خالی مجاز است (یعنی «این شرح دیگر جاری نیست»). */
class ReportDto {
  @IsString({ message: 'شرحِ عمل نامعتبر است' })
  @MaxLength(20000, { message: 'شرحِ عمل طولانی است' })
  body!: string;
}

/** «افزودن به پیش‌فرض» از میزِ اتاق — نوعِ عمل از خودِ مراجعه می‌آید، نه از کاربر. */
class OpTemplateDto {
  @IsString({ message: 'متنِ شرح نامعتبر است' })
  @MaxLength(20000, { message: 'متن بلندتر از سقفِ یک قالب است' })
  body!: string;

  @IsOptional() @IsString({ message: 'عنوان نامعتبر است' }) @MaxLength(120, { message: 'عنوان بلند است' })
  title?: string;
}

class DischargeDto {
  @IsString({ message: 'وضعیتِ بیمار هنگامِ ترخیص را بنویسید' })
  @MinLength(2, { message: 'وضعیتِ بیمار هنگامِ ترخیص را بنویسید' })
  @MaxLength(4000, { message: 'وضعیتِ هنگامِ ترخیص طولانی است' })
  condition!: string;

  /* ── بستهٔ ۶ب — تصمیمِ مالک: «توضیحات، شرحِ ترخیص و یادداشت». ──
     وضعیتِ خروج اجباری است (یک لمس)، دو متنِ دیگر اختیاری. */
  @IsIn(DISPOSITION_KEYS, { message: 'وضعیتِ خروج را انتخاب کنید (منزل، انتقال، با رضایتِ شخصی، فوت)' })
  disposition!: string;

  @IsOptional() @IsString() @MaxLength(8000, { message: 'شرحِ ترخیص طولانی است' })
  summary?: string;

  @IsOptional() @IsString() @MaxLength(2000, { message: 'یادداشتِ ترخیص طولانی است' })
  remark?: string;
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

  /* شمارشِ روزهای ماه برای نشانهٔ تقویم — همان مجوزِ دیدنِ تخته. */
  @RequirePermissions('theatre.read')
  @Get('month')
  month(@Query('year') year: string, @Query('month') month: string, @CurrentUser() user: any) {
    return this.theatre.month(Number(year), Number(month), user);
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

  @RequirePermissions('theatre.report')
  @Post('visits/:id/report')
  report(@Param('id', ParseIntPipe) id: number, @Body() dto: ReportDto, @CurrentUser() user: any) {
    return this.theatre.setReport(id, dto.body, user);
  }

  /* پیش‌فرض‌های شرحِ عمل (چیپ‌ها + «افزودن به پیش‌فرض») — `op-templates.ts`. */
  @RequirePermissions('theatre.read')
  @Get('visits/:id/op-templates')
  opTemplates(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.theatre.opTemplates(id, user);
  }

  @RequirePermissions('templates.add')
  @Post('visits/:id/op-templates')
  addOpTemplate(@Param('id', ParseIntPipe) id: number, @Body() dto: OpTemplateDto, @CurrentUser() user: any) {
    return this.theatre.addOpTemplate(id, dto, user);
  }

  /* یافته‌های حینِ عمل — همان مجوزِ شرحِ عمل، چون همان سندنویسیِ جراح است. */
  @RequirePermissions('theatre.report')
  @Post('visits/:id/findings')
  findings(@Param('id', ParseIntPipe) id: number, @Body() dto: ReportDto, @CurrentUser() user: any) {
    return this.theatre.setReport(id, dto.body, user, 'findings');
  }

  /**
   * مدرکِ همین عمل. عمداً زیرِ `theatre.read` و نه `documents.read`:
   * جراحِ داخلِ اتاق باید عکسِ MRI را ببیند بی‌آنکه دسترسیِ کلِ مدارکِ
   * پرونده را بگیرد. دامنه‌اش هم به **همان مراجعه** بسته است.
   */
  @RequirePermissions('theatre.read')
  @Get('visits/:id/documents/:documentId/file')
  async document(
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) documentId: number,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { doc, stream } = await this.theatre.openDocument(id, documentId, user);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', String(doc.size));
    res.setHeader('Content-Disposition',
      `${doc.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
    // مدرکِ پزشکی نباید در کشِ میانی بنشیند — همان قاعدهٔ مسیرِ پرونده.
    res.setHeader('Cache-Control', 'private, no-store');
    stream.pipe(res);
  }

  /* ⚠️ مجوزِ خودش را دارد نه `visits.times`: این یکی سندِ بالینیِ امضادار
     می‌نویسد، نه مهرِ ساعت. */
  @RequirePermissions('theatre.discharge')
  @Post('visits/:id/discharge')
  discharge(@Param('id', ParseIntPipe) id: number, @Body() dto: DischargeDto, @CurrentUser() user: any) {
    return this.theatre.discharge(id, dto, user);
  }
}
