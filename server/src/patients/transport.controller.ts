import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TransportService } from './transport.service';
import { StopDoneDto } from './dto/routes.dto';

/**
 * پرتالِ تیمِ حمل‌ونقل.
 *
 * ماژولِ `transport` (سطح ۲) — راننده نباید برای دیدنِ مسیرِ فردایش به تختهٔ
 * چینش (سطح ۴) دسترسی بگیرد. مسیرها زیرِ `transport/` می‌مانند تا از خودِ
 * URL پیدا باشد نمای محدود است، نه نمای مدیر با یک فیلتر.
 */
@Controller('transport')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('transport')
export class TransportController {
  constructor(private transport: TransportService) {}

  @RequirePermissions('transport.own')
  @Get('agenda')
  agenda(@CurrentUser() user: any, @Query('scope') scope?: string) {
    const s = ['today', 'upcoming', 'past'].includes(scope ?? '') ? (scope as any) : 'today';
    return this.transport.agenda(user, s);
  }

  @RequirePermissions('transport.own')
  @Post('stops/:id/done')
  done(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StopDoneDto,
    @CurrentUser() user: any,
  ) {
    return this.transport.markDone(id, dto, user);
  }
}
