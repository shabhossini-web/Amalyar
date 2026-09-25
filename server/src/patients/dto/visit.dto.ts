import { CANCEL_REASON_KEYS } from '../../common/cancel-reasons';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EnDigits, IsNationalId } from '../../common/validators';
import { PAYERS } from '../settlement.service';
import { ANESTHESIA_KEYS, DECISION_KEYS } from '../labels';

/**
 * نوع‌های **پایه‌ی** ملاقات — نه فهرستِ کامل.
 *
 * ⚠️ تا دیروز این فهرست بسته بود و هر مراجعه‌ای باید یکی از این چهار می‌شد.
 * ولی مسیرِ درمان جایگشتِ زیادی دارد: یک مطب «ویزیت → درمان → پیگیری» دارد،
 * دیگری «ویزیت → جراحی → ادامه‌ی درمان → پیگیری»، و مطبِ داخلی اصلاً جراحی
 * ندارد. هر فهرستِ ثابتی دستِ‌کم یکی از این‌ها را غلط می‌کند.
 *
 * حالا نوعِ معتبر = نوعی که **فرم دارد** (`FormDef.visitKind`). این‌ها فقط
 * پیش‌فرضِ seed و پشتوانه‌ی نصب‌های قدیمی‌اند تا داده‌ی موجود نامعتبر نشود.
 * اعتبارسنجیِ واقعی در سرویس است نه در دکوراتور — چون class-validator
 * فهرستش را در زمانِ کامپایل می‌خواهد و این فهرست را کاربر در زمانِ اجرا
 * می‌سازد. همان دلیلِ اعتبارسنجیِ اجباری‌بودن.
 */
export const VISIT_KINDS = ['surgery', 'clinic', 'followup', 'consult'] as const;
/** تصمیمِ درمانیِ ویزیت — کلیدها از `DECISION_LABELS` (تنها خانهٔ برچسب‌ها). */
export const DECISIONS = DECISION_KEYS;

/// ثبتِ مراجعه — یا patientId (بیمارِ موجود) یا نام/نام‌خانوادگی (بیمارِ جدید)
export class CreateVisitDto {
  /// خدمتِ مراجعه در نصبِ شرکتی (`ionm` | `implant`)؛ شرکتِ تک‌خدمته خالی بگذارد، خودش پر می‌شود.
  @IsOptional() @IsIn(['ionm', 'implant', ''], { message: 'خدمتِ مراجعه نامعتبر است' })
  service?: string;

  /// اعتبارش در `assertKind` سنجیده می‌شود، نه این‌جا — فهرست پویاست.
  @IsOptional() @IsString() @MaxLength(40)
  kind?: string;

  @IsOptional()
  @IsInt({ message: 'شناسهٔ بیمار نامعتبر است' })
  patientId?: number;

  @ValidateIf((o) => !o.patientId)
  @IsString({ message: 'نام را وارد کنید' })
  @MinLength(2, { message: 'نام کوتاه است' })
  @MaxLength(60, { message: 'نام طولانی است' })
  firstName?: string;

  @ValidateIf((o) => !o.patientId)
  @IsString({ message: 'نام خانوادگی را وارد کنید' })
  @MinLength(2, { message: 'نام خانوادگی کوتاه است' })
  @MaxLength(60, { message: 'نام خانوادگی طولانی است' })
  lastName?: string;

  @IsOptional()
  @EnDigits()
  @Matches(/^09\d{9}$/, { message: 'شمارهٔ موبایل نامعتبر است (مثال: 09121234567)' })
  phone?: string;

  @IsOptional()
  @EnDigits()
  @ValidateIf((o) => o.nationalId !== '')
  @IsNationalId()
  nationalId?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'تاریخ تولد نامعتبر است' })
  birthDate?: string;

  @IsOptional()
  @IsInt({ message: 'جراح نامعتبر است' })
  surgeonId?: number;

  @IsOptional()
  @IsInt({ message: 'بیمارستان نامعتبر است' })
  hospitalId?: number;

  @IsOptional()
  @IsInt({ message: 'کارشناس نامعتبر است' })
  techId?: number;

  @IsOptional()
  @IsInt({ message: 'نوع عمل نامعتبر است' })
  procedureTypeId?: number;

  @IsOptional()
  @IsInt({ message: 'تشخیص نامعتبر است' })
  diagnosisId?: number;

  /**
   * **سایرِ تشخیص‌ها** به ترتیبِ اهمیت (رتبهٔ ۲ به بعد) — بستهٔ ۷ب.
   * تشخیصِ اصلی همان `diagnosisId` است. نبودنِ کلید = دست نزن؛ `[]` یا `null` = پاک کن.
   * ⚠️ باید در DTO اعلام شود: `ValidationPipe({ whitelist: true })` کلیدِ
   * اعلام‌نشده را بی‌صدا دور می‌ریزد (نگهبانِ CI).
   */
  @IsOptional()
  @IsArray({ message: 'فهرستِ تشخیص‌ها نامعتبر است' })
  @ArrayMaxSize(9, { message: 'حداکثر ۱۰ تشخیص برای یک مراجعه (یک اصلی و ۹ دیگر)' })
  @IsInt({ each: true, message: 'تشخیص نامعتبر است' })
  @Min(1, { each: true, message: 'تشخیص نامعتبر است' })
  otherDiagnosisIds?: number[] | null;

  /** **سایرِ عمل‌ها**ی همان جلسه (رتبهٔ ۲ به بعد) — بستهٔ ۷ج. همان قواعد. */
  @IsOptional()
  @IsArray({ message: 'فهرستِ عمل‌ها نامعتبر است' })
  @ArrayMaxSize(9, { message: 'حداکثر ۱۰ عمل برای یک مراجعه (یک اصلی و ۹ دیگر)' })
  @IsInt({ each: true, message: 'نوعِ عمل نامعتبر است' })
  @Min(1, { each: true, message: 'نوعِ عمل نامعتبر است' })
  otherProcedureTypeIds?: number[] | null;

  /** موضوعِ ویزیت — اولیه / پست‌آپ / زیبایی. `docs/BOOKING.md` مرحلهٔ ۱. */
  @IsOptional()
  @IsInt({ message: 'موضوعِ ویزیت نامعتبر است' })
  topicId?: number;

  /** متنِ آزادِ نوعِ عمل — فقط برای سازگاری با رکوردهای قدیمی نگه داشته شده. */
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'نوع عمل طولانی است' })
  opType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'شرحِ عمل طولانی است' })
  opReport?: string;

  /* ── بخش‌های متنیِ هستهٔ ثابت (بستهٔ ۶الف) — هر کدام سندِ نسخه‌دارِ خودش
     (`SECTION_NOTES`). سقف‌ها همان سقفِ شرحِ عمل: یادداشتِ بالینیِ واقعی
     بلند می‌شود و بریدنِ بی‌صدا از ردکردن بدتر است. */
  @IsOptional() @IsString() @MaxLength(5000, { message: 'شرحِ حال طولانی است' })
  history?: string;

  @IsOptional() @IsString() @MaxLength(5000, { message: 'شرحِ معاینه طولانی است' })
  exam?: string;

  @IsOptional() @IsString() @MaxLength(5000, { message: 'یافته‌ها طولانی است' })
  findings?: string;

  @IsOptional() @IsString() @MaxLength(5000, { message: 'طرحِ درمان طولانی است' })
  planNote?: string;

  @IsOptional() @IsString() @MaxLength(5000, { message: 'نسخه طولانی است' })
  prescription?: string;

  /// نوعِ بیهوشی — کلیدی از `ANESTHESIA_LABELS`.
  @IsOptional() @IsIn(ANESTHESIA_KEYS, { message: 'نوعِ بیهوشی نامعتبر است' })
  anesthesia?: string;

  /// علائمِ حیاتیِ لحظهٔ ثبت — اختیاری؛ یک شیء، یا تا سه (فرمِ عمل: یکی به‌ازای هر مرحلهٔ
  /// الصاق‌شده). شکل و بازه در `vitalsRowsFor` سنجیده می‌شود — همان قراردادِ ویرایش.
  @IsOptional()
  vitals?: Record<string, unknown> | Record<string, unknown>[];

  /// زیرفرم‌های الصاقی (۱۴۰۵/۰۷/۰۳) — `[{ key, data?, removed? }]`؛ شکلِ دقیق و سنجشِ
  /// پاسخ‌ها در `planSubforms` (تعریفِ زیرفرم را سوپرادمین در زمانِ اجرا می‌سازد).
  @IsOptional() @IsArray({ message: 'زیرفرم‌ها نامعتبر است' })
  subforms?: Record<string, unknown>[];

  /**
   * مبلغِ توافقی — **تومان**، فقط هنگامِ **ساخت**.
   *
   * ⚠️ تا امروز فرمِ مراجعه هیچ مبلغی نداشت و کاربر باید بعداً صورت‌حساب را
   * جدا باز می‌کرد؛ نتیجه‌اش مراجعه‌های صفرتومانی بود که در گزارشِ مالی
   * دیده نمی‌شدند. این‌جا یک **قلمِ خدمت** می‌سازد، نه ستونی روی مراجعه:
   * جمعِ فاکتور همچنان از قلم‌ها مشتق می‌شود و فردا که قلمِ دوم اضافه شد،
   * دو منبعِ حقیقت برای «مبلغِ این عمل» وجود نخواهد داشت.
   *
   * ⚠️ در **ویرایش** پذیرفته نمی‌شود: ویرایشِ مراجعه نباید بی‌سروصدا قلمِ
   * تازه بسازد. اصلاحِ مبلغ کارِ صورت‌حساب است.
   */
  @IsOptional() @Type(() => Number) @IsInt({ message: 'مبلغ باید عددِ صحیح باشد' })
  @Min(0, { message: 'مبلغ نمی‌تواند منفی باشد' })
  amount?: number;

  @IsOptional()
  @IsISO8601({}, { message: 'تاریخ عمل نامعتبر است' })
  opDate?: string;

  /// «ویزیتِ بعدی» — پزشک روی خودِ فرم ثبت می‌کند؛ ستونِ واقعی، پایهٔ یادآوری‌ها.
  /// پاک‌کردن با `null` است نه رشتهٔ خالی (IsISO8601 رشتهٔ خالی را رد می‌کند).
  @IsOptional()
  @IsISO8601({}, { message: 'تاریخِ ویزیتِ بعدی نامعتبر است' })
  nextVisitDate?: string;

  /// پیگیریِ اختصاصیِ همین بیمار — خالی = قالب/روزهای نوعِ عمل.
  @IsOptional() @IsString() @MaxLength(2000, { message: 'متنِ مراقبت طولانی است' })
  postOpCare?: string;

  @IsOptional() @IsString() @MaxLength(60, { message: 'روزهای پیگیری طولانی است' })
  followUpDays?: string;

  /// پیامکِ مراقبت بلافاصله بعد از ثبت برود، نه فردای عمل.
  @IsOptional() @IsBoolean({ message: 'زمانِ ارسالِ مراقبت نامعتبر است' })
  postOpImmediate?: boolean;

  /// مراقبتِ قبل از عمل — خالی = قالبِ نوعِ عمل.
  @IsOptional() @IsString() @MaxLength(2000, { message: 'متنِ مراقبتِ قبل از عمل طولانی است' })
  preOpCare?: string;

  /// مراقبتِ قبل از عمل، علاوه بر موعدِ مقرر، همین حالا هم برود.
  @IsOptional() @IsBoolean({ message: 'زمانِ ارسالِ مراقبتِ قبل از عمل نامعتبر است' })
  preOpImmediate?: boolean;

  /// تصمیمِ درمانیِ ویزیت — چندتایی؛ مقدارهای مجاز در DECISIONS.
  @IsOptional() @IsArray() @IsIn(DECISIONS, { each: true, message: 'تصمیمِ درمانی نامعتبر است' })
  decisions?: string[];

  /// شکایتِ اولیه — «چرا آمده»، به زبانِ خودِ بیمار. ستونِ واقعی است.
  @IsOptional() @IsString() @MaxLength(2000, { message: 'شکایتِ اولیه طولانی است' })
  chiefComplaint?: string;

  /// ویزیتی که تصمیمِ عمل در آن گرفته شد — عملِ ساخته‌شده شکایتش را از آن
  /// **مشتق** می‌کند. تعلقش به همان بیمار در سرویس سنجیده می‌شود.
  @IsOptional() @IsInt({ message: 'شناسهٔ ویزیتِ تصمیم نامعتبر است' })
  decidedInVisitId?: number;

  /// ساعت‌ها: «۰۸:۳۰». اعتبارسنجیِ دقیق و نرمال‌سازیِ ارقامِ فارسی در سرویس
  /// (`normalizeTime`) انجام می‌شود؛ این‌جا فقط از رشته‌بودن و طول مطمئن می‌شویم
  /// تا یک regex در دو جا تکرار نشود.
  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  opStartTime?: string;

  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  opEndTime?: string;

  /* ⚠️ `techArriveTime` عمداً نیست (W3.8/U7): ساعتِ حضور از برنامهٔ چینش
     (`hospital_duties`) می‌آید و تنها نویسنده‌اش `syncVisitDuty()` است.
     `whitelist`ِ ValidationPipe مقدارِ کلاینتِ قدیمی را بی‌صدا دور می‌ریزد. */
  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  cargoDueTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'یادداشت طولانی است' })
  notes?: string;

  /**
   * پاسخِ فیلدهای **دلخواه** — کلیدِ فیلد به مقدار.
   *
   * ⚠️ عمداً بدونِ دکوراتورِ ساختاری: شکلش را سوپرادمین در فرم‌ساز تعیین
   * می‌کند، نه ما در زمانِ کامپایل. اعتبارسنجیِ واقعی (اجباری‌بودن) در
   * `FormsService.assertValid` انجام می‌شود، جایی که تعریفِ فرم در دسترس است.
   *
   * ⚠️ `@IsObject()` لازم است وگرنه `ValidationPipe` با `whitelist: true` این
   * فیلد را **بی‌صدا دور می‌ریزد** و پاسخ‌های کاربر هرگز به سرور نمی‌رسند.
   */
  @IsOptional() @IsObject({ message: 'فیلدهای دلخواه نامعتبرند' })
  extra?: Record<string, any>;
}

/// ویرایشِ مراجعه — همهٔ فیلدها اختیاری؛ نام/موبایل بیمار هم قابلِ اصلاح است
export class UpdateVisitDto {
  /// اعتبارش در `assertKind` سنجیده می‌شود، نه این‌جا — فهرست پویاست.
  @IsOptional() @IsString() @MaxLength(40)
  kind?: string;

  /// خدمتِ مراجعه در نصبِ شرکتی؛ '' یعنی پاک کن. بستهٔ شرکت در سرویس سنجیده می‌شود (`visitServiceOf`).
  @IsOptional() @IsIn(['ionm', 'implant', ''], { message: 'خدمتِ مراجعه نامعتبر است' })
  service?: string;

  /// طرفِ حسابِ فاکتور — بیمار یا بیمارستان.
  @IsOptional()
  @IsIn(PAYERS as unknown as string[], { message: 'طرفِ حساب نامعتبر است' })
  payer?: string;

  @IsOptional() @ValidateIf((o) => o.payerHospitalId !== null)
  @Type(() => Number) @IsInt({ message: 'بیمارستانِ طرفِ حساب نامعتبر است' })
  payerHospitalId?: number | null;

  /// استثنای قراردادِ جراح برای همین مراجعه. رشتهٔ خالی یعنی «برگرد به قرارداد».
  @IsOptional()
  @IsIn(['percent', 'fixed', ''], { message: 'نوعِ سهمِ جراح نامعتبر است' })
  surgeonShareKind?: string | null;

  @IsOptional() @ValidateIf((o) => o.surgeonShareValue !== null)
  @Type(() => Number) @IsInt({ message: 'مقدارِ سهمِ جراح باید عددِ صحیح باشد' })
  @Min(0, { message: 'مقدارِ سهمِ جراح نمی‌تواند منفی باشد' })
  surgeonShareValue?: number | null;

  /// هزینهٔ مستقیمِ این کیس (تومان) — تا ماژولِ هزینه‌ها بیاید، دستی.
  @IsOptional() @ValidateIf((o) => o.caseCost !== null)
  @Type(() => Number) @IsInt({ message: 'هزینهٔ کیس باید عددِ صحیح باشد' })
  @Min(0, { message: 'هزینهٔ کیس نمی‌تواند منفی باشد' })
  caseCost?: number | null;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'نام کوتاه است' })
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'نام خانوادگی کوتاه است' })
  @MaxLength(60)
  lastName?: string;

  @IsOptional()
  @EnDigits()
  @ValidateIf((o) => o.phone !== '')
  @Matches(/^09\d{9}$/, { message: 'شمارهٔ موبایل نامعتبر است' })
  phone?: string;

  @IsOptional()
  @EnDigits()
  @ValidateIf((o) => o.nationalId !== '')
  @IsNationalId()
  nationalId?: string;

  @IsOptional()
  @ValidateIf((o) => o.birthDate !== null && o.birthDate !== '')
  @IsISO8601({}, { message: 'تاریخ تولد نامعتبر است' })
  birthDate?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.surgeonId !== null)
  @IsInt({ message: 'جراح نامعتبر است' })
  surgeonId?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.hospitalId !== null)
  @IsInt({ message: 'بیمارستان نامعتبر است' })
  hospitalId?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.techId !== null)
  @IsInt({ message: 'کارشناس نامعتبر است' })
  techId?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.procedureTypeId !== null)
  @IsInt({ message: 'نوع عمل نامعتبر است' })
  procedureTypeId?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.diagnosisId !== null)
  @IsInt({ message: 'تشخیص نامعتبر است' })
  diagnosisId?: number | null;

  /**
   * **سایرِ تشخیص‌ها** به ترتیبِ اهمیت (رتبهٔ ۲ به بعد) — بستهٔ ۷ب.
   * تشخیصِ اصلی همان `diagnosisId` است. نبودنِ کلید = دست نزن؛ `[]` یا `null` = پاک کن.
   * ⚠️ باید در DTO اعلام شود: `ValidationPipe({ whitelist: true })` کلیدِ
   * اعلام‌نشده را بی‌صدا دور می‌ریزد (نگهبانِ CI).
   */
  @IsOptional()
  @IsArray({ message: 'فهرستِ تشخیص‌ها نامعتبر است' })
  @ArrayMaxSize(9, { message: 'حداکثر ۱۰ تشخیص برای یک مراجعه (یک اصلی و ۹ دیگر)' })
  @IsInt({ each: true, message: 'تشخیص نامعتبر است' })
  @Min(1, { each: true, message: 'تشخیص نامعتبر است' })
  otherDiagnosisIds?: number[] | null;

  /** **سایرِ عمل‌ها**ی همان جلسه (رتبهٔ ۲ به بعد) — بستهٔ ۷ج. همان قواعد. */
  @IsOptional()
  @IsArray({ message: 'فهرستِ عمل‌ها نامعتبر است' })
  @ArrayMaxSize(9, { message: 'حداکثر ۱۰ عمل برای یک مراجعه (یک اصلی و ۹ دیگر)' })
  @IsInt({ each: true, message: 'نوعِ عمل نامعتبر است' })
  @Min(1, { each: true, message: 'نوعِ عمل نامعتبر است' })
  otherProcedureTypeIds?: number[] | null;

  /** `null` صریح یعنی «موضوع را بردار». */
  @IsOptional()
  @ValidateIf((o) => o.topicId !== null)
  @IsInt({ message: 'موضوعِ ویزیت نامعتبر است' })
  topicId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  opType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'شرحِ عمل طولانی است' })
  opReport?: string;

  /* بخش‌های هستهٔ ثابت — رشتهٔ خالی یعنی «این سند دیگر جاری نیست» (همان
     معنای شرحِ عمل در `setVisitNote`). */
  @IsOptional() @IsString() @MaxLength(5000, { message: 'شرحِ حال طولانی است' })
  history?: string;

  @IsOptional() @IsString() @MaxLength(5000, { message: 'شرحِ معاینه طولانی است' })
  exam?: string;

  @IsOptional() @IsString() @MaxLength(5000, { message: 'یافته‌ها طولانی است' })
  findings?: string;

  @IsOptional() @IsString() @MaxLength(5000, { message: 'طرحِ درمان طولانی است' })
  planNote?: string;

  @IsOptional() @IsString() @MaxLength(5000, { message: 'نسخه طولانی است' })
  prescription?: string;

  /// نوعِ بیهوشی — `null`/خالی یعنی پاکش کن.
  @IsOptional() @ValidateIf((o) => o.anesthesia !== null && o.anesthesia !== '')
  @IsIn(ANESTHESIA_KEYS, { message: 'نوعِ بیهوشی نامعتبر است' })
  anesthesia?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.opDate !== null && o.opDate !== '')
  @IsISO8601({}, { message: 'تاریخ عمل نامعتبر است' })
  opDate?: string | null;

  /// «ویزیتِ بعدی» — `null`/رشتهٔ خالی یعنی پاکش کن (پزشک منصرف شد).
  @IsOptional()
  @ValidateIf((o) => o.nextVisitDate !== null && o.nextVisitDate !== '')
  @IsISO8601({}, { message: 'تاریخِ ویزیتِ بعدی نامعتبر است' })
  nextVisitDate?: string | null;

  /// پیگیریِ اختصاصی — رشتهٔ خالی/null یعنی «برگرد به قالبِ نوعِ عمل».
  @IsOptional() @ValidateIf((o) => o.postOpCare !== null)
  @IsString() @MaxLength(2000, { message: 'متنِ مراقبت طولانی است' })
  postOpCare?: string | null;

  @IsOptional() @ValidateIf((o) => o.followUpDays !== null)
  @IsString() @MaxLength(60, { message: 'روزهای پیگیری طولانی است' })
  followUpDays?: string | null;

  @IsOptional() @IsBoolean({ message: 'زمانِ ارسالِ مراقبت نامعتبر است' })
  postOpImmediate?: boolean;

  @IsOptional() @ValidateIf((o) => o.preOpCare !== null)
  @IsString() @MaxLength(2000, { message: 'متنِ مراقبتِ قبل از عمل طولانی است' })
  preOpCare?: string | null;

  /// مراقبتِ قبل از عمل، علاوه بر موعدِ مقرر، همین حالا هم برود.
  @IsOptional() @IsBoolean({ message: 'زمانِ ارسالِ مراقبتِ قبل از عمل نامعتبر است' })
  preOpImmediate?: boolean;

  /// تصمیمِ درمانیِ ویزیت — چندتایی؛ مقدارهای مجاز در DECISIONS.
  @IsOptional() @IsArray() @IsIn(DECISIONS, { each: true, message: 'تصمیمِ درمانی نامعتبر است' })
  decisions?: string[];

  /// شکایتِ اولیه — `null`/خالی یعنی «بردار»، و برای عملی که از ویزیت آمده
  /// یعنی «به ارث‌بری برگرد» (سرویس عینِ متنِ ارثی را هم ذخیره نمی‌کند).
  @IsOptional() @ValidateIf((o) => o.chiefComplaint !== null)
  @IsString() @MaxLength(2000, { message: 'شکایتِ اولیه طولانی است' })
  chiefComplaint?: string | null;

  /// ساعت‌ها: «۰۸:۳۰». اعتبارسنجیِ دقیق و نرمال‌سازیِ ارقامِ فارسی در سرویس
  /// (`normalizeTime`) انجام می‌شود؛ این‌جا فقط از رشته‌بودن و طول مطمئن می‌شویم
  /// تا یک regex در دو جا تکرار نشود.
  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  opStartTime?: string;

  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  opEndTime?: string;

  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  cargoDueTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * پاسخِ فیلدهای **دلخواه** — کلیدِ فیلد به مقدار.
   *
   * ⚠️ عمداً بدونِ دکوراتورِ ساختاری: شکلش را سوپرادمین در فرم‌ساز تعیین
   * می‌کند، نه ما در زمانِ کامپایل. اعتبارسنجیِ واقعی (اجباری‌بودن) در
   * `FormsService.assertValid` انجام می‌شود، جایی که تعریفِ فرم در دسترس است.
   *
   * ⚠️ `@IsObject()` لازم است وگرنه `ValidationPipe` با `whitelist: true` این
   * فیلد را **بی‌صدا دور می‌ریزد** و پاسخ‌های کاربر هرگز به سرور نمی‌رسند.
   */
  @IsOptional() @IsObject({ message: 'فیلدهای دلخواه نامعتبرند' })
  extra?: Record<string, any>;

  /// اندازه‌گیریِ تایپ‌شده در فرمِ ویرایش که هنوز «ثبت» نخورده — همراهِ «ذخیره» می‌نشیند
  /// (بازبینیِ ۱۴۰۵/۰۷/۰۳: تا دیروز بی‌صدا دور ریخته می‌شد). یک شیء یا تا سه (قبل/بعد از عمل).
  @IsOptional()
  vitals?: Record<string, unknown> | Record<string, unknown>[];

  /// زیرفرم‌های الصاقی — همان قراردادِ ساخت.
  @IsOptional() @IsArray({ message: 'زیرفرم‌ها نامعتبر است' })
  subforms?: Record<string, unknown>[];
}

/// فقط ساعت‌ها — برای کارشناسِ سرِ عمل و پنلِ چینش، بدونِ اجازهٔ ویرایشِ بقیهٔ مراجعه.
export class VisitTimesDto {
  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  opStartTime?: string;

  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  opEndTime?: string;

  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  cargoDueTime?: string;
}

export class VisitStatusDto {
  @IsIn(['pending', 'done', 'cancelled'], { message: 'وضعیت نامعتبر است' })
  opStatus!: string;

  /* ⚠️ اجباریِ **مشروط**: فقط هنگامِ لغو. `IsIn` این‌جا شکلِ ورودی را می‌سنجد و
     خودِ اجباری‌بودن در سرویس چک می‌شود، چون به `opStatus` وابسته است. */
  @IsOptional() @IsIn(CANCEL_REASON_KEYS, { message: 'دلیلِ لغو نامعتبر است' })
  cancelReason?: string;

  /** یادداشتِ داخلی — هرگز برای بیمار فرستاده نمی‌شود. */
  @IsOptional() @IsString() @MaxLength(400)
  cancelNote?: string;
}
