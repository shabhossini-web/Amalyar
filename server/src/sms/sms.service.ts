import { Injectable, Logger } from '@nestjs/common';

/**
 * سرویسِ پیامک — ملی‌پیامک (همان روشِ ملک‌طب: endpointِ advanced).
 * تا وقتی MELI_API_KEY و MELI_FROM تنظیم نشده‌اند، پیامک واقعی ارسال نمی‌شود
 * و کد فقط در لاگ می‌آید (و در پاسخِ API به‌صورت devCode برمی‌گردد تا تست ممکن باشد).
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
    return this.send(phone, `عمل‌یار: کد تأیید شما ${code}`);
  }

  async send(phone: string, text: string): Promise<{ sent: boolean; stub: boolean }> {
    const apiKey = process.env.MELI_API_KEY;
    const from = process.env.MELI_FROM;
    const to = this.normalize(phone);
    if (!to) {
      this.log.warn(`شمارهٔ نامعتبر: ${phone}`);
      return { sent: false, stub: false };
    }
    if (!apiKey || !from) {
      this.log.warn(`[STUB] پیامک به ${to}: ${text}`);
      return { sent: false, stub: true };
    }

    const body = JSON.stringify({ from, to: [to], text: this.appendLagho(text), udh: '' });
    try {
      const res = await fetch(
        `https://console.melipayamak.com/api/send/advanced/${encodeURIComponent(apiKey)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
      );
      const data: any = await res.json().catch(() => null);
      const recIds = data?.recIds;
      const ok = Array.isArray(recIds) && Number(recIds[0]) > 0;
      if (!ok) this.log.warn(`ملی‌پیامک ناموفق: ${JSON.stringify(data)?.slice(0, 160)}`);
      return { sent: ok, stub: false };
    } catch (e) {
      this.log.error(`ملی‌پیامک خطا: ${e}`);
      return { sent: false, stub: false };
    }
  }
}
