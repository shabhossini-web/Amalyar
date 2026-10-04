import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  lastName?: string;

  // dataURL سلفیِ جدید
  @IsOptional()
  @IsString()
  @MinLength(30)
  @MaxLength(3_500_000)
  selfie?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  current: string;

  @IsString()
  @MinLength(6, { message: 'رمزِ جدید حداقل ۶ کاراکتر' })
  @MaxLength(128)
  next: string;
}

/**
 * منتخب‌های شخصی — سه «فرمِ منتخب» و سه «ابزارکِ منتخب» (۱۴۰۵/۰۷/۰۳).
 * هر خانه کلید یا `null`؛ شکلِ دقیقِ کلید در `AuthService.setPrefs` سنجیده می‌شود.
 */
export class UpdatePrefsDto {
  @IsOptional() @IsArray({ message: 'فرم‌های منتخب نامعتبر است' }) @ArrayMaxSize(3, { message: 'حداکثر سه فرمِ منتخب' })
  subformPins?: (string | null)[];

  @IsOptional() @IsArray({ message: 'ابزارک‌های منتخب نامعتبر است' }) @ArrayMaxSize(3, { message: 'حداکثر سه ابزارکِ منتخب' })
  todayPins?: (string | null)[];

  /** پیش‌فرض‌های مصرفیِ کارشناس (بستهٔ ج): `[{ name, lines: [{ itemId, quantity }] }]` — شکلش را سرویس می‌سنجد. */
  @IsOptional() @IsArray({ message: 'پیش‌فرض‌های مصرفی نامعتبر است' }) @ArrayMaxSize(12, { message: 'حداکثر دوازده پیش‌فرضِ مصرفی' })
  usagePresets?: unknown[];
}
