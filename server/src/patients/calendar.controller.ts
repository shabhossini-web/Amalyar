import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CalendarService } from './calendar.service';

/** تقویمِ عمل‌ها — ماژولِ جدا تا شرکتی که تقویم نمی‌خواهد تایلش را نبیند. */
@Controller('calendar')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('calendar')
export class CalendarController {
  constructor(private cal: CalendarService) {}

  @RequirePermissions('patients.read')
  @Get()
  month(@CurrentUser() user: any, @Query('year') year?: string, @Query('month') month?: string) {
    return this.cal.month(Number(year), Number(month), user);
  }
}
