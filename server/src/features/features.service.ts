import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FEATURES, FEATURE_BY_KEY, FEATURE_DEFAULT_LEVELS, LOCKED_FEATURES } from '../auth/access-registry';
import { LEVEL } from '../common/levels';
import { DEFAULT_VERTICAL, isVertical } from '../config/verticals';
import { KEY_SERVICES, TenantProfile, featurePlanForProfile, featureSeedRows, profileOf } from '../config/tenant-profile';

/**
 * پیش‌فرضِ سطحِ ماژول‌ها — از رجیستریِ دسترسی می‌آید، نه از فهرستی که این‌جا
 * نوشته شده باشد. منبعِ حقیقتِ زمانِ اجرا همچنان DB است.
 */
export const FEATURE_DEFAULTS = FEATURE_DEFAULT_LEVELS;

/**
 * **ساختِ ردیف‌های غایبِ ماژول — به نوعِ همین نصب** (global-07). همهٔ سازنده‌های تنبل (این سرویس،
 * ماتریسِ دسترسی، و دو مسیرِ «عوض‌کردنِ نوع» پیش از گذار) از همین می‌گذرند تا ردیفِ تازه همیشه
 * همان چیزی باشد که پلانِ پروفایل می‌گوید — نه «روشن با سطحِ سراسری» (`featureSeedRows`).
 *
 * `profile` را کسی می‌دهد که پروفایلِ **قبلی** را می‌خواهد (گذارِ نوعِ نصب داخلِ تراکنشی که ردیفِ
 * تنظیمات را همین حالا عوض کرده)؛ بی‌آن، از همان دو ردیفِ تنظیمات خوانده می‌شود. ⚠️ ردیفِ موجود
 * دست نمی‌خورد (`skipDuplicates`) — سطح و خاموش/روشنی که شرکت خودش گذاشته حفظ می‌شود.
 */
export async function seedFeatureRows(db: { setting: any; feature: any }, profile?: TenantProfile) {
  const p = profile ?? await readProfile(db);
  await db.feature.createMany({ data: featureSeedRows(p, FEATURES), skipDuplicates: true });
}

/**
 * **صلاحیتِ نقش‌محور** — ماژول‌هایی که «کیستی» می‌خواهند، نه «سطح» — از روی چهار واقعیتِ حساب.
 *
 * ⚠️ **سطح به‌تنهایی راننده را از کارشناس جدا نمی‌کند** — هر دو سطح ۲اند. رانندهٔ ثبت‌شده
 * کارشناس **نیست**، مگر واقعاً عملی به نامش خورده باشد (کسی که هر دو نقش را دارد پنلش را از دست
 * نمی‌دهد)؛ پزشکِ متصل به تعریفِ جراح هم همین‌طور. بازهٔ سطحِ کارشناس همان است که `listTechs`
 * «کارشناس» می‌داند — تعریفِ دومِ «چه کسی کارشناس است» یعنی روزی لانچر و فهرستِ چینش دو جوابِ
 * متفاوت بدهند.
 *
 * یک قاعده برای دو جا: `forUser` (یک نفر، لانچر) و پیش‌نمایشِ اثرِ تغییر در «سطوحِ دسترسی»
 * (همهٔ کارکنان — `eligibilityOf`). تا بازبینیِ خصمانه (R9) آن صفحه فرمولِ گارد را در کلاینت
 * تکرار می‌کرد و این صلاحیت را نمی‌دید: فهرستِ «از دست می‌دهند»ِ پنلِ کارشناسی راننده‌ها را هم
 * می‌شمرد.
 */
export function eligibleFrom(f: { level: number; staff: boolean; surgeon: boolean; techVisits: boolean }) {
  const inTechBand = f.level >= LEVEL.TECH && f.level <= LEVEL.SUPERVISOR;
  return {
    // پرتالِ راننده بدونِ رکوردِ نیرو صفحهٔ خطاست — حتی برای سوپرادمین.
    transport: f.staff,
    surgeon: f.surgeon,
    tech: inTechBand && (!f.staff || f.techVisits) && (!f.surgeon || f.techVisits),
  };
}

/** ماژول‌هایی که علاوه بر سطح صلاحیتِ نقش هم می‌خواهند (`eligibleFrom`). */
export const ROLE_GATED = new Set(['transport', 'surgeon', 'tech']);

/** صلاحیتِ نقش‌محورِ چند حساب با سه کوئری — نه چهار کوئری به‌ازای هر نفر. */
export async function eligibilityOf(db: any, accounts: { id: number; personId: number | null; level: number }[]) {
  const persons = [...new Set(accounts.map((a) => a.personId).filter((x): x is number => !!x))];
  const ids = accounts.map((a) => a.id);
  const [staff, surgeons, visits] = await Promise.all([
    persons.length ? db.transportStaff.findMany({ where: { personId: { in: persons }, active: true }, select: { personId: true } }) : [],
    persons.length ? db.surgeon.findMany({ where: { personId: { in: persons }, active: true }, select: { personId: true } }) : [],
    ids.length ? db.visit.groupBy({ by: ['techId'], where: { techId: { in: ids } }, _count: { _all: true } }) : [],
  ]);
  const staffP = new Set(staff.map((r: any) => r.personId));
  const surgeonP = new Set(surgeons.map((r: any) => r.personId));
  const techIds = new Set(visits.map((r: any) => r.techId));
  return new Map(accounts.map((a) => [a.id, eligibleFrom({
    level: a.level,
    staff: !!a.personId && staffP.has(a.personId),
    surgeon: !!a.personId && surgeonP.has(a.personId),
    techVisits: techIds.has(a.id),
  })]));
}

/** نوعِ نصب + خدمات از همان دو ردیفِ تنظیمات — همان قاعدهٔ `ConfigService.profile()` (`profileOf`). */
async function readProfile(db: { setting: any }): Promise<TenantProfile> {
  const rows: { key: string; value: string }[] = await db.setting.findMany({ where: { key: { in: ['vertical', KEY_SERVICES] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const raw = get('vertical');
  return profileOf(isVertical(raw) ? raw : DEFAULT_VERTICAL, get(KEY_SERVICES));
}


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

  /// seedِ تنبل: کلیدهای غایب به پلانِ نوعِ همین نصب ساخته می‌شوند (`seedFeatureRows`)
  private async ensureSeeded() {
    await seedFeatureRows(this.prisma);
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
    /* ⚠️ سوپرادمین **همهٔ** پنل‌های **روشن** را می‌بیند — همان قاعدهٔ گاردها (عبورِ
       بی‌قیدِ سطح ۶) و همان انتظارِ کاربر از ملک‌طب: یک نفر باید کلِ چرخه را
       با دیدِ کامل ببیند. تا امروز صلاحیتِ نقش‌محور (راننده/کارشناس) کاشیِ
       سوپرادمین را هم پنهان می‌کرد در حالی که خودِ endpointها برایش باز بودند
       — لانچر و سرور دو حرفِ متفاوت می‌زدند. ماژولِ خاموش اما برای او هم خاموش
       است (پایین، shell-06). */
    /* تا بستهٔ ۵ (بازخوردِ مالک ۱۴۰۵/۰۶/۲۹) کاشیِ `surgeon` در مطب همین‌جا برای همه
       خاموش می‌شد («پزشک مطب از داشبورد استفاده می‌کند»). حالا در مطب همان کاشی
       «میزِ پزشک» است و روشن/خاموشش را فقط پلانِ حوزه (`verticals.ts`) و پیوندِ حساب
       به تعریفِ جراح (`eligibility`) تعیین می‌کند — نه یک استثنای هاردکد. */
    if (level >= LEVEL.SUPER_ADMIN) {
      /* ⚠️ **ماژولِ خاموش برای سوپرادمین هم کاشی ندارد** (بازبینیِ UX، shell-06). تا امروز
         `allowed` برای او فقط «در مطب نبودنِ» پنلِ کارشناس را می‌سنجید و `enabled` را نادیده
         می‌گرفت: مالک ماژولی را در «سطوحِ دسترسی» خاموش می‌کرد و کاشی سرِ جایش می‌ماند — و
         خیال می‌کرد کلید خراب است؛ و «فهرستِ انتظارِ عمل» (فقط مطب) در شرکت به کادرِ قرمزِ
         بی‌راه می‌رسید. سطح و صلاحیتِ نقش همچنان برای او سنجیده نمی‌شوند (همان عبورِ بی‌قیدِ
         سطحِ ۶ در گاردها)؛ فقط روشن/خاموشِ ماژول — اهرمِ پلن — به او هم می‌رسد. و چون ماژولِ
         خاموش **در خودِ جدول** خاموش است، سوپرادمین از «سطوحِ دسترسی» همان را روشن می‌کند.
         ⚠️ **دلیل می‌گوید چرا:** ماژولی که پلانِ همین نوعِ نصب ندارد «در مطب نیست» / «در خدماتِ
         این شرکت نیست» (مالک، ۱۴۰۵/۰۷/۰۵ — «در مطب اصلاً بخشِ کارشناس نداریم»)؛ بقیه «غیرفعال».
         مطبی که خودش از «سطوحِ دسترسی» روشنشان کرده همچنان می‌بیندشان. */
      const profile = await readProfile(this.prisma).catch(() => null);
      const plan = profile ? featurePlanForProfile(profile.kind, profile.services) : null;
      const outside = profile?.kind === 'clinic' ? 'این بخش در مطب نیست' : 'این بخش در خدماتِ این شرکت نیست';
      return rows.map((r) => ({
        ...r,
        allowed: r.enabled,
        reason: r.enabled ? null : plan && !(r.key in plan) ? outside : 'این بخش غیرفعال است',
      }));
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
    /* شمارِ عمل‌ها فقط وقتی به کار می‌آید که سطح در بازهٔ کارشناس باشد (`eligibleFrom`). */
    const inTechBand = level >= LEVEL.TECH && level <= LEVEL.SUPERVISOR;
    const techVisits = inTechBand && (staff || surgeon)
      ? (await this.prisma.visit.count({ where: { techId: id } })) > 0
      : false;
    return eligibleFrom({ level, staff: !!staff, surgeon: !!surgeon, techVisits });
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
