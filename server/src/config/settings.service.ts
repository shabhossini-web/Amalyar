import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../tenant/tenant-context';
import {
  SETTING_BY_KEY, SETTING_GROUPS, SETTINGS, SettingDef,
  coerce, isDefault, parse, serialize,
} from './settings-registry';

/** عمرِ کش. کوتاه است چون چند replica هم‌زمان بالا هستند و هرکدام کشِ خودش را دارد. */
const TTL_MS = 30_000;

/**
 * تنظیماتِ اختصاصیِ هر شرکت.
 *
 * ⚠️ **کش باید با `tenantId` کلید بخورد.** `PrismaService` تک‌نمونه است و
 * تنانت از `AsyncLocalStorage` می‌آید؛ اگر کش بدونِ کلیدِ تنانت باشد، نامِ
 * انبارِ شرکتِ اول روی فاکتورِ شرکتِ دوم چاپ می‌شود — بدترین نوعِ باگ در
 * چندمستأجری، چون سامانه سالم به‌نظر می‌رسد و داده جابه‌جا می‌شود.
 */
@Injectable()
export class SettingsService {
  private cache = new Map<string, { at: number; rows: Map<string, string> }>();

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private tenants: TenantContext,
  ) {}

  private tenantKey(): string {
    return this.tenants.require().tenantId;
  }

  private async rows(): Promise<Map<string, string>> {
    const key = this.tenantKey();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;

    const keys = SETTINGS.map((d) => d.key);
    const found = await this.prisma.setting.findMany({ where: { key: { in: keys } } });
    const rows = new Map(found.map((r) => [r.key, r.value]));
    this.cache.set(key, { at: Date.now(), rows });
    return rows;
  }

  private invalidate() {
    this.cache.delete(this.tenantKey());
  }

  // ── خواندنِ نوع‌دار برای بقیهٔ سرویس‌ها ────────────────────────

  private async raw(key: string): Promise<string | number | boolean> {
    const def = SETTING_BY_KEY.get(key);
    if (!def) throw new Error(`تنظیمِ نااعلام: ${key}`);
    return parse(def, (await this.rows()).get(key));
  }

  async text(key: string): Promise<string> {
    return String(await this.raw(key));
  }

  async num(key: string): Promise<number> {
    return Number(await this.raw(key));
  }

  async bool(key: string): Promise<boolean> {
    return Boolean(await this.raw(key));
  }

  /**
   * متنِ تنظیم، و اگر خالی بود پیش‌فرضِ فراخوان.
   *
   * لازم است چون «خالی» برای بیشترِ متن‌ها یعنی «تنظیم نشده»، نه «رشتهٔ خالی
   * را چاپ کن» — و بدونِ این، هر فراخوان باید خودش `|| something` بنویسد و
   * دیر یا زود یکی‌شان یادش می‌رود.
   */
  async textOr(key: string, fallback: string): Promise<string> {
    const v = (await this.text(key)).trim();
    return v || fallback;
  }

  // ── صفحهٔ تنظیمات ────────────────────────────────────────────

  /** فهرستِ گروه‌بندی‌شده برای رابط. کلاینت هیچ کلیدی را hardcode نمی‌کند. */
  async all() {
    const rows = await this.rows();
    const item = (d: SettingDef) => {
      const value = parse(d, rows.get(d.key));
      return {
        key: d.key,
        label: d.label,
        hint: d.hint ?? null,
        type: d.type,
        value,
        default: d.default,
        // «دست‌نخورده» را صریح می‌گوییم تا کاربر بداند کدام را خودش عوض کرده.
        isDefault: isDefault(d, value),
        min: d.min ?? null,
        max: d.max ?? null,
        maxLength: d.maxLength ?? null,
        ltr: d.ltr ?? false,
      };
    };
    return {
      groups: SETTING_GROUPS.map((g) => ({
        ...g,
        hint: g.hint ?? null,
        items: SETTINGS.filter((d) => d.group === g.key).map(item),
      })).filter((g) => g.items.length > 0),
    };
  }

  /**
   * ذخیرهٔ گروهی.
   *
   * ⚠️ کلیدِ نااعلام **رد می‌شود**، بی‌سروصدا نادیده گرفته نمی‌شود: نادیده‌گرفتن
   * یعنی کاربر «ذخیره شد ✓» ببیند و مقدارش هیچ‌جا نرود.
   */
  async update(patch: Record<string, unknown>, user: any) {
    const entries = Object.entries(patch ?? {});
    if (!entries.length) throw new BadRequestException('چیزی برای ذخیره نیست');

    const unknown = entries.map(([k]) => k).filter((k) => !SETTING_BY_KEY.has(k));
    if (unknown.length) {
      throw new BadRequestException(`تنظیمِ ناشناخته: ${unknown.join('، ')}`);
    }

    const errors: string[] = [];
    const wanted: { def: SettingDef; value: string | number | boolean }[] = [];
    for (const [key, raw] of entries) {
      const def = SETTING_BY_KEY.get(key)!;
      const got = coerce(def, raw);
      if (got.error) errors.push(got.error);
      else wanted.push({ def, value: got.value! });
    }
    // همهٔ ایرادها یک‌جا، نه اولی. کاربر فرم را یک‌بار درست می‌کند.
    if (errors.length) throw new BadRequestException(errors);

    const before = await this.rows();
    const changed: { key: string; from: unknown; to: unknown }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const { def, value } of wanted) {
        const prev = parse(def, before.get(def.key));
        if (serialize(prev) === serialize(value)) continue;
        changed.push({ key: def.key, from: prev, to: value });

        if (isDefault(def, value)) {
          // برابرِ پیش‌فرض = نبودِ ردیف. توضیحش در `isDefault` رجیستری است.
          await tx.setting.deleteMany({ where: { key: def.key } });
        } else {
          const str = serialize(value);
          await tx.setting.upsert({
            where: { key: def.key },
            create: { key: def.key, value: str },
            update: { value: str },
          });
        }
      }
    });

    this.invalidate();

    for (const c of changed) {
      await this.audit.record({
        actorId: user?.id, action: 'settings.update', entityType: 'setting', entityId: 0,
        before: { key: c.key, value: c.from }, after: { key: c.key, value: c.to },
      });
    }

    return { ...(await this.all()), changed: changed.length };
  }

  /** هویتِ شرکت برای سربرگ و فاکتور — یک‌جا، تا هر چاپ‌گر خودش نچیندش. */
  async brand() {
    const rows = await this.rows();
    const get = (k: string) => String(parse(SETTING_BY_KEY.get(k)!, rows.get(k))).trim();
    const name = get('brand_name');
    return {
      name: name || null,
      // نامِ رسمی اگر نبود، همان نامِ برند: سندِ رسمی نباید بی‌نام چاپ شود.
      legalName: get('company_legal_name') || name || null,
      nationalId: get('company_national_id') || null,
      econCode: get('company_econ_code') || null,
      phone: get('company_phone') || null,
      address: get('company_address') || null,
      /// رنگ همیشه مقدار دارد (پیش‌فرضِ رجیستری) — کلاینت نباید fallback بچیند.
      color: get('brand_color') || '#7c3aed',
    };
  }
}
