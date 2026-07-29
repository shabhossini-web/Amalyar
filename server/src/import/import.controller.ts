import { Body, Controller, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ImportService } from './import.service';

/**
 * وارد کردنِ دادهٔ سامانهٔ قبلی.
 *
 * عمداً `@Feature` ندارد: ایمپورت کارِ راه‌اندازی است، نه ماژولی که مشتری
 * روشن/خاموشش کند. مجوزش سوپرادمین است چون کلِ دیتابیسِ شرکت را دست می‌زند.
 */
@Controller('import')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ImportController {
  constructor(private imports: ImportService) {}

  @RequirePermissions('import.run')
  @Post('malekteb')
  malekteb(@Body() dump: any, @Query('dryRun') dryRun: string, @CurrentUser() user: any) {
    return this.imports.malekteb(dump, { dryRun: dryRun === '1' }, user);
  }
}
