import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { DispatchService } from './dispatch.service';

/** چینشِ نیروها — کارشناس، راننده و پیک. */
@Controller('dispatch')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dispatch')
export class DispatchController {
  constructor(private dis: DispatchService) {}

  @RequirePermissions('patients.read')
  @Get('staff')
  staff() {
    return this.dis.staff();
  }

  @RequirePermissions('patients.read')
  @Get('month')
  month(@Query('year') y?: string, @Query('month') m?: string) {
    return this.dis.month(Number(y), Number(m));
  }

  @RequirePermissions('patients.read')
  @Get('day')
  day(@Query('year') y?: string, @Query('month') m?: string, @Query('day') d?: string) {
    return this.dis.day(Number(y), Number(m), Number(d));
  }

  /// متنِ ابلاغ — همان بدنه‌ای که فازِ پیام‌رسان خواهد فرستاد.
  @RequirePermissions('patients.read')
  @Get('visits/:id/briefing')
  briefing(@Param('id', ParseIntPipe) id: number, @Query('role') role: string) {
    return this.dis.briefing(id, role);
  }
}
