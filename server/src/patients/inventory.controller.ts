import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { InventoryService } from './inventory.service';
import { AdjustDto, LotCreateDto, LotPatchDto, MovementDto, QuantityNoteDto, ReleaseDto, ReturnCountDto, SetFillDto, SetMoveDto, TransferReceiptDto, TransferReceiveDto, TransferSendDto, TransferUsageDto, VisitUsageDto } from './dto/inventory.dto';
import { SetStockService } from './set-stock.service';
import { VisitUsageService } from './usage.service';
import { DefinitionsService } from './definitions.service';
import { ItemCreateDto, ItemPatchDto } from './definitions.controller';

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
  constructor(private inv: InventoryService, private sets: SetStockService, private defs: DefinitionsService, private usages: VisitUsageService) {}

  // ── کالاها (کاتالوگ) — از تعاریفِ پایه به انبار آمده (مالک، ۱۴۰۵/۰۷/۱۱) ──

  /**
   * ⚠️ همان جدولِ `items` است که `/items` می‌دهد (تک‌منبع)؛ فقط درِ ورودش `inventory.items` (سطح ۳)
   * شد، نه `definitions.manage` (سطح ۵): انباردار باید بی‌دسترسیِ مدیریتی کالا تعریف کند.
   */
  @RequirePermissions('inventory.read')
  @Get('items')
  catalog(@Query('q') q?: string) {
    return this.inv.catalog(q);
  }

  @RequirePermissions('inventory.items')
  @Post('items')
  addItem(@Body() dto: ItemCreateDto) {
    return this.defs.createItem(dto);
  }

  @RequirePermissions('inventory.items')
  @Patch('items/:id')
  patchItem(@Param('id', ParseIntPipe) id: number, @Body() dto: ItemPatchDto) {
    return this.defs.updateItem(id, dto);
  }

  @RequirePermissions('inventory.items')
  @Delete('items/:id')
  removeItem(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteItem(id);
  }

  // ── ست به‌عنوانِ بستهٔ موجودی (بستهٔ ب) ──

  @RequirePermissions('inventory.read')
  @Get('sets')
  setsList(@Query('q') q?: string) {
    return this.sets.sets({ q });
  }

  @RequirePermissions('inventory.read')
  @Get('sets/:lotId')
  async setOne(@Param('lotId', ParseIntPipe) lotId: number) {
    const [set] = await this.sets.sets({ lotId });
    return set ?? null;
  }

  /// تکمیل از انبار — بی‌بدنه یعنی همهٔ کسری‌ها (FEFO).
  @RequirePermissions('inventory.write')
  @Post('sets/:lotId/fill')
  setFill(@Param('lotId', ParseIntPipe) lotId: number, @Body() dto: SetFillDto, @CurrentUser() user: any) {
    return this.sets.fill(lotId, dto ?? {}, user);
  }

  /// خرابیِ قلمِ داخلِ ست → محلِ «خرابی‌ها».
  @RequirePermissions('inventory.write')
  @Post('sets/:lotId/damage')
  setDamage(@Param('lotId', ParseIntPipe) lotId: number, @Body() dto: SetMoveDto, @CurrentUser() user: any) {
    return this.sets.damage(lotId, dto, user);
  }

  /// برداشتِ قلم از ست به انبار.
  @RequirePermissions('inventory.write')
  @Post('sets/:lotId/withdraw')
  setWithdraw(@Param('lotId', ParseIntPipe) lotId: number, @Body() dto: SetMoveDto, @CurrentUser() user: any) {
    return this.sets.withdraw(lotId, dto, user);
  }

  // ── «خرابی‌ها»: اسقاط یا تعمیر ──

  @RequirePermissions('inventory.read')
  @Get('damaged')
  damaged() {
    return this.sets.damaged();
  }

  @RequirePermissions('inventory.write')
  @Post('damaged/:lotId/scrap')
  scrap(@Param('lotId', ParseIntPipe) lotId: number, @Body() dto: QuantityNoteDto, @CurrentUser() user: any) {
    return this.sets.scrap(lotId, dto, user);
  }

  @RequirePermissions('inventory.write')
  @Post('damaged/:lotId/repair')
  repair(@Param('lotId', ParseIntPipe) lotId: number, @Body() dto: QuantityNoteDto, @CurrentUser() user: any) {
    return this.sets.repair(lotId, dto, user);
  }

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

  /** موجودیِ در دسترسِ چند کالا (`?items=1,2`) — انتخابگرِ اقلامِ ثبت‌نام؛ فقط نمایش، بی‌رزرو. */
  @RequirePermissions('inventory.read')
  @Get('availability')
  availability(@Query('items') items?: string) {
    return this.inv.availability(String(items ?? '').split(',').map(Number));
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

  /// خرابیِ قلمی در خودِ انبار → «خرابی‌ها» (اسقاط یا تعمیر بعداً همان‌جا).
  @RequirePermissions('inventory.write')
  @Post('lots/:id/damage')
  lotDamage(@Param('id', ParseIntPipe) id: number, @Body() dto: QuantityNoteDto, @CurrentUser() user: any) {
    return this.sets.lotDamage(id, dto, user);
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

  /**
   * تحویلِ دوطرفه (مالک، ۱۴۰۵/۰۷/۱۱): برگهٔ شمارش و «تحویل گرفتم»ِ کارشناس.
   *
   * مجوزِ سبکِ خودش (`stock.consume`) و `@Feature('tech')` — همان درسِ `release`: کارشناسِ
   * سطح ۲ نباید پشتِ ماژولِ انبار (سطح ۳) بماند.
   */
  @Feature('tech')
  @RequirePermissions('stock.consume')
  @Get('transfers/:id/receipt')
  receiptSheet(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.inv.receiptSheet(id, user);
  }

  @Feature('tech')
  @RequirePermissions('stock.consume')
  @Post('transfers/:id/receipt')
  confirmReceipt(@Param('id', ParseIntPipe) id: number, @Body() dto: TransferReceiptDto, @CurrentUser() user: any) {
    return this.inv.confirmReceipt(id, dto, user);
  }

  /**
   * ثبتِ مصرفیِ کارشناس (مالک، ۱۴۰۵/۰۷/۱۱، بستهٔ ج) — برگهٔ یک عمل: از ست، ارسالیِ حواله، از انبار.
   *
   * مجوزِ سبکِ خودش (`stock.consume`) و `@Feature('tech')` — کارشناسِ سطح ۲ نباید پشتِ ماژولِ انبار بماند.
   */
  @Feature('tech')
  @RequirePermissions('stock.consume')
  @Get('visits/:visitId/usage')
  usageSheet(@Param('visitId', ParseIntPipe) visitId: number, @CurrentUser() user: any) {
    return this.usages.sheet(visitId, user);
  }

  @Feature('tech')
  @RequirePermissions('stock.consume')
  @Post('visits/:visitId/usage')
  saveUsage(@Param('visitId', ParseIntPipe) visitId: number, @Body() dto: VisitUsageDto, @CurrentUser() user: any) {
    return this.usages.save(visitId, dto, user);
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

  /**
   * اعلامِ پایانیِ کارشناسِ سرِ عمل — مجوزِ سبک، چون کارِ خودِ اوست.
   *
   * ⚠️ `@Feature('tech')` هم لازم است، نه فقط مجوزِ سبک: ماژولِ این کنترلر
   * `inventory` (سطح ۳) است و کارشناس سطح ۲ دارد. تا وقتی پنلِ کارشناسی ساخته
   * نشده بود، این endpoint برای **همان کسی که برایش نوشته شده بود** بسته بود و
   * کسی نفهمید — مجوزِ درست با ماژولِ غلط یعنی درِ بسته.
   */
  @Feature('tech')
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

  /// شمارشِ برگشتِ ستِ سریالی — شمردم/خرابی؛ گم‌شده حساب می‌شود (بستهٔ ب).
  @RequirePermissions('inventory.write')
  @Post('transfers/:id/return-count')
  returnCount(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnCountDto, @CurrentUser() user: any) {
    return this.sets.returnCount(id, dto, user);
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
