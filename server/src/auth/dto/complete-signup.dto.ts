import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CompleteSignupDto {
  // توکنِ کوتاه‌عمرِ صادرشده پس از تأییدِ OTP
  @IsString() @MinLength(20)
  signupToken: string;

  @IsString() @MinLength(2) @MaxLength(40)
  firstName: string;

  @IsString() @MinLength(2) @MaxLength(40)
  lastName: string;

  @IsString() @MinLength(3) @MaxLength(40)
  @Matches(/^[a-zA-Z0-9_.]+$/, { message: 'نام کاربری فقط حروف/عدد و . یا _' })
  /* دست‌کم یک حرفِ لاتین (بستهٔ PS، PS9) — تمام‌رقم با شمارهٔ موبایل اشتباه می‌شد. */
  @Matches(/[a-zA-Z]/, { message: 'نام کاربری باید دست‌کم یک حرفِ لاتین داشته باشد' })
  username: string;

  @IsString() @MinLength(6) @MaxLength(128)
  password: string;

  // dataURL سلفی (دوربینِ زندهٔ اجباری در فرانت)
  @IsString() @MinLength(30) @MaxLength(3_500_000)
  selfie: string;
}
