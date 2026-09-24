import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { DECISION_CLOSE_LABELS } from './labels';
import { WaitlistService } from './waitlist.service';

class CloseDecisionDto {
  @IsIn(Object.keys(DECISION_CLOSE_LABELS), { message: 'دلیلِ بستن را انتخاب کنید' })
  reason!: string;
}

/**
 * **فهرستِ انتظارِ عمل** (بستهٔ ۹) — ماژولِ خودش (`waitlist`)، فقط مطب.
 * ماژولِ جدا و نه زیرِ `dashboard`: پزشکِ سطح ۲ فهرستِ بیمارانِ منتظرِ خودش را
 * می‌خواهد بی‌آنکه داشبوردِ مالی بگیرد.
 */
@Controller('waitlist')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('waitlist')
export class WaitlistController {
  constructor(private waitlist: WaitlistService) {}

  @RequirePermissions('waitlist.read')
  @Get()
  list(@CurrentUser() user: any) {
    return this.waitlist.list(user);
  }

  @RequirePermissions('waitlist.manage')
  @Post('decisions/:id/close')
  close(@Param('id', ParseIntPipe) id: number, @Body() dto: CloseDecisionDto, @CurrentUser() user: any) {
    return this.waitlist.closeDecision(id, dto.reason, user);
  }

  @RequirePermissions('waitlist.manage')
  @Post('decisions/:id/reopen')
  reopen(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.waitlist.reopenDecision(id, user);
  }
}
