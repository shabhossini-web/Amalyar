/**
 * **«امروز» یک تعریف دارد — به وقتِ مطب، نه به وقتِ کانتینر.**
 *
 * 🔴 باگِ واقعی که این فایل برایش ساخته شد: سرور روی کانتینرِ **UTC** می‌دود و
 * کاربر در **تهران** (+۳:۳۰) است. `FrontDeskService.todayIso()` روزِ UTC را
 * می‌داد ولی مرورگر روزِ محلی را می‌فرستد، پس بینِ ۰۰:۰۰ تا ۰۳:۳۰ تهران این دو
 * **یک روز اختلاف** داشتند: `isToday` غلط می‌شد و `canStart` برای **کلِ تخته**
 * خاموش — یعنی هر شب سه ساعت و نیم هیچ بیماری از میزِ پذیرش شروع نمی‌شد و
 * هیچ خطایی هم دیده نمی‌شد. همان پنجره‌ای که شیفتِ شب واقعاً کار می‌کند.
 *
 * و «امروز» هفت پیادهٔ مستقل داشت: پنج تا `setHours(0,0,0,0)` (ساعتِ کانتینر)،
 * یکی `setUTCHours`، و یکی `Intl` با `Asia/Tehran` — همان یکی که درست بود.
 *
 * ⚠️ **قراردادِ ذخیره‌سازی عوض نمی‌شود:** تاریخ‌ها نیمه‌شبِ **UTC**ِ همان روزِ
 * تقویمی ذخیره می‌شوند (`common/jalali.ts` → `toJalali` هم روی UTC می‌خواند).
 * چیزی که این‌جا درست می‌شود «**کدام** روزِ تقویمی امروز است»، نه اینکه
 * مرزهایش کجاست. پس بازه همچنان نیمه‌شبِ UTC تا نیمه‌شبِ UTCِ روزِ بعد است.
 *
 * ⚠️ منطقهٔ زمانی از env می‌آید تا نصبِ خارج از ایران هم درست کار کند، ولی
 * پیش‌فرضش `Asia/Tehran` است — نه `UTC`: پیش‌فرضِ غلطی که «کار می‌کند» بدترین
 * حالت است، چون هیچ‌کس تنظیمش نمی‌کند و باگ فقط سه ساعتِ شب دیده می‌شود.
 */
export const CLINIC_TZ = process.env.CLINIC_TZ || 'Asia/Tehran';

/**
 * فرمترها کش می‌شوند چون **ساختنِ `Intl` گران‌ترین کارِ این فایل است** و
 * `clinicTodayIso()` در حلقه صدا زده می‌شود (هر ردیفِ تختهٔ میزِ پذیرش).
 * درسِ ثبت‌شده در ملک‌طب: ~۱۲۸۰ ساختِ فرمتر برای یک صفحه، ۱۸۲ms → ۰٫۶ms.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** `YYYY-MM-DD`ِ یک لحظه، به وقتِ مطب. */
export function clinicDateIso(at: Date = new Date(), tz: string = CLINIC_TZ): string {
  let f = FORMATTERS.get(tz);
  if (!f) {
    /* `en-CA` عمداً: تنها locale ای که بی‌هیچ گزینهٔ اضافه `YYYY-MM-DD` می‌دهد. */
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    FORMATTERS.set(tz, f);
  }
  return f.format(at);
}

/** «امروز» به وقتِ مطب — `YYYY-MM-DD`. */
export const clinicTodayIso = (at: Date = new Date(), tz: string = CLINIC_TZ) => clinicDateIso(at, tz);

/**
 * نیمه‌شبِ UTCِ یک روزِ تقویمی — همان قراردادِ ستونِ `DATE`ِ `Appointment`
 * و تاریخ‌های ذخیره‌شده.
 */
export const dayUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * بازهٔ یک روزِ تقویمی برای فیلترِ `DateTime` — `[gte, lte]`.
 *
 * ⚠️ `lte` روی ۲۳:۵۹:۵۹٫۹۹۹ است نه `lt` روی روزِ بعد، چون همهٔ فراخوان‌های
 * موجود `lte` می‌نوشتند و عوض‌کردنِ نوعِ مرز در یک migrationِ بی‌ربط یعنی
 * تفاوتِ یک‌میلی‌ثانیه‌ای که فقط در دادهٔ واقعی خودش را نشان می‌دهد.
 */
export function dayRangeUtc(iso: string): [Date, Date] {
  const start = dayUtc(iso);
  return [start, new Date(start.getTime() + 86_399_999)];
}

/** بازهٔ «امروزِ مطب» — میان‌بری که بیشترِ فراخوان‌ها همین را می‌خواهند. */
export function todayRangeUtc(at: Date = new Date(), tz: string = CLINIC_TZ): [Date, Date] {
  return dayRangeUtc(clinicTodayIso(at, tz));
}

/**
 * آفسِتِ منطقهٔ زمانی (دقیقه) در یک لحظه — فرمترِ کش‌شده، همان دلیلِ بالا.
 */
const OFFSET_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function tzOffsetMinutes(at: Date, tz: string): number {
  let f = OFFSET_FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    OFFSET_FORMATTERS.set(tz, f);
  }
  const parts = f.formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * **لحظهٔ واقعیِ** شروعِ روزِ مطبِ حاوی `at` — برای مقایسه با زمان‌مهرهای واقعی
 * (`doneAt`، `createdAt`)، نه با تاریخ‌های ذخیره‌شده (که نیمه‌شبِ UTC‌اند و `dayUtc` دارند).
 *
 * ⚠️ تفاوتش با `todayRangeUtc` همان سه ساعت و نیم است: نیمه‌شبِ تهران ۲۰:۳۰ UTCِ روزِ
 * قبل است. آشکارسازی که «تحویلِ دیشب» را با `doneAt < نیمه‌شبِ UTC` می‌سنجید، تحویلِ
 * ۱۲:۳۰ بامدادِ تهران را «دیروز» می‌شمرد و همان شب برای دفتر کار می‌ساخت.
 */
export function clinicDayStart(at: Date = new Date(), tz: string = CLINIC_TZ): Date {
  const midnightAsUtc = dayUtc(clinicDateIso(at, tz)).getTime();
  const guess = new Date(midnightAsUtc - tzOffsetMinutes(at, tz) * 60_000);
  /* اگر آفست درست در همان شب عوض شده باشد (DST)، آفستِ خودِ نیمه‌شب ملاک است. */
  return new Date(midnightAsUtc - tzOffsetMinutes(guess, tz) * 60_000);
}
