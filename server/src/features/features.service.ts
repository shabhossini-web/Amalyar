import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LEVEL } from '../common/levels';

/**
 * پیش‌فرض‌ها فقط seed اولیه‌اند؛ منبعِ حقیقت DB است و سوپرادمین تغییرش می‌دهد.
 * enabled بعداً اهرمِ لایسنس/پلنِ SaaS هم می‌شود.
 */
export const FEATURE_DEFAULTS: Record<string, { minLevel: number }> = {
  dashboard: { minLevel: 5 },
  formgen: { minLevel: 5 },
  messenger: { minLevel: 2 },
  accounting: { minLevel: 5 },
  calendar: { minLevel: 4 },
  dispatch: { minLevel: 4 },
  letter: { minLevel: 5 },
  tech: { minLevel: 2 },
  inventory: { minLevel: 3 },
  users: { minLevel: 6 },
};

/// «کاربران» قفلِ سطح ۶ می‌ماند — پایین‌آوردنش یعنی امکانِ ارتقای دسترسی توسط غیرسوپرادمین
const LOCKED_KEYS = new Set(['users']);

@Injectable()
export class FeaturesService {
  constructor(private prisma: PrismaService) {}

  /// seedِ تنبل: کلیدهای غایب با پیش‌فرض ساخته می‌شوند
  private async ensureSeeded() {
    await this.prisma.feature.createMany({
      data: Object.entries(FEATURE_DEFAULTS).map(([key, d]) => ({ key, minLevel: d.minLevel })),
      skipDuplicates: true,
    });
  }

  async list() {
    await this.ensureSeeded();
    const rows = await this.prisma.feature.findMany();
    const order = Object.keys(FEATURE_DEFAULTS);
    rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return rows.map((r) => ({
      key: r.key,
      minLevel: r.minLevel,
      enabled: r.enabled,
      defaultLevel: FEATURE_DEFAULTS[r.key]?.minLevel ?? 6,
      locked: LOCKED_KEYS.has(r.key),
    }));
  }

  async update(key: string, patch: { minLevel?: number; enabled?: boolean }) {
    if (!(key in FEATURE_DEFAULTS)) throw new BadRequestException('ماژولِ ناشناخته');
    if (LOCKED_KEYS.has(key)) throw new BadRequestException('دسترسیِ این ماژول قفل است');
    if (patch.minLevel !== undefined && (patch.minLevel < LEVEL.VIEWER || patch.minLevel > LEVEL.SUPER_ADMIN)) {
      throw new BadRequestException('سطح نامعتبر است');
    }
    await this.ensureSeeded();
    const row = await this.prisma.feature.update({
      where: { key },
      data: {
        ...(patch.minLevel !== undefined ? { minLevel: patch.minLevel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      },
    });
    return { key: row.key, minLevel: row.minLevel, enabled: row.enabled };
  }

  async reset() {
    await this.prisma.feature.deleteMany({});
    await this.ensureSeeded();
    return this.list();
  }
}
