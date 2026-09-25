import {
  Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { MAX_DOCUMENT_BYTES } from './record.service';
import { VisitTimesDto } from './dto/visit.dto';
import { AgendaScope, TechService } from './tech.service';

const SCOPES: AgendaScope[] = ['today', 'upcoming', 'past'];

/**
 * پذیرش از کارتِ حضور.
 *
 * بی‌بدنه = «به نامِ خودم» (کارشناس، مثلِ همیشه). `dutyId` فقط در نمای سرپرستی
 * می‌آید و سرور کارشناس را از **همان ردیفِ برنامه** می‌خوانَد — برای غیرِ
 * سوپرادمین با ۴۰۳ رد می‌شود.
 */
class ClaimDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'برنامهٔ حضورِ انتخابی نامعتبر است' })
  @Min(1, { message: 'برنامهٔ حضورِ انتخابی نامعتبر است' })
  dutyId?: number;
}

/**
 * پنلِ کارشناسی — دفترِ کارِ خودِ کارشناس.
 *
 * ماژولش `tech` است (سطح ۲) نه `dashboard` (سطح ۵): کارشناس نباید برای دیدنِ
 * کارِ فردایش به داشبوردِ مدیریت دسترسی بگیرد. مسیرهای این‌جا همه زیرِ `tech/`
 * هستند تا از خودِ URL پیدا باشد که نمای محدودند، نه نمای مدیر با یک فیلتر.
 * سوپرادمین همین مسیرها را برای **همهٔ** کارشناسان دارد (دامنه در سرویس، نه
 * پارامترِ ورودی) — `TechService`.
 */
@Controller('tech')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('tech')
export class TechController {
  @Post('visits/:id/claim') @RequirePermissions('visits.claim')
  claim(@Param('id', ParseIntPipe) id: number, @Body() dto: ClaimDto, @CurrentUser() user: any) { return this.tech.claim(id, dto?.dutyId, user); }
  constructor(private tech: TechService) {}

  @RequirePermissions('patients.read')
  @Get('agenda')
  agenda(@CurrentUser() user: any, @Query('scope') scope?: string) {
    const s = SCOPES.includes(scope as AgendaScope) ? (scope as AgendaScope) : 'today';
    return this.tech.agenda(user, s);
  }

  /// ساعتِ واقعی را کسی می‌زند که سرِ عمل بوده — همان استدلالِ `visits.times`.
  @RequirePermissions('visits.times')
  @Patch('visits/:id/times')
  times(@Param('id', ParseIntPipe) id: number, @Body() dto: VisitTimesDto, @CurrentUser() user: any) {
    return this.tech.setTimes(id, dto, user);
  }

  @RequirePermissions('documents.write')
  @Post('visits/:id/report')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  report(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: any, @CurrentUser() user: any) {
    return this.tech.uploadReport(id, file, user);
  }
}
