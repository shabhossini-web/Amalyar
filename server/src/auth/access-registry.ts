import { LEVEL } from '../common/levels';

/**
 * رجیستریِ دسترسی — **خالص**، بدونِ Prisma و Nest.
 *
 * ⚠️ **همان قاعدهٔ `settings-registry.ts`: کلید از کد می‌آید، مقدار از کاربر.**
 *
 * سامانه دو لایهٔ دسترسی دارد و تا امروز فقط نیمی‌اش دیده می‌شد:
 *
 *   • `Feature`  — «کدام ماژول برای چه سطحی باز است» (داشبورد، انبار، چینش…)
 *   • `Permission` — «چه کسی چه کاری می‌تواند بکند» (`stock.consume`، `billing.write`…)
 *
 * لایهٔ دوم جدولِ خودش را داشت و گاردِ خودش را، ولی هیچ رابطی نداشت؛ یعنی
 * نیمی از سیستمِ دسترسی فقط با تغییرِ کد قابلِ تنظیم بود. این فایل هر دو لایه
 * را **یک‌جا اعلام** می‌کند تا صفحهٔ ماتریس از روی همین ساخته شود و کلاینت
 * هیچ کلید یا برچسبی را hardcode نکند.
 *
 * ⚠️ **هر کلید باید `label`ِ فارسی داشته باشد.** کلیدی که فقط `stock.consume`
 * دیده شود، برای مدیری که باید تصمیم بگیرد یعنی هیچ — و مدیری که نمی‌فهمد،
 * یا هیچ‌وقت دست نمی‌زند یا کورکورانه باز می‌کند. نگهبانِ CI همین را می‌سنجد.
 *
 * افزودنِ مجوزِ تازه = یک ردیف این‌جا؛ نه migration لازم دارد نه دست‌زدن به UI.
 */

export interface AccessGroup {
  key: string;
  label: string;
  hint?: string;
}

export interface AccessDef {
  key: string;
  /** برچسبِ فارسی — چیزی که مدیر می‌خواند، نه کلیدِ کد. */
  label: string;
  /** چرا این دسترسی جداست و باز/بسته‌بودنش چه معنایی دارد. */
  hint?: string;
  group: string;
  defaultLevel: number;
  /**
   * قفلِ ضدِ‌ارتقا. کلیدِ قفل نه سطحش عوض می‌شود نه خاموش می‌شود —
   * دلیلش پایینِ `LOCKED_FEATURES` آمده.
   */
  locked?: boolean;
}

/** دسته‌بندیِ ماتریس. ترتیبِ همین آرایه ترتیبِ صفحه است. */
export const ACCESS_GROUPS: AccessGroup[] = [
  {
    key: 'modules',
    label: 'ماژول‌ها',
    hint: 'کدام بخشِ سامانه اصلاً برای این سطح باز شود. ماژولِ بسته یعنی کاشی‌اش در لانچر هم دیده نمی‌شود.',
  },
  {
    key: 'patients',
    label: 'بیماران و مراجعات',
    hint: 'بخشِ هویتی از بخشِ بالینی جداست: کارشناسی که برای چینشِ کار نامِ بیمار را می‌بیند، لازم نیست سابقهٔ پزشکی‌اش را ببیند.',
  },
  {
    key: 'documents',
    label: 'مدارک',
  },
  {
    key: 'money',
    label: 'مالی',
    hint: 'صورت‌حساب از حسابداری جداست: کسی که فاکتورِ بیمار را می‌بندد لازم نیست سهمِ جراح و درصدِ شرکا را ببیند، و برعکس.',
  },
  {
    key: 'inventory',
    label: 'انبار',
  },
  {
    key: 'system',
    label: 'تعاریف و سامانه',
  },
];

/**
 * ماژول‌ها.
 *
 * ⚠️ `minLevel`ِ ذخیره‌شده در DB منبعِ حقیقت است؛ این‌ها فقط seedِ اولیه‌اند.
 * `enabled` بعداً اهرمِ لایسنس/پلنِ SaaS هم می‌شود.
 */
export const FEATURES: AccessDef[] = [
  {
    key: 'dashboard', label: 'داشبورد مدیریت', group: 'modules',
    hint: 'ثبت و پیگیریِ مراجعات، مالیِ پایه و گزارش‌ها.',
    defaultLevel: LEVEL.ADMIN,
  },
  {
    key: 'formgen', label: 'فرم‌ساز', group: 'modules',
    defaultLevel: LEVEL.ADMIN,
  },
  {
    key: 'messenger', label: 'پیام‌رسان', group: 'modules',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'accounting', label: 'حسابداری', group: 'modules',
    hint: 'قرارداد جراح، تقسیمِ سهم و دفترِ شرکا.',
    defaultLevel: LEVEL.ADMIN,
  },
  {
    key: 'calendar', label: 'تقویمِ عمل‌ها', group: 'modules',
    defaultLevel: LEVEL.SUPERVISOR,
  },
  {
    key: 'dispatch', label: 'چینشِ نیروها', group: 'modules',
    defaultLevel: LEVEL.SUPERVISOR,
  },
  {
    key: 'letter', label: 'نامهٔ اداری', group: 'modules',
    defaultLevel: LEVEL.ADMIN,
  },
  {
    key: 'tech', label: 'پنلِ کارشناسی', group: 'modules',
    hint: 'دفترِ کارِ خودِ کارشناس. عمداً سطحِ پایینی دارد: کارشناس نباید برای دیدنِ کارِ فردایش به داشبوردِ مدیریت دسترسی بگیرد.',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'inventory', label: 'انبار', group: 'modules',
    defaultLevel: LEVEL.TECH_ADMIN,
  },
  {
    key: 'users', label: 'مدیریتِ کاربران', group: 'modules',
    hint: 'تأیید، رد و تعیینِ سطحِ کاربران. قفل است — دلیلش در ستونِ کناری.',
    defaultLevel: LEVEL.SUPER_ADMIN, locked: true,
  },
  {
    key: 'transport', label: 'پرتالِ حمل‌ونقل', group: 'modules',
    hint: 'راننده و پیک مسیرِ خودشان را می‌بینند و تحویل را ثبت می‌کنند. هیچ اطلاعاتی از بیمار در آن نیست.',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'access', label: 'سطوحِ دسترسی', group: 'modules',
    hint: 'همین صفحه. قفل است — صفحه‌ای که دسترسی‌ها را عوض می‌کند نمی‌تواند خودش را برای سطحِ پایین‌تر باز کند.',
    defaultLevel: LEVEL.SUPER_ADMIN, locked: true,
  },
];

/** مجوزهای ریزدانهٔ عملیات. */
export const PERMISSIONS: AccessDef[] = [
  {
    key: 'transport.own', label: 'دیدنِ مسیرِ خود و ثبتِ تحویل', group: 'inventory',
    hint: 'راننده و پیک: مسیرِ امروزِ خودشان، بارِ هر توقف، و ثبتِ آن‌که واقعاً تحویل گرفت.',
    defaultLevel: LEVEL.TECH,
  },
  // ── بیماران و مراجعات ─────────────────────────────────────────
  {
    key: 'patients.read', label: 'دیدنِ فهرستِ مراجعات', group: 'patients',
    hint: 'نام بیمار، جراح، تاریخ و بیمارستانِ هر مراجعه.',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'patients.read_all', label: 'دیدنِ مراجعاتِ همهٔ کارشناسان', group: 'patients',
    hint: 'بدونِ این، هر کس فقط مراجعاتی را می‌بیند که خودش در آن‌ها کارشناس بوده.',
    defaultLevel: LEVEL.SUPERVISOR,
  },
  {
    key: 'patients.create', label: 'ثبتِ مراجعهٔ تازه', group: 'patients',
    defaultLevel: LEVEL.TECH_ADMIN,
  },
  {
    key: 'patients.update', label: 'ویرایشِ مراجعه', group: 'patients',
    hint: 'جراح، بیمارستان، نوعِ عمل و تاریخ.',
    defaultLevel: LEVEL.SUPERVISOR,
  },
  {
    key: 'patients.status', label: 'بستنِ وضعیتِ عمل (انجام‌شده / لغو)', group: 'patients',
    defaultLevel: LEVEL.SUPERVISOR,
  },
  {
    key: 'visits.times', label: 'ثبتِ ساعتِ شروع و پایانِ عمل', group: 'patients',
    hint: 'کارِ کسی است که سرِ عمل حاضر است. عمداً از «ویرایشِ مراجعه» جدا مانده تا این اجازه، اجازهٔ دست‌زدن به مالی نشود.',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'patients.delete', label: 'حذفِ مراجعه', group: 'patients',
    defaultLevel: LEVEL.SUPER_ADMIN,
  },
  {
    key: 'patients.clinical.read', label: 'دیدنِ بخشِ بالینیِ پرونده', group: 'patients',
    hint: 'حساسیت، سابقه، بیمه و شرح‌ها — جدا از بخشِ هویتی.',
    defaultLevel: LEVEL.TECH_ADMIN,
  },
  {
    key: 'patients.clinical.write', label: 'ویرایشِ بخشِ بالینیِ پرونده', group: 'patients',
    defaultLevel: LEVEL.TECH_ADMIN,
  },

  // ── مدارک ────────────────────────────────────────────────────
  {
    key: 'documents.read', label: 'دیدنِ مدارکِ پرونده', group: 'documents',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'documents.write', label: 'آپلودِ مدرک و گزارشِ عمل', group: 'documents',
    hint: 'آپلودِ گزارش کارِ خودِ کارشناس است، پس از سطحِ کارشناس باز است؛ دامنه‌اش محدود به مراجعاتی است که خودش در آن‌ها بوده.',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'documents.delete', label: 'حذفِ مدرک', group: 'documents',
    defaultLevel: LEVEL.ADMIN,
  },

  // ── مالی ─────────────────────────────────────────────────────
  {
    key: 'billing.read', label: 'دیدنِ صورت‌حسابِ مراجعه', group: 'money',
    defaultLevel: LEVEL.SUPERVISOR,
  },
  {
    key: 'billing.write', label: 'صدورِ صورت‌حساب و ثبتِ پرداخت', group: 'money',
    defaultLevel: LEVEL.ADMIN,
  },
  {
    key: 'accounting.read', label: 'دیدنِ حسابداری — قرارداد، سهمِ جراح و شرکا', group: 'money',
    defaultLevel: LEVEL.ADMIN,
  },
  {
    key: 'accounting.manage', label: 'نهایی‌کردنِ تسویه و پرداختِ سهم', group: 'money',
    hint: 'تسویهٔ نهایی‌شده بدهیِ بینِ شرکا می‌سازد؛ برگشتش هم رکورد می‌گذارد نه پاک‌کردن.',
    defaultLevel: LEVEL.ADMIN,
  },

  // ── انبار ────────────────────────────────────────────────────
  {
    key: 'inventory.read', label: 'دیدنِ موجودی، لات‌ها و حواله‌ها', group: 'inventory',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'inventory.write', label: 'ثبتِ ورود، حواله و جابه‌جاییِ کالا', group: 'inventory',
    defaultLevel: LEVEL.TECH_ADMIN,
  },
  {
    key: 'inventory.adjust', label: 'انبارگردانی — بازنویسیِ موجودیِ لات', group: 'inventory',
    hint: 'با یک عدد کلِ موجودیِ یک لات بازنویسی می‌شود و اختلافش دیگر قابلِ ردیابی نیست؛ برای همین از ثبتِ عادیِ انبار بالاتر است.',
    defaultLevel: LEVEL.SUPERVISOR,
  },
  {
    key: 'stock.consume', label: 'ثبتِ مصرفِ سرِ عمل روی حواله', group: 'inventory',
    hint: 'کارِ کارشناسِ حاضر در اتاقِ عمل. جدا از «ثبتِ ورود و حواله» مانده تا این اجازه، اجازهٔ ساختِ لات یا صدورِ حواله نشود.',
    defaultLevel: LEVEL.TECH,
  },

  // ── تعاریف و سامانه ──────────────────────────────────────────
  {
    key: 'definitions.read', label: 'دیدنِ تعاریفِ پایه', group: 'system',
    hint: 'جراح، بیمارستان، نوعِ عمل، کالا و ست.',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'definitions.manage', label: 'ساخت و ویرایشِ تعاریفِ پایه', group: 'system',
    defaultLevel: LEVEL.ADMIN,
  },
  {
    key: 'users.manage', label: 'مدیریتِ کاربران — تأیید، رد و تعیینِ سطح', group: 'system',
    hint: 'قفل است: کسی که سطحِ دیگران را عوض می‌کند می‌تواند سطحِ خودش را هم عوض کند. این تنها درِ ارتقای دسترسی در سامانه است و باید دستِ سوپرادمین بماند.',
    defaultLevel: LEVEL.SUPER_ADMIN, locked: true,
  },
  {
    key: 'import.run', label: 'وارد کردنِ دادهٔ سامانهٔ قبلی', group: 'system',
    hint: 'کلِ دیتابیسِ شرکت را دست می‌زند.',
    defaultLevel: LEVEL.SUPER_ADMIN,
  },
];

/**
 * ⚠️ **درِ ضدِ‌ارتقا.**
 *
 * `users` و `access` و `users.manage` قفل‌اند و باید بمانند. اگر سطحِ این‌ها
 * پایین بیاید، سطحِ ۵ می‌تواند سطحِ خودش را ۶ کند و همهٔ قفل‌های دیگر بی‌معنا
 * می‌شوند — یعنی کلِ این صفحه یک دکمهٔ «من سوپرادمین شوم» می‌شد.
 *
 * قفل روی **خودِ کلید** است نه روی سطحِ فعلی، چون اگر شرطْ «سطحش ۶ باشد» بود،
 * یک PATCH آن را ۵ می‌کرد و PATCHِ بعدی دیگر قفل نمی‌دید.
 *
 * نکتهٔ دوم: سوپرادمین هرگز نمی‌تواند خودش را بیرون بگذارد، چون هر دو گارد
 * برای سطح ۶ زودتر `true` برمی‌گردانند. پس بدترین کارِ ممکن روی این صفحه
 * «بستنِ در به روی بقیه» است، نه «بستنِ در به روی همه».
 */
export const LOCKED_FEATURES: ReadonlySet<string> = new Set(
  FEATURES.filter((f) => f.locked).map((f) => f.key),
);
export const LOCKED_PERMISSIONS: ReadonlySet<string> = new Set(
  PERMISSIONS.filter((p) => p.locked).map((p) => p.key),
);

export const FEATURE_BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));
export const PERMISSION_BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

/** شکلِ قدیمیِ پیش‌فرضِ ماژول‌ها — تا `FeatureGuard` بی‌تغییر بماند. */
export const FEATURE_DEFAULT_LEVELS: Record<string, { minLevel: number }> =
  Object.fromEntries(FEATURES.map((f) => [f.key, { minLevel: f.defaultLevel }]));

/** شکلِ قدیمیِ پیش‌فرضِ مجوزها — تا `PermissionGuard` بی‌تغییر بماند. */
export const PERMISSION_DEFAULT_LEVELS: Record<string, number> =
  Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.defaultLevel]));
