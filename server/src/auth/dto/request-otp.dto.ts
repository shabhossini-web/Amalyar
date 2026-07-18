import { Matches } from 'class-validator';

export class RequestOtpDto {
  @Matches(/^0\d{10}$/, { message: 'شمارهٔ موبایل باید ۱۱ رقم و با ۰ شروع شود' })
  phone: string;
}
