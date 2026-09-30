import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

type Bucket = { count: number; resetAt: number };

/** محدودکنندهٔ سبک برای یک instance. در مقیاس چند replica باید با Redis جایگزین شود. */
@Injectable()
export class RateLimitService {
  private buckets = new Map<string, Bucket>();

  hit(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    current.count += 1;
    if (current.count > limit) {
      throw new HttpException(
        'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * بی‌شمردن: آیا یک `hit` دیگر زیرِ سقف می‌ماند؟ برای سقفِ **بی‌صدا** با چند سطل که فقط وقتی کار قطعی شد
   * شمرده می‌شود (پیامکِ لینکِ ادامه، بستهٔ PF): اگر سطلِ اول شمرده می‌شد و دومی جلوی ارسال را می‌گرفت، اولی
   * پیامکی را شمرده بود که هرگز نرفت.
   */
  peek(key: string, limit: number): boolean {
    const current = this.buckets.get(key);
    return !current || current.resetAt <= Date.now() || current.count < limit;
  }
}
