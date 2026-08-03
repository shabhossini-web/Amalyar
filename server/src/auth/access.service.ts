import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LEVEL, LEVEL_NAMES, MAX_LEVEL, MIN_LEVEL } from '../common/levels';
import {
  ACCESS_GROUPS,
  AccessDef,
  FEATURES,
  FEATURE_BY_KEY,
  LOCKED_FEATURES,
  LOCKED_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_BY_KEY,
} from './access-registry';

export type AccessKind = 'feature' | 'permission';

export interface AccessPatch {
  minLevel?: number;
  enabled?: boolean;
}

/** یک ردیفِ ماتریس، همان‌طور که رابط می‌بیندش. */
export interface AccessRow {
  kind: AccessKind;
  key: string;
  label: string;
  hint: string | null;
  group: string;
  minLevel: number;
  enabled: boolean;
  defaultLevel: number;
  locked: boolean;
  /** «دست‌نخورده» صریح گفته می‌شود تا مدیر بداند کدام را خودش عوض کرده. */
  isDefault: boolean;
}

/**
 * ماتریسِ دسترسی — تنها نویسندهٔ جدول‌های `features` و `permissions`.
 *
 * دو لایه با هم مدیریت می‌شوند چون از دیدِ مدیر یک سؤال‌اند: «سطح ۳ به چه
 * چیزهایی دسترسی دارد؟» جداکردنشان در رابط یعنی مدیر باید در ذهنش دو جدول
 * را روی هم بگذارد — و همان‌جاست که ماژولِ باز با مجوزِ بستهٔ متناظر (یا
 * برعکس) ساخته می‌شود.
 *
 * ⚠️ **هر نوشتن در `audit` ثبت می‌شود.** تغییرِ بی‌ردِ دسترسی یعنی شش ماه بعد
 * هیچ‌کس نمی‌داند چه کسی در را باز کرد — و دقیقاً همان چیزی است که در بازرسی
 * پرسیده می‌شود.
 */
@Injectable()
export class AccessService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ── seedِ تنبل ────────────────────────────────────────────────

  private async ensureSeeded() {
    await this.prisma.feature.createMany({
      data: FEATURES.map((f) => ({ key: f.key, minLevel: f.defaultLevel })),
      skipDuplicates: true,
    });
    await this.prisma.permission.createMany({
      data: PERMISSIONS.map((p) => ({ key: p.key, minLevel: p.defaultLevel })),
      skipDuplicates: true,
    });
  }

  // ── خواندنِ ماتریس ────────────────────────────────────────────

  private row(kind: AccessKind, def: AccessDef, stored?: { minLevel: number; enabled: boolean }): AccessRow {
    const minLevel = stored?.minLevel ?? def.defaultLevel;
    const enabled = stored?.enabled ?? true;
    return {
      kind,
      key: def.key,
      label: def.label,
      hint: def.hint ?? null,
      group: def.group,
      minLevel,
      enabled,
      defaultLevel: def.defaultLevel,
      locked: this.isLocked(kind, def.key),
      isDefault: enabled && minLevel === def.defaultLevel,
    };
  }

  /**
   * کلِ ماتریس در یک درخواست.
   *
   * ⚠️ برچسب‌ها و نامِ سطوح هم برمی‌گردند تا کلاینت هیچ کلیدی را hardcode نکند —
   * همان قاعدهٔ `settings-registry`. اگر رابط برچسبِ خودش را داشت، افزودنِ مجوزِ
   * تازه دو تغییر لازم داشت و دیر یا زود یکی‌شان جا می‌ماند؛ آن‌وقت مدیر ردیفی
   * می‌دید با نامِ `stock.consume` که نمی‌داند چیست.
   */
  async matrix() {
    await this.ensureSeeded();
    const [features, permissions] = await Promise.all([
      this.prisma.feature.findMany(),
      this.prisma.permission.findMany(),
    ]);
    const fMap = new Map(features.map((r) => [r.key, r]));
    const pMap = new Map(permissions.map((r) => [r.key, r]));

    const rows: AccessRow[] = [
      ...FEATURES.map((d) => this.row('feature', d, fMap.get(d.key))),
      ...PERMISSIONS.map((d) => this.row('permission', d, pMap.get(d.key))),
    ];

    return {
      levels: Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => ({
        value: MIN_LEVEL + i,
        label: LEVEL_NAMES[MIN_LEVEL + i],
      })),
      groups: ACCESS_GROUPS.map((g) => ({
        key: g.key,
        label: g.label,
        hint: g.hint ?? null,
        rows: rows.filter((r) => r.group === g.key),
      })).filter((g) => g.rows.length > 0),
      changed: rows.filter((r) => !r.isDefault).length,
    };
  }

  // ── نوشتن ────────────────────────────────────────────────────

  private isLocked(kind: AccessKind, key: string) {
    return kind === 'feature' ? LOCKED_FEATURES.has(key) : LOCKED_PERMISSIONS.has(key);
  }

  private def(kind: AccessKind, key: string): AccessDef {
    const def = kind === 'feature' ? FEATURE_BY_KEY.get(key) : PERMISSION_BY_KEY.get(key);
    if (!def) throw new NotFoundException(kind === 'feature' ? 'ماژولِ ناشناخته' : 'مجوزِ ناشناخته');
    return def;
  }

  /**
   * ⚠️ **درِ ضدِ‌ارتقا.**
   *
   * قفل روی **خودِ کلید** است، نه روی سطحِ فعلی‌اش. اگر شرط «سطحش ۶ باشد»
   * بود، یک PATCH آن را ۵ می‌کرد و PATCHِ بعدی دیگر چیزی برای محافظت
   * نمی‌دید. `users` / `access` / `users.manage` تنها درهای ارتقای دسترسی
   * در سامانه‌اند؛ باز شدنشان یعنی سطح ۵ می‌تواند خودش را ۶ کند و بقیهٔ
   * قفل‌ها بی‌معنا شوند.
   *
   * برعکسش — قفل‌شدنِ خودِ مدیر بیرونِ سامانه — ممکن نیست: هر دو گارد برای
   * سطح ۶ زودتر `true` برمی‌گردانند و این endpointها هم `MinLevel(6)` دارند.
   */
  private guardLock(kind: AccessKind, key: string) {
    if (!this.isLocked(kind, key)) return;
    throw new BadRequestException(
      kind === 'feature'
        ? 'این ماژول قفل است و سطحش عوض نمی‌شود'
        : 'این مجوز قفل است و سطحش عوض نمی‌شود',
    );
  }

  private guardLevel(minLevel?: number) {
    if (minLevel === undefined) return;
    if (!Number.isInteger(minLevel) || minLevel < LEVEL.VIEWER || minLevel > LEVEL.SUPER_ADMIN) {
      throw new BadRequestException('سطح نامعتبر است');
    }
  }

  async update(kind: AccessKind, key: string, patch: AccessPatch, user: any) {
    const def = this.def(kind, key);
    this.guardLock(kind, key);
    this.guardLevel(patch.minLevel);
    if (patch.minLevel === undefined && patch.enabled === undefined) {
      throw new BadRequestException('چیزی برای تغییر نیست');
    }
    return this.write(kind, def, {
      minLevel: patch.minLevel ?? undefined,
      enabled: patch.enabled ?? undefined,
    }, user, `access.${kind}.update`);
  }

  /** بازگرداندنِ یک ردیف به پیش‌فرضِ کد. */
  async resetOne(kind: AccessKind, key: string, user: any) {
    const def = this.def(kind, key);
    this.guardLock(kind, key);
    return this.write(kind, def, { minLevel: def.defaultLevel, enabled: true }, user, `access.${kind}.reset`);
  }

  private async write(
    kind: AccessKind,
    def: AccessDef,
    patch: AccessPatch,
    user: any,
    action: string,
  ) {
    await this.ensureSeeded();
    const table = kind === 'feature' ? this.prisma.feature : this.prisma.permission;

    const before = await (table as any).findUnique({ where: { key: def.key } });
    const prev = {
      minLevel: before?.minLevel ?? def.defaultLevel,
      enabled: before?.enabled ?? true,
    };
    const next = {
      minLevel: patch.minLevel ?? prev.minLevel,
      enabled: patch.enabled ?? prev.enabled,
    };

    // بی‌تغییر = بی‌رکورد. وگرنه دفترِ رویدادها پر می‌شود از ردیف‌هایی که چیزی
    // نگفته‌اند و تغییرِ واقعی بینشان گم می‌شود.
    if (prev.minLevel === next.minLevel && prev.enabled === next.enabled) {
      return this.row(kind, def, next);
    }

    await (table as any).upsert({
      where: { key: def.key },
      create: { key: def.key, minLevel: next.minLevel, enabled: next.enabled },
      update: { minLevel: next.minLevel, enabled: next.enabled },
    });

    await this.audit.record({
      actorId: user?.id,
      action,
      entityType: kind,
      entityId: def.key,
      before: { key: def.key, label: def.label, ...prev },
      after: { key: def.key, label: def.label, ...next },
    });

    return this.row(kind, def, next);
  }

  /**
   * بازگرداندنِ **کلِ** ماتریس به پیش‌فرض.
   *
   * ⚠️ حذفِ ردیف‌ها کافی نیست و عمداً upsert می‌شود: با حذف، رکوردِ audit
   * «چه چیزی عوض شد» را از دست می‌داد و دفعهٔ بعد `ensureSeeded` بی‌سروصدا
   * ردیف می‌ساخت. این‌جا هر ردیفِ غیرپیش‌فرض جداگانه ثبت می‌شود.
   */
  async resetAll(user: any) {
    await this.ensureSeeded();
    const [features, permissions] = await Promise.all([
      this.prisma.feature.findMany(),
      this.prisma.permission.findMany(),
    ]);
    const fMap = new Map(features.map((r) => [r.key, r]));
    const pMap = new Map(permissions.map((r) => [r.key, r]));

    let changed = 0;
    for (const def of FEATURES) {
      if (LOCKED_FEATURES.has(def.key)) continue;
      const cur = fMap.get(def.key);
      if (cur && cur.minLevel === def.defaultLevel && cur.enabled) continue;
      await this.write('feature', def, { minLevel: def.defaultLevel, enabled: true }, user, 'access.feature.reset');
      changed += 1;
    }
    for (const def of PERMISSIONS) {
      if (LOCKED_PERMISSIONS.has(def.key)) continue;
      const cur = pMap.get(def.key);
      if (cur && cur.minLevel === def.defaultLevel && cur.enabled) continue;
      await this.write('permission', def, { minLevel: def.defaultLevel, enabled: true }, user, 'access.permission.reset');
      changed += 1;
    }

    return { ...(await this.matrix()), reverted: changed };
  }
}
