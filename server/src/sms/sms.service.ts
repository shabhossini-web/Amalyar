import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { sanitizeWebOtpHost } from '../common/webotp';

/**
 * سرویسِ پیامک — ملی‌پیامک (همان روشِ ملک‌طب: endpointِ advanced).
 * در production نبودن تنظیمات یا شکست provider به‌صورت fail-closed با HTTP 503
 * برگردانده می‌شود. شماره، متن پیام، OTP، پاسخ خام provider و API key هرگز log نمی‌شوند.
 * در test/development، نبودن credential فقط stub امن بدون محتوای پیام است.
 *
 * ⚠️ **«چرا نرفت» گم نمی‌شود.** پیامِ عمومیِ خطا («سرویس پیامک موقتاً در دسترس
 * نیست») عمداً کلی است، چون تا صفحهٔ ورودِ ناشناس هم می‌رسد. ولی علتِ واقعی —
 * راه‌اندازی‌نشدنِ کلید/خط یا متنِ ردِ خودِ ملی‌پیامک — روی `smsDetail`ِ همان خطا
 * می‌نشیند و دفترِ یادآوری‌ها (فقط کارکنان) همان را نشان می‌دهد. تا ۱۴۰۵/۰۷/۰۴ این
 * علت دور ریخته می‌شد و پیام‌های مراقبتِ بعد از عمل فقط «موقتاً در دسترس نیست»
 * می‌گفتند؛ نه معلوم بود کلید نیست، نه اعتبار تمام شده، نه متن رد شده.
 *
 * برای فعال‌سازی (env در Coolify):
 *   MELI_API_KEY = <همان apiKey ملی‌پیامکِ ملک‌طب>
 *   MELI_FROM    = <خطِ فرستنده، همان sms_from ملک‌طب>
 */
/** عبارتِ اجباریِ انصراف — دقیقاً همان متنِ مقررات («لغو11» با رقمِ لاتین). */
const LAGHO = 'لغو11';

/**
 * کدهای خطای ملی‌پیامک (مقدارِ `recIds[0]` وقتی ارسال پذیرفته نشده). شناسهٔ ارسالِ
 * موفق عددی چندرقمی است؛ عددِ کوچک یعنی کدِ خطا، نه شناسه — نسخهٔ قبلی هر عددِ
 * مثبتی را «ارسال شد» می‌گرفت.
 */
const MELI_CODES: Record<number, string> = {
  0: 'کلید یا نام کاربریِ ملی‌پیامک نامعتبر است',
  2: 'اعتبارِ پنلِ پیامک کافی نیست',
  3: 'به سقفِ ارسالِ روزانه رسیده‌اید',
  4: 'به سقفِ حجمِ ارسال رسیده‌اید',
  5: 'شمارهٔ فرستنده (خطِ ارسال) معتبر نیست',
  6: 'سامانهٔ پیامک در حالِ به‌روزرسانی است',
  7: 'متن حاوی کلمهٔ فیلترشده است',
  9: 'ارسالِ متنِ آزاد از خطِ عمومی/اشتراکی از طریقِ وب‌سرویس ممکن نیست',
  10: 'کاربرِ پنلِ پیامک فعال نیست',
  11: 'پیام ارسال نشد',
  12: 'مدارکِ کاربرِ پنلِ پیامک کامل نیست',
  14: 'متن حاوی لینک است و این خط اجازهٔ ارسالِ لینک ندارد',
  15: 'ارسال به چند گیرنده بدونِ «لغو11» ممکن نیست',
  16: 'شمارهٔ گیرنده پیدا نشد',
  17: 'متنِ پیامک خالی است',
  35: 'شمارهٔ گیرنده در فهرستِ سیاهِ مخابرات است',
};

/**
 * علتِ ردِ ملی‌پیامک به فارسی — برای دفترِ یادآوری‌ها و لاگ. هیچ عددِ حساسی در آن نمی‌ماند:
 * هر رشتهٔ چهاررقمی به بالا (شمارهٔ گیرنده، کدِ تأییدِ شش‌رقمی اگر provider متن را پژواک
 * کند، شناسه) پاک می‌شود و طول سقف دارد. کدِ خطا (یک‌ودورقمی) و کدِ HTTP می‌مانند.
 */
function rejectionDetail(httpStatus: number, data: any): string {
  const code = Array.isArray(data?.recIds) && data.recIds.length ? Number(data.recIds[0]) : NaN;
  const said = [data?.status, data?.message, data?.error].find((x) => typeof x === 'string' && x.trim());
  const parts = [
    Number.isFinite(code) && MELI_CODES[code] ? `${MELI_CODES[code]} (کدِ ${code})` : Number.isFinite(code) ? `کدِ ${code}` : null,
    said ? String(said).trim() : null,
    !said && !Number.isFinite(code) ? `پاسخِ HTTP ${httpStatus}` : null,
  ].filter(Boolean) as string[];
  const text = [...new Set(parts)].join(' — ').replace(/[0-9۰-۹]{4,}/g, '…').replace(/\s+/g, ' ').trim();
  return `ملی‌پیامک پیام را نپذیرفت: ${text}`.slice(0, 240);
}

/** خطای ۵۰۳ با پیامِ عمومی + علتِ واقعی برای کارکنان (`smsDetail`). */
function smsUnavailable(detail: string, outcome: 'rejected' | 'unconfigured'): ServiceUnavailableException {
  const error = new ServiceUnavailableException('سرویس پیامک موقتاً در دسترس نیست');
  (error as any).smsDetail = detail;
  (error as any).smsOutcome = outcome;
  return error;
}

const UNCONFIGURED = 'پیامک روی سرور راه‌اندازی نشده است: کلید یا خطِ ارسالِ ملی‌پیامک (MELI_API_KEY / MELI_FROM) تنظیم نیست';

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

  /**
   * «لغو11» ته هر پیامِ غیرِتأییدی — مثلِ ملک‌طب (اپت‌اوتِ اجباریِ ایران). نسخهٔ قبلیِ
   * آخر (با رقمِ فارسی یا لاتین، با یا بی‌فاصله) پاک می‌شود تا دوبار نیاید. رقمِ **لاتین**
   * چون متنِ مقررات و راهنمای ملی‌پیامک همین است؛ «لغو۱۱»ِ فارسی را هر پالایه‌ای نمی‌شناسد.
   */
  private appendLagho(text: string): string {
    return text.replace(/\s*لغو\s*[0-9۰-۹]+\s*$/u, '').replace(/\s+$/, '') + `\n${LAGHO}`;
  }

  async sendOtp(phone: string, code: string, webOtpHost?: string | null) {
    // خطِ آخر = فرمتِ origin-bound WebOTP. میزبان باید میزبانِ همان صفحه باشد،
    // وگرنه مرورگر بی‌صدا اتوفیل نمی‌کند (sanitizeWebOtpHost تک‌منبعِ اعتبارسنجی است).
    const validHost = sanitizeWebOtpHost(webOtpHost) ?? 'amalyar.com';
    const text = `عمل‌یار: کد تأیید شما ${code}\n${LAGHO}\n@${validHost} #${code}`;
    return this.send(phone, text, { skipLagho: true });
  }

  async send(
    phone: string,
    text: string,
    opts: { skipLagho?: boolean } = {},
  ): Promise<{ sent: boolean; stub: boolean; providerId?: string; detail?: string; outcome?: 'rejected' | 'invalid' }> {
    const apiKey = process.env.MELI_API_KEY;
    const from = process.env.MELI_FROM;
    const to = this.normalize(phone);
    if (!to) {
      this.log.warn('درخواست پیامک با شمارهٔ نامعتبر رد شد');
      /* `invalid`: تکرارش بی‌فایده است — دفترِ یادآوری دوباره امتحانش نمی‌کند. */
      return { sent: false, stub: false, detail: 'شمارهٔ موبایلِ گیرنده معتبر نیست', outcome: 'invalid' };
    }
    if (!apiKey || !from) {
      if (process.env.NODE_ENV === 'production') {
        this.log.error('تنظیمات سرویس پیامک در production ناقص است');
        throw smsUnavailable(UNCONFIGURED, 'unconfigured');
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
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(20_000) },
      );
    } catch {
      this.log.error('ارتباط با سرویس ملی‌پیامک برقرار نشد');
      const error = new ServiceUnavailableException('نتیجه ارتباط با سرویس پیامک مشخص نشد');
      (error as any).smsOutcome = 'unknown';
      throw error;
    }

    const data: any = await res.json().catch(() => null);
    const recIds = data?.recIds;
    /* شناسهٔ ارسالِ موفق چندرقمی است؛ `recIds[0]`ِ کوچک کدِ خطای ملی‌پیامک است (`MELI_CODES`). */
    const ok = res.ok && Array.isArray(recIds) && Number(recIds[0]) >= 1000;
    if (!ok) {
      const detail = rejectionDetail(res.status, data);
      /* علت بی‌شماره و بی‌متنِ پیام — `rejectionDetail` هر رشتهٔ رقمیِ بلند را پاک کرده است. */
      this.log.warn(`ارسال ملی‌پیامک پذیرفته نشد (HTTP ${res.status}) — ${detail}`);
      if (process.env.NODE_ENV === 'production') throw smsUnavailable(detail, 'rejected');
      return { sent: false, stub: false, detail, outcome: 'rejected' };
    }
    return { sent: true, stub: false, providerId: String(recIds[0]) };
  }

  /**
   * همان `send` برای دکمه‌های **پنلِ کارکنان** (لینکِ ثبت‌نام، خلاصه، پورتال، فرم): اگر
   * ملی‌پیامک رد کرد یا کلید تنظیم نیست، ۵۰۳ علتِ واقعی را می‌گوید نه «موقتاً در دسترس
   * نیست». مسیرِ عمومی (OTP ورود و ثبت‌نام) هرگز از این‌جا نمی‌گذرد و پیامِ کلی می‌گیرد.
   */
  async sendForStaff(phone: string, text: string) {
    try {
      return await this.send(phone, text);
    } catch (e: any) {
      if (e?.smsDetail) throw new ServiceUnavailableException(e.smsDetail);
      throw e;
    }
  }
}
