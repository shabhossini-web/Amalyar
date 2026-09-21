/**
 * **کاتالوگِ نوعِ فرم — تنها جایی که می‌گوید هر نوعِ فرم چه چیزی دارد.**
 *
 * بازخوردِ مالک ۱۴۰۵/۰۶/۳۰: «نوعِ فرم‌هامون به‌هم‌ریخته شده… موقع اضافه/کم‌کردنِ
 * باکس‌ها بعضی چیزا قاطی میشه… مرحلهٔ تأییدِ فرم‌های شرکتی و نورو و جراحی و ویزیت
 * همه یه اطلاعات و میخوان، باید تفکیک بشن… فرم‌هایی که پرداخت میخوان و نمیخوان
 * باید بهتر تفکیک شن.» تصمیمِ مالک برای فرم‌ساز: **نیمه‌بسته** — فیلدِ دلخواه
 * می‌مانَد، ولی نه هر باکسی روی هر فرمی.
 *
 * ⚠️ چرا این فایل لازم شد — سه چیزی که قبلاً هرکدام جای خودش حدس زده می‌شد:
 *
 * ① **پالتِ فرم‌ساز تخت بود.** هر چهارده نوعِ باکس روی هر فرمی، بدونِ هیچ
 *    نشانه‌ای از اینکه کدامشان به این فرم می‌خورد. کاربر باید خودش می‌دانست.
 *
 *    ⚠️ **ولی این کاتالوگ راهنماست نه قفل — و این را با اشتباه یاد گرفتیم.**
 *    نسخهٔ اول باکسِ پرداخت را روی فرمِ مراجعه ۴۰۰ می‌کرد، با این استدلال که
 *    «پرداخت مالِ ثبت‌نام است». غلط بود: `resolveLinkRefs` هر فرمی را به یک
 *    `IntakeLink` می‌بندد، پس فرمِ مراجعه هم واقعاً می‌تواند پول بگیرد. سه
 *    سوییتِ رگرسیون همان لحظه قرمز شدند. `boxes` یعنی «این‌ها را اول نشان بده»،
 *    نه «بقیه ممنوع».
 *
 * ② **مرحلهٔ تأیید با `targetKind` و `workflow` حدس زده می‌شد** و استثناها
 *    هاردکد بودند (`visible('surgeonId') || workflow === 'ionm'`). هر حوزهٔ
 *    تازه یعنی یک شرطِ تازه در JSX — همان شکلی که «قاطی» می‌شود.
 *
 * ③ **نبودِ تعریفِ فرم به یک فهرستِ ثابت fallback می‌کرد**
 *    (`targetKind !== 'clinic' || ['surgeonId','opDate','opStartTime']`). یعنی
 *    یک خطای شبکه، پنلِ تأیید را به چیدمانی می‌برد که هیچ‌کس انتخابش نکرده.
 *
 * ⚠️ **این فایل قرارداد است، نه سلیقه.** کلاینت هیچ‌کدام از این فهرست‌ها را
 * دوباره نمی‌نویسد؛ از `GET /forms/types` می‌خواند (قانونِ ۳ و ۱۵). نگهبانِ CI
 * هاردکدشدنشان را می‌گیرد.
 */

/** نوعِ فرم از `scope` و `visitKind`ِ خودِ فرم ساخته می‌شود — بدونِ ستونِ تازه. */
export const formTypeKey = (scope: string, visitKind?: string | null): string =>
  visitKind ? `${scope}.${visitKind}` : scope;

/** آیا این نوعِ فرم **معمولاً** پول می‌گیرد؟ برچسبِ کارتِ فرم از همین می‌آید — قاعدهٔ اجرایی نیست. */
export type PaymentRule = 'required' | 'optional' | 'never';

export interface FormSection {
  key: string;
  label: string;
  /** کلیدهای هسته‌ای که در این بخش می‌نشینند — ترتیبِ نمایشِ فرم‌ساز. */
  builtin: string[];
  /** فیلدِ دلخواهِ تازه به کدام بخش می‌رود؟ دقیقاً یک بخش این را دارد. */
  custom?: boolean;
}

export interface FormTypeDef {
  key: string;
  label: string;
  /** یک جملهٔ کوتاه که در فرم‌ساز بالای پالت می‌نشیند. */
  hint: string;
  payment: PaymentRule;
  /** باکس‌هایی که این نوعِ فرم معمولاً می‌خواهد — پالت این‌ها را **اول** نشان می‌دهد؛ بقیه زیرِ «سایر» می‌مانند. */
  boxes: string[];
  /** کنترل‌هایی که **مرحلهٔ تأیید** لازم دارد — پنلِ تأیید همین را می‌خوانَد. */
  approval: string[];
  sections: FormSection[];
}

/* باکس‌های متنی/عددی — روی هر فرمی معنی دارند. */
const PLAIN = ['text', 'textarea', 'number', 'select', 'multiselect', 'date', 'time', 'bool', 'phone', 'rating'];
/* مدرک — عکس و لینکِ بیرونی. */
const MEDIA = ['image', 'links'];

const patientSection = (): FormSection => ({
  key: 'patient', label: 'اطلاعاتِ بیمار', builtin: [],
});
const mediaSection = (): FormSection => ({
  key: 'media', label: 'مدارک', builtin: [],
});
const customSection = (): FormSection => ({
  key: 'custom', label: 'پرسش‌های اختصاصی', builtin: [], custom: true,
});

/**
 * ⚠️ **`approval` عمداً فهرستِ کنترل است، نه «همهٔ فیلدهای فرم».**
 * پنلِ تأیید جایی است که ادمین مراجعه را **می‌سازد**؛ چیزی که آن‌جا لازم است
 * لزوماً همان چیزی نیست که بیمار پر کرده. ثبت‌نامِ نورومانیتورینگ جراح را
 * اجباری می‌خواهد حتی اگر بیمار کادرش را ندیده باشد، و ویزیتِ مطب بیمارستان
 * نمی‌خواهد. تا دیروز همین تفاوت با `workflow === 'ionm'` در JSX نوشته شده بود.
 */
export const FORM_TYPES: Record<string, FormTypeDef> = {
  'intake.surgery': {
    key: 'intake.surgery',
    label: 'ثبت‌نامِ عمل',
    hint: 'بیمار پیش از عمل پر می‌کند و فیشِ واریزی می‌گذارد. تأیید، مراجعه می‌سازد.',
    payment: 'required',
    boxes: [...PLAIN, ...MEDIA, 'payment'],
    approval: ['surgeonId', 'hospitalId', 'techId', 'procedureTypeId', 'opDate', 'opStartTime'],
    sections: [
      { ...patientSection(), builtin: ['surgeonName', 'hospitalName', 'procedure', 'opDate'] },
      mediaSection(),
      { key: 'payment', label: 'پرداخت', builtin: ['pay'] },
      customSection(),
    ],
  },
  'intake.clinic': {
    key: 'intake.clinic',
    label: 'ثبت‌نامِ ویزیت',
    hint: 'بیمارِ مطب پیش از ویزیت پر می‌کند. پرداخت اختیاری است — ویزیتِ رایگان هم داریم.',
    payment: 'optional',
    boxes: [...PLAIN, ...MEDIA, 'payment'],
    approval: ['surgeonId', 'opDate', 'opStartTime'],
    sections: [
      { ...patientSection(), builtin: ['opDate'] },
      mediaSection(),
      { key: 'payment', label: 'پرداخت', builtin: ['pay'] },
      customSection(),
    ],
  },
  'visit.surgery': {
    key: 'visit.surgery',
    label: 'فرمِ عمل',
    hint: 'کارکنان هنگام و پس از عمل پر می‌کنند. پول از خودِ مراجعه می‌آید، نه از باکسِ پرداخت.',
    payment: 'never',
    boxes: [...PLAIN, ...MEDIA],
    approval: ['surgeonId', 'hospitalId', 'techId', 'procedureTypeId', 'opDate', 'opStartTime'],
    sections: [
      { key: 'pre', label: 'پیش از عمل', builtin: ['surgeonId', 'hospitalId', 'techId', 'procedureTypeId', 'opDate'] },
      { key: 'intra', label: 'حینِ عمل', builtin: ['opStartTime', 'opEndTime', 'opReport'] },
      { key: 'post', label: 'پس از عمل', builtin: ['nextVisitDate', 'notes'] },
      customSection(),
    ],
  },
  'visit.clinic': {
    key: 'visit.clinic',
    label: 'فرمِ ویزیت',
    hint: 'ویزیتِ مطب. بیمارستان و کارشناس ندارد؛ پزشک و تاریخ کافی است.',
    payment: 'never',
    boxes: [...PLAIN, ...MEDIA],
    approval: ['surgeonId', 'opDate', 'opStartTime'],
    sections: [
      { key: 'pre', label: 'پیش از ویزیت', builtin: ['surgeonId', 'topicId', 'opDate', 'opStartTime'] },
      { key: 'intra', label: 'شرحِ ویزیت', builtin: ['diagnosisId', 'opReport'] },
      { key: 'post', label: 'پس از ویزیت', builtin: ['nextVisitDate', 'notes'] },
      customSection(),
    ],
  },
  'visit.followup': {
    key: 'visit.followup',
    label: 'فرمِ پیگیری',
    hint: 'پیگیریِ پس از عمل یا ویزیت. مراجعهٔ تازه نمی‌سازد.',
    payment: 'never',
    boxes: [...PLAIN, ...MEDIA],
    approval: ['surgeonId', 'opDate'],
    sections: [
      { ...patientSection(), builtin: ['surgeonId', 'opDate'] },
      mediaSection(),
      customSection(),
    ],
  },
  'visit.consult': {
    key: 'visit.consult',
    label: 'فرمِ مشاوره',
    hint: 'مشاورهٔ پیش از تصمیم. بیمارستان و ساعت لازم ندارد.',
    payment: 'never',
    boxes: [...PLAIN, ...MEDIA],
    approval: ['surgeonId', 'opDate'],
    sections: [
      { ...patientSection(), builtin: ['surgeonId', 'topicId', 'opDate'] },
      mediaSection(),
      customSection(),
    ],
  },
  /* ⚠️ فرمِ ثبت‌نامِ **بی‌نوع** — نصبِ قدیمی یا فرمی که `visit_kind` نگرفته.
     بدونِ این ردیف به `record` می‌افتاد و باکسِ پرداختش رد می‌شد، یعنی
     همان فرمی که کارش گرفتنِ پول است از پول‌گرفتن می‌افتاد. fallbackِ امن
     برای «ثبت‌نام» یعنی نگه‌داشتنِ پرداخت، نه برداشتنش. */
  intake: {
    key: 'intake',
    label: 'ثبت‌نام',
    hint: 'فرمِ ثبت‌نامِ بی‌نوع. اگر نوعِ مراجعه‌اش را مشخص کنید، چیدمانِ دقیق‌ترش می‌آید.',
    payment: 'optional',
    boxes: [...PLAIN, ...MEDIA, 'payment'],
    approval: ['surgeonId', 'opDate'],
    sections: [patientSection(), mediaSection(), { key: 'payment', label: 'پرداخت', builtin: ['pay'] }, customSection()],
  },
  /* ⚠️ فرمِ **مراجعهٔ** بی‌نوع — `createForm` اجازه می‌دهد `visitKind` خالی
     بماند و سه سوییتِ موجود دقیقاً همین را می‌سازند. بدونِ این ردیف به `record`
     می‌افتاد، یعنی فرمِ مراجعه برچسبِ «زیرپرونده» می‌گرفت. */
  visit: {
    key: 'visit',
    label: 'فرمِ مراجعه',
    hint: 'فرمِ مراجعهٔ بی‌نوع. اگر نوعش را مشخص کنید (عمل/ویزیت/پیگیری) بخش‌بندیِ دقیق‌ترش می‌آید.',
    payment: 'optional',
    boxes: [...PLAIN, ...MEDIA, 'payment'],
    approval: ['surgeonId', 'hospitalId', 'opDate', 'opStartTime'],
    sections: [patientSection(), mediaSection(), customSection()],
  },
  record: {
    key: 'record',
    label: 'فرمِ زیرپرونده',
    hint: 'نظرسنجی و پرسش‌نامه. مراجعه نمی‌سازد و پول نمی‌گیرد — فقط پاسخ ثبت می‌کند.',
    payment: 'never',
    boxes: [...PLAIN, ...MEDIA],
    approval: [],
    sections: [customSection(), mediaSection()],
  },
};

/**
 * نوعِ یک فرم — با fallbackِ **صریح**.
 *
 * ⚠️ fallback به `record` می‌رود نه به بازترین حالت: نوعِ ناشناخته (نصبِ قدیمی،
 * `visitKind`ِ عجیب) نباید سهواً باکسِ پرداخت یا کنترل‌های تأیید بگیرد. نوعِ
 * ناشناخته باید **کمترین** اختیار را داشته باشد، نه بیشترین.
 */
export function formTypeOf(scope: string, visitKind?: string | null): FormTypeDef {
  return FORM_TYPES[formTypeKey(scope, visitKind)]
    ?? FORM_TYPES[scope]
    ?? FORM_TYPES.record;
}

/** آیا این باکس در پالتِ **پیشنهادیِ** این نوعِ فرم است؟ (نه مجوز — رجوع به یادداشتِ بالا.) */
export const boxSuggested = (t: FormTypeDef, box: string): boolean => t.boxes.includes(box);
