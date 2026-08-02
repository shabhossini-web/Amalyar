import { Global, Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * ⚠️ Global است چون `SettingsService` را ماژول‌های دیگر هم می‌خوانند (انبار،
 * حمل، فاکتور). جایگزینش تکرارِ import در هر ماژول بود، که دیر یا زود یکی
 * جا می‌ماند و همان‌جا مقدارِ hardcode برمی‌گردد.
 */
@Global()
@Module({
  controllers: [ConfigController, SettingsController],
  providers: [ConfigService, SettingsService],
  exports: [ConfigService, SettingsService],
})
export class TenantConfigModule {}
