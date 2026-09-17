import {
  Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { CANCEL_REASON_KEYS } from '../common/cancel-reasons';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { FrontDeskService } from './frontdesk.service';

class DeskStatusDto {
  @IsIn(['held', 'confirmed', 'arrived', 'done', 'noshow', 'cancelled'], { message: 'وضعیت نامعتبر است' })
  status!: string;

  /* دلیلِ لغو — اجباریِ مشروط؛ خودِ اجبار در سرویس چک می‌شود. */
  @IsOptional() @IsIn(CANCEL_REASON_KEYS, { message: 'دلیلِ لغو نامعتبر است' })
  cancelReason?: string;

  /** یادداشتِ داخلی — هرگز برای بیمار فرستاده نمی‌شود. */
  @IsOptional() @IsString() @MaxLength(400)
  cancelNote?: string;
}

class DeskWalkInDto {
  @IsInt({ message: 'پرونده را انتخاب کنید' }) patientId!: number;
  @IsString({ message: 'روز را انتخاب کنید' }) date!: string;
  @IsOptional() @IsInt() startMin?: number;
  @IsOptional() @IsInt() topicId?: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

/**
 * **میزِ پذیرشِ روز** (W3.3، §۴.۵).
 *
 * ⚠️ کنترلرِ **جدا** با فیچرِ `frontdesk` (سطحِ کارشناس/منشی)، نه گیتِ
 * پایین‌ترِ `calendar`: آن یکی کلِ تقویمِ عمل‌ها و قواعدِ برنامهٔ کاری را هم
 * پوشش می‌دهد و پایین‌آوردنش آن‌ها را هم به سطحِ ۲ باز می‌کرد. سرویسِ زیرین
 * مشترک است، پس منطق کپی نمی‌شود — فقط دروازه فرق می‌کند.
 */
@Controller('frontdesk')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('frontdesk')
export class FrontDeskController {
  constructor(private readonly svc: FrontDeskService) {}

  /** تختهٔ یک روز — ستون‌ها، شمارنده‌ها، و ردیف‌ها با چیپِ پرداخت. */
  @Get('day') @RequirePermissions('frontdesk.read')
  day(@Query('date') date: string) {
    return this.svc.day(date);
  }

  /** پیشنهادِ نوبت برای بیمارِ سرِ میز — همان مسیرِ ظرفیتِ عادی. */
  @Get('suggest') @RequirePermissions('frontdesk.walkin')
  suggest(
    @Query('patientId', ParseIntPipe) patientId: number,
    @Query('date') date: string,
    @Query('topicId') topicId?: string,
  ) {
    return this.svc.suggest(patientId, date, topicId ? Number(topicId) : undefined);
  }

  @Post('walk-in') @RequirePermissions('frontdesk.walkin')
  walkIn(@Body() dto: DeskWalkInDto, @CurrentUser() user: any) {
    return this.svc.walkIn(dto, user);
  }

  @Post('appointments/:id/status') @RequirePermissions('frontdesk.status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: DeskStatusDto, @CurrentUser() user: any) {
    return this.svc.setStatus(id, dto.status, user, { reason: dto.cancelReason, note: dto.cancelNote });
  }

  /** «رسید» و «شروع» در یک کلیک — شرحِ کاملِ چراییِ ترکیب در سرویس. */
  @Post('appointments/:id/start') @RequirePermissions('frontdesk.start')
  start(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.svc.start(id, user);
  }
}
