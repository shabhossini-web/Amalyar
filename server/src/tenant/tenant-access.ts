/**
 * چرخهٔ عمرِ تجاریِ شرکت — **تنها** جایی که «این شرکت الان چه دسترسی‌ای دارد» حساب می‌شود.
 *
 * خواستهٔ مالک (۱۴۰۵/۰۷/۱۵): برای شرکت‌های ساخته‌شده بشود حساب را فعال/غیرفعال کرد،
 * مهلت گذاشت، و نسخهٔ آزمایشی (دمو) داد. سه ستونِ control-db این را حمل می‌کنند و
 * این فایل آن‌ها را به یک حالتِ یگانه ترجمه می‌کند که میان‌افزار اعمال می‌کند،
 * پنلِ پلتفرم نشان می‌دهد و اپِ شرکت در بنر می‌خواند. کلاینت هیچ‌کدام را خودش
 * استنتاج نمی‌کند (قانونِ ۱۵) — «۱۲ روز مانده» از همین‌جا می‌آید.
 *
 * قاعده‌ها:
 *  - `suspendedAt` ست باشد → **معلق**: هیچ درخواستی به دیتابیسِ شرکت نمی‌رسد (۴۰۳)،
 *    جز `GET /api/auth/setup-status` که صفحهٔ ورود با آن علت را به کاربر می‌گوید.
 *  - `accessUntil` گذشته باشد → **منقضی**: خواندن آزاد، نوشتن ۴۰۳ — داده قفل می‌شود،
 *    گم نمی‌شود، و ورود/خروج همچنان کار می‌کند تا کاربر پرونده‌هایش را ببیند.
 *  - `plan = demo` فقط برچسب است («نسخهٔ آزمایشی»)؛ مهلتش را همان `accessUntil` می‌دهد.
 *
 * بدونِ وابستگی به Nest، تا Worker و سوییت‌ها هم همین را بخوانند.
 */

export const TENANT_PLANS = ['demo', 'paid'] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];

export const PLAN_LABELS: Record<TenantPlan, string> = { demo: 'نسخهٔ آزمایشی (دمو)', paid: 'اشتراک' };

export const ACCESS_MESSAGES = {
  suspended: 'حسابِ این شرکت غیرفعال شده است. برای فعال‌سازی با پشتیبانیِ عمل‌یار تماس بگیرید.',
  expired: 'مهلتِ اشتراکِ این شرکت به پایان رسیده است؛ تا تمدید، سامانه فقط برای مشاهده باز است.',
} as const;

export type TenantAccessState = 'active' | 'suspended' | 'expired';

export interface TenantAccessSource {
  plan?: string | null;
  accessUntil?: Date | string | null;
  suspendedAt?: Date | string | null;
}

export interface TenantAccess {
  state: TenantAccessState;
  plan: TenantPlan;
  planLabel: string;
  /** ISO؛ `null` یعنی بی‌مهلت. */
  accessUntil: string | null;
  /** روزهای مانده تا پایانِ مهلت (منفی = گذشته)؛ `null` وقتی مهلتی نیست. */
  daysLeft: number | null;
  suspended: boolean;
  readOnly: boolean;
  /** متنِ فارسیِ وضعیت برای بنر/پیام؛ `null` وقتی چیزی برای گفتن نیست. */
  message: string | null;
}

const DAY_MS = 86_400_000;
/** تهران ثابت است؛ مهلت «تا پایانِ آن روز» معنا دارد، نه تا لحظهٔ ثبت. */
const TEHRAN_OFFSET = '+03:30';

/** `YYYY-MM-DD` (میلادی) → لحظهٔ پایانِ همان روز به وقتِ تهران. نامعتبر → `null`. */
export function endOfDayTehran(ymd: string | null | undefined): Date | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T23:59:59.999${TEHRAN_OFFSET}`);
  if (Number.isNaN(d.getTime())) return null;
  // «۱۴۰۵-۰۲-۳۱»ِ اشتباهِ کاربر را JS بی‌صدا به ماهِ بعد می‌برد؛ همان روز باید برگردد.
  const back = new Date(d.getTime() + 3.5 * 3_600_000).toISOString().slice(0, 10);
  return back === ymd ? d : null;
}

/** تاریخِ `YYYY-MM-DD`ِ تهران برای `days` روز بعد از `now`. */
export function tehranDatePlusDays(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() + 3.5 * 3_600_000 + days * DAY_MS).toISOString().slice(0, 10);
}

/** شمارهٔ روزِ تقویمیِ تهران (برای تفاضلِ روزها، نه ساعت‌ها). */
const tehranDayIndex = (at: Date) => Math.floor((at.getTime() + 3.5 * 3_600_000) / DAY_MS);

export function normalizePlan(value: unknown): TenantPlan {
  return value === 'demo' ? 'demo' : 'paid';
}

export function tenantAccess(src: TenantAccessSource, now: Date = new Date()): TenantAccess {
  const plan = normalizePlan(src.plan);
  const until = src.accessUntil ? new Date(src.accessUntil) : null;
  const suspended = Boolean(src.suspendedAt);
  const hasUntil = Boolean(until && !Number.isNaN(until.getTime()));
  /* «روزِ مانده» تفاضلِ **تاریخِ تقویمیِ** تهران است، نه ساعت: مهلتِ «تا ۲۷ مهر» در صبحِ ۱۵ مهر
     ۱۲ روز مانده است (همان حسابی که کاربر می‌کند)، در خودِ ۲۷ مهر صفر («امروز آخرین روز»)،
     و فردایش منفی. انقضا اما با لحظهٔ دقیق سنجیده می‌شود (پایانِ همان روز). */
  const daysLeft = hasUntil ? tehranDayIndex(until!) - tehranDayIndex(now) : null;
  const expired = hasUntil && until!.getTime() < now.getTime();
  const state: TenantAccessState = suspended ? 'suspended' : expired ? 'expired' : 'active';
  return {
    state,
    plan,
    planLabel: PLAN_LABELS[plan],
    accessUntil: hasUntil ? until!.toISOString() : null,
    daysLeft,
    suspended,
    readOnly: state === 'expired',
    message: state === 'suspended' ? ACCESS_MESSAGES.suspended : state === 'expired' ? ACCESS_MESSAGES.expired : null,
  };
}

/** مسیرهایی که در حالتِ فقط‌خواندنی هم نوشتن می‌خواهند: ورود/خروج/بازیابیِ رمز — نه هیچ دادهٔ بالینی. */
const READ_ONLY_WRITE_ALLOW = /^\/api\/auth\/(login|logout|logout-all|switch|password\/request-otp|password\/reset|webauthn\/login\/(options|verify))$/;

/** آیا این درخواست در حالتِ فقط‌خواندنی مجاز است؟ (خواندن همیشه؛ نوشتن فقط برای ورود و خروج) */
export function readOnlyAllows(method: string, path: string): boolean {
  const m = (method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  return READ_ONLY_WRITE_ALLOW.test(path.replace(/\/+$/, ''));
}

/** تنها مسیری که شرکتِ معلق هم جواب می‌گیرد — تا صفحهٔ ورود بگوید چرا بسته است. */
export const SUSPENDED_ALLOW = /^\/api\/auth\/setup-status$/;
