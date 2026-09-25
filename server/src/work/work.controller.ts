import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { Feature } from '../auth/feature.decorator';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { WorkService, type OwnerFilter, type OwnerRoleFilter, type WorkAction, type WorkScope } from './work.service';
import { TodayService } from './today.service';

class CreateWorkDto {
  @IsString() @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MaxLength(40) type?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsInt() @Min(1) patientId?: number;
  @IsOptional() @IsInt() @Min(1) visitId?: number;
  @IsOptional() @IsInt() @Min(1) appointmentId?: number;
  @IsOptional() @IsString() @MaxLength(20) ownerRole?: string;
  @IsOptional() @IsInt() @Min(1) ownerAccountId?: number;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @IsInt() @Min(0) @Max(3) priority?: number;
}

class PatchWorkDto {
  @IsIn(['done', 'block', 'assign', 'snooze', 'cancel', 'reopen']) action!: WorkAction;
  @IsOptional() outcome?: any;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @IsInt() @Min(1) accountId?: number;
  @IsOptional() @IsDateString() until?: string;
}

const SCOPES: WorkScope[] = ['inbox', 'mine', 'role', 'patient', 'all'];

/** `owner` در کوئری: شناسهٔ حساب (عددِ مثبت) یا `none` — بقیه ۴۰۰، نه نادیده‌گرفتنِ بی‌صدا. */
function parseOwner(raw?: string): OwnerFilter | undefined {
  if (raw == null || raw === '') return undefined;
  if (raw === 'none') return 'none';
  if (/^\d{1,9}$/.test(raw) && Number(raw) > 0) return Number(raw);
  throw new BadRequestException('شناسهٔ مسئول نامعتبر است');
}

/**
 * `ownerRole` در کوئری: کلیدِ نقش یا `none`. شکلِ کلید عمداً آزاد است (فقط طول و
 * نویسهٔ کنترلی): دسته‌های `owners` از خودِ ستونِ `owner_role` ساخته می‌شوند و
 * `POST /work` هر رشتهٔ تا ۲۰ نویسه را می‌پذیرد — الگوی سخت‌تر تبی را که سرور
 * خودش داده با ۴۰۰ می‌شکست. مقدار فقط در شرطِ برابری می‌نشیند (پارامتری).
 */
function parseOwnerRole(raw?: string): OwnerRoleFilter | undefined {
  if (raw == null || raw === '') return undefined;
  if (raw.length <= 40 && !/[\u0000-\u001f]/.test(raw)) return raw;
  throw new BadRequestException('نقشِ مسئول نامعتبر است');
}

@Controller('work')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('work')
export class WorkController {
  constructor(private work: WorkService, private todaySvc: TodayService) {}

  /** صفحهٔ «امروز» (W2.3) — کارها + عمل‌ها + نوبت‌های امروز در یک درخواست، هر بخش جدا گیت‌شده. */
  @Get('today') @RequirePermissions('work.read')
  today(@CurrentUser() user: any) {
    return this.todaySvc.today(user);
  }

  /**
   * `owner`/`ownerRole` = فیلترِ «مالِ کیست» در نمای تیم (دسته‌های `owners`ِ همان پاسخ‌ها
   * `filter`ِ آماده دارند). `sort=overdue` = عقب‌افتاده اول (زنگِ نمای تیم).
   */
  @Get() @RequirePermissions('work.read')
  list(
    @CurrentUser() user: any,
    @Query('scope') scope?: string,
    @Query('patientId') patientId?: string,
    @Query('state') state?: string,
    @Query('type') type?: string,
    @Query('due') due?: string,
    @Query('limit') limit?: string,
    @Query('owner') owner?: string,
    @Query('ownerRole') ownerRole?: string,
    @Query('sort') sort?: string,
  ) {
    return this.work.list(user, {
      scope: SCOPES.includes(scope as WorkScope) ? (scope as WorkScope) : 'inbox',
      patientId: patientId ? Number(patientId) : undefined,
      state: state || undefined,
      type: type || undefined,
      due: due || undefined,
      limit: limit ? Number(limit) : undefined,
      owner: parseOwner(owner),
      ownerRole: parseOwnerRole(ownerRole),
      sort: sort === 'overdue' ? 'overdue' : undefined,
    });
  }

  /** `owners=1` دسته‌های «مالِ کیست» را هم می‌دهد (فقط نمای تیم) — زنگ که هر دقیقه می‌پرسد لازمش ندارد. */
  @Get('counts') @RequirePermissions('work.read')
  counts(@CurrentUser() user: any, @Query('owners') owners?: string) {
    return this.work.counts(user, { owners: owners === '1' });
  }

  /** «به چه کسی واگذار شود» — فقط سوپرادمین؛ بقیه ۴۰۳ با پیامِ فارسی (از خودِ سرویس). */
  @Get('assignees') @RequirePermissions('work.read')
  assignees(@CurrentUser() user: any) { return this.work.assignees(user); }

  @Post() @RequirePermissions('work.write')
  create(@Body() dto: CreateWorkDto, @CurrentUser() user: any) { return this.work.create(user, dto); }

  @Patch(':id') @RequirePermissions('work.write')
  act(@Param('id', ParseIntPipe) id: number, @Body() dto: PatchWorkDto, @CurrentUser() user: any) {
    return this.work.act(user, id, dto.action, dto);
  }

  /** فقط آزمون/عیب‌یابی — worker همین را خودکار می‌زند. */
  @Post('process') @RequirePermissions('work.process')
  process(@CurrentUser() user: any) { return this.work.process(user); }
}
