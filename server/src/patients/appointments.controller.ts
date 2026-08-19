import {
  Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppointmentsService } from './appointments.service';

class WalkInDto {
  @IsInt({ message: 'پرونده را انتخاب کنید' }) patientId!: number;
  @IsString({ message: 'روز را انتخاب کنید' }) date!: string;
  @IsOptional() @IsInt() startMin?: number;
  @IsOptional() @IsInt() topicId?: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class StatusDto {
  @IsIn(['held', 'confirmed', 'arrived', 'done', 'noshow', 'cancelled'], { message: 'وضعیت نامعتبر است' })
  status!: string;
}

/**
 * میزِ پذیرش — `docs/BOOKING.md` مرحلهٔ ۵.
 * زیرِ فیچرِ `calendar`: همان کسی که تقویم را می‌بیند، نوبت‌ها را هم اداره می‌کند.
 */
@Controller('appointments')
@UseGuards(JwtAuthGuard, FeatureGuard)
@Feature('calendar')
export class AppointmentsController {
  constructor(private readonly svc: AppointmentsService) {}

  @Get('day')
  day(@Query('date') date: string) {
    return this.svc.day(date);
  }

  /** پیشنهادِ نوبت برای «ویزیتِ بعدی» — وضعیتِ روز + نوبتِ فعالِ خودِ بیمار. */
  @Get('suggest')
  suggest(
    @Query('patientId', ParseIntPipe) patientId: number,
    @Query('date') date: string,
    @Query('topicId') topicId?: string,
  ) {
    return this.svc.suggest(patientId, date, topicId ? Number(topicId) : undefined);
  }

  @Post()
  walkIn(@Body() dto: WalkInDto, @CurrentUser() user: any) {
    return this.svc.walkIn(dto, user);
  }

  @Post(':id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto, @CurrentUser() user: any) {
    return this.svc.setStatus(id, dto.status, user);
  }

  @Post(':id/visit')
  startVisit(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.svc.startVisit(id, user);
  }
}
