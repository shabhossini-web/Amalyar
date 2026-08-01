import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { DispatchService } from './dispatch.service';
import { AssignDto, JobRoleDto } from './dto/dispatch.dto';

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

  /// نقشِ شغلی روی حساب می‌نشیند و کارِ مدیرِ کاربران است، نه چینش‌کننده.
  @RequirePermissions('users.manage')
  @Patch('staff/:id/role')
  role(@Param('id', ParseIntPipe) id: number, @Body() dto: JobRoleDto, @CurrentUser() user: any) {
    return this.dis.setJobRole(id, dto.jobRole ?? null, user);
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

  @RequirePermissions('patients.update')
  @Post('visits/:id/assign')
  assign(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignDto, @CurrentUser() user: any) {
    return this.dis.assign(id, dto, user);
  }

  @RequirePermissions('patients.update')
  @Delete('assignments/:id')
  unassign(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.dis.unassign(id, user);
  }

  /// متنِ ابلاغ — همان بدنه‌ای که فازِ پیام‌رسان خواهد فرستاد.
  @RequirePermissions('patients.read')
  @Get('visits/:id/briefing')
  briefing(@Param('id', ParseIntPipe) id: number, @Query('role') role: string) {
    return this.dis.briefing(id, role);
  }
}
