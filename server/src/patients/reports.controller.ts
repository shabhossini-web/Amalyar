import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { ReportsService } from './reports.service';

/** گزارشِ مالی — درآمد، وصولی، هزینه، سود و تفکیک‌ها. */
@Controller('reports')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('accounting')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @RequirePermissions('accounting.read')
  @Get('financial')
  financial(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.financial({ from: dateOf(from), to: dateOf(to) });
  }
}

function dateOf(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
