import { Type } from 'class-transformer';
import {
  IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf,
} from 'class-validator';
import { EnDigits, MobileInput } from '../../common/validators';
import { DOCUMENT_CATEGORIES, DOCUMENT_PHASES, NOTE_KINDS } from '../record.service';

/** ویرایشِ پروفایلِ بیمار. کد ملی عمداً نیست — کلیدِ هویت است، نه یک فیلدِ معمولی. */
export class PatientPatchDto {
  @IsOptional() @IsString() @MinLength(2, { message: 'نام کوتاه است' }) @MaxLength(60)
  firstName?: string;

  @IsOptional() @IsString() @MinLength(2, { message: 'نام خانوادگی کوتاه است' }) @MaxLength(60)
  lastName?: string;

  @IsOptional() @MobileInput() @ValidateIf((o) => o.phone !== '')
  @Matches(/^09\d{9}$/, { message: 'شمارهٔ موبایل نامعتبر است' })
  phone?: string;

  @IsOptional() @ValidateIf((o) => o.birthDate !== '' && o.birthDate !== null)
  @IsISO8601({}, { message: 'تاریخِ تولد نامعتبر است' })
  birthDate?: string | null;

  @IsOptional() @ValidateIf((o) => o.gender !== '' && o.gender !== null)
  @IsIn(['male', 'female'], { message: 'جنسیت نامعتبر است' })
  gender?: string | null;

  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;

  @IsOptional() @ValidateIf((o) => o.bloodType !== '' && o.bloodType !== null)
  @IsIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], { message: 'گروهِ خونی نامعتبر است' })
  bloodType?: string | null;

  // متن‌های بالینی سقفِ بلندتری دارند: سابقهٔ دارویی و حساسیت واقعاً طولانی می‌شوند.
  @IsOptional() @IsString() @MaxLength(1000) allergies?: string;
  @IsOptional() @IsString() @MaxLength(2000) chronicConditions?: string;
  @IsOptional() @IsString() @MaxLength(2000) medications?: string;

  @IsOptional() @IsString() @MaxLength(80) insurer?: string;
  @IsOptional() @EnDigits() @IsString() @MaxLength(40) insuranceNo?: string;
  @IsOptional() @IsString() @MaxLength(80) supplementalInsurer?: string;

  @IsOptional() @IsString() @MaxLength(80) emergencyName?: string;
  @IsOptional() @EnDigits() @ValidateIf((o) => o.emergencyPhone !== '')
  @Matches(/^0\d{9,10}$/, { message: 'شمارهٔ تماسِ اضطراری نامعتبر است' })
  emergencyPhone?: string;
  @IsOptional() @IsString() @MaxLength(40) emergencyRelation?: string;

  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

/**
 * فیلدهای همراهِ آپلود. چون از multipart می‌آیند همه رشته‌اند، پس `visitId` با
 * `@Type(() => Number)` تبدیل می‌شود — بدونِ آن `IsInt` روی رشته می‌افتد.
 */
export class DocumentUploadDto {
  @IsOptional() @IsIn(DOCUMENT_CATEGORIES as unknown as string[], { message: 'دستهٔ مدرک نامعتبر است' })
  category?: string;

  @IsOptional() @IsString() @MaxLength(120, { message: 'عنوان طولانی است' })
  title?: string;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'مراجعهٔ انتخابی نامعتبر است' })
  visitId?: number;

  @IsOptional() @ValidateIf((o) => o.takenAt !== '')
  @IsISO8601({}, { message: 'تاریخِ مدرک نامعتبر است' })
  takenAt?: string;

  /* مرحلهٔ مدرک نسبت به عمل. این‌جا فقط شکلِ مقدار سنجیده می‌شود؛ اینکه بدونِ
     `visitId` معنی ندارد در `record.service` رد می‌شود — آن‌جا تنها جایی است
     که هر دو مسیرِ آپلود و لینک از آن رد می‌شوند. */
  @IsOptional() @IsIn(DOCUMENT_PHASES as unknown as string[], { message: 'مرحلهٔ مدرک نامعتبر است' })
  phase?: string;
}

/** مدرکِ لینکی — نشانیِ MRI/پاراکلینیک روی سرویسِ دیگر. sanitization در سرویس. */
export class DocumentLinkDto {
  @IsString() @MinLength(8, { message: 'نشانی کوتاه است' }) @MaxLength(2000, { message: 'نشانی طولانی است' })
  url!: string;

  @IsOptional() @IsIn(DOCUMENT_CATEGORIES as unknown as string[], { message: 'دستهٔ مدرک نامعتبر است' })
  category?: string;

  @IsOptional() @IsString() @MaxLength(120, { message: 'عنوان طولانی است' })
  title?: string;

  /* ورودِ پورتالِ پکس/آزمایشگاه — همکارِ بعدی باید بتواند لینک را باز کند. */
  @IsOptional() @IsString() @MaxLength(120, { message: 'نامِ کاربری طولانی است' })
  user?: string;

  @IsOptional() @IsString() @MaxLength(120, { message: 'رمز طولانی است' })
  pass?: string;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'مراجعهٔ انتخابی نامعتبر است' })
  visitId?: number;

  @IsOptional() @ValidateIf((o) => o.takenAt !== '')
  @IsISO8601({}, { message: 'تاریخِ مدرک نامعتبر است' })
  takenAt?: string;

  /* مرحلهٔ مدرک نسبت به عمل. این‌جا فقط شکلِ مقدار سنجیده می‌شود؛ اینکه بدونِ
     `visitId` معنی ندارد در `record.service` رد می‌شود — آن‌جا تنها جایی است
     که هر دو مسیرِ آپلود و لینک از آن رد می‌شوند. */
  @IsOptional() @IsIn(DOCUMENT_PHASES as unknown as string[], { message: 'مرحلهٔ مدرک نامعتبر است' })
  phase?: string;
}

export class NoteCreateDto {
  @IsOptional() @IsIn(NOTE_KINDS as unknown as string[], { message: 'نوعِ شرح نامعتبر است' })
  kind?: string;

  @IsString() @MinLength(1, { message: 'متنِ شرح خالی است' }) @MaxLength(20000, { message: 'متنِ شرح طولانی است' })
  body!: string;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'مراجعهٔ انتخابی نامعتبر است' })
  visitId?: number;
}

export class NoteAmendDto {
  @IsString() @MinLength(1, { message: 'متنِ شرح خالی است' }) @MaxLength(20000, { message: 'متنِ شرح طولانی است' })
  body!: string;
}
