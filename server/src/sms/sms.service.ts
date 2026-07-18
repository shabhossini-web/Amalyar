import { Injectable, Logger } from '@nestjs/common';

/**
 * سرویسِ پیامک — پلاگین.
 * تا وقتی SMS_API_KEY تنظیم نشده، کد فقط در لاگ نمایش داده می‌شود (حالتِ توسعه).
 * برای اتصالِ واقعی: SMS_API_KEY / SMS_SENDER / SMS_URL را در env بگذار و بخشِ TODO را پر کن.
 */
@Injectable()
export class SmsService {
  private readonly log = new Logger('SMS');

  async send(phone: string, text: string): Promise<{ sent: boolean; stub: boolean }> {
    const key = process.env.SMS_API_KEY;
    if (!key) {
      this.log.warn(`[STUB] پیامک به ${phone}: ${text}`);
      return { sent: false, stub: true };
    }
    // TODO: اتصال به پنلِ پیامکِ ایران (kavenegar/melipayamak/…)
    //   const url = process.env.SMS_URL; const sender = process.env.SMS_SENDER;
    //   await fetch(url, { method:'POST', ... })
    this.log.warn(`[NO-PROVIDER] پیامک به ${phone}: ${text}`);
    return { sent: false, stub: true };
  }
}
