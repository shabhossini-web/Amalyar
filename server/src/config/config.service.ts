import { BadRequestException, Injectable } from '@nestjs/common';
import {
  APPT_LABELS, NOTE_KIND_LABELS, OP_LABELS,
  ORDER_LABELS, ORDER_KIND_LABELS, REMINDER_LABELS, REMINDER_KIND_LABELS, INTAKE_LABELS,
  DECISION_LABELS, ANESTHESIA_LABELS, DISPOSITION_LABELS, EXCLUSIVE_DECISION, ORDER_DECISIONS,
  WAITLIST_LABELS, DECISION_CLOSE_LABELS, DECISION_CLOSE_HINTS,
} from '../patients/labels';
import { vitalCatalog } from '../patients/vitals';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_VERTICAL, VERTICALS, VerticalKey, featurePlanFor, isVertical } from './verticals';
import {
  KEY_SERVICES, SERVICES, SERVICE_ORDER, TENANT_KINDS, TenantKind, TenantProfile,
  featureChanges, featureSeedRows, profileError, profileLabel, profileOf, requestedProfile,
} from './tenant-profile';
import { FEATURES } from '../auth/access-registry';
import { seedFeatureRows } from '../features/features.service';
import { SITE_SECTIONS, sectionPlanFor } from '../site/site.registry';
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

  /**
   * **نوعِ نصب + بستهٔ خدمات** — منبعِ واحد برای هر کسی که می‌پرسد «مطب است یا
   * شرکت، و این شرکت چه خدماتی دارد». قاعده در `tenant-profile.ts` است.
   *
   * ⚠️ خوانندهٔ تازه باید از همین بپرسد، نه از `vertical()`: برای شرکتِ
   * دوخدمته `vertical` فقط خدمتِ اصلی است و «ایمپلنت هم دارد» را نمی‌گوید.
   */
  async profile(): Promise<TenantProfile> {
    const [vertical, services] = await Promise.all([this.vertical(), this.read(KEY_SERVICES)]);
    return profileOf(vertical, services);
  }

  async get() {
    const [vertical, brand, profile] = await Promise.all([this.vertical(), this.settings.brand(), this.profile()]);
    return {
      vertical,
      verticalLabel: VERTICALS[vertical].label,
      /**
       * نوعِ نصب و بستهٔ خدمات (`tenant-profile.ts`). `vertical` برای
       * سازگاری می‌ماند و برای شرکت همیشه خدمتِ اصلی است.
       */
      kind: profile.kind,
      services: profile.services,
      profileLabel: profileLabel(profile),
      kinds: Object.entries(TENANT_KINDS).map(([key, v]) => ({ key, label: v.label })),
      serviceCatalog: SERVICE_ORDER.map((key) => ({ key, label: SERVICES[key].label })),
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
      /**
       * **برچسبِ وضعیت‌ها — همان استدلالِ `cancelReasons`.**
       *
       * چند صفحه با چند فیچرِ متفاوت همین فهرست را می‌خواهند (فیلترِ داشبورد،
       * تبِ شرح‌های پرونده، جستجوی بالینی) و `/config` تنها چیزی است که هر
       * کاربرِ واردشده می‌خواند.
       *
       * ⚠️ این فهرست برای جایی است که باید **همهٔ گزینه‌ها** را بشماری (فیلتر،
       * کشویی). برچسبِ یک ردیفِ مشخص از خودِ همان ردیف می‌آید (`opStatusFa`،
       * `statusFa`، `kindFa`) — وگرنه دو مسیرِ برچسب‌زنی داریم و همان واگرایی
       * که این بسته برای بستنش نوشته شد برمی‌گردد.
       */
      statuses: {
        visit: Object.entries(OP_LABELS).map(([key, label]) => ({ key, label })),
        appointment: Object.entries(APPT_LABELS).map(([key, label]) => ({ key, label })),
        note: Object.entries(NOTE_KIND_LABELS).map(([key, label]) => ({ key, label })),
        /* سه خانوادهٔ دیگر که هر کدام سه تا چهار کپیِ کلاینتی داشتند. */
        order: Object.entries(ORDER_LABELS).map(([key, label]) => ({ key, label })),
        orderKind: Object.entries(ORDER_KIND_LABELS).map(([key, label]) => ({ key, label })),
        reminder: Object.entries(REMINDER_LABELS).map(([key, label]) => ({ key, label })),
        reminderKind: Object.entries(REMINDER_KIND_LABELS).map(([key, label]) => ({ key, label })),
        intake: Object.entries(INTAKE_LABELS).map(([key, label]) => ({ key, label })),
        /* بستهٔ ۶: تصمیمِ درمانی، نوعِ بیهوشی و وضعیتِ خروج — کشویی/دکمه‌های
           فرم از همین می‌خوانند، نه از فهرستِ هاردکدِ کلاینت. */
        /* `order`: همان درخواست است و دراپ‌داون نشانش نمی‌دهد (سفارش خودش کلید را می‌گذارد)؛
           `exclusive`: با تصمیمِ دیگری جمع نمی‌شود. هر دو از `labels.ts` — کلاینت فهرست ندارد. */
        decision: Object.entries(DECISION_LABELS).map(([key, label]) => ({
          key, label,
          ...((ORDER_DECISIONS as readonly string[]).includes(key) ? { order: true } : {}),
          ...(key === EXCLUSIVE_DECISION ? { exclusive: true } : {}),
        })),
        anesthesia: Object.entries(ANESTHESIA_LABELS).map(([key, label]) => ({ key, label })),
        disposition: Object.entries(DISPOSITION_LABELS).map(([key, label]) => ({ key, label })),
        /* بستهٔ ۹ج — تب‌های فهرستِ انتظار و دلایلِ بستنِ تصمیم (با جملهٔ راهنمای هرکدام). */
        waitlist: Object.entries(WAITLIST_LABELS).map(([key, label]) => ({ key, label })),
        decisionClose: Object.entries(DECISION_CLOSE_LABELS).map(([key, label]) => ({ key, label, hint: DECISION_CLOSE_HINTS[key] ?? null })),
      },
      /* اندازه‌های علائمِ حیاتی با واحد و بازه — فرم همین را رندر می‌کند و سرور
         با همین (`vitalsInput`) می‌سنجد؛ یک کاتالوگ، دو مصرف. */
      vitals: vitalCatalog(),
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
   * در مطب، بنیان‌گذارِ تنها خودش پزشک است — شرحِ کامل کنارِ فراخوانِ آن در
   * `setVertical`. هر دو مسیرِ «مطب شدن» (حوزهٔ قدیمی و پروفایل) از همین می‌گذرند،
   * وگرنه یکی‌شان روزی `Surgeon`ِ بنیان‌گذار را جا می‌انداخت.
   */
  private async promoteSoleFounder(tx: any) {
    const admins = await tx.account.findMany({
      where: { level: LEVEL.SUPER_ADMIN, status: 'active' },
      select: { id: true, jobRole: true },
    });
    if (admins.length === 1 && !admins[0].jobRole) {
      const row = await tx.account.update({ where: { id: admins[0].id }, data: { jobRole: 'doctor' }, select: { personId: true } });
      /* 🔴 **نقش بدونِ تعریفِ جراح نصفِ کار است — و نصفش بدتر از هیچ است.**
         نسخهٔ اولِ همین بلوک (بستهٔ ۱) فقط `jobRole` را می‌داد. صفِ کار درست
         شد ولی `Surgeon`ی ساخته نشد، و کشویِ **اجباریِ** «پزشک» در فرمِ ویزیت
         از `GET /surgeons` پر می‌شود: صاحبِ مطب می‌نشست پشتِ میزش و در فهرستِ
         پزشکان **خودش نبود**، پس اولین ویزیتش هم ثبت نمی‌شد. `setJobRole` و
         خودِ migration هر دو این upsert را داشتند؛ همین یک مسیر جا افتاده بود
         — همان «دو مسیر برای یک نقش» که کامنتِ `accounts.service.ts` هشدارش
         را می‌دهد. */
      await tx.surgeon.upsert({ where: { personId: row.personId }, update: {}, create: { personId: row.personId } });
    }
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
      /* ⚠️ مسیرِ قدیمیِ «تغییرِ حوزه» بستهٔ خدمات را هم به همان یک حوزه برمی‌گرداند.
         بدونِ این، `vertical=implant` کنارِ یک `services=[ionm]`ِ جامانده
         می‌نشست و دو منبع دو حرف می‌زدند (`profileOf` آن را کهنه می‌خواند، ولی
         ردیفِ جامانده نباید اصلاً بماند). */
      await tx.setting.deleteMany({ where: { key: KEY_SERVICES } });

      const plan = featurePlanFor(value);
      // ماژولی که در پلانِ حوزهٔ تازه نیست خاموش می‌شود، نه حذف — تا اگر شرکت
      // برگشت، تنظیماتِ قبلی‌اش از دست نرفته باشد.
      /* global-07: ردیفِ غایب هم ساخته شود و همین حلقه تکلیفش را بگیرد — وگرنه ساختِ تنبلِ بعدی روشنش می‌کرد. */
      await seedFeatureRows(tx);
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
      if (value === 'clinic') await this.promoteSoleFounder(tx);
    });

    await this.audit.record({
      actorId: user?.id, action: 'config.vertical', entityType: 'setting', entityId: 0,
      before: { vertical: before }, after: { vertical: value },
    });
    return this.get();
  }

  /**
   * **نوعِ نصب و بستهٔ خدمات را خودِ شرکت می‌چیند** (مالک، ۱۴۰۵/۰۷/۰۱).
   *
   * جانشینِ «تغییرِ حوزه» برای صفحهٔ تنظیمات؛ `PATCH /config/vertical` برای
   * سوییت‌ها و بازگشت می‌ماند. تفاوت‌های عمدی با آن:
   *  - ماژول‌ها فقط جایی عوض می‌شوند که عضویتشان در پلان عوض شده
   *    (`featureChanges`) — سطح و خاموش/روشنِ دست‌خورده حفظ می‌شود.
   *  - پروفایلِ بی‌تغییر هیچ نوشتنی ندارد.
   *  - اگر خدمتِ اصلی (و در نتیجه چیدمانِ پیش‌فرضِ سایت) عوض شود، وضعیتِ فعلیِ
   *    بخش‌های سایت اول **ثبت** می‌شود تا سایتِ منتشرشده یک‌شبه بخشِ تازه نگیرد.
   */
  async previewProfile(kind: string, services: string[]) {
    const err = profileError(kind, services);
    if (err) throw new BadRequestException(err);
    const before = await this.profile();
    const after = requestedProfile(kind as TenantKind, services);
    const stored = await this.prisma.feature.findMany({ select: { key: true, minLevel: true, enabled: true } });
    /* global-07: ردیفِ غایب همان‌طور حساب می‌شود که `setProfile` پیش از گذار می‌سازدش (پلانِ قبلی) —
       تا پیش‌نمایش همان را بگوید که ذخیره می‌کند. */
    const have = new Set(stored.map((r) => r.key));
    const rows = [...stored, ...featureSeedRows(before, FEATURES).filter((r) => !have.has(r.key))];
    const label = (key: string) => FEATURES.find((f) => f.key === key)?.label ?? key;
    const changes = featureChanges(before, after, rows).map((c) => ({ ...c, label: label(c.key) }));
    /* خدمتی که برداشته می‌شود: لینک‌های زنده‌اش کار می‌کنند و ثبت‌نام‌های بازش
       همچنان تأییدشدنی‌اند — ولی مدیر باید پیش از ذخیره بداند چند تاست. */
    const removed = before.services.filter((x) => !after.services.includes(x));
    const affected = await Promise.all(removed.map(async (service) => {
      const where = { form: { key: `intake.${service}` } };
      const [links, open] = await Promise.all([
        this.prisma.intakeLink.count({ where: { ...where, active: true } }),
        this.prisma.intakeSubmission.count({ where: { ...where, status: { in: ['pending_fill', 'pending_payment', 'pending_approval'] } } }),
      ]);
      return { service, label: SERVICES[service].label, links, open };
    }));
    const same = before.kind === after.kind && before.services.join() === after.services.join();
    return {
      same,
      before: { kind: before.kind, services: before.services, label: profileLabel(before) },
      after: { kind: after.kind, services: after.services, label: profileLabel(after) },
      changes,
      removed: affected,
      /* واژگان از خدمتِ اصلی می‌آید (`terms.js`)؛ اگر عوض شود مدیر باید بداند. */
      vocabularyChanges: before.primary !== after.primary,
    };
  }

  async setProfile(kind: string, services: string[], user: any) {
    const err = profileError(kind, services);
    if (err) throw new BadRequestException(err);
    const before = await this.profile();
    const after = requestedProfile(kind as TenantKind, services);
    if (before.kind === after.kind && before.services.join() === after.services.join()) return this.get();

    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key: KEY_VERTICAL }, create: { key: KEY_VERTICAL, value: after.primary }, update: { value: after.primary } });
      if (after.kind === 'company') {
        const value = JSON.stringify(after.services);
        await tx.setting.upsert({ where: { key: KEY_SERVICES }, create: { key: KEY_SERVICES, value }, update: { value } });
      } else {
        await tx.setting.deleteMany({ where: { key: KEY_SERVICES } });
      }

      /* global-07: ردیف‌های غایب اول به پروفایلِ **قبلی** ساخته می‌شوند تا گذار روی ردیفِ واقعی حساب
         شود. بی‌این، ماژولی که پلانِ تازه ندارد و ردیفی هم نداشت خاموش نمی‌شد و ساختِ تنبلِ بعدی
         روشنش می‌کرد — «چینشِ نیروها» در لانچرِ مطب. */
      await seedFeatureRows(tx, before);
      const rows = await tx.feature.findMany({ select: { key: true, minLevel: true, enabled: true } });
      for (const c of featureChanges(before, after, rows)) {
        if (c.action === 'create') await tx.feature.create({ data: { key: c.key, minLevel: c.minLevel!, enabled: true } });
        else if (c.action === 'enable') await tx.feature.update({ where: { key: c.key }, data: { minLevel: c.minLevel!, enabled: true } });
        else if (c.action === 'relevel') await tx.feature.update({ where: { key: c.key }, data: { minLevel: c.minLevel! } });
        else await tx.feature.update({ where: { key: c.key }, data: { enabled: false } });
      }

      /* ⚠️ بخشِ بی‌ردیفِ سایت از چیدمانِ خدمتِ اصلی پیش‌فرض می‌گیرد
         (`site.service.ts`)؛ عوض‌شدنِ خدمتِ اصلی یعنی سایتِ منتشرشده بی‌خبر
         بخشِ تازه بگیرد یا بخشی را گم کند. پس وضعیتِ **فعلی** ثبت می‌شود. */
      if (before.primary !== after.primary) {
        const plan = new Set(sectionPlanFor(before.primary));
        await tx.siteSection.createMany({
          data: SITE_SECTIONS.map((d, i) => ({ key: d.key, enabled: plan.has(d.key), sort: i })),
          skipDuplicates: true,
        });
      }

      if (after.kind === 'clinic' && before.kind !== 'clinic') await this.promoteSoleFounder(tx);
    });

    await this.audit.record({
      actorId: user?.id, action: 'config.profile', entityType: 'setting', entityId: 0,
      before: { kind: before.kind, services: before.services }, after: { kind: after.kind, services: after.services },
    });
    return this.get();
  }
}
