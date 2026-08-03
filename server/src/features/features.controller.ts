import { Controller, Get, UseGuards } from '@nestjs/common';
import { FeaturesService } from './features.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * ماژول‌های فعال — فقط **خواندنی**.
 *
 * ⚠️ نوشتن عمداً این‌جا نیست: `PATCH /access/features/:key` تنها نویسنده است،
 * چون فقط آن مسیر تغییر را در `audit` ثبت می‌کند و قفلِ ضدِ‌ارتقا را می‌سنجد.
 * مسیرِ دومِ نوشتن یعنی روزی یکی از دو مسیر یکی از این دو کار را فراموش کند و
 * دری بی‌ردپا باز شود.
 */
@Controller('features')
@UseGuards(JwtAuthGuard)
export class FeaturesController {
  constructor(private features: FeaturesService) {}

  /// همهٔ کاربرانِ واردشده — لانچر از همین گیت می‌شود
  @Get()
  list() {
    return this.features.list();
  }
}
