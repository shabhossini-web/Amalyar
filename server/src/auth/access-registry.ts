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
  {
    key: 'work',
    label: 'کارها و پیگیری',
    hint: 'صفِ کارِ هر نقش: نتیجهٔ نیازمندِ بررسی، ثبت‌نامِ در انتظار، تماس با بیمار، گزارشِ ناقص… هر کار مسئول و مهلت دارد.',
  },
];

/**
 * ماژول‌ها.
 *
 * ⚠️ `minLevel`ِ ذخیره‌شده در DB منبعِ حقیقت است؛ این‌ها فقط seedِ اولیه‌اند.
 * `enabled` بعداً اهرمِ لایسنس/پلنِ SaaS هم می‌شود.
 */
export const FEATURES: AccessDef[] = [
  { key: 'surgeon', label: 'پرتال جراح', group: 'modules', defaultLevel: LEVEL.TECH, hint: 'مراجعات و دستورهای جراح مرتبط با حساب در شرکت‌های نورو و ایمپلنت.' },
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
    /* میزِ پذیرشِ روز (§۴.۵) — **عمداً سطحِ کارشناس/منشی**، نه سوپروایزر.
       کسی که بیمار را می‌پذیرد پایین‌ترین سطحِ کاری است؛ اگر این کاشی سطحِ
       `calendar` را بگیرد، منشی اصلاً نمی‌تواند بیمار را «رسید» بزند و کلِ
       بسته بی‌مصرف می‌شود. ⚠️ و دلیلِ اینکه کنترلرِ جدا دارد نه گیتِ پایین‌ترِ
       `calendar`: پایین‌آوردنِ `calendar` کلِ تقویمِ عمل‌ها و قواعدِ برنامهٔ
       کاری را هم سطحِ ۲ می‌کرد. */
    key: 'frontdesk', label: 'میزِ پذیرش', group: 'modules',
    hint: 'پذیرشِ بیمارانِ امروز: رسید، شروعِ مراجعه، نوبتِ حضوری.',
    defaultLevel: LEVEL.TECH,
  },
  {
    /* ⚠️ خواندن از سطحِ **کارشناس** باز است چون گام‌های دوره همان کاری است که
       خودِ کارشناس انجام می‌دهد؛ ولی انتشارِ الگو مجوزِ جدا دارد (`pathway.manage`)
       چون الگو روی بیمارانِ **بعدی** اثر می‌گذارد نه یک پرونده. */
    key: 'pathway', label: 'مسیرِ درمان', group: 'modules',
    hint: 'دورهٔ خدمت با مرحله، مسئول و موعد — برای نصب‌های ویزیت‌محور و دوره‌ای.',
    defaultLevel: LEVEL.TECH,
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
    key: 'site', label: 'سایتِ معرفیِ شرکت', group: 'modules',
    hint: 'صفحهٔ عمومیِ روی دامنهٔ خودِ شرکت — چیزی که مراجعه‌کننده پیش از هر ورودی می‌بیند. خاموش که باشد، ریشهٔ دامنه مثلِ قبل به فرمِ ورود می‌رود.',
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
  {
    key: 'work', label: 'کارهای من', group: 'modules',
    hint: 'صفِ کارِ هر نفر و هر نقش (لایهٔ کار). عمداً از سطحِ کارشناس باز است: هر کسی که کاری به نامش می‌خورد باید آن را ببیند.',
    defaultLevel: LEVEL.TECH,
  },
];

/** مجوزهای ریزدانهٔ عملیات. */
export const PERMISSIONS: AccessDef[] = [
  { key: 'surgeon.read', label: 'دیدن مراجعات خود در پرتال جراح', group: 'patients', defaultLevel: LEVEL.TECH },
  { key: 'surgeon.write', label: 'ثبت دستور و اقلام موردنیاز مراجعات خود', group: 'patients', defaultLevel: LEVEL.TECH },
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
  /* ── میزِ پذیرش ─────────────────────────────────────────────
     ⚠️ این‌ها **مجوزِ عملیات**اند نه ماژول (قانون ۳): دیدنِ تختهٔ روز با
     عوض‌کردنِ وضعیتِ بیمار یکی نیست، و نصبی که می‌خواهد منشی فقط ببیند باید
     بتواند بدونِ خاموش‌کردنِ کلِ کاشی این کار را بکند. */
  {
    key: 'pathway.read', label: 'دیدنِ مسیرِ درمان', group: 'patients',
    hint: 'دوره‌های بیمار، مرحله‌ها، مسئول و موعد.',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'pathway.step', label: 'ثبتِ مرحلهٔ مسیر', group: 'patients',
    hint: 'انجام‌شده/رد‌شده کردنِ مرحله و جابه‌جاییِ موعدِ همان بیمار.',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'pathway.start', label: 'شروع و بستنِ دورهٔ درمان', group: 'patients',
    defaultLevel: LEVEL.TECH_ADMIN,
  },
  {
    key: 'pathway.manage', label: 'انتشارِ الگوی مسیر', group: 'patients',
    hint: 'الگو روی بیمارانِ بعدی اثر می‌گذارد، نه یک پرونده — پس سطحِ مدیر.',
    defaultLevel: LEVEL.ADMIN,
  },
  {
    key: 'frontdesk.read', label: 'دیدنِ میزِ پذیرش', group: 'patients',
    hint: 'تختهٔ بیمارانِ امروز و وضعیتشان.',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'frontdesk.status', label: 'تغییرِ وضعیتِ پذیرش', group: 'patients',
    hint: 'رسید / نیامد / تمام شد / لغو روی نوبتِ امروز.',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'frontdesk.start', label: 'شروعِ مراجعه از میز', group: 'patients',
    hint: 'بازکردنِ فرمِ مراجعه برای بیمارِ حاضر.',
    defaultLevel: LEVEL.TECH,
  },
  {
    key: 'frontdesk.walkin', label: 'نوبتِ حضوری', group: 'patients',
    hint: 'گرفتنِ نوبت برای بیمارِ سرِ میز — از همان مسیرِ ظرفیت.',
    defaultLevel: LEVEL.TECH,
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
    key: 'visits.claim', label: 'پذیرشِ مراجعهٔ آزاد در بیمارستان محل خدمت', group: 'patients',
    hint: 'فقط در بیمارستان و روزی که مدیر حضور کارشناس را ثبت کرده است.',
    defaultLevel: LEVEL.TECH,
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

  // ── فرمِ ثبت‌نامِ بیمار ────────────────────────────────────────
  {
    key: 'intake.read', label: 'دیدنِ صفِ ثبت‌نامِ بیماران', group: 'patients',
    hint: 'فرم‌هایی که بیماران از لینکِ عمومی پر کرده‌اند و هنوز مراجعه نشده‌اند.',
    defaultLevel: LEVEL.ADMIN,
  },
  {
    key: 'intake.review', label: 'تأیید، رد و بازگرداندنِ ثبت‌نام', group: 'patients',
    hint: 'تأیید یعنی ساختِ مراجعهٔ واقعی — از این‌جا داده وارد دفترِ عملیاتی و مالی می‌شود.',
    defaultLevel: LEVEL.ADMIN,
  },
  {
    key: 'intake.manage', label: 'ساخت و ویرایشِ لینکِ ثبت‌نام', group: 'system',
    hint: 'لینکِ عمومی و مبلغش. هر کسی این لینک را داشته باشد می‌تواند ثبت‌نام کند.',
    defaultLevel: LEVEL.ADMIN,
  },

  // ── تعاریف و سامانه ──────────────────────────────────────────
  {
    /* ⚠️ خواندنِ تعریفِ فرم عمداً سطحِ پایینی دارد: هر کسی که مراجعه ثبت
       می‌کند باید بداند چه فیلدهایی و کدامشان اجباری‌اند — بدونِ آن اصلاً
       فرمی برای پرکردن ندارد. */
    key: 'forms.read', label: 'دیدنِ تعریفِ فرم‌ها', group: 'system',
    hint: 'فیلدهای فرمِ مراجعه، ثبت‌نام و نظرسنجی.',
    defaultLevel: LEVEL.TECH,
  },
  {
    /* ⚠️ ولی نوشتن سوپرادمین است: یک فیلدِ اجباریِ تازه همان لحظه کارِ همه‌ی
       کاربران را عوض می‌کند. */
    key: 'forms.manage', label: 'ویرایشِ فرم‌ها', group: 'system',
    hint: 'افزودن و حذفِ فیلد، اجباری‌کردن، و ترتیب.',
    defaultLevel: LEVEL.SUPER_ADMIN,
  },
  {
    key: 'site.read', label: 'دیدنِ محتوای سایتِ معرفی', group: 'system',
    hint: 'متن‌ها، خدمات، تصاویر و پرسش‌های صفحهٔ عمومی.',
    defaultLevel: LEVEL.ADMIN,
  },
  {
    /* ⚠️ نوشتن عمداً یک پله بالاتر از خواندن است: این تنها جایی در سامانه
       است که متنِ نوشته‌شده **بیرون** از دیوارِ لاگین منتشر می‌شود. */
    key: 'site.manage', label: 'ویرایشِ سایتِ معرفی', group: 'system',
    hint: 'هر تغییری این‌جا بلافاصله روی صفحهٔ عمومیِ شرکت دیده می‌شود.',
    defaultLevel: LEVEL.SUPER_ADMIN,
  },
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
  /* ── لایهٔ کار (W2.1) ── */
  { key: 'work.read', label: 'دیدنِ کارهای خود و نقشِ خود', group: 'work', defaultLevel: LEVEL.TECH },
  { key: 'work.write', label: 'انجام، توقف و ساختنِ کارِ دستی', group: 'work', defaultLevel: LEVEL.TECH },
  { key: 'work.assign', label: 'واگذاریِ کار به دیگران و دیدنِ همهٔ کارها', group: 'work', hint: 'سوپروایزر و بالاتر: کارِ بی‌مسئول را به کسی می‌دهد و صفِ همه را می‌بیند.', defaultLevel: LEVEL.SUPERVISOR },
  { key: 'work.process', label: 'اجرای دستیِ پردازشگرِ رویدادها', group: 'work', hint: 'فقط برای آزمون و عیب‌یابی؛ worker همین را خودکار انجام می‌دهد.', defaultLevel: LEVEL.SUPER_ADMIN },
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
