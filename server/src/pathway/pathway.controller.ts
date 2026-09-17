import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PathwayService } from './pathway.service';

class PublishDto {
  @IsArray({ message: 'مرحله‌ها باید فهرست باشند' })
  steps!: unknown[];
}

class PreviewDto {
  @IsArray({ message: 'مرحله‌ها باید فهرست باشند' })
  steps!: unknown[];

  /** مبدأِ فرضیِ آزمون — پیش‌فرض امروز. */
  @IsOptional() @IsString() anchor?: string;
}

class StartDto {
  @IsInt({ message: 'پرونده را انتخاب کنید' }) patientId!: number;
  @IsInt({ message: 'الگو را انتخاب کنید' }) templateId!: number;
  @IsOptional() @IsInt() visitId?: number;
  /** مبدأ — وگرنه تاریخِ عملِ همان مراجعه، وگرنه امروز. */
  @IsOptional() @IsString() anchor?: string;
}

class StepDto {
  @IsOptional() @IsIn(['pending', 'done', 'skipped'], { message: 'وضعیتِ مرحله نامعتبر است' })
  status?: string;

  @IsOptional() @IsString() dueAt?: string | null;
  @IsOptional() @IsInt() ownerId?: number | null;
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

class CloseDto {
  @IsIn(['done', 'cancelled'], { message: 'وضعیتِ دوره نامعتبر است' }) status!: string;
}

/**
 * **مسیرِ درمان** (W4.1، یافتهٔ A4).
 *
 * ⚠️ خواندن از سطحِ کارشناس باز است چون گام‌های دوره همان کاری است که خودِ
 * کارشناس باید انجام دهد؛ ولی **انتشارِ الگو** کارِ مدیر است: الگو روی
 * بیمارانِ بعدی اثر می‌گذارد، نه فقط روی یک پرونده.
 */
@Controller('pathway')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('pathway')
export class PathwayController {
  constructor(private readonly svc: PathwayService) {}

  @Get('templates') @RequirePermissions('pathway.read')
  templates() {
    return this.svc.templates();
  }

  @Post('templates/:id/publish') @RequirePermissions('pathway.manage')
  publish(@Param('id', ParseIntPipe) id: number, @Body() dto: PublishDto, @CurrentUser() user: any) {
    return this.svc.publish(id, dto.steps, user);
  }

  /**
   * آزمونِ الگو با بیمارِ ساختگی — «بیازماید» در معیارِ پذیرشِ W4.2.
   *
   * ⚠️ `@Post` است چون بدنه می‌گیرد، ولی **هیچ‌چیز نمی‌نویسد**؛ مجوزش هم
   * همان `pathway.manage` است چون فقط کسی که الگو می‌سازد لازمش دارد.
   */
  @Post('preview') @RequirePermissions('pathway.manage')
  preview(@Body() dto: PreviewDto) {
    return this.svc.preview(dto.steps, dto.anchor);
  }

  /** دوره‌های یک بیمار — کارتِ پروندهٔ زنده همین را می‌خواند. */
  @Get('episodes') @RequirePermissions('pathway.read')
  forPatient(@Query('patientId', ParseIntPipe) patientId: number, @CurrentUser() user: any) {
    return this.svc.forPatient(patientId, user);
  }

  @Get('episodes/:id') @RequirePermissions('pathway.read')
  view(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.svc.view(id, user);
  }

  @Post('episodes') @RequirePermissions('pathway.start')
  start(@Body() dto: StartDto, @CurrentUser() user: any) {
    return this.svc.start(dto, user);
  }

  @Patch('steps/:id') @RequirePermissions('pathway.step')
  step(@Param('id', ParseIntPipe) id: number, @Body() dto: StepDto, @CurrentUser() user: any) {
    return this.svc.patchStep(id, dto, user);
  }

  @Post('episodes/:id/close') @RequirePermissions('pathway.start')
  close(@Param('id', ParseIntPipe) id: number, @Body() dto: CloseDto, @CurrentUser() user: any) {
    return this.svc.close(id, dto.status, user);
  }
}
