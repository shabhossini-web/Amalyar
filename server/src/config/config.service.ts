import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_VERTICAL, VERTICALS, VerticalKey, featurePlanFor, isVertical } from './verticals';
import { SettingsService } from './settings.service';
import { CANCEL_REASONS, cancelSms } from '../common/cancel-reasons';
import { LEVEL } from '../common/levels';

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
      /// نوعِ پیش‌فرضِ مراجعهٔ تازه — از حوزه (مطب: ویزیت)؛ کلاینت hardcode نمی‌کند.
      defaultKind: VERTICALS[vertical].defaultKind,
      brandName: brand.name,
      /// هویتِ کاملِ شرکت برای سربرگ و فاکتور — یک منبع، تا هر چاپ‌گر خودش
      /// از تنظیمات نچیندش و یکی‌شان از قلم نیفتد.
      brand,
      /// فهرست برای صفحهٔ تنظیمات؛ کلاینت نباید این‌ها را hardcode کند.
      verticals: Object.entries(VERTICALS).map(([key, v]) => ({ key, label: v.label })),
      /**
       * دلیل‌های لغو — مجموعهٔ بستهٔ `common/cancel-reasons.ts`.
       *
       * ⚠️ چرا این‌جا و نه کنارِ خودِ لغو: سه جای لغو (داشبورد، میزِ پذیرش،
       * تقویم) پشتِ سه فیچرِ **متفاوت**اند. هر endpointای که پشتِ یکی از آن سه
       * بنشیند برای دو تای دیگر ۴۰۳ می‌دهد، و سه endpointِ هم‌محتوا یعنی سه
       * جایی که می‌توانند واگرا شوند. `/config` تنها چیزی است که هر کاربرِ
       * واردشده می‌خواند.
       *
       * ⚠️ `sms` **همان جمله‌ای است که واقعاً می‌رود** (بدونِ سربرگ و تاریخ)،
       * چون از همان `cancelSms()` ساخته می‌شود که پیام را می‌سازد. اگر کلاینت
       * متنِ نمونه را خودش می‌نوشت، اولین تغییرِ متنِ پیامک آن را به دروغ
       * تبدیل می‌کرد — و دروغش را کسی نمی‌دید، چون پیش‌نمایش را کارمند می‌بیند
       * و پیامک را بیمار.
       *
       * ⚠️ متنِ `patient` عمداً **خام فرستاده نمی‌شود**: تکه‌ای مثل «به درخواستِ
       * خودتان» بیرون از جمله معنا ندارد و کارمند آن را «چیزی که بیمار
       * می‌گیرد» می‌خواند.
       */
      cancelReasons: Object.entries(CANCEL_REASONS).map(([key, r]) => ({
        key,
        label: r.label,
        sms: {
          visit: cancelSms('visit', key, {}),
          appointment: cancelSms('appointment', key, {}),
        },
      })),
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

      /* ⚠️ **در مطب، بنیان‌گذار خودش پزشک است — و بدونِ `jobRole` هیچ کاری به او نمی‌رسد.**

         `auth.service.ts` هنگامِ ثبت‌نام به اولین سوپرادمین `jobRole: 'doctor'`
         می‌دهد، ولی **فقط اگر حوزه در همان لحظه `clinic` باشد**. و
         `DEFAULT_VERTICAL` برابرِ `ionm` است، یعنی صاحبِ مطب اول ثبت‌نام می‌کند
         و **بعد** حوزه را عوض می‌کند — پس آن شرط روی هیچ نصبِ واقعیِ مطبی
         برقرار نمی‌شود و `jobRole` تا ابد `null` می‌مانَد.

         نتیجه‌اش سکوتِ کامل بود: `work.service.ts` صفِ نقش را
         `ownerRole: user.jobRole ?? '__none__'` می‌سازد، پس کارِ `review_result`
         که قاعدهٔ `order.answered` با `ownerRole: 'doctor'` می‌سازد هیچ‌وقت به
         او نمی‌رسید. باگِ واقعی (۱۴۰۵/۰۶/۳۰): نتیجهٔ مشاورهٔ همان روز روی میزِ
         پزشک دیده می‌شد ولی «کارهای من» می‌گفت «کارِ بازی ندارید».

         ⚠️ فقط وقتی که **یک** سوپرادمینِ فعال باشد — یعنی همان مطبِ تک‌پزشکه.
         با چند سوپرادمین نمی‌شود حدس زد کدامشان پزشک است، و حدسِ غلط یعنی
         کارِ بررسیِ نتیجهٔ پزشکی روی میزِ آدمِ اشتباه. */
      if (value === 'clinic') {
        const admins = await tx.account.findMany({
          where: { level: LEVEL.SUPER_ADMIN, status: 'active' },
          select: { id: true, jobRole: true },
        });
        if (admins.length === 1 && !admins[0].jobRole) {
          await tx.account.update({ where: { id: admins[0].id }, data: { jobRole: 'doctor' } });
        }
      }
    });

    await this.audit.record({
      actorId: user?.id, action: 'config.vertical', entityType: 'setting', entityId: 0,
      before: { vertical: before }, after: { vertical: value },
    });
    return this.get();
  }
}
