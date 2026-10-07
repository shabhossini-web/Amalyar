import { Transform } from 'class-transformer';
import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidNationalId, normalizeMobile, toEnDigits } from './identity';

/**
 * ارقامِ فارسی/عربیِ ورودی را پیش از اعتبارسنجی به انگلیسی تبدیل می‌کند.
 *
 * ترتیب مهم است: class-transformer پیش از class-validator اجرا می‌شود، پس
 * الگوهای `^09\d{9}$` روی مقدارِ نرمال‌شده تست می‌شوند. بدونِ این، کاربری که
 * با کیبوردِ فارسی «۰۹۱۲…» می‌زد پیامِ «شمارهٔ نامعتبر» می‌گرفت.
 */
export const EnDigits = () =>
  Transform(({ value }) => (typeof value === 'string' ? toEnDigits(value).trim() : value));

/**
 * شمارهٔ موبایل را پیش از اعتبارسنجی به شکلِ «09…» می‌برد: ارقامِ فارسی، فاصله، «+98» و «0098».
 * رشتهٔ خالی خالی می‌ماند (فیلدهای اختیاریِ `^09\d{9}$|^$`)، و مقدارِ غیررشته دست‌نخورده می‌ماند.
 */
export const MobileInput = () =>
  Transform(({ value }) => (typeof value === 'string' ? normalizeMobile(value) : value));

/**
 * کدِ ملی با رقمِ کنترلی، نه فقط «۱۰ رقم».
 *
 * چون کدِ ملی کلیدِ پروندهٔ بیمار است، یک رقمِ غلط یعنی یک پروندهٔ تکراریِ
 * دائمی؛ آزمونِ checksum جلوی بخشِ بزرگی از غلط‌های تایپی را همین‌جا می‌گیرد.
 */
export function IsNationalId(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isNationalId',
      target: object.constructor,
      propertyName,
      options: { message: 'کد ملی معتبر نیست', ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidNationalId(value),
      },
    });
  };
}
