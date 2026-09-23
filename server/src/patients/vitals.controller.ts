import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { VitalsService } from './vitals.service';

/**
 * علائمِ حیاتی زیرِ مسیرِ خودِ مراجعه — همان گیت و مجوزهای فرمِ مراجعه، چون
 * همان‌جا ثبت و دیده می‌شوند. سنجهٔ مقدارها در `vitalsInput` است (یک جا برای
 * ثبتِ همراهِ مراجعه و ثبتِ جدا).
 */
@Controller('visits/:id/vitals')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dashboard')
export class VitalsController {
  constructor(private vitals: VitalsService) {}

  @RequirePermissions('patients.read')
  @Get()
  list(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.vitals.list(id, user);
  }

  @RequirePermissions('patients.update')
  @Post()
  add(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser() user: any) {
    return this.vitals.add(id, body ?? {}, user);
  }

  @RequirePermissions('patients.update')
  @Delete(':vid')
  remove(@Param('id', ParseIntPipe) id: number, @Param('vid', ParseIntPipe) vid: number, @CurrentUser() user: any) {
    return this.vitals.remove(id, vid, user);
  }
}
