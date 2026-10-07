import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { decryptDatabaseUrl } from '../tenant/tenant-crypto';
import { DEFAULT_VERTICAL, isVertical } from '../config/verticals';
import { KEY_SERVICES, profileLabel, profileOf, TENANT_KINDS, SERVICES } from '../config/tenant-profile';

export interface ProbedProfile {
  kind: keyof typeof TENANT_KINDS;
  services: (keyof typeof SERVICES)[];
  label: string;
}

const TTL_MS = 60_000;
const TIMEOUT_MS = 2_500;

/**
 * **نوعِ فعلیِ هر شرکت** (مطب/شرکتی + خدمات) برای فهرستِ پنلِ پلتفرم — از خودِ `settings`ِ همان شرکت.
 *
 * ⚠️ عمداً **نسخهٔ دومی در control-db نگه داشته نمی‌شود**: شرکت نوعش را در تنظیماتِ خودش عوض می‌کند و هر
 * رونوشتِ کنترلی روزی کهنه می‌شد و پنل دروغ می‌گفت. پس از همان منبع خوانده می‌شود، با کَشِ کوتاه (۶۰ ثانیه) و
 * سقفِ زمانِ ۲٫۵ ثانیه به‌ازای هر شرکت؛ شرکتی که پاسخ ندهد `null` می‌گیرد و فهرست سالم می‌ماند.
 * فقط دو ردیفِ `vertical`/`services` خوانده می‌شود، از همان کلاینتِ per-tenantِ `PrismaService`.
 */
@Injectable()
export class TenantProfileProbe {
  private readonly cache = new Map<string, { at: number; value: ProbedProfile | null }>();

  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext) {}

  async of(tenant: { id: string; slug: string; status: string; databaseUrlEncrypted: string }): Promise<ProbedProfile | null> {
    if (tenant.status !== 'active') return null;
    const hit = this.cache.get(tenant.id);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    let value: ProbedProfile | null = null;
    try {
      const databaseUrl = decryptDatabaseUrl(tenant.databaseUrlEncrypted);
      const rows = await Promise.race([
        this.context.run(
          { tenantId: tenant.id, tenantSlug: tenant.slug, databaseUrl, hostname: 'platform-probe' },
          () => this.prisma.setting.findMany({ where: { key: { in: ['vertical', KEY_SERVICES] } }, select: { key: true, value: true } }),
        ),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
      ]);
      const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
      const raw = get('vertical');
      const profile = profileOf(isVertical(raw) ? raw : DEFAULT_VERTICAL, get(KEY_SERVICES));
      value = { kind: profile.kind, services: profile.services, label: profileLabel(profile) };
    } catch {
      value = null;
    }
    this.cache.set(tenant.id, { at: Date.now(), value });
    return value;
  }
}
