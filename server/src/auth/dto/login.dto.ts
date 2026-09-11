import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  identifier: string; // نام کاربری یا شمارهٔ موبایل

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;

  /** «مرا به خاطر بسپار» — کوکیِ ماندگار و عضویت در مجموعهٔ چندحسابی؛ پیش‌فرض true. */
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}
