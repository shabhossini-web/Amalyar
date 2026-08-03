import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FEATURES, FEATURE_BY_KEY, FEATURE_DEFAULT_LEVELS, LOCKED_FEATURES } from '../auth/access-registry';

/**
 * پیش‌فرضِ سطحِ ماژول‌ها — از رجیستریِ دسترسی می‌آید، نه از فهرستی که این‌جا
 * نوشته شده باشد. منبعِ حقیقتِ زمانِ اجرا همچنان DB است.
 */
export const FEATURE_DEFAULTS = FEATURE_DEFAULT_LEVELS;

/**
 * خواندنِ ماژول‌ها.
 *
 * ⚠️ **نوشتن این‌جا نیست، در `AccessService` است.** تا دیروز هم این سرویس
 * می‌نوشت هم صفحهٔ کاربران صدایش می‌زد؛ حالا که ماتریسِ دسترسی هر دو لایه را
 * با هم می‌نویسد و در `audit` ثبت می‌کند، مسیرِ دومِ نوشتن یعنی تغییری که هیچ
 * ردی از خودش نمی‌گذارد. برای هر جدول فقط **یک** نویسنده.
 */
@Injectable()
export class FeaturesService {
  constructor(private prisma: PrismaService) {}

  /// seedِ تنبل: کلیدهای غایب با پیش‌فرض ساخته می‌شوند
  private async ensureSeeded() {
    await this.prisma.feature.createMany({
      data: FEATURES.map((f) => ({ key: f.key, minLevel: f.defaultLevel })),
      skipDuplicates: true,
    });
  }

  /**
   * فهرستِ ماژول‌ها برای لانچر — همهٔ کاربرانِ واردشده می‌خوانند.
   * ⚠️ برچسبِ فارسی هم برمی‌گردد تا لانچر و ماتریس نامِ ماژول را hardcode نکنند.
   */
  async list() {
    await this.ensureSeeded();
    const rows = await this.prisma.feature.findMany();
    const order = FEATURES.map((f) => f.key);
    rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return rows.map((r) => {
      const def = FEATURE_BY_KEY.get(r.key);
      return {
        key: r.key,
        label: def?.label ?? r.key,
        hint: def?.hint ?? null,
        minLevel: r.minLevel,
        enabled: r.enabled,
        defaultLevel: def?.defaultLevel ?? 6,
        locked: LOCKED_FEATURES.has(r.key),
      };
    });
  }
}
