import type { RateLimitService } from './rate-limit.service';

/**
 * سقفِ **مشترکِ** «پیامکِ عمومی به این شماره» (بستهٔ PS، PS7) — در ساعت.
 *
 * سه درِ بی‌احراز هرکدام سقفِ خودش را داشت: «ادامه با موبایل»ِ ثبت‌نامِ بیمار، کدِ ثبت‌نامِ حساب و کدِ بازیابیِ
 * رمز — هرکدام ۱۲ تا ۲۴ پیامک در ساعت به یک شماره. روی هم یعنی ده‌ها پیامک در ساعت به گوشیِ هر کسی که شماره‌اش
 * را بدانیم، با هزینهٔ مطب. این سطل روی هر سه است و **بی‌صداست**: پاسخ همان است، فقط پیامک نمی‌رود — ۴۲۹ می‌گفت
 * «این شماره روی یکی از این درها کاری دارد».
 */
export const PUBLIC_SMS_PER_HOUR = 4;

/** یک پیامکِ عمومی به `to` مجاز است؟ اگر بله همین حالا شمرده می‌شود — فقط درست پیش از خودِ ارسال صدا بزنید. */
export function takePublicSms(rateLimit: Pick<RateLimitService, 'hit'> & Partial<Pick<RateLimitService, 'peek'>>, tid: string, to: string): boolean {
  const key = `pubsms:${tid}:${to}`;
  /* محدودکنندهٔ ساختگیِ آزمون‌های درونِ فرایند (`{ hit() {} }`) `peek` ندارد — آن‌جا سقفی در کار نیست. */
  if (typeof rateLimit.peek !== 'function') return true;
  if (!rateLimit.peek(key, PUBLIC_SMS_PER_HOUR)) return false;
  rateLimit.hit(key, PUBLIC_SMS_PER_HOUR, 3600_000);
  return true;
}
