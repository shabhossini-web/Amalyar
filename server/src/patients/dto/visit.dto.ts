import {
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
} from 'class-validator';

/// ثبتِ مراجعه — یا patientId (بیمارِ موجود) یا نام/نام‌خانوادگی (بیمارِ جدید)
export class CreateVisitDto {
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
  @Matches(/^09\d{9}$/, { message: 'شمارهٔ موبایل نامعتبر است (مثال: 09121234567)' })
  phone?: string;

  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'کد ملی باید ۱۰ رقم باشد' })
  nationalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'نام جراح طولانی است' })
  surgeonName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'نام بیمارستان طولانی است' })
  hospitalName?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'تاریخ عمل نامعتبر است' })
  opDate?: string;

  @IsOptional()
  @IsInt({ message: 'مبلغ باید عدد باشد' })
  @Min(0, { message: 'مبلغ نمی‌تواند منفی باشد' })
  amount?: number; // تومان

  @IsOptional()
  @IsInt({ message: 'پرداختی باید عدد باشد' })
  @Min(0, { message: 'پرداختی نمی‌تواند منفی باشد' })
  paid?: number; // تومان

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'یادداشت طولانی است' })
  notes?: string;
}

/// ویرایشِ مراجعه — همهٔ فیلدها اختیاری؛ نام/موبایل بیمار هم قابلِ اصلاح است
export class UpdateVisitDto {
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
  @ValidateIf((o) => o.phone !== '')
  @Matches(/^09\d{9}$/, { message: 'شمارهٔ موبایل نامعتبر است' })
  phone?: string;

  @IsOptional()
  @ValidateIf((o) => o.nationalId !== '')
  @Matches(/^\d{10}$/, { message: 'کد ملی باید ۱۰ رقم باشد' })
  nationalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  surgeonName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  hospitalName?: string;

  @IsOptional()
  @ValidateIf((o) => o.opDate !== null && o.opDate !== '')
  @IsISO8601({}, { message: 'تاریخ عمل نامعتبر است' })
  opDate?: string | null;

  @IsOptional()
  @IsInt({ message: 'مبلغ باید عدد باشد' })
  @Min(0)
  amount?: number; // تومان

  @IsOptional()
  @IsInt({ message: 'پرداختی باید عدد باشد' })
  @Min(0)
  paid?: number; // تومان

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class VisitStatusDto {
  @IsIn(['pending', 'done', 'cancelled'], { message: 'وضعیت نامعتبر است' })
  opStatus!: string;
}
