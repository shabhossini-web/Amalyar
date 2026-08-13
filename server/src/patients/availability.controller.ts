import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { AvailabilityService } from './availability.service';

class RuleCreateDto {
  @IsOptional() @IsInt() doctorId?: number | null;
  @IsInt({ message: 'روزِ هفته نامعتبر است' }) weekday!: number;
  @IsInt() @Min(0) startMin!: number;
  @IsInt() @Min(1) endMin!: number;
  @IsOptional() @IsIn(['slot', 'capacity'], { message: 'حالتِ نوبت‌دهی نامعتبر است' }) mode?: string;
  @IsOptional() @IsInt() slotMinutes?: number;
  @IsOptional() @IsInt() capacity?: number;
  @IsOptional() @IsArray() topicIds?: number[];
  @IsOptional() @IsString() activeFrom?: string;
  @IsOptional() @IsString() activeTo?: string;
}

class RulePatchDto {
  @IsOptional() @IsInt() doctorId?: number | null;
  @IsOptional() @IsInt() weekday?: number;
  @IsOptional() @IsInt() startMin?: number;
  @IsOptional() @IsInt() endMin?: number;
  @IsOptional() @IsIn(['slot', 'capacity']) mode?: string;
  @IsOptional() @IsInt() slotMinutes?: number;
  @IsOptional() @IsInt() capacity?: number;
  @IsOptional() @IsArray() topicIds?: number[];
  @IsOptional() @IsString() activeTo?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

class ExceptionCreateDto {
  @IsString() date!: string;
  @IsOptional() @IsInt() doctorId?: number | null;
  @IsOptional() @IsBoolean() closed?: boolean;
  @IsOptional() @IsInt() startMin?: number;
  @IsOptional() @IsInt() endMin?: number;
  @IsOptional() @IsIn(['slot', 'capacity']) mode?: string;
  @IsOptional() @IsInt() slotMinutes?: number;
  @IsOptional() @IsInt() capacity?: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

/**
 * برنامهٔ کاری و تقویمِ آزاد — `docs/BOOKING.md` مرحلهٔ ۲.
 *
 * ⚠️ `GET /availability/month` عمداً مجوزِ **خواندنِ تعریف‌ها** می‌گیرد نه
 * مدیریت: منشی باید بتواند روزهای آزاد را ببیند بدونِ اینکه بتواند برنامه را
 * عوض کند. مسیرِ عمومیِ بیمار در مرحلهٔ ۳ جدا ساخته می‌شود — این یکی پشتِ
 * لاگین است.
 */
@Controller('availability')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AvailabilityController {
  constructor(private readonly svc: AvailabilityService) {}

  @RequirePermissions('definitions.read')
  @Get('month')
  month(
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('doctorId') doctorId?: string,
    @Query('topicId') topicId?: string,
  ) {
    return this.svc.month(Number(year), Number(month), {
      doctorId: doctorId ? Number(doctorId) : undefined,
      topicId: topicId ? Number(topicId) : undefined,
    });
  }

  @RequirePermissions('definitions.read')
  @Get('rules')
  rules() {
    return this.svc.listRules();
  }

  @RequirePermissions('definitions.manage')
  @Post('rules')
  addRule(@Body() dto: RuleCreateDto) {
    return this.svc.createRule(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('rules/:id')
  patchRule(@Param('id', ParseIntPipe) id: number, @Body() dto: RulePatchDto) {
    return this.svc.updateRule(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('rules/:id')
  delRule(@Param('id', ParseIntPipe) id: number) {
    return this.svc.deleteRule(id);
  }

  @RequirePermissions('definitions.read')
  @Get('exceptions')
  exceptions() {
    return this.svc.listExceptions();
  }

  @RequirePermissions('definitions.manage')
  @Post('exceptions')
  addException(@Body() dto: ExceptionCreateDto) {
    return this.svc.createException(dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('exceptions/:id')
  delException(@Param('id', ParseIntPipe) id: number) {
    return this.svc.deleteException(id);
  }
}
