import { Matches } from 'class-validator';
import { MobileInput } from '../../common/validators';

export class VerifyOtpDto {
  @MobileInput()
  @Matches(/^0\d{10}$/, { message: 'شمارهٔ موبایل نامعتبر است' })
  phone: string;

  @Matches(/^\d{5,6}$/, { message: 'کد تأیید نامعتبر است' })
  code: string;
}
