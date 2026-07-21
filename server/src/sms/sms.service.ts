import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * سرویسِ پیامک — ملی‌پیامک (همان روشِ ملک‌طب: endpointِ advanced).
 * در production نبودن تنظیمات یا شکست provider به‌صورت fail-closed با HTTP 503
 * برگردانده می‌شود. شماره، متن پیام، OTP، پاسخ خام provider و API key هرگز log نمی‌شوند.
 * در test/development، نبودن credential فقط stub امن بدون محتوای پیام است.
 *
 * برای فعال‌سازی (env در Coolify):
 *   MELI_API_KEY = <همان apiKey ملی‌پیامکِ ملک‌طب>
 *   MELI_FROM    = <خطِ فرستنده، همان sms_from ملک‌طب>
 */
@Injectable()
export class SmsService {
  private readonly log = new Logger('SMS');

  private normalize(to: string): string | null {
    let t = (to || '').replace(/[^0-9]/g, '');
    if (t.length < 10) return null;
    if (t.startsWith('98')) t = '0' + t.slice(2);
    if (!t.startsWith('0')) t = '0' + t;
    return t;
  }

  // نرمال‌سازیِ «لغو۱۱» — مثلِ ملک‌طب (اپت‌اوتِ اجباریِ ایران)
  private appendLagho(text: string): string {
    return text.replace(/\s*لغو\s*[0-9۰-۹]+\s*$/u, '').replace(/\s+$/, '') + '\nلغو۱۱';
  }

  async sendOtp(phone: string, code: string) {
    // خطِ آخر = فرمتِ WebOTP تا اندروید کد را خودکار پر کند؛ «لغو۱۱» قبلش می‌آید
    const text = `عمل‌یار: کد تأیید شما ${code}\nلغو۱۱\n@amalyar.com #${code}`;
    return this.send(phone, text, { skipLagho: true });
  }

  async send(
    phone: string,
    text: string,
    opts: { skipLagho?: boolean } = {},
  ): Promise<{ sent: boolean; stub: boolean }> {
    const apiKey = process.env.MELI_API_KEY;
    const from = process.env.MELI_FROM;
    const to = this.normalize(phone);
    if (!to) {
      this.log.warn('درخواست پیامک با شمارهٔ نامعتبر رد شد');
      return { sent: false, stub: false };
    }
    if (!apiKey || !from) {
      if (process.env.NODE_ENV === 'production') {
        this.log.error('تنظیمات سرویس پیامک در production ناقص است');
        throw new ServiceUnavailableException('سرویس پیامک موقتاً در دسترس نیست');
      }
      this.log.warn('[STUB] سرویس پیامک پیکربندی نشده است؛ پیام واقعی ارسال نشد');
      return { sent: false, stub: true };
    }

    const finalText = opts.skipLagho ? text : this.appendLagho(text);
    const body = JSON.stringify({ from, to: [to], text: finalText, udh: '' });
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(
        `https://console.melipayamak.com/api/send/advanced/${encodeURIComponent(apiKey)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
      );
    } catch {
      this.log.error('ارتباط با سرویس ملی‌پیامک برقرار نشد');
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException('سرویس پیامک موقتاً در دسترس نیست');
      }
      return { sent: false, stub: false };
    }

    const data: any = await res.json().catch(() => null);
    const recIds = data?.recIds;
    const ok = res.ok && Array.isArray(recIds) && Number(recIds[0]) > 0;
    if (!ok) {
      this.log.warn(`ارسال ملی‌پیامک پذیرفته نشد (HTTP ${res.status})`);
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException('سرویس پیامک موقتاً در دسترس نیست');
      }
    }
    return { sent: ok, stub: false };
  }
}
