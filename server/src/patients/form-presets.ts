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
  /** دستهٔ مدرکی که باکسِ `image`/`links` در پرونده می‌سازد (`DOCUMENT_CATEGORIES`). */
  docCategory?: string;
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
  'payer', 'kind', 'topicId', 'nextVisitDate', 'chiefComplaint',
  /* بستهٔ ۶الف: نوعِ بیهوشی ستون شد — تا دیروز فیلدِ دلخواهِ قالبِ جراحیِ مطب
     بود و در `extra` می‌نشست، پس «چند عمل با بیهوشیِ عمومی؟» جواب نداشت. */
  'anesthesia',
  /* ⚠️ `techArriveTime` عمداً نیست (W3.8/U7): فرمِ مراجعه دیگر ساعتِ حضور
     نمی‌گیرد — از برنامهٔ چینش می‌آید. فیلدی که در فرم‌ساز روشن شود ولی
     چیزی ننویسد، بدترین نوعِ فیلد است: کاربر پُرش می‌کند و بی‌صدا گم می‌شود. */
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
  /* «چرا آمده» — ستونِ واقعی شد تا هر میز همان یک داده را ببیند. */
  { key: 'chiefComplaint', label: 'شکایتِ اولیه', type: 'textarea' },
  /* موضوعِ ویزیت — اولیه/پست‌آپ/زیبایی. `docs/BOOKING.md` مرحلهٔ ۱. */
  { key: 'topicId', label: 'موضوعِ ویزیت', type: 'select' },
  { key: 'opStartTime', label: 'ساعتِ شروع', type: 'time' },
  { key: 'opEndTime', label: 'ساعتِ پایان', type: 'time' },
  { key: 'opReport', label: 'شرحِ عمل', type: 'textarea' },
  /* ── بخش‌های متنیِ هستهٔ ثابت (بستهٔ ۶الف) — مثلِ `opReport` ستون نیستند؛
     `SECTION_NOTES` در `clinical-note.ts` هر کدام را به سندِ نسخه‌دارِ خودش
     می‌برد. کلیدها عمداً همان کلیدهای قدیمیِ فیلدِ دلخواهِ قالبِ مطب‌اند تا
     ردیفِ موجود ارتقا یابد نه دوتا شود. */
  { key: 'history', label: 'شرحِ حال و علائم', type: 'textarea' },
  { key: 'findings', label: 'یافته‌های پاراکلینیک', type: 'textarea' },
  { key: 'exam', label: 'شرحِ معاینه', type: 'textarea' },
  { key: 'planNote', label: 'طرحِ درمان و توصیه‌ها', type: 'textarea' },
  { key: 'prescription', label: 'نسخه / دارو', type: 'textarea' },
  { key: 'anesthesia', label: 'نوعِ بیهوشی', type: 'select' },
  /* «دو هفتهٔ دیگر بیاید» — ستونِ واقعی، پایهٔ فازِ یادآوری‌ها. */
  { key: 'nextVisitDate', label: 'ویزیتِ بعدی', type: 'date' },
  { key: 'amount', label: 'مبلغ (تومان)', type: 'money' },
  { key: 'notes', label: 'یادداشت', type: 'textarea' },
];

export const VISIT_CATALOG_KEYS = new Set(VISIT_BUILTIN_CATALOG.map((f) => f.key));

/**
 * **هستهٔ ثابتِ مراجعه در مطب** — بخش‌هایی که فرم‌ساز خاموش یا حذفشان نمی‌کند.
 *
 * 🔴 تصمیمِ مالک (بستهٔ ۶): «مطب دو نوع مراجعه دارد، ویزیت و عمل؛ ویزیت یک
 * استانداردِ ثابت دارد و عمل یک استانداردِ ثابت». تا دیروز فرم‌ساز می‌توانست
 * حتی «تشخیص» و «شکایتِ اولیه» را خاموش کند، یعنی دو مطب روی یک سامانه دو
 * پروندهٔ ناهم‌سنج می‌ساختند و هیچ گزارشی بینشان جمع نمی‌شد.
 *
 * ⚠️ «ثابت» یعنی **بودن و ترتیب**، نه همه‌چیز: ستاره (اجباری‌بودن)، برچسب و
 * بخشِ نقش همچنان قابلِ تنظیم‌اند — خواستهٔ قبلیِ «سوپرادمین هر فیلد را
 * ستاره‌دار کند یا نکند» سرِ جایش می‌ماند. تفاوت‌های هر مطب جایشان فیلدهای
 * تکمیلی است.
 *
 * ⚠️ فقط حوزهٔ `clinic`: شرکتِ نورومانیتورینگ/ایمپلنت پروندهٔ بالینیِ جراح را
 * نمی‌نویسد و فرمِ سبکِ خودش را نگه می‌دارد.
 *
 * ترتیبِ آرایه همان ترتیبِ رندر است (استانداردِ یادداشتِ بالینی).
 */
export const CLINIC_CORE: Record<'visit' | 'surgery', string[]> = {
  visit: [
    'opDate', 'surgeonId', 'chiefComplaint', 'history', 'findings', 'exam',
    'diagnosisId', 'planNote', 'prescription', 'nextVisitDate',
  ],
  surgery: [
    'opDate', 'surgeonId', 'hospitalId', 'procedureTypeId', 'diagnosisId',
    'chiefComplaint', 'anesthesia', 'opStartTime', 'opEndTime', 'findings', 'opReport',
  ],
};

/** خانوادهٔ هسته‌ای یک نوعِ مراجعه — هر نوعی جز عمل، ویزیت حساب می‌شود. */
export const coreFamily = (visitKind: string | null | undefined): 'visit' | 'surgery' =>
  (visitKind === 'surgery' ? 'surgery' : 'visit');

/** آیا این کلید در این نوعِ مراجعه جزوِ هستهٔ ثابت است؟ (فقط حوزهٔ مطب) */
export const isCoreKey = (vertical: string, visitKind: string | null | undefined, key: string) =>
  vertical === 'clinic' && CLINIC_CORE[coreFamily(visitKind)].includes(key);

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
  /* ⚠️ `builtin` شد چون ستون شد. تا دیروز فیلدِ دلخواه بود و پاسخش در
     `Visit.extra` می‌نشست — یعنی شکایتی که در ویزیت ثبت می‌شد در اتاقِ عمل
     دیده نمی‌شد. نصب‌های موجود با backfillِ `forms.service` به ردیفِ builtin
     ارتقا می‌یابند و مقدارشان با مهاجرتِ SQL به ستون می‌رود. */
  chiefComplaint: {
    key: 'chiefComplaint', label: 'شکایتِ اولیه', type: 'textarea', builtin: true,
    placeholder: 'به زبانِ خودِ بیمار',
  },
  nextVisit: {
    key: 'nextVisitDate', label: 'ویزیتِ بعدی', type: 'date', builtin: true,
    hint: 'اگر بیمار باید دوباره بیاید، همین‌جا ثبت شود — پایهٔ یادآوری‌ها',
  },
  history: {
    key: 'history', label: 'شرحِ حال و علائم', type: 'textarea', builtin: true,
    placeholder: 'شروع، مدت، سیر، علائمِ همراه…',
  },
  findings: { key: 'findings', label: 'یافته‌های پاراکلینیک', type: 'textarea', builtin: true },
  exam: { key: 'exam', label: 'شرحِ معاینه', type: 'textarea', builtin: true },
  planNote: {
    key: 'planNote', label: 'طرحِ درمان و توصیه‌ها', type: 'textarea', builtin: true,
    placeholder: 'شرحِ درمان، توصیه‌ها…',
  },
  prescription: {
    key: 'prescription', label: 'نسخه / دارو', type: 'textarea', builtin: true,
    placeholder: 'داروها و دستورِ مصرف',
  },
  anesthesia: { key: 'anesthesia', label: 'نوعِ بیهوشی', type: 'select', builtin: true },
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
    { ...CORE.chiefComplaint },
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
/**
 * باکس‌های مدارکِ پزشکیِ فرمِ ویزیت — عکس‌های MRI/CT و لینک‌های پکس/آزمایشگاه.
 *
 * ⚠️ چرا پیش‌فرض‌اند: مطبِ واقعی همین دو را خودش با یک باکسِ عکس و یک «متنِ
 * بلند برای لینک» ساخته بود (اسکرین‌شاتِ کاربر) — لینکِ داخلِ متنِ بلند نه
 * کلیک‌شدنی است، نه رمزِ پورتال جایی دارد، نه به مدارکِ پرونده می‌رسد.
 * ⚠️ جدا export شده چون `backfillClinicMedia` همین دو را به فرمِ ویزیتِ نصب‌های
 * موجود اضافه می‌کند؛ قالب فقط برای نصبِ تازه خوانده می‌شود.
 */
export const CLINIC_MEDIA_FIELDS: PresetField[] = [
  {
    key: 'imaging', label: 'تصاویرِ پزشکی (MRI، CT، رادیولوژی…)', type: 'image', docCategory: 'imaging',
    hint: 'چند عکس با هم یا یکی‌یکی — در پرونده زیرِ «تصویربرداری» می‌نشیند',
  },
  {
    key: 'imagingLinks', label: 'لینکِ تصاویر و آزمایش‌ها', type: 'links', docCategory: 'imaging',
    hint: 'لینکِ پکس، درایو یا سایتِ آزمایشگاه؛ اگر ورود می‌خواهد، نامِ کاربری و رمزش را زیرِ همان لینک بنویسید',
  },
];

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
    /* ── هستهٔ ثابتِ ویزیت (بستهٔ ۶الف) — به ترتیبِ استانداردِ یادداشتِ بالینی:
       شکایت ← شرحِ حال ← یافته‌ها ← معاینه ← تشخیص ← تصمیم ← طرح و نسخه.
       ⚠️ «تصمیم» دیگر فیلدِ دلخواهِ `plan` نیست: ستونِ چندتاییِ
       `Visit.decisions` است که همیشه زیرِ تشخیص رندر می‌شود. «مدتِ علائم» هم
       در شرحِ حال آمد — یک جملهٔ کوتاه، نه یک فیلدِ جدا. */
    { ...CORE.chiefComplaint, required: true },
    { ...CORE.history },
    { ...CORE.findings },
    ...CLINIC_MEDIA_FIELDS,
    { ...CORE.exam },
    { ...CORE.diagnosis },
    { ...CORE.planNote },
    { ...CORE.prescription },
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
    /* ⚠️ روی فرمِ عمل هم هست، چون عملی که از ویزیت نیامده ارثی ندارد و
       باید همین‌جا پرسیده شود. عملی که از ویزیت آمده این را خالی می‌گذارد و
       شکایت را از همان ویزیت **مشتق** می‌کند (`decidedInVisitId`). */
    { ...CORE.chiefComplaint },
    { ...CORE.anesthesia },
    { ...CORE.assistant },
    { ...CORE.start },
    { ...CORE.end },
    { ...CORE.findings, label: 'یافته‌های حینِ عمل' },
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

/** Public registration is a separate workflow from the team's clinical visit form. */
export const REGISTRATION_PRESETS: Record<VerticalKey, PresetForm> = {
  ionm: {
    ...INTAKE, key: 'intake.ionm', title: 'ثبت‌نام خدمات نورومانیتورینگ', visitKind: 'surgery',
    hint: 'مشخصات بیمار، اطلاعات عمل و فیش؛ پس از بررسی شرکت، مراجعه ثبت می‌شود.',
    fields: [...INTAKE.fields.filter(f => !['address', 'referralSource'].includes(f.key)),
      { key: 'surgeonName', label: 'نام جراح', required: true }, { key: 'hospitalName', label: 'بیمارستان', required: true },
      { key: 'procedure', label: 'نوع عمل' }, { key: 'opDate', label: 'تاریخ عمل', type: 'date', required: true },
      { key: 'patientNotes', label: 'توضیحات بیمار', type: 'textarea' }, { key: 'pay', label: 'پرداخت و فیش واریزی', type: 'payment' }],
  },
  implant: {
    ...INTAKE, key: 'intake.implant', title: 'ثبت‌نام تأمین تجهیزات و ایمپلنت', visitKind: 'surgery',
    hint: 'دستور جراح و اطلاعات عمل را بفرستید؛ شرکت، اقلام و تعداد موردنیاز را پیش از تأیید بررسی می‌کند.',
    fields: [...INTAKE.fields.filter(f => !['address', 'referralSource'].includes(f.key)),
      { key: 'surgeonName', label: 'نام جراح', required: true }, { key: 'hospitalName', label: 'بیمارستان', required: true },
      { key: 'procedure', label: 'نوع عمل' }, { key: 'opDate', label: 'تاریخ عمل', type: 'date' },
      { key: 'prescription', label: 'تصویر دستور جراح', type: 'image', required: true },
      { key: 'patientNotes', label: 'شرح دستور و توضیحات', type: 'textarea' },
      { key: 'pay', label: 'پرداخت و فیش واریزی', type: 'payment' }],
  },
  clinic: { ...INTAKE, key: 'intake.clinic', title: 'ثبت‌نام مطب و درخواست ویزیت', visitKind: 'clinic',
    hint: 'ثبت‌نام اولیه و درخواست ویزیت؛ فرم عمل از مسیر جداگانهٔ مطب انتخاب می‌شود.',
    fields: [...INTAKE.fields, { key: 'chiefComplaint', label: 'علت مراجعه', type: 'textarea', required: true }, { key: 'patientNotes', label: 'توضیحات تکمیلی', type: 'textarea' }] },
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

/** زیرپروندهٔ پیگیری؛ با نوع مراجعهٔ followup متفاوت است. */
export const POSTOP_FOLLOWUP: PresetForm = {
  key: 'record.postop-followup', title: 'پیگیری پس از عمل', scope: 'record',
  hint: 'پاسخ‌ها برای بررسی تیم درمان ثبت می‌شوند. این فرم جای تماس ضروری با مرکز درمانی نیست.',
  fields: [
    { key: 'generalCondition', label: 'وضعیت کلی نسبت به روز قبل', type: 'select', required: true,
      options: [{ v: 'better', l: 'بهتر' }, { v: 'same', l: 'بدون تغییر' }, { v: 'worse', l: 'بدتر' }] },
    { key: 'symptoms', label: 'علائم یا تغییرات جدید را شرح دهید', type: 'textarea', required: true, hint: 'اگر علامت تازه‌ای ندارید بنویسید ندارم.' },
    { key: 'careQuestions', label: 'پرسش درباره دستورهای مراقبتی داده‌شده', type: 'textarea' },
    { key: 'medicationQuestions', label: 'مشکل یا پرسش درباره داروهای تجویزشده', type: 'textarea' },
    { key: 'contactRequested', label: 'درخواست تماس از تیم درمان دارم', type: 'bool' },
    { key: 'contactTime', label: 'زمان مناسب تماس', type: 'text' },
    { key: 'otherNotes', label: 'توضیحات دیگر', type: 'textarea' },
  ],
};

/**
 * فرم‌هایی که یک حوزه با آن‌ها شروع می‌کند.
 *
 * هر حوزه ثبت‌نام مستقل دارد؛ فرم‌های بالینی مطب و الگوهای سفارشی حفظ می‌شوند.
 */
export const PRESETS: Record<VerticalKey, PresetForm[]> = {
  ionm: [OPERATION, REGISTRATION_PRESETS.ionm, SURVEY],
  implant: [OPERATION, REGISTRATION_PRESETS.implant],
  /* ⚠️ «فرمِ پیگیری» عمداً نیست: پیگیری یک **موضوعِ ویزیت** است نه نوعِ
     جدای مراجعه — داشتنِ هر دو، کاربر را سرِ دوراهیِ بی‌معنی می‌گذاشت.
     تعریفش برای نصب‌های قدیمی می‌ماند (غیرفعال)، تا مراجعاتشان خوانده شود. */
  clinic: [CLINIC_VISIT, CLINIC_SURGERY, REGISTRATION_PRESETS.clinic, SURVEY],
};
