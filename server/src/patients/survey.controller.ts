import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SurveyService } from './survey.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { toDateValue } from '../common/jalali';

class SourceCreateDto {
  @IsString() @MinLength(2, { message: 'نام کوتاه است' }) @MaxLength(60) name!: string;
  @IsOptional() @IsBoolean() asksWho?: boolean;
  @IsOptional() @IsInt() sort?: number;
}
class SourcePatchDto {
  @IsOptional() @IsString() @MinLength(2, { message: 'نام کوتاه است' }) @MaxLength(60) name?: string;
  @IsOptional() @IsBoolean() asksWho?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sort?: number;
}
class SubmitDto {
  /** ⚠️ بدونِ `@IsObject` این فیلد را `ValidationPipe` بی‌صدا دور می‌ریزد. */
  @IsObject({ message: 'پاسخ‌ها نامعتبرند' }) answers!: Record<string, any>;
}

/**
 * مسیرهای **عمومی** — بدونِ ورود.
 *
 * ⚠️ عمداً کنترلرِ جدا و بدونِ هیچ گاردی، مثلِ `PublicIntakeController`. اگر
 * این‌ها را با مسیرهای ادمین در یک کلاس می‌گذاشتیم، یک `@UseGuards` روی کلاس
 * کافی بود تا بیمار پشتِ دیوارِ لاگین بماند — و کسی تا شکایتِ مشتری متوجه
 * نمی‌شد.
 */
@Controller('public')
export class PublicSurveyController {
  constructor(private survey: SurveyService) {}

  /**
   * کانال‌های آشنایی برای فرمِ ثبت‌نامِ عمومی.
   *
   * ⚠️ فقط `id` و `name` و `asksWho` — نه شمارنده‌ی بیماران. تعدادِ بیمارِ هر
   * کانال دادهٔ تجاریِ شرکت است و روی یک صفحهٔ بی‌احراز جایی ندارد.
   */
  @Get('referral-sources')
  async sources() {
    const rows = await this.survey.listSources(false);
    return rows.map((r) => ({ id: r.id, name: r.name, asksWho: r.asksWho }));
  }

  @Get('survey/:token')
  view(@Param('token') token: string) {
    return this.survey.publicView(token);
  }

  @Post('survey/:token')
  submit(@Param('token') token: string, @Body() dto: SubmitDto) {
    return this.survey.submit(token, dto.answers ?? {});
  }
}

/** مسیرهای ادمین — کاتالوگِ کانال‌ها، دعوت‌نامه‌ها و دو گزارش. */
@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
export class SurveyController {
  constructor(private survey: SurveyService) {}

  @RequirePermissions('definitions.read')
  @Get('referral-sources')
  list(@Query('all') all?: string) {
    return this.survey.listSources(all === '1');
  }

  @RequirePermissions('definitions.manage')
  @Post('referral-sources')
  create(@Body() dto: SourceCreateDto) {
    return this.survey.createSource(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('referral-sources/:id')
  patch(@Param('id', ParseIntPipe) id: number, @Body() dto: SourcePatchDto) {
    return this.survey.patchSource(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('referral-sources/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.survey.removeSource(id);
  }

  /** «کدام کانال بیمار می‌آورد» — همان عددی که تصمیمِ تبلیغات را می‌سازد. */
  /* ⚠️ کلیدهای مجوز باید در `access-registry.ts` **وجود داشته باشند**. نسخهٔ
     اول `reports.read` و `patients.write` را اختراع کرده بود — کلیدهایی که
     هیچ‌جا تعریف نشده‌اند و گارد با پیش‌فرضِ سوپرادمین می‌بستشان، پس ادمینِ
     معمولی ۴۰۳ می‌گرفت بی‌آنکه در ماتریسِ دسترسی چیزی برای روشن‌کردن ببیند. */
  @RequirePermissions('accounting.read')
  @Get('reports/referral')
  referralReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.survey.sourceReport({ from: toDateValue(from) ?? undefined, to: toDateValue(to) ?? undefined });
  }

  @RequirePermissions('accounting.read')
  @Get('reports/survey')
  surveyReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.survey.report({ from: toDateValue(from) ?? undefined, to: toDateValue(to) ?? undefined });
  }

  @RequirePermissions('patients.read')
  @Get('visits/:id/survey')
  forVisit(@Param('id', ParseIntPipe) id: number) {
    return this.survey.forVisit(id);
  }

  @RequirePermissions('patients.update')
  @Post('visits/:id/survey')
  invite(@Param('id', ParseIntPipe) id: number) {
    return this.survey.invite(id);
  }
}
