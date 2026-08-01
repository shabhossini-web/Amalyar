import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TreasuryService } from './treasury.service';
import { ChequeCreateDto, ChequeStatusDto, FiscalYearDto, PayoutCreateDto } from './dto/treasury.dto';

/** خزانه، پرداختِ سهم، چک و سالِ مالی. */
@Controller()
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('accounting')
export class TreasuryController {
  constructor(private tr: TreasuryService) {}

  /// موجودیِ هر حساب — مشتق از پرداخت‌ها، هزینه‌ها و پرداختِ سهم.
  @RequirePermissions('accounting.read')
  @Get('treasury')
  treasury() {
    return this.tr.treasury();
  }

  // ── پرداختِ سهم ──

  @RequirePermissions('accounting.read')
  @Get('visits/:id/payouts')
  payouts(@Param('id', ParseIntPipe) id: number) {
    return this.tr.payoutsFor(id);
  }

  @RequirePermissions('accounting.manage')
  @Post('visits/:id/payouts')
  addPayout(@Param('id', ParseIntPipe) id: number, @Body() dto: PayoutCreateDto, @CurrentUser() user: any) {
    return this.tr.addPayout(id, dto, user);
  }

  @RequirePermissions('accounting.manage')
  @Delete('payouts/:id')
  dropPayout(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.tr.removePayout(id, user);
  }

  // ── چک ──

  @RequirePermissions('accounting.read')
  @Get('cheques')
  cheques(@Query('status') status?: string, @Query('direction') direction?: string) {
    return this.tr.cheques({ status, direction });
  }

  @RequirePermissions('accounting.manage')
  @Post('cheques')
  addCheque(@Body() dto: ChequeCreateDto, @CurrentUser() user: any) {
    return this.tr.addCheque(dto, user);
  }

  @RequirePermissions('accounting.manage')
  @Patch('cheques/:id')
  chequeStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: ChequeStatusDto, @CurrentUser() user: any) {
    return this.tr.setChequeStatus(id, dto.status, user);
  }

  // ── سالِ مالی ──

  @RequirePermissions('accounting.read')
  @Get('fiscal-years')
  years() {
    return this.tr.years();
  }

  @RequirePermissions('accounting.manage')
  @Post('fiscal-years')
  addYear(@Body() dto: FiscalYearDto, @CurrentUser() user: any) {
    return this.tr.addYear(dto, user);
  }

  /// بستن/بازکردنِ دوره — بستن یعنی هیچ سندی با تاریخِ داخلِ آن دوره نوشته نشود.
  @RequirePermissions('accounting.manage')
  @Post('fiscal-years/:id/close')
  close(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.tr.setYearClosed(id, true, user);
  }

  @RequirePermissions('accounting.manage')
  @Post('fiscal-years/:id/reopen')
  reopen(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.tr.setYearClosed(id, false, user);
  }
}
