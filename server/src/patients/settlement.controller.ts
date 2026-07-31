import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SettlementService } from './settlement.service';
import { ContractCreateDto, PartnersSetDto } from './dto/settlement.dto';

/**
 * حسابداری — قرارداد، سهامدار و تقسیمِ سهم.
 *
 * ماژولِ `accounting` جداست نه زیرِ dashboard: سوپروایزری که وضعیتِ عمل را
 * می‌بندد لازم نیست سهمِ جراح را ببیند، و شرکتی که پلنِ حسابداری ندارد اصلاً
 * نباید این تایل را داشته باشد.
 */
@Controller()
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('accounting')
export class SettlementController {
  constructor(private acc: SettlementService) {}

  // ── قراردادِ جراح ──

  @RequirePermissions('accounting.read')
  @Get('contracts')
  contracts(@Query('surgeon') surgeon?: string) {
    return this.acc.contracts(surgeon ? Number(surgeon) : undefined);
  }

  @RequirePermissions('accounting.manage')
  @Post('contracts')
  addContract(@Body() dto: ContractCreateDto, @CurrentUser() user: any) {
    return this.acc.addContract(dto, user);
  }

  /// غیرفعال می‌شود نه حذف — تسویه‌های گذشته به آن ارجاع منطقی دارند.
  @RequirePermissions('accounting.manage')
  @Delete('contracts/:id')
  dropContract(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.acc.removeContract(id, user);
  }

  // ── سهامداران ──

  @RequirePermissions('accounting.read')
  @Get('partners')
  partners() {
    return this.acc.partners();
  }

  @RequirePermissions('accounting.manage')
  @Post('partners')
  setPartners(@Body() dto: PartnersSetDto, @CurrentUser() user: any) {
    return this.acc.setPartners(dto.partners, user);
  }

  // ── تسویهٔ مراجعه ──

  @RequirePermissions('accounting.read')
  @Get('visits/:id/settlement')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.acc.get(id);
  }

  @RequirePermissions('accounting.read')
  @Get('visits/:id/settlement/history')
  history(@Param('id', ParseIntPipe) id: number) {
    return this.acc.history(id);
  }

  /// محاسبه = نسخهٔ تازه. نسخهٔ قبلی باطل می‌شود ولی پاک نمی‌شود.
  @RequirePermissions('accounting.manage')
  @Post('visits/:id/settlement')
  compute(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.acc.compute(id, user);
  }

  @RequirePermissions('accounting.manage')
  @Post('visits/:id/settlement/finalize')
  finalize(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.acc.finalize(id, user);
  }

  @RequirePermissions('accounting.manage')
  @Post('visits/:id/settlement/reopen')
  reopen(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.acc.reopen(id, user);
  }
}
