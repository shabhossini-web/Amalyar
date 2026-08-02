import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_VERTICAL, VERTICALS, VerticalKey, featurePlanFor, isVertical } from './verticals';
import { SettingsService } from './settings.service';

const KEY_VERTICAL = 'vertical';

/**
 * پیکربندیِ سطحِ شرکت.
 *
 * `vertical` تنها چیزی است که نصبِ یک شرکت را از دیگری متفاوت می‌کند: از رویش
 * هم ماژول‌های فعال ساخته می‌شود، هم واژگانی که کاربر می‌بیند.
 */
@Injectable()
export class ConfigService {
  constructor(private prisma: PrismaService, private audit: AuditService, private settings: SettingsService) {}

  private async read(key: string): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async vertical(): Promise<VerticalKey> {
    const raw = await this.read(KEY_VERTICAL);
    // مقدارِ ناشناخته (مثلاً downgrade نسخه) نباید سامانه را بشکند.
    return isVertical(raw) ? raw : DEFAULT_VERTICAL;
  }

  async get() {
    const [vertical, brand] = await Promise.all([this.vertical(), this.settings.brand()]);
    return {
      vertical,
      verticalLabel: VERTICALS[vertical].label,
      brandName: brand.name,
      /// هویتِ کاملِ شرکت برای سربرگ و فاکتور — یک منبع، تا هر چاپ‌گر خودش
      /// از تنظیمات نچیندش و یکی‌شان از قلم نیفتد.
      brand,
      /// فهرست برای صفحهٔ تنظیمات؛ کلاینت نباید این‌ها را hardcode کند.
      verticals: Object.entries(VERTICALS).map(([key, v]) => ({ key, label: v.label })),
    };
  }

  /**
   * تغییرِ حوزه — ماژول‌ها هم هم‌زمان بازچینی می‌شوند.
   *
   * ⚠️ هیچ داده‌ای پاک یا تبدیل نمی‌شود؛ فقط دسترسی و واژگان عوض می‌شود. برگشت
   * به حوزهٔ قبلی هم همین‌قدر بی‌خطر است.
   */
  async setVertical(value: string, user: any) {
    if (!isVertical(value)) throw new BadRequestException('حوزهٔ کاری نامعتبر است');
    const before = await this.vertical();

    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: KEY_VERTICAL },
        create: { key: KEY_VERTICAL, value },
        update: { value },
      });

      const plan = featurePlanFor(value);
      // ماژولی که در پلانِ حوزهٔ تازه نیست خاموش می‌شود، نه حذف — تا اگر شرکت
      // برگشت، تنظیماتِ قبلی‌اش از دست نرفته باشد.
      const existing = await tx.feature.findMany();
      for (const row of existing) {
        const wanted = plan[row.key];
        await tx.feature.update({
          where: { key: row.key },
          data: wanted ? { minLevel: wanted.minLevel, enabled: true } : { enabled: false },
        });
      }
      for (const [key, wanted] of Object.entries(plan)) {
        if (existing.some((r) => r.key === key)) continue;
        await tx.feature.create({ data: { key, minLevel: wanted.minLevel, enabled: true } });
      }
    });

    await this.audit.record({
      actorId: user?.id, action: 'config.vertical', entityType: 'setting', entityId: 0,
      before: { vertical: before }, after: { vertical: value },
    });
    return this.get();
  }
}
