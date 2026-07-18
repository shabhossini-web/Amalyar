import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class VerifySignupDto {
  @Matches(/^0\d{10}$/, { message: 'شمارهٔ موبایل نامعتبر است' })
  phone: string;

  @Matches(/^\d{5,6}$/, { message: 'کد تأیید نامعتبر است' })
  code: string;

  @IsString() @MinLength(2) @MaxLength(40)
  firstName: string;

  @IsString() @MinLength(2) @MaxLength(40)
  lastName: string;

  @IsString() @MinLength(3) @MaxLength(40)
  @Matches(/^[a-zA-Z0-9_.]+$/, { message: 'نام کاربری فقط حروف/عدد و . یا _' })
  username: string;

  @IsString() @MinLength(6) @MaxLength(128)
  password: string;

  // dataURL سلفی (دوربینِ زندهٔ اجباری در فرانت)
  @IsString() @MinLength(30) @MaxLength(3_500_000)
  selfie: string;
}
