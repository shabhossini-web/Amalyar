import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { Feature } from '../auth/feature.decorator';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RepairService } from './repair.service';

/**
 * W1.10 — اسکنِ دادهٔ ناقصِ تاریخی و صفِ تطبیق.
 *
 * ⚠️ پشتِ همان مجوزِ `work.process` است، نه یک کلیدِ تازه: هر دو «اجرای دستیِ
 * یک تطبیق‌گرِ پس‌زمینه»اند و دو نامِ متفاوت برای یک اختیار یعنی روزی یکی
 * داده می‌شود و آن یکی نه. سطحِ پیش‌فرضش سوپرادمین است.
 *
 * ⚠️ `scan` و `run` دو مسیرِ جدا هستند و این عمدی است: گزارشِ سلامت معیارِ
 * تصمیم است و اگر خودش بنویسد، «ببینم چه خبر است» با «درستش کن» یکی می‌شود.
 */
@Controller('repair')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('work')
export class RepairController {
  constructor(private repair: RepairService) {}

  @RequirePermissions('work.process')
  @Get('scan')
  scan(@Query('limit') limit?: string) {
    return this.repair.scan(this.limit(limit));
  }

  @RequirePermissions('work.process')
  @Post('run')
  run(@CurrentUser() user: any, @Query('limit') limit?: string) {
    return this.repair.run(user?.id ?? null, this.limit(limit));
  }

  private limit(v?: string) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 2000) : 500;
  }
}
