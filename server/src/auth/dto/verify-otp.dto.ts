import { Matches } from 'class-validator';

export class VerifyOtpDto {
  @Matches(/^0\d{10}$/, { message: 'شمارهٔ موبایل نامعتبر است' })
  phone: string;

  @Matches(/^\d{5,6}$/, { message: 'کد تأیید نامعتبر است' })
  code: string;
}
