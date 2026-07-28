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
    features: { dashboard: 5, calendar: 4, dispatch: 4, tech: 2, accounting: 5, messenger: 2, formgen: 5, letter: 5, users: 6 },
  },
  /** تأمین‌کنندهٔ ست و ایمپلنت — واحدِ کار همان مراجعه است، با قلم‌های کالا. */
  implant: {
    label: 'تجهیزات و ایمپلنت',
    // چینشِ کارشناس معنا ندارد؛ در عوض انبار و فاکتور مهم است.
    features: { dashboard: 5, calendar: 4, accounting: 4, messenger: 2, letter: 5, users: 6 },
  },
  /** مطب و تیمِ جراحی — از ویزیت تا عمل تا پیگیری. */
  clinic: {
    label: 'مطب و تیمِ جراحی',
    features: { dashboard: 4, calendar: 3, accounting: 5, messenger: 2, formgen: 5, letter: 5, users: 6 },
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
