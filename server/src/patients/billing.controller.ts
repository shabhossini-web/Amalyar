import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { BillingService } from './billing.service';
import { ChargeCreateDto, PaymentCreateDto } from './dto/billing.dto';

class PricingDto {
  @IsIn(['coded', 'global'], { message: 'مدلِ قیمت‌گذاری نامعتبر است' })
  pricingModel!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'مبلغِ کل باید عددِ صحیح باشد' })
  @Min(0)
  globalAmount?: number;
}

/**
 * صورت‌حسابِ مراجعه — اقلام و پرداخت‌ها.
 *
 * زیرِ `visits/:id` است چون هیچ قلمی بدونِ مراجعه معنا ندارد؛ مالکیت از خودِ
 * URL پیداست و اجازهٔ دسترسی همان‌جا با scope مراجعه سنجیده می‌شود.
 */
@Controller('visits')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dashboard')
export class BillingController {
  constructor(private billing: BillingService) {}

  @RequirePermissions('billing.read')
  @Get(':id/billing')
  get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.billing.get(id, user);
  }

  /** مدلِ قیمت‌گذاری: coded (جمعِ اقلام) یا global (مبلغِ کلِ توافقی). */
  @RequirePermissions('billing.write')
  @Post(':id/billing/pricing')
  setPricing(@Param('id', ParseIntPipe) id: number, @Body() dto: PricingDto, @CurrentUser() user: any) {
    return this.billing.setPricing(id, dto, user);
  }

  @RequirePermissions('billing.write')
  @Post(':id/charges')
  addCharge(@Param('id', ParseIntPipe) id: number, @Body() dto: ChargeCreateDto, @CurrentUser() user: any) {
    return this.billing.addCharge(id, dto, user);
  }

  /**
   * حذفِ قلم. `?returnStock=1` یعنی «کالا واقعاً مصرف نشد، به انبار برگردد» —
   * صریح و پیش‌فرض خاموش، چون این ادعایی دربارهٔ دنیای فیزیکی است که فقط کاربر
   * می‌تواند بکند، نه نتیجهٔ منطقیِ ویرایشِ فاکتور.
   */
  @RequirePermissions('billing.write')
  @Delete('charges/:chargeId')
  removeCharge(
    @Param('chargeId', ParseIntPipe) chargeId: number,
    @Query('returnStock') returnStock: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.billing.removeCharge(chargeId, user, returnStock === '1' || returnStock === 'true');
  }

  @RequirePermissions('billing.write')
  @Post(':id/payments')
  addPayment(@Param('id', ParseIntPipe) id: number, @Body() dto: PaymentCreateDto, @CurrentUser() user: any) {
    return this.billing.addPayment(id, dto, user);
  }

  @RequirePermissions('billing.write')
  @Delete('payments/:paymentId')
  removePayment(@Param('paymentId', ParseIntPipe) paymentId: number, @CurrentUser() user: any) {
    return this.billing.removePayment(paymentId, user);
  }
}
