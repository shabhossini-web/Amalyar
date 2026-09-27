import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FEATURES, FEATURE_BY_KEY, FEATURE_DEFAULT_LEVELS, LOCKED_FEATURES } from '../auth/access-registry';
import { LEVEL } from '../common/levels';

/**
 * پیش‌فرضِ سطحِ ماژول‌ها — از رجیستریِ دسترسی می‌آید، نه از فهرستی که این‌جا
 * نوشته شده باشد. منبعِ حقیقتِ زمانِ اجرا همچنان DB است.
 */
export const FEATURE_DEFAULTS = FEATURE_DEFAULT_LEVELS;

/** ماژول‌های کارشناسی — مطب ندارد، حتی برای سوپرادمین (`forUser`). */
const CLINIC_ABSENT = new Set(['tech', 'dispatch']);

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
   * ماژول‌هایی که **این کاربر** واقعاً می‌تواند باز کند.
   *
   * ⚠️ «سطحت کافی است» با «این ماژول به کارِ تو می‌آید» یکی نیست. رانندهٔ سطح
   * ۲ و کارشناسِ سطح ۲ هر دو از فیلترِ سطح رد می‌شوند، پس تا دیروز راننده
   * کاشیِ «پنلِ کارشناسی» را می‌دید و کارشناس کاشیِ «پرتالِ حمل‌ونقل» را —
   * و هر کدام که می‌زد به صفحهٔ خالی یا خطا می‌رسید.
   *
   * پس علاوه بر سطح، **صلاحیتِ نقش** هم سنجیده می‌شود: پرتالِ حمل‌ونقل فقط
   * برای کسی که به یک `TransportStaff` وصل است، و پنلِ کارشناسی فقط برای
   * حسابی که نقشش کارشناسی است.
   *
   * ⚠️ این محاسبه **روی سرور** است و لانچر فقط `allowed` را می‌خواند. تا
   * دیروز کلاینت خودش `level >= minLevel` را حساب می‌کرد؛ دو منبعِ حقیقت
   * برای «چه چیزی را می‌بینم» یعنی روزی یکی‌شان عقب می‌ماند.
   */
  async forUser(user: any) {
    const rows = await this.list();
    const level = user?.level ?? 0;
    /* ⚠️ سوپرادمین **همهٔ** پنل‌ها را می‌بیند — همان قاعدهٔ گاردها (عبورِ
       بی‌قیدِ سطح ۶) و همان انتظارِ کاربر از ملک‌طب: یک نفر باید کلِ چرخه را
       با دیدِ کامل ببیند. تا امروز صلاحیتِ نقش‌محور (راننده/کارشناس) کاشیِ
       سوپرادمین را هم پنهان می‌کرد در حالی که خودِ endpointها برایش باز بودند
       — لانچر و سرور دو حرفِ متفاوت می‌زدند. */
    /* تا بستهٔ ۵ (بازخوردِ مالک ۱۴۰۵/۰۶/۲۹) کاشیِ `surgeon` در مطب همین‌جا برای همه
       خاموش می‌شد («پزشک مطب از داشبورد استفاده می‌کند»). حالا در مطب همان کاشی
       «میزِ پزشک» است و روشن/خاموشش را فقط پلانِ حوزه (`verticals.ts`) و پیوندِ حساب
       به تعریفِ جراح (`eligibility`) تعیین می‌کند — نه یک استثنای هاردکد. */
    if (level >= LEVEL.SUPER_ADMIN) {
      /* ⚠️ **استثنا: بخشِ کارشناسِ مطب** (مالک، ۱۴۰۵/۰۷/۰۵ — «در مطب اصلاً بخشِ کارشناس نداریم،
         گزارش نداریم»). پلانِ مطب `tech` و `dispatch` را ندارد، پس برای بقیه از قبل خاموش‌اند؛
         ولی سوپرادمینِ مطب کاشیِ «پنلِ کارشناسی» را می‌دید و در آن عملِ مطب «آپلودِ گزارش»
         می‌خواست — درحالی‌که سندِ عملِ مطب شرحِ عملِ جراح است. فقط وقتی خاموش‌اند: مطبی که
         خودش از «سطوحِ دسترسی» روشنشان کرده همچنان می‌بیندشان. */
      const clinic = (await this.prisma.setting.findUnique({ where: { key: 'vertical' } }).catch(() => null))?.value === 'clinic';
      return rows.map((r) => {
        const absent = clinic && !r.enabled && CLINIC_ABSENT.has(r.key);
        return { ...r, allowed: !absent, reason: absent ? 'این بخش در مطب نیست' : null };
      });
    }
    const eligible = await this.eligibility(user);
    const jobRole = user?.jobRole ?? '';
    return rows.map((r) => {
      const byLevel = level >= r.minLevel;
      const byRole = eligible[r.key] ?? true;
      /* قیدِ نقشِ ماتریس — AND با سطح؛ آرایهٔ خالی یعنی بدونِ قید. */
      const byJobRole = !r.roles.length || r.roles.includes(jobRole);
      return {
        ...r,
        allowed: r.enabled && byLevel && byRole && byJobRole,
        // دلیل برای صفحه‌ای که کاربر مستقیم نشانی‌اش را تایپ کرده.
        reason: !r.enabled ? 'این بخش غیرفعال است'
          : !byLevel ? 'سطحِ دسترسیِ شما برای این بخش کافی نیست'
            : !byRole ? 'این بخش برای نقشِ دیگری است'
              : !byJobRole ? 'این بخش برای نقشِ شغلیِ شما نیست'
                : null,
      };
    });
  }

  /**
   * صلاحیتِ نقش‌محور — فقط برای ماژول‌هایی که «کیستی» می‌خواهند، نه «سطح».
   *
   * ⚠️ سوپرادمین استثنا **نمی‌شود**: پرتالِ راننده بدونِ رکوردِ راننده حتی
   * برای سوپرادمین هم صفحهٔ خطاست، پس نشان‌دادنش فقط سردرگمی می‌سازد.
   */
  private async eligibility(user: any): Promise<Record<string, boolean>> {
    const id = user?.id ?? -1;
    const account = await this.prisma.account.findUnique({
      where: { id },
      select: { personId: true, level: true },
    });
    const staff = account?.personId
      ? await this.prisma.transportStaff.findFirst({ where: { personId: account.personId, active: true }, select: { id: true } })
      : null;
    const level = account?.level ?? user?.level ?? 0;
    const surgeon = account?.personId ? await this.prisma.surgeon.findFirst({ where: { personId: account.personId, active: true }, select: { id: true } }) : null;
    // بازهٔ سطحی که `listTechs` «کارشناس» می‌داند — تعریفِ دومِ «چه کسی
    // کارشناس است» یعنی روزی لانچر و فهرستِ چینش دو جوابِ متفاوت بدهند.
    const inTechBand = level >= LEVEL.TECH && level <= LEVEL.SUPERVISOR;

    /**
     * ⚠️ **سطح به‌تنهایی راننده را از کارشناس جدا نمی‌کند** — هر دو سطح ۲اند.
     * نسخهٔ اول همین را جا انداخت و راننده همچنان کاشیِ پنلِ کارشناسی را
     * می‌دید. پس رانندهٔ ثبت‌شده کارشناس **نیست**، مگر واقعاً عملی به نامش
     * خورده باشد (کسی که هر دو نقش را دارد پنلش را از دست نمی‌دهد).
     */
    const hasTechVisits = inTechBand
      ? (await this.prisma.visit.count({ where: { techId: id } })) > 0
      : false;

    return {
      // پرتالِ راننده بدونِ رکوردِ نیرو صفحهٔ خطاست — حتی برای سوپرادمین.
      transport: !!staff,
      surgeon: !!surgeon,
      tech: inTechBand && (!staff || hasTechVisits) && (!surgeon || hasTechVisits),
    };
  }

  /**
   * فهرستِ ماژول‌ها — بدونِ در نظر گرفتنِ کاربر. ماتریسِ دسترسی از این می‌خواند.
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
        roles: Array.isArray(r.roles) ? (r.roles as string[]) : [],
        defaultLevel: def?.defaultLevel ?? 6,
        locked: LOCKED_FEATURES.has(r.key),
      };
    });
  }
}
