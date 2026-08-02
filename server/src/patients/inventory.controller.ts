import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { InventoryService } from './inventory.service';
import { AdjustDto, LotCreateDto, LotPatchDto, MovementDto, ReleaseDto, TransferReceiveDto, TransferSendDto, TransferUsageDto } from './dto/inventory.dto';

/**
 * انبار — لات، سریال، دفترِ حرکت و ردیابی.
 *
 * ماژولِ جدا (`inventory`) دارد و نه زیرِ dashboard: شرکتِ خدماتی که کالا
 * نمی‌فروشد اصلاً نباید این را ببیند، و این تفاوت با «دسترسی نداری» فرق دارد.
 */
@Controller('stock')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('inventory')
export class InventoryController {
  constructor(private inv: InventoryService) {}

  @RequirePermissions('inventory.read')
  @Get('lots')
  lots(
    @Query('q') q?: string,
    @Query('item') item?: string,
    @Query('inStock') inStock?: string,
    @Query('expiringDays') expiringDays?: string,
  ) {
    return this.inv.listLots({
      q,
      itemId: item ? Number(item) : undefined,
      inStock: inStock === '1',
      expiringDays: expiringDays ? Number(expiringDays) : undefined,
    });
  }

  /** لات‌های قابلِ انتخاب برای یک کالا — انتخابگرِ فاکتور از این می‌خواند. */
  @RequirePermissions('inventory.read')
  @Get('items/:itemId/lots')
  forItem(@Param('itemId', ParseIntPipe) itemId: number) {
    return this.inv.availableFor(itemId);
  }

  @RequirePermissions('inventory.read')
  @Get('lots/:id')
  lot(@Param('id', ParseIntPipe) id: number) {
    return this.inv.lot(id);
  }

  /** ردیابیِ فراخوان: این لات در کدام عمل‌ها و روی کدام بیمارها رفت. */
  @RequirePermissions('inventory.read')
  @Get('lots/:id/trace')
  trace(@Param('id', ParseIntPipe) id: number) {
    return this.inv.trace(id);
  }

  @RequirePermissions('inventory.write')
  @Post('lots')
  create(@Body() dto: LotCreateDto, @CurrentUser() user: any) {
    return this.inv.createLot(dto, user);
  }

  @RequirePermissions('inventory.write')
  @Patch('lots/:id')
  patch(@Param('id', ParseIntPipe) id: number, @Body() dto: LotPatchDto, @CurrentUser() user: any) {
    return this.inv.updateLot(id, dto, user);
  }

  @RequirePermissions('inventory.write')
  @Delete('lots/:id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.inv.deleteLot(id, user);
  }

  @RequirePermissions('inventory.write')
  @Post('lots/:id/receive')
  receive(@Param('id', ParseIntPipe) id: number, @Body() dto: MovementDto, @CurrentUser() user: any) {
    return this.inv.receive(id, dto, user);
  }

  @RequirePermissions('inventory.write')
  @Post('lots/:id/consume')
  consume(@Param('id', ParseIntPipe) id: number, @Body() dto: MovementDto, @CurrentUser() user: any) {
    return this.inv.consume({ lotId: id, quantity: dto.quantity, visitId: dto.visitId, reason: dto.reason }, user);
  }

  @RequirePermissions('inventory.write')
  @Post('lots/:id/return')
  giveBack(@Param('id', ParseIntPipe) id: number, @Body() dto: MovementDto, @CurrentUser() user: any) {
    return this.inv.returnToStock({ lotId: id, quantity: dto.quantity, visitId: dto.visitId, reason: dto.reason }, user);
  }

  /// انبارگردانی سطحِ بالاتری می‌خواهد: با یک عدد، موجودی هر لاتی قابلِ بازنویسی است.
  @RequirePermissions('inventory.adjust')
  @Post('lots/:id/adjust')
  adjust(@Param('id', ParseIntPipe) id: number, @Body() dto: AdjustDto, @CurrentUser() user: any) {
    return this.inv.adjust(id, dto.counted, dto.reason, user);
  }

  // ── حواله‌ها: سفرِ ست به بیمارستان و برگشتش ──

  /**
   * ⚠️ خواندنِ حواله و ثبتِ مصرف زیرِ ماژولِ `tech` (سطح ۲) هستند نه `inventory`
   * (سطح ۳)، چون کارِ کارشناسِ سرِ عمل‌اند نه کارِ انباردار. دامنه‌شان هم با
   * `transferScope` به عمل‌های خودِ کارشناس محدود است.
   *
   * هرچه انبار را دست می‌زند (ساختِ لات، صدور، رسید، برگشت) زیرِ `inventory`
   * می‌ماند — کارشناس ست را می‌بیند و مصرفش را می‌زند، ولی انبار نمی‌گرداند.
   */
  @Feature('tech')
  @RequirePermissions('inventory.read')
  @Get('transfers')
  transfers(@CurrentUser() user: any, @Query('status') status?: string, @Query('visit') visit?: string) {
    return this.inv.listTransfers({ status, visitId: visit ? Number(visit) : undefined }, user);
  }

  @Feature('tech')
  @RequirePermissions('inventory.read')
  @Get('transfers/:id')
  transfer(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.inv.transfer(id, user);
  }

  /**
   * برگهٔ مصرف — کارشناسِ سرِ عمل «چند تا مصرف شد» را می‌زند.
   *
   * مجوزِ سبک‌ترِ خودش (`stock.consume`) را دارد، نه `inventory.write`: کارشناسی
   * که سرِ عمل مصرف ثبت می‌کند نباید بتواند لات بسازد یا حواله صادر کند.
   */
  @Feature('tech')
  @RequirePermissions('stock.consume')
  @Post('transfers/:id/usage')
  usage(@Param('id', ParseIntPipe) id: number, @Body() dto: TransferUsageDto, @CurrentUser() user: any) {
    return this.inv.recordUsage(id, dto.lines, user);
  }

  @RequirePermissions('inventory.write')
  @Post('transfers')
  send(@Body() dto: TransferSendDto, @CurrentUser() user: any) {
    return this.inv.sendTransfer(dto, user);
  }

  /// رسیدِ CSR — موجودی جابه‌جا نمی‌شود، فقط امضا و ساعت ثبت می‌شود.
  /// ارسالِ واقعیِ حوالهٔ برنامه‌ریزی‌شده — دفترِ انبار همین‌جا می‌خورد.
  @RequirePermissions('inventory.write')
  @Post('transfers/:id/ship')
  ship(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.inv.shipTransfer(id, user);
  }

  /// اعلامِ پایانیِ کارشناسِ سرِ عمل — مجوزِ سبک، چون کارِ خودِ اوست.
  @RequirePermissions('stock.consume')
  @Post('transfers/:id/release')
  release(@Param('id', ParseIntPipe) id: number, @Body() dto: ReleaseDto, @CurrentUser() user: any) {
    return this.inv.releaseTransfer(id, dto, user);
  }

  @RequirePermissions('inventory.write')
  @Post('transfers/:id/receive')
  csr(@Param('id', ParseIntPipe) id: number, @Body() dto: TransferReceiveDto, @CurrentUser() user: any) {
    return this.inv.receiveTransfer(id, dto, user);
  }

  /// برگشتِ مانده — تعداد از دفتر می‌آید نه از کاربر.
  @RequirePermissions('inventory.write')
  @Post('transfers/:id/return')
  back(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.inv.returnTransfer(id, user);
  }
}

/**
 * مصرفِ ثبت‌شده در یک مراجعه.
 *
 * زیرِ `visits/:id` است چون سؤالِ «در این عمل چه رفت» سؤالِ پروندهٔ بیمار است،
 * ولی مجوزش همان مجوزِ انبار می‌ماند.
 */
@Controller('visits')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('inventory')
export class VisitStockController {
  constructor(private inv: InventoryService) {}

  @RequirePermissions('inventory.read')
  @Get(':id/stock')
  usage(@Param('id', ParseIntPipe) id: number) {
    return this.inv.visitUsage(id);
  }
}
