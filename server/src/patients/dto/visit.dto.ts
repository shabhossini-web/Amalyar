import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { EnDigits, IsNationalId } from '../../common/validators';

/** نوعِ ملاقات — فهرستِ بسته تا گزارش‌گیری روی متنِ آزاد نیفتد. */
export const VISIT_KINDS = ['surgery', 'clinic', 'followup', 'consult'] as const;

/// ثبتِ مراجعه — یا patientId (بیمارِ موجود) یا نام/نام‌خانوادگی (بیمارِ جدید)
export class CreateVisitDto {
  @IsOptional()
  @IsIn(VISIT_KINDS as unknown as string[], { message: 'نوعِ مراجعه نامعتبر است' })
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

  /** متنِ آزادِ نوعِ عمل — فقط برای سازگاری با رکوردهای قدیمی نگه داشته شده. */
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'نوع عمل طولانی است' })
  opType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'شرحِ عمل طولانی است' })
  opReport?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'تاریخ عمل نامعتبر است' })
  opDate?: string;

  /// ساعت‌ها: «۰۸:۳۰». اعتبارسنجیِ دقیق و نرمال‌سازیِ ارقامِ فارسی در سرویس
  /// (`normalizeTime`) انجام می‌شود؛ این‌جا فقط از رشته‌بودن و طول مطمئن می‌شویم
  /// تا یک regex در دو جا تکرار نشود.
  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  opStartTime?: string;

  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  opEndTime?: string;

  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  techArriveTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'یادداشت طولانی است' })
  notes?: string;
}

/// ویرایشِ مراجعه — همهٔ فیلدها اختیاری؛ نام/موبایل بیمار هم قابلِ اصلاح است
export class UpdateVisitDto {
  @IsOptional()
  @IsIn(VISIT_KINDS as unknown as string[], { message: 'نوعِ مراجعه نامعتبر است' })
  kind?: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(120)
  opType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'شرحِ عمل طولانی است' })
  opReport?: string;

  @IsOptional()
  @ValidateIf((o) => o.opDate !== null && o.opDate !== '')
  @IsISO8601({}, { message: 'تاریخ عمل نامعتبر است' })
  opDate?: string | null;

  /// ساعت‌ها: «۰۸:۳۰». اعتبارسنجیِ دقیق و نرمال‌سازیِ ارقامِ فارسی در سرویس
  /// (`normalizeTime`) انجام می‌شود؛ این‌جا فقط از رشته‌بودن و طول مطمئن می‌شویم
  /// تا یک regex در دو جا تکرار نشود.
  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  opStartTime?: string;

  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  opEndTime?: string;

  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  techArriveTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/// فقط ساعت‌ها — برای کارشناسِ سرِ عمل و پنلِ چینش، بدونِ اجازهٔ ویرایشِ بقیهٔ مراجعه.
export class VisitTimesDto {
  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  opStartTime?: string;

  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  opEndTime?: string;

  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' })
  techArriveTime?: string;
}

export class VisitStatusDto {
  @IsIn(['pending', 'done', 'cancelled'], { message: 'وضعیت نامعتبر است' })
  opStatus!: string;
}
