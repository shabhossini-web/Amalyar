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
}
