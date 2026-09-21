import { LEVEL } from '../common/levels';

/**
 * حوزهٔ کاریِ شرکت — «همان یک تغییرِ کوچک» که نصب را خصوصی‌سازی می‌کند.
 *
 * هر حوزه دو چیز تعیین می‌کند:
 *  ۱. کدام ماژول‌ها روشن باشند و از چه سطحی
 *  ۲. کاربر چه کلماتی ببیند (نگاشتِ واژگان در فرانت، با همین کلید)
 *
 * ⚠️ خودِ ساختارِ داده عوض نمی‌شود. یک «کیس»ِ شرکتِ تجهیزات همان Visit است با
 * قلم‌های کالا؛ اگر برای هر حوزه جدولِ جدا بسازیم، سه محصول داریم نه یکی.
 */
export const VERTICALS = {
  /** نورومانیتورینگ حین عمل — حوزهٔ فعلی. */
  ionm: {
    label: 'نورومانیتورینگ حین عمل',
    /** نوعِ پیش‌فرضِ «مراجعهٔ جدید» — کلیدِ فرمِ مراجعه (`visit.<kind>`). */
    defaultKind: 'surgery',
    // انبار اینجا هم هست: الکترود و سوزنِ یک‌بارمصرف هم لات و تاریخِ انقضا دارند.
    features: { dashboard: 5, calendar: 4, frontdesk: 2, dispatch: 4, tech: 2, surgeon: 2, accounting: 5, messenger: 2, formgen: 5, letter: 5, inventory: 3, site: 5, users: 6, work: 2, pathway: 2 },
  },
  /** تأمین‌کنندهٔ ست و ایمپلنت — واحدِ کار همان مراجعه است، با قلم‌های کالا. */
  implant: {
    label: 'تجهیزات و ایمپلنت',
    defaultKind: 'surgery',
    // چینشِ کارشناس معنا ندارد؛ در عوض انبار و فاکتور مهم است. برای این حوزه
    // انبار هستهٔ کار است نه جانبی — ردیابیِ سریالِ ایمپلنت الزامِ فراخوان است،
    // پس از سطحِ کارشناس باز می‌شود.
    features: { dashboard: 5, calendar: 4, frontdesk: 2, surgeon: 2, accounting: 4, messenger: 2, formgen: 5, letter: 5, inventory: 2, site: 5, users: 6, work: 2, pathway: 2 },
  },
  /** مطب و تیمِ جراحی — از ویزیت تا عمل تا پیگیری. */
  clinic: {
    label: 'مطب و تیمِ جراحی',
    // در مطب اولین گزینهٔ «مراجعهٔ جدید» ویزیت است، نه عمل (بستهٔ ۵ب).
    defaultKind: 'clinic',
    // `surgeon` = «میزِ پزشک»: پزشکِ مطب (حسابِ متصل به تعریفِ جراح) همه‌کارش را
    // از همان‌جا می‌کند — امروزِ من، بیمارانِ من، نتایجِ رسیده (بازخوردِ مالک ۱۴۰۵/۰۶/۲۹).
    features: { dashboard: 4, calendar: 3, frontdesk: 2, surgeon: 2, accounting: 5, messenger: 2, formgen: 5, letter: 5, site: 5, users: 6, work: 2, pathway: 2 },
  },
} as const;

export type VerticalKey = keyof typeof VERTICALS;

export const DEFAULT_VERTICAL: VerticalKey = 'ionm';

export const isVertical = (value: unknown): value is VerticalKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(VERTICALS, value);

/**
 * سطحِ پیش‌فرضِ هر ماژول برای یک حوزه.
 *
 * ماژولی که در فهرستِ حوزه نیست خاموش می‌شود — نه اینکه سطحش بالا برود. تفاوتش
 * مهم است: خاموش یعنی «این محصول این را ندارد»، سطحِ بالا یعنی «دسترسی نداری».
 *
 * ⚠️ **پس هر ماژولِ تازه باید این‌جا هم بیاید، وگرنه سوییچِ حوزه بی‌صدا
 * خاموشش می‌کند.** `frontdesk` (W3.3) دقیقاً همین را خورده بود: در
 * `access-registry` ثبت شده بود ولی در هیچ‌کدام از سه حوزه نبود، پس اولین
 * تغییرِ حوزه میزِ پذیرش را از روی لانچر برمی‌داشت و هیچ خطایی هم نمی‌داد.
 * با W4.1 هم خودش اضافه شد هم `pathway`.
 */
export function featurePlanFor(vertical: VerticalKey): Record<string, { minLevel: number; enabled: boolean }> {
  const plan = VERTICALS[vertical].features as Record<string, number>;
  const out: Record<string, { minLevel: number; enabled: boolean }> = {};
  for (const [key, minLevel] of Object.entries(plan)) out[key] = { minLevel, enabled: true };
  return out;
}

/** برای اعتبارسنجیِ سطح در جای دیگر. */
export const MIN_LEVEL = LEVEL.VIEWER;
export const MAX_LEVEL = LEVEL.SUPER_ADMIN;
