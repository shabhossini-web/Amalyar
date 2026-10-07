import { Matches } from 'class-validator';
import { MobileInput } from '../../common/validators';

export class RequestOtpDto {
  @MobileInput()
  @Matches(/^0\d{10}$/, { message: 'شمارهٔ موبایل باید ۱۱ رقم و با ۰ شروع شود' })
  phone: string;
}
