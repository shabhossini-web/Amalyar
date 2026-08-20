import { VerticalKey } from '../config/verticals';

/**
 * قالبِ آماده‌ی فرم‌ها به‌ازای حوزه‌ی کاری — **نقطه‌ی شروع، نه قفل.**
 *
 * ⚠️ این تنها جایی است که «حوزه» و «فرم» به هم می‌رسند، و عمداً فقط یک‌بار:
 * هنگامِ seed. از آن لحظه به بعد فرم‌ها مالِ سوپرادمین‌اند و این فایل دیگر
 * حرفی ندارد. اگر حوزه در هر درخواست فرم را تعیین می‌کرد، «ماژولِ ویرایشِ فرم»
 * بی‌معنا بود — کاربر ویرایش می‌کرد و دفعه‌ی بعد همه‌چیز به قالب برمی‌گشت.
 *
 * ⚠️ **چرا مطب سه فرم دارد و نورومانیتورینگ یک فرم:** در نورومانیتورینگ هر
 * مراجعه یک عمل است، پس تفکیک چیزی اضافه نمی‌کند و فقط یک انتخابِ بی‌خود سرِ
 * راهِ کاربر می‌گذارد. در مطب اما مسیرِ بیمار سه ایستگاهِ واقعاً متفاوت دارد:
 * ویزیت (شکایت، معاینه، تشخیص)، جراحی (پروسیجر، بیمارستان، تیم)، و پیگیری
 * (وضعیتِ بهبود، عارضه). یک فرمِ مشترک برای این سه یعنی فرمی که در هر ایستگاه
 * نیمی‌اش بی‌ربط است — و کاربر یاد می‌گیرد نیمی از فرم را رد کند.
 */

export type PresetField = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  builtin?: boolean;
  hint?: string;
  placeholder?: string;
  options?: { v: string; l: string }[];
  /** صفحهٔ چینش. نیامدنش یعنی صفحهٔ ۱ — قالب‌های امروز همه تک‌صفحه‌اند. */
  page?: number;
};

export type PresetForm = {
  key: string;
  title: string;
  /**
   * ⚠️ `survey` دیگر یک محدوده نیست: نظرسنجی **مصداقی** از فرمِ زیرپرونده است
   * و `scope: 'record'` می‌گیرد. مهاجرت مقدارِ قدیمیِ داخلِ دیتابیس را هم
   * برمی‌گرداند، پس نصب‌های موجود چیزی گم نمی‌کنند.
   */
  scope: 'visit' | 'record' | 'intake';
  visitKind?: string;
  hint?: string;
  /** توکنِ رنگِ کارت. نیامدنش یعنی «خودکار از کلید». */
  color?: string;
  fields: PresetField[];
};

/**
 * کلیدهایی که روی فرمِ **مراجعه** به ستونِ واقعیِ `Visit` می‌نشینند.
 *
 * ⚠️ این فهرست **قرارداد** است، نه راحتی: `split()` هر کلیدی را که این‌جا
 * نباشد به `Visit.extra` می‌فرستد. پس اگر فیلدی در قالبِ یک فرمِ مراجعه
 * `builtin` علامت بخورد ولی از این فهرست جا بماند، مقدارش در JSON دفن می‌شود و
 * ستونش خالی می‌ماند — **بدونِ هیچ خطایی**. نگهبانِ CI همین هم‌خوانی را می‌سنجد.
 *
 * ⚠️ فرمِ **ثبت‌نام** عمداً بیرونِ این قرارداد است: فیلدهای builtinاش
 * (`firstName`, `nationalId`, `referralSource`, …) ستونِ `Patient` هستند نه
 * `Visit`، و مسیرِ ذخیره‌شان `IntakeService` است نه `split()`. اگر آن‌ها را هم
 * این‌جا می‌آوردیم، فهرست دو معنی پیدا می‌کرد و اولین کسی که رویش حساب می‌کرد
 * اشتباه می‌فهمید.
 */
export const BUILTIN_VISIT_KEYS = new Set([
  'surgeonId', 'hospitalId', 'techId', 'procedureTypeId', 'diagnosisId',
  'opDate', 'opStartTime', 'opEndTime', 'opType', 'notes', 'amount',
  'payer', 'kind', 'techArriveTime', 'topicId', 'nextVisitDate',
]);

/**
 * کاتالوگِ **کاملِ** فیلدهای هسته‌ایِ قابلِ چینشِ فرمِ مراجعه.
 *
 * ⚠️ چرا این فهرست جدا از `BUILTIN_VISIT_KEYS` است: آن یکی قراردادِ
 * «کدام کلید به ستون می‌نشیند» است و این یکی «کدام فیلد در فرم‌ساز قابلِ
 * روشن/خاموش و جابه‌جایی است». `opReport` دقیقاً جای اختلافشان است: در فرم
 * چیده می‌شود ولی ستون نیست — `setOpReport` آن را به `ClinicalNote` می‌برد،
 * و اگر در `BUILTIN_VISIT_KEYS` بود، `split()` ستونی را می‌نوشت که وجود
 * ندارد و approve با خطای Prisma می‌ترکید.
 *
 * ⚠️ **هر فرمِ مراجعه باید همهٔ این کلیدها را به‌شکلِ ردیفِ builtin داشته
 * باشد** (backfill در `forms.service`). دلیلش باگی است که کاربر گزارش کرد:
 * تا وقتی کاتالوگ ناقص بود، کلاینت فیلدِ «تعریف‌نشده» را روشن حساب می‌کرد —
 * چاره‌ای هم نداشت، چون خاموش‌حساب‌کردنش یعنی ناپدیدشدنِ بی‌صدای فیلدهایی
 * که در هیچ قالبی نبودند. نتیجه: نوعِ «ویزیت» که سوپرادمین می‌ساخت با
 * جراح/بیمارستان/ساعتِ عمل رندر می‌شد و **هیچ راهی برای برداشتنشان نبود**.
 * حالا که کاتالوگ کامل است، «در تعریف نیست» یعنی خاموش، و همهٔ فیلدها در
 * فرم‌ساز یک ردیفِ قابلِ کنترل دارند.
 */
export const VISIT_BUILTIN_CATALOG: { key: string; label: string; type: string }[] = [
  { key: 'opDate', label: 'تاریخ', type: 'date' },
  { key: 'surgeonId', label: 'پزشک/جراح', type: 'select' },
  { key: 'hospitalId', label: 'بیمارستان/مرکز', type: 'select' },
  { key: 'techId', label: 'کارشناس', type: 'select' },
  { key: 'procedureTypeId', label: 'نوعِ عمل', type: 'select' },
  { key: 'diagnosisId', label: 'تشخیص', type: 'select' },
  /* موضوعِ ویزیت — اولیه/پست‌آپ/زیبایی. `docs/BOOKING.md` مرحلهٔ ۱. */
  { key: 'topicId', label: 'موضوعِ ویزیت', type: 'select' },
  { key: 'opStartTime', label: 'ساعتِ شروع', type: 'time' },
  { key: 'opEndTime', label: 'ساعتِ پایان', type: 'time' },
  { key: 'techArriveTime', label: 'حضورِ کارشناس', type: 'time' },
  { key: 'opReport', label: 'شرحِ عمل', type: 'textarea' },
  /* «دو هفتهٔ دیگر بیاید» — ستونِ واقعی، پایهٔ فازِ یادآوری‌ها. */
  { key: 'nextVisitDate', label: 'ویزیتِ بعدی', type: 'date' },
  { key: 'amount', label: 'مبلغ (تومان)', type: 'money' },
  { key: 'notes', label: 'یادداشت', type: 'textarea' },
];

export const VISIT_CATALOG_KEYS = new Set(VISIT_BUILTIN_CATALOG.map((f) => f.key));

/** فیلدهای هسته‌ای که تقریباً هر فرمِ مراجعه‌ای دارد. */
const CORE = {
  surgeon: { key: 'surgeonId', label: 'جراح', type: 'select', builtin: true },
  doctor: { key: 'surgeonId', label: 'پزشک', type: 'select', builtin: true },
  hospital: { key: 'hospitalId', label: 'بیمارستان', type: 'select', builtin: true },
  center: { key: 'hospitalId', label: 'مرکز', type: 'select', builtin: true },
  tech: { key: 'techId', label: 'کارشناس', type: 'select', builtin: true },
  assistant: { key: 'techId', label: 'دستیار', type: 'select', builtin: true },
  procedure: { key: 'procedureTypeId', label: 'نوعِ عمل', type: 'select', builtin: true },
  diagnosis: { key: 'diagnosisId', label: 'تشخیص', type: 'select', builtin: true },
  topic: { key: 'topicId', label: 'موضوعِ ویزیت', type: 'select', builtin: true },
  date: { key: 'opDate', label: 'تاریخ', type: 'date', builtin: true },
  start: { key: 'opStartTime', label: 'ساعتِ شروع', type: 'time', builtin: true },
  end: { key: 'opEndTime', label: 'ساعتِ پایان', type: 'time', builtin: true },
  amount: { key: 'amount', label: 'مبلغ (تومان)', type: 'money', builtin: true },
  notes: { key: 'notes', label: 'توضیحات', type: 'textarea', builtin: true },
  nextVisit: {
    key: 'nextVisitDate', label: 'ویزیتِ بعدی', type: 'date', builtin: true,
    hint: 'اگر بیمار باید دوباره بیاید، همین‌جا ثبت شود — پایهٔ یادآوری‌ها',
  },
} as const;

/** فرمِ عملِ نورومانیتورینگ/تجهیزات — یک فرم، چون یک نوع کار هست. */
const OPERATION: PresetForm = {
  key: 'visit.surgery',
  title: 'فرمِ عمل',
  scope: 'visit',
  visitKind: 'surgery',
  fields: [
    { ...CORE.date, required: true },
    { ...CORE.surgeon, required: true },
    { ...CORE.hospital, required: true },
    { ...CORE.procedure },
    { ...CORE.tech },
    { ...CORE.start },
    { ...CORE.end },
    { ...CORE.amount },
    { ...CORE.notes },
  ],
};

/**
 * فرم‌های مطب — سه ایستگاهِ مسیرِ بیمار.
 *
 * ⚠️ فیلدهای غیرِ builtin این‌جا (شکایتِ اصلی، شرحِ معاینه، وضعیتِ بهبود…) عمداً
 * **پیش‌فرضِ پیشنهادی**اند نه الزام: بیشترِ مطب‌ها این‌ها را می‌خواهند، ولی هر
 * کدامشان با یک کلیک حذف یا اختیاری می‌شود. هدف این است که مشتریِ تازه با
 * صفحه‌ی خالی روبه‌رو نشود، نه اینکه سلیقه‌ی ما را بپذیرد.
 */
const CLINIC_VISIT: PresetForm = {
  key: 'visit.clinic',
  title: 'فرمِ ویزیت',
  scope: 'visit',
  visitKind: 'clinic',
  hint: 'ویزیتِ مطب — شکایت، معاینه و تصمیم.',
  fields: [
    { ...CORE.date, required: true },
    { ...CORE.doctor, required: true },
    { ...CORE.center },
    /* شرحِ ویزیت (اولیه/پست‌آپ/زیبایی…) — سازندهٔ ویزیت انتخاب یا اضافه‌اش
       می‌کند (quick-add در خودِ فرم). نبودنش در پریست یعنی هیچ مطبی این
       فیلد را نمی‌دید — روی نصبِ واقعی گزارش شد. */
    { ...CORE.topic },
    { key: 'chiefComplaint', label: 'شکایتِ اصلی', type: 'textarea', required: true, placeholder: 'به زبانِ خودِ بیمار' },
    { key: 'historyDuration', label: 'مدتِ علائم', type: 'text', placeholder: 'مثلاً ۳ ماه' },
    { key: 'exam', label: 'شرحِ معاینه', type: 'textarea' },
    { ...CORE.diagnosis },
    {
      key: 'plan',
      label: 'تصمیم',
      type: 'select',
      options: [
        { v: 'conservative', l: 'درمانِ محافظه‌کارانه' },
        { v: 'imaging', l: 'درخواستِ تصویربرداری' },
        { v: 'lab', l: 'درخواستِ آزمایش' },
        { v: 'surgery', l: 'کاندیدِ جراحی' },
        { v: 'refer', l: 'ارجاع' },
      ],
      hint: '«کاندیدِ جراحی» یعنی این بیمار در ادامه فرمِ جراحی می‌گیرد.',
    },
    /* طرحِ درمان و نسخه — روایتِ آزادِ پزشک؛ «تصمیم»ِ بالا فقط دسته است. */
    { key: 'planNote', label: 'طرحِ درمان', type: 'textarea', placeholder: 'شرحِ درمان، توصیه‌ها…' },
    { key: 'prescription', label: 'نسخه / دارو', type: 'textarea', placeholder: 'داروها و دستورِ مصرف' },
    { ...CORE.nextVisit },
    { ...CORE.amount },
    { ...CORE.notes },
  ],
};

const CLINIC_SURGERY: PresetForm = {
  key: 'visit.surgery',
  title: 'فرمِ جراحی',
  scope: 'visit',
  visitKind: 'surgery',
  hint: 'عملِ جراحیِ بیماری که از ویزیت به این‌جا رسیده.',
  fields: [
    { ...CORE.date, required: true },
    { ...CORE.doctor, required: true },
    { ...CORE.hospital, required: true },
    { ...CORE.procedure, required: true },
    { ...CORE.diagnosis },
    { ...CORE.assistant },
    { ...CORE.start },
    { ...CORE.end },
    {
      key: 'anesthesia',
      label: 'نوعِ بیهوشی',
      type: 'select',
      options: [
        { v: 'general', l: 'عمومی' },
        { v: 'spinal', l: 'نخاعی' },
        { v: 'local', l: 'موضعی' },
        { v: 'sedation', l: 'سِدیشن' },
      ],
    },
    { key: 'admitDays', label: 'روزهای بستری', type: 'number' },
    { ...CORE.amount },
    { ...CORE.notes },
  ],
};

/** ⚠️ بازنشسته — از PRESETS برداشته شد؛ فقط برای نصب‌های قدیمی مستند می‌ماند. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CLINIC_FOLLOWUP: PresetForm = {
  key: 'visit.followup',
  title: 'فرمِ پیگیری',
  scope: 'visit',
  visitKind: 'followup',
  hint: 'پیگیریِ پس از عمل یا پس از ویزیت.',
  fields: [
    { ...CORE.date, required: true },
    { ...CORE.doctor },
    { ...CORE.topic },
    {
      key: 'recovery',
      label: 'وضعیتِ بهبود',
      type: 'select',
      required: true,
      options: [
        { v: 'good', l: 'خوب' },
        { v: 'fair', l: 'متوسط' },
        { v: 'poor', l: 'ضعیف' },
      ],
    },
    { key: 'painScore', label: 'شدتِ درد (۰ تا ۱۰)', type: 'number', hint: '۰ بدونِ درد، ۱۰ شدیدترین' },
    { key: 'complication', label: 'عارضه', type: 'textarea', placeholder: 'اگر عارضه‌ای بوده' },
    /* ⚠️ builtin شد (ستونِ واقعی) — کلیدِ قدیمیِ `nextVisit` در نصب‌های
       موجود به‌شکلِ فیلدِ دلخواه می‌ماند و داده‌اش سرِ جایش است. */
    { ...CORE.nextVisit, label: 'پیگیریِ بعدی' },
    { ...CORE.amount },
    { ...CORE.notes },
  ],
};

/**
 * فرمِ ثبت‌نامِ بیمار (عمومی).
 *
 * ⚠️ «نحوه‌ی آشنایی» این‌جاست و نه در نظرسنجی: بیمار در لحظه‌ی ثبت‌نام هنوز
 * یادش هست چطور پیدایمان کرده. پرسیدنش هفته‌ها بعد در نظرسنجی، جوابِ حدسی
 * می‌گیرد — و این همان عددی است که تصمیمِ تبلیغات را می‌سازد.
 *
 * ⚠️ کلیدهای builtin این فرم ستونِ `Patient` هستند، نه `Visit` — پس عمداً در
 * `BUILTIN_VISIT_KEYS` نیستند و مسیرِ ذخیره‌شان `IntakeService` است.
 */
const INTAKE: PresetForm = {
  key: 'intake',
  title: 'فرمِ ثبت‌نام',
  scope: 'intake',
  fields: [
    { key: 'firstName', label: 'نام', type: 'text', required: true, builtin: true },
    { key: 'lastName', label: 'نام خانوادگی', type: 'text', required: true, builtin: true },
    { key: 'nationalId', label: 'کدِ ملی', type: 'text', required: true, builtin: true },
    { key: 'phone', label: 'موبایل', type: 'phone', required: true, builtin: true },
    { key: 'birthDate', label: 'تاریخِ تولد', type: 'date', builtin: true },
    { key: 'address', label: 'نشانی', type: 'textarea', builtin: true },
    { key: 'referralSource', label: 'چطور با ما آشنا شدید؟', type: 'select', builtin: true },
  ],
};

/**
 * نظرسنجی — سؤال‌ها کاملاً قابلِ ویرایش، ولی با یک شروعِ معقول.
 *
 * ⚠️ `scope: 'record'` است نه `'survey'`: پرشدنش مراجعه نمی‌سازد، به **پرونده**
 * می‌چسبد. کلیدش عمداً همان `survey` ماند چون `survey.service.ts` با همین کلید
 * پیدایش می‌کند.
 */
const SURVEY: PresetForm = {
  key: 'survey',
  title: 'نظرسنجی',
  scope: 'record',
  hint: 'نظرِ شما کیفیتِ کارِ ما را می‌سازد.',
  fields: [
    { key: 'overall', label: 'رضایتِ کلی', type: 'rating', required: true },
    { key: 'doctor', label: 'برخوردِ پزشک', type: 'rating' },
    { key: 'staff', label: 'برخوردِ کارکنان', type: 'rating' },
    { key: 'waiting', label: 'مدتِ انتظار', type: 'rating' },
    { key: 'recommend', label: 'ما را به دیگران معرفی می‌کنید؟', type: 'bool' },
    { key: 'comment', label: 'هر نکته‌ی دیگری', type: 'textarea' },
  ],
};

/**
 * فرم‌هایی که یک حوزه با آن‌ها شروع می‌کند.
 *
 * ⚠️ `implant` عمداً `formgen` ندارد (به `verticals.ts` نگاه کن) پس فرمِ
 * ثبت‌نام و نظرسنجی نمی‌گیرد — ساختنِ فرمی که هیچ صفحه‌ای نشانش نمی‌دهد یعنی
 * ردیفی در دیتابیس که کاربر پیدایش نمی‌کند و ما بعداً سرش گیج می‌شویم.
 */
export const PRESETS: Record<VerticalKey, PresetForm[]> = {
  ionm: [OPERATION, INTAKE, SURVEY],
  implant: [OPERATION],
  /* ⚠️ «فرمِ پیگیری» عمداً نیست: پیگیری یک **موضوعِ ویزیت** است نه نوعِ
     جدای مراجعه — داشتنِ هر دو، کاربر را سرِ دوراهیِ بی‌معنی می‌گذاشت.
     تعریفش برای نصب‌های قدیمی می‌ماند (غیرفعال)، تا مراجعاتشان خوانده شود. */
  clinic: [CLINIC_VISIT, CLINIC_SURGERY, INTAKE, SURVEY],
};
