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
export const MELI_CODES: Record<number, string> = {
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
  /* ⚠️ «کدِ ۱۸» با متنِ «عملیات موفق» می‌آید (dr-gorji، ۱۴۰۵/۰۸/۰۳، پس از رفعِ کلمهٔ فیلترشده): «عملیات موفق» وضعیتِ خودِ
     فراخوانیِ API است، نه ارسال؛ کدِ ۱۸ در مستنداتِ ملی‌پیامک «شمارهٔ گیرنده نامعتبر است». شناسهٔ ارسالِ موفق ≥ ۱۵ رقم است. */
  18: 'شمارهٔ گیرنده از دیدِ ملی‌پیامک نامعتبر است — شمارهٔ بیمار را بررسی کنید',
  35: 'شمارهٔ گیرنده در فهرستِ سیاهِ مخابرات است',
};

/**
 * «شناسهٔ ارسالی» که در واقع **کدِ خطای** ملی‌پیامک است (عددِ کمتر از ۱۰۰۰) — یا `null`.
 *
 * ⚠️ تا ۱۴۰۵/۰۷/۰۴ ساعتِ ۰۹:۴۳ (#110) هر پاسخی با `recIds[0] > 0` «رفت» ثبت می‌شد؛ یعنی پاسخِ
 * «پیام ارسال نشد (کدِ ۱۱)» یا «اعتبار کافی نیست (کدِ ۲)» هم «رفت» بود و شناسه‌اش همان کد. گزارشِ
 * عیب‌یابی با همین تابع آن «رفت»های قدیمی را از نو می‌خواند — تنها ردِ واقعی‌ای که از آن دوره مانده.
 */
export function meliErrorCodeOf(providerId: unknown): number | null {
  if (providerId === null || providerId === undefined || String(providerId).trim() === '') return null;
  const n = Number(providerId);
  return Number.isInteger(n) && n >= 0 && n < 1000 ? n : null;
}

/** متنِ فارسیِ یک کدِ خطای ملی‌پیامک. */
export const meliCodeText = (code: number) => MELI_CODES[code] ?? 'کدِ ناشناختهٔ ملی‌پیامک';

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
    /* «عملیات موفق» کنارِ یک کدِ خطا وضعیتِ خودِ فراخوانی است و خوانندهٔ دفتر را گمراه می‌کرد («کد ۱۸ — عملیات موفق»). */
    said && !(Number.isFinite(code) && /موفق/.test(String(said))) ? String(said).trim() : null,
    !said && !Number.isFinite(code) ? `پاسخِ HTTP ${httpStatus}` : null,
  ].filter(Boolean) as string[];
  const text = [...new Set(parts)].join(' — ').replace(/[0-9۰-۹]{4,}/g, '…').replace(/\s+/g, ' ').trim();
  return `ملی‌پیامک پیام را نپذیرفت: ${text}`.slice(0, 240);
}

/**
 * ردِ «متن حاوی کلمهٔ فیلترشده» — کدِ ۷، یا متنِ وضعیتِ ملی‌پیامک که همین را می‌گوید (پاسخِ واقعیِ dr-gorji،
 * ۱۴۰۵/۰۷/۲۸، فقط متن داشت و کد نداشت). این رد به **متن** گره خورده، نه به لحظه: همان متن دوباره هم رد می‌شود.
 */
export function isFilteredRejection(data: any): boolean {
  const code = Array.isArray(data?.recIds) && data.recIds.length ? Number(data.recIds[0]) : NaN;
  if (code === 7) return true;
  return [data?.status, data?.message, data?.error].some((x) => typeof x === 'string' && /فیلتر/.test(x));
}

/** خطای ۵۰۳ با پیامِ عمومی + علتِ واقعی برای کارکنان (`smsDetail`). */
function smsUnavailable(detail: string, outcome: 'rejected' | 'unconfigured', filtered = false): ServiceUnavailableException {
  const error = new ServiceUnavailableException('سرویس پیامک موقتاً در دسترس نیست');
  (error as any).smsDetail = detail;
  (error as any).smsOutcome = outcome;
  if (filtered) (error as any).smsFiltered = true;
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

  /**
   * @param purpose `'password-reset'` ← متنِ بازیابیِ رمز (بستهٔ PF، PF10): کدِ بازیابی کلیدِ کلِ حساب است و
   *   مهندسیِ اجتماعی («از پشتیبانی تماس می‌گیریم، کد را بخوانید») رایج‌ترین راهِ دزدیدنش؛ پیامک باید بگوید
   *   این کدِ چیست و به هیچ‌کس داده نشود. بقیهٔ هدف‌ها همان متنِ کوتاهِ قبلی.
   */
  async sendOtp(phone: string, code: string, webOtpHost?: string | null, purpose?: string) {
    // خطِ آخر = فرمتِ origin-bound WebOTP. میزبان باید میزبانِ همان صفحه باشد،
    // وگرنه مرورگر بی‌صدا اتوفیل نمی‌کند (sanitizeWebOtpHost تک‌منبعِ اعتبارسنجی است).
    const validHost = sanitizeWebOtpHost(webOtpHost) ?? 'amalyar.com';
    /* «به هیچ‌کس، حتی پشتیبانی، ندهید» برای هر کدی که حسابی را تحویل می‌دهد یا فرمِ پزشکیِ بیمار را باز می‌کند —
       بازیابی (PF10)، و ثبت‌نام/تصاحب/تأییدِ شماره و «ادامهٔ ثبت‌نامِ» بیمار (بستهٔ PS، PS8): کلاه‌بردارِ تلفنی
       همین کد را «برای تأییدِ شماره» می‌خواهد. کدِ بی‌هدف (ورودِ پلتفرم) همان متنِ کوتاهِ قبلی. */
    const warn = 'این کد را به هیچ‌کس، حتی پشتیبانی، ندهید. اگر درخواست نکرده‌اید نادیده بگیرید.';
    const head = purpose === 'password-reset'
      ? `کدِ بازیابیِ رمزِ عمل‌یار: ${code}\n${warn}`
      : purpose === 'signup' || purpose?.startsWith('test-account:')
        ? `کدِ تأییدِ شماره در عمل‌یار: ${code}\n${warn}`
        : purpose?.startsWith('intake-resume:')
          ? `کدِ ادامهٔ ثبت‌نام: ${code}\n${warn}`
          : `عمل‌یار: کد تأیید شما ${code}`;
    const text = `${head}\n${LAGHO}\n@${validHost} #${code}`;
    return this.send(phone, text, { skipLagho: true });
  }

  async send(
    phone: string,
    text: string,
    opts: { skipLagho?: boolean } = {},
  ): Promise<{ sent: boolean; stub: boolean; providerId?: string; detail?: string; outcome?: 'rejected' | 'invalid'; filtered?: boolean }> {
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
      const filtered = isFilteredRejection(data);
      /* علت بی‌شماره و بی‌متنِ پیام — `rejectionDetail` هر رشتهٔ رقمیِ بلند را پاک کرده است. */
      this.log.warn(`ارسال ملی‌پیامک پذیرفته نشد (HTTP ${res.status}) — ${detail}`);
      /* شمارهٔ گیرنده نامعتبر: تکرارش بی‌فایده است و هیچ‌چیزی رد نشده که «دوباره» لازم باشد — همان قراردادِ شمارهٔ خرابِ
         بالا (`outcome: 'invalid'`، بی‌پرتاب)، تا دفتر یک‌باره «نرفت» بنویسد نه سه تلاشِ بی‌حاصل. */
      if (Number(Array.isArray(recIds) ? recIds[0] : NaN) === 18) return { sent: false, stub: false, detail, outcome: 'invalid' };
      if (process.env.NODE_ENV === 'production') throw smsUnavailable(detail, 'rejected', filtered);
      return { sent: false, stub: false, detail, outcome: 'rejected', ...(filtered ? { filtered } : {}) };
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
      if (e?.smsDetail) {
        const staffError = new ServiceUnavailableException(e.smsDetail);
        /* `smsOutcome` می‌ماند تا فراخوان بفهمد «قطعاً نرفت» (rejected/unconfigured) یا «نامعلوم» — فقط اولی ثبتِ
           «نرفت» و کارِ «ارسالِ دوباره» می‌سازد (`OrdersService.send`). */
        (staffError as any).smsOutcome = e.smsOutcome;
        if (e.smsFiltered) (staffError as any).smsFiltered = true;
        throw staffError;
      }
      throw e;
    }
  }
}
