import { Controller, Get } from '@nestjs/common';
import { TenantMigratorService } from './tenant/tenant-migrator.service';

@Controller()
export class AppController {
  constructor(private readonly migrator: TenantMigratorService) {}

  /**
   * سلامتِ سرویس + وضعیتِ هم‌گامیِ دیتابیسِ شرکت‌ها.
   *
   * عمداً بی‌نام است (فقط شمارش): این مسیر بدونِ احراز هویت است و نامِ شرکت‌ها
   * نباید بیرون برود. `ok` وقتی false می‌شود که شرکتی عقب مانده باشد، تا
   * مانیتورینگ همان را ببیند نه اینکه منتظرِ شکایتِ کاربر بمانیم.
   */
  @Get('health')
  health() {
    const migrations = this.migrator.summary();
    return {
      ok: migrations.failed === 0,
      service: 'amalyar-server',
      ts: new Date().toISOString(),
      migrations,
    };
  }
}
