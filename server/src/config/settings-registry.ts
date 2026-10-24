/**
 * رجیستریِ تنظیماتِ شرکت — **خالص**، بدونِ Prisma و Nest.
 *
 * ⚠️ **قاعدهٔ حاکم: کلید از کد می‌آید، مقدار از کاربر.**
 *
 * وسوسه این است که صفحهٔ تنظیمات یک ویرایشگرِ آزادِ key/value باشد تا «هر
 * خصوصی‌سازی بدون deploy» ممکن شود. ولی آن‌وقت یک مدیر `contact_phone`
 * می‌نویسد و مدیرِ بعدی `contactPhone`، هر دو در جدول می‌نشینند، هیچ‌کدام را
 * کد نمی‌خواند، و شش ماه بعد کسی نمی‌داند کدام درست است. تنظیمی که کد
 * نمی‌خواندش تنظیم نیست، یادداشت است.
 *
 * پس هر کلید این‌جا **اعلام** می‌شود با نوع و پیش‌فرضش، و سرویس هر کلیدِ
 * نااعلام را رد می‌کند. افزودنِ تنظیمِ تازه = یک ردیف در این فایل؛ نه
 * migration لازم دارد نه دست‌زدن به UI (صفحه از همین فهرست ساخته می‌شود).
 *
 * `vertical` عمداً این‌جا نیست: تغییرش فقط یک مقدار نمی‌نویسد، جدولِ
 * `features` را بازچینی می‌کند — پس سرویس و صفحهٔ خودش را دارد.
 */

import { QUIET_DEFAULT } from '../sms/quiet-hours';

export type SettingType = 'text' | 'textarea' | 'number' | 'bool' | 'color';

export interface SettingDef {
  key: string;
  label: string;
  hint?: string;
  group: string;
  type: SettingType;
  /** پیش‌فرض **در کد** می‌ماند، نه در دیتابیس. دلیلش پایینِ `serialize` آمده. */
  default: string | number | boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  /** ورودیِ لاتین (شماره، کد) — تا در RTL جابه‌جا نشود. */
  ltr?: boolean;
  /** در گروهِ «پیامک‌ها» متنِ خام است، نه قالبِ پیامک (بدونِ دکمهٔ جای‌گیر و پیش‌نمایشِ پیامک). */
  plain?: boolean;
  /** در صفحهٔ تنظیمات نشان داده نمی‌شود — با فرایندِ خودش (مثلاً آپلود) پر می‌شود. */
  hidden?: boolean;
  /**
   * فقط برای نصبی که یکی از این خدمات را دارد (مثلاً فیلدهای فاکتورِ نورومانیتورینگ) — مطب و
   * شرکتِ ایمپلنت قالبِ خامِ `901290:EMG,…` را نمی‌بینند (بازبینیِ UX ۱۴۰۵/۰۷).
   */
  services?: string[];
}

export interface SettingGroupDef {
  key: string;
  label: string;
  hint?: string;
  /** گروه فقط وقتی ماژولِ همین کلید برای این نصب روشن است — «حمل و نقل» در مطب معنا ندارد. */
  feature?: string;
}

export const SETTING_GROUPS: SettingGroupDef[] = [
  { key: 'invoice', label: 'قالب فاکتور {org}', hint: 'اطلاعات این قالب در نسخهٔ صادرشده ثبت می‌شود؛ تغییر قالب، فاکتورهای قبلی را تغییر نمی‌دهد.' },
  {
    key: 'identity',
    label: 'هویتِ {org}',
    hint: 'روی فاکتورِ رسمی و سربرگ چاپ می‌شود. فاکتورِ بدونِ شناسهٔ ملی و کدِ اقتصادی سندِ مالیاتی نیست.',
  },
  {
    key: 'inventory',
    label: 'انبار و دارایی',
    hint: 'پیش‌فرض‌های انبار. تغییرشان روی دادهٔ ثبت‌شده اثر ندارد؛ از این به بعد اعمال می‌شود.',
    feature: 'inventory',
  },
  {
    key: 'transport',
    label: 'حمل و نقل',
    feature: 'transport',
  },
  {
    key: 'sms',
    label: 'پیامک‌ها و زمان‌بندی',
    hint: 'متن و زمانِ همهٔ پیامک‌هایی که برای بیمار می‌رود. نامِ برند خودکار اولِ هر پیامک می‌آید. با دکمه‌های زیرِ هر متن («+ تاریخ»، «+ لینک»، …) جای‌گیر بگذارید؛ پیش‌نمایش و شمارِ پیامک همان‌جا دیده می‌شود.',
  },
  {
    key: 'intake',
    label: 'پذیرشِ آنلاین',
    hint: 'متن‌هایی که بیمار در لینکِ ثبت‌نام می‌بیند. یک متن برای کلِ {org} و همهٔ لینک‌ها.',
  },
  {
    key: 'ai',
    label: 'دستیارِ هوشِ مصنوعی',
    hint: 'هر سرویسِ سازگار با OpenAI کار می‌کند (AvalAI، GapGPT، …). همهٔ فیلدهای خالی از پیکربندیِ مرکزیِ سامانه («مادر») خوانده می‌شوند — یعنی اگر مدیرِ پلتفرم آن‌جا را پر کرده باشد، این‌جا لازم نیست چیزی بنویسید؛ هر چه این‌جا بنویسید بر مرکزی مقدم است.',
  },
];

export const SETTINGS: SettingDef[] = [
  { key: 'registration_ionm_installed', label: 'قالب ثبت‌نام نورو', group: 'identity', type: 'bool', default: false, hidden: true },
  { key: 'registration_implant_installed', label: 'قالب ثبت‌نام ایمپلنت', group: 'identity', type: 'bool', default: false, hidden: true },
  { key: 'registration_clinic_installed', label: 'قالب ثبت‌نام مطب', group: 'identity', type: 'bool', default: false, hidden: true },
  { key: 'registration_ionm_service_fields', label: 'ارتقای فرم ثبت‌نام نورو (کارت ملی، دستور پزشک، رزرو بدون تاریخ)', group: 'identity', type: 'bool', default: false, hidden: true },
  { key: 'registration_implant_service_fields', label: 'ارتقای فرم ثبت‌نام ایمپلنت (کارت ملی، رزرو بدون تاریخ)', group: 'identity', type: 'bool', default: false, hidden: true },
  { key: 'registration_ionm_no_payment_box', label: 'برداشتنِ باکسِ پرداختِ تکراری از فرم ثبت‌نام نورو', group: 'identity', type: 'bool', default: false, hidden: true },
  { key: 'registration_implant_no_payment_box', label: 'برداشتنِ باکسِ پرداختِ تکراری از فرم ثبت‌نام ایمپلنت', group: 'identity', type: 'bool', default: false, hidden: true },
  /* آخرین نامی که سامانه خودش روی فرمِ مراجعهٔ شرکت گذاشت — تا نامِ دستیِ مدیر هرگز بازنویسی نشود. */
  { key: 'company_visit_form_title', label: 'نامِ خودکارِ فرمِ مراجعهٔ شرکت', group: 'identity', type: 'text', default: '', maxLength: 80, hidden: true },
  { key: 'invoice_title', label: 'عنوان فاکتور', group: 'invoice', type: 'text', default: 'صورتحساب خدمات', maxLength: 120 },
  { key: 'invoice_prefix', label: 'پیشوند شماره فاکتور', hint: 'شمارهٔ ترتیبی خودکار بعد از این متن می‌آید.', group: 'invoice', type: 'text', default: '', maxLength: 20 },
  { key: 'invoice_formal_name', label: 'نام صادرکنندهٔ رسمی', hint: 'خالی = نامِ حقوقیِ {org} در «هویتِ {org}». نامِ سامانه چاپ نمی‌شود.', group: 'invoice', type: 'text', default: '', maxLength: 120 },
  { key: 'invoice_informal_name', label: 'نام صادرکنندهٔ غیررسمی', hint: 'خالی = نامِ حقوقیِ {org} در «هویتِ {org}».', group: 'invoice', type: 'text', default: '', maxLength: 120 },
  { key: 'invoice_registration', label: 'شمارهٔ ثبتِ {org}', group: 'invoice', type: 'text', default: '', maxLength: 40, ltr: true },
  { key: 'invoice_postal', label: 'کدِ پستیِ {org}', group: 'invoice', type: 'text', default: '', maxLength: 20, ltr: true },
  { key: 'invoice_website', label: 'وب‌سایتِ {org}', group: 'invoice', type: 'text', default: '', maxLength: 180, ltr: true },
  { key: 'invoice_notes', label: 'توضیحات پایین فاکتور', group: 'invoice', type: 'textarea', default: '', maxLength: 2000 },
  { key: 'invoice_signatures', label: 'محل‌های امضا (هر عنوان در یک خط)', group: 'invoice', type: 'textarea', default: 'تنظیم‌کننده\nمهر و امضای شرکت\nتأیید دریافت‌کننده', maxLength: 300 },
  { key: 'invoice_show_payments', label: 'نمایش ریز پرداخت‌ها', group: 'invoice', type: 'bool', default: true },
  { key: 'invoice_letterhead_top', label: 'فضای بالای سربرگ (میلی‌متر)', group: 'invoice', type: 'number', default: 42, min: 10, max: 65 },
  { key: 'invoice_letterhead_bottom', label: 'فضای پایین سربرگ (میلی‌متر)', group: 'invoice', type: 'number', default: 24, min: 10, max: 45 },
  /* فاکتورِ نورومانیتورینگ — الگوی ملک‌طب: یک پاپ‌آپ، همهٔ خدمات با تیکِ پیش‌فرض، مصرفی‌های پرتکرار.
     هر شرکت پیش‌فرضِ خودش را دارد؛ از خودِ پاپ‌آپ («ذخیره به‌عنوانِ پیش‌فرضِ شرکت») هم پر می‌شود. */
  { key: 'invoice_neuro_defaults', label: 'خدماتِ نورومانیتورینگِ پیش‌فرضِ فاکتور', hint: 'شناسه‌های «کد:نام» که در پاپ‌آپِ صدور از قبل تیک دارند، با کاما. ساده‌ترین راه: در پاپ‌آپ انتخاب کنید و «ذخیره به‌عنوانِ پیش‌فرضِ شرکت» را بزنید.', group: 'invoice', type: 'text', default: '901290:EMG,901325:MEP,901320:SEP,901300:Monitoring', maxLength: 400, ltr: true, services: ['ionm'] },
  { key: 'invoice_neuro_consumables', label: 'مصرفی‌های پرتکرارِ فاکتورِ نورومانیتورینگ', hint: 'از پنجره فاکتور نورو، اقلام انبار و اثر مصرف را انتخاب و پیش‌فرض شرکت را ذخیره کنید. قالب قدیمی نام | IRC | تعداد نیز خوانده می‌شود.', group: 'invoice', type: 'textarea', default: 'Electrode | 9449874222229990 | 40', maxLength: 12000, services: ['ionm'] },
  // ── هویتِ شرکت ────────────────────────────────────────────────
  {
    key: 'brand_name',
    label: 'نامِ برند',
    hint: 'نامی که در رابط و بالای فاکتور دیده می‌شود.',
    group: 'identity', type: 'text', default: '', maxLength: 60,
  },
  {
    key: 'brand_color',
    label: 'رنگِ برند',
    hint: 'رنگِ اصلیِ رابط. بقیهٔ سایه‌ها از همین ساخته می‌شوند.',
    group: 'identity', type: 'color', default: '#7c3aed', maxLength: 7, ltr: true,
  },
  {
    key: 'company_legal_name',
    label: 'نامِ رسمیِ حقوقی',
    hint: 'اگر با نامِ برند فرق دارد. روی فاکتور همین چاپ می‌شود، چون سندِ رسمی نامِ ثبتی می‌خواهد.',
    group: 'identity', type: 'text', default: '', maxLength: 120,
  },
  {
    key: 'company_national_id',
    label: 'شناسهٔ ملیِ {org}',
    group: 'identity', type: 'text', default: '', maxLength: 20, ltr: true,
  },
  {
    key: 'company_econ_code',
    label: 'کدِ اقتصادی',
    group: 'identity', type: 'text', default: '', maxLength: 20, ltr: true,
  },
  {
    key: 'company_phone',
    label: 'تلفنِ {org}',
    group: 'identity', type: 'text', default: '', maxLength: 30, ltr: true,
  },
  {
    key: 'company_address',
    label: 'نشانی',
    group: 'identity', type: 'textarea', default: '', maxLength: 300,
  },

  // ── پذیرشِ آنلاین ────────────────────────────────────────────
  {
    key: 'intake_payment_note',
    label: 'توضیحِ صفحهٔ پرداخت',
    hint: 'بالای کارتِ بانکی در مرحلهٔ واریز دیده می‌شود. خالی = متنِ پیش‌فرض.',
    group: 'intake', type: 'textarea',
    default: 'مبلغ را به کارت یا شبای زیر واریز کنید و تصویرِ فیش را همین‌جا بارگذاری کنید؛ ثبت‌نامِ شما پس از بررسیِ فیش تأیید می‌شود.',
    maxLength: 600,
  },

  // ── انبار و دارایی ───────────────────────────────────────────
  {
    key: 'home_location',
    label: 'نامِ انبارِ پیش‌فرض',
    hint: 'لاتی که محلِ صریح ندارد این‌جا شمرده می‌شود و مبدأِ پیش‌فرضِ حواله همین است.',
    group: 'inventory', type: 'text', default: 'انبارِ مرکزی', maxLength: 60,
  },
  {
    key: 'consignment_default_days',
    label: 'دورهٔ پیش‌فرضِ صورت‌برداریِ امانی (روز)',
    hint: 'وقتی هنگام سپردنِ دارایی دوره‌ای وارد نشود، همین به کار می‌رود. صفر یعنی «دوره‌ای نیست».',
    group: 'inventory', type: 'number', default: 30, min: 0, max: 3650,
  },

  // ── حمل و نقل ────────────────────────────────────────────────
  {
    key: 'transport_expense_category',
    label: 'دستهٔ هزینهٔ حمل',
    hint: 'ردیفِ هزینهٔ هر مسیر با همین دسته در دفترِ مالی ثبت می‌شود و گزارش با همین تفکیک می‌کند.',
    group: 'transport', type: 'text', default: 'حمل و نقل', maxLength: 40,
  },
  // ── پیامک‌ها ─────────────────────────────────────────────────
  {
    key: 'sms_next_visit_text', label: 'متنِ یادآوریِ ویزیتِ بعدی',
    group: 'sms', type: 'textarea', default: 'یادآوری: ویزیتِ بعدیِ شما {date} است.', maxLength: 500,
  },
  {
    key: 'sms_next_visit_days', label: 'ویزیتِ بعدی — چند روز قبل',
    group: 'sms', type: 'number', default: 1, min: 0, max: 30,
  },
  {
    key: 'sms_surgery_text', label: 'متنِ یادآوریِ عمل',
    group: 'sms', type: 'textarea', default: 'یادآوری: عملِ شما {date} است. لطفاً توصیه‌های پیش از عمل را رعایت فرمایید.', maxLength: 500,
  },
  {
    key: 'sms_surgery_days', label: 'یادآوریِ عمل — چند روز قبل',
    group: 'sms', type: 'number', default: 1, min: 0, max: 30,
  },
  {
    key: 'sms_pre_op_days', label: 'مراقبتِ قبل از عمل — چند روز قبل',
    hint: 'متنش از قالبِ خودِ نوعِ عمل می‌آید (تعریف‌های پایه).',
    group: 'sms', type: 'number', default: 2, min: 0, max: 30,
  },
  {
    key: 'sms_post_op_days', label: 'مراقبتِ بعد از عمل — چند روز بعد',
    group: 'sms', type: 'number', default: 1, min: 0, max: 30,
  },
  {
    key: 'sms_reminder_hour', label: 'ساعتِ ارسالِ یادآوری‌های روزانه',
    hint: 'به وقتِ تهران — ویزیتِ بعدی، عمل و مراقبت‌ها در این ساعت می‌روند.',
    group: 'sms', type: 'number', default: 10, min: 6, max: 22,
  },
  {
    key: 'sms_appointment_text', label: 'متنِ یادآوریِ نوبت',
    group: 'sms', type: 'textarea', default: 'یادآوری نوبت: {date}{time}{topic}. لطفاً به‌موقع مراجعه فرمایید.', maxLength: 500,
  },
  {
    key: 'sms_appointment_hour', label: 'ساعتِ یادآوریِ نوبت (عصرِ روزِ قبل)',
    group: 'sms', type: 'number', default: 17, min: 6, max: 22,
  },
  {
    key: 'sms_portal_text', label: 'متنِ پیامکِ پروندهٔ الکترونیک',
    group: 'sms', type: 'textarea', default: 'پروندهٔ الکترونیکِ شما — مراجعات، نوبت‌ها و پیام‌ها:\n{link}', maxLength: 500,
  },
  {
    key: 'sms_summary_text', label: 'متنِ پیامکِ خلاصهٔ ویزیت',
    group: 'sms', type: 'textarea', default: 'خلاصهٔ ویزیتِ شما:\n{link}', maxLength: 500,
  },
  {
    key: 'sms_form_send_text', label: 'متنِ پیامکِ ارسالِ فرم',
    group: 'sms', type: 'textarea', default: '{title}\n{link}', maxLength: 500,
  },
  {
    key: 'sms_quiet_on', label: 'ساعتِ سکوتِ پیامک',
    hint: 'در بازهٔ زیر، یادآوری‌های خودکار برای بیماران نمی‌روند و تا پایانِ بازه در صف می‌مانند (ساعتِ ایران). دکمه‌های «ارسالِ دوباره» و «ارسالِ سررسیده‌ها»، کدِ تأییدِ ورود و ابلاغِ برنامهٔ روزِ کارشناسان مسدود نمی‌شوند.',
    group: 'sms', type: 'bool', default: QUIET_DEFAULT.on,
  },
  {
    key: 'sms_quiet_from', label: 'شروعِ ساعتِ سکوت',
    hint: 'ساعتِ ۰ تا ۲۳؛ مثلاً ۲۱ یعنی از ساعتِ ۹ شب.',
    group: 'sms', type: 'number', default: QUIET_DEFAULT.from, min: 0, max: 23,
  },
  {
    key: 'sms_quiet_to', label: 'پایانِ ساعتِ سکوت',
    hint: 'ساعتِ ۰ تا ۲۳؛ مثلاً ۸ یعنی پیام‌های مانده از ساعتِ ۸ صبح می‌روند. شروع و پایان برابر باشند یعنی بازه‌ای نیست.',
    group: 'sms', type: 'number', default: QUIET_DEFAULT.to, min: 0, max: 23,
  },
  {
    key: 'sms_word_replacements', label: 'جایگزینیِ کلمه‌ها در پیامک‌ها',
    hint: 'هر خط یک جایگزینی: «کلمه = جایگزین» (فقط یک کلمه). هنگامِ ارسالِ هر یادآوریِ پیامکی اعمال می‌شود؛ متنِ ثبت‌شده در دفتر دست‌نخورده می‌ماند. وقتی ملی‌پیامک «متن حاوی کلمهٔ فیلترشده است» می‌گوید، دفترِ یادآوری‌ها کلمه را پیدا می‌کند و همین‌جا اضافه‌اش می‌کند.',
    group: 'sms', type: 'textarea', default: '', maxLength: 2000, plain: true,
  },
  {
    key: 'sms_intake_return_text', label: 'متنِ پیامکِ برگشتِ ثبت‌نام برای اصلاح',
    hint: 'وقتی تأییدکننده ثبت‌نام را به یک مرحله برمی‌گرداند. {stage} مرحله، {reason} دلیل، {link} لینکِ همان فرم.',
    group: 'sms', type: 'textarea', default: 'ثبت‌نامِ شما برای اصلاح برگشت خورد ({stage}): {reason}\n{link}', maxLength: 500,
  },
  {
    key: 'sms_intake_reject_text', label: 'متنِ پیامکِ ردِ ثبت‌نام',
    hint: '{reason} دلیلِ رد — بی‌لینک، چون فرمِ ردشده دیگر پر نمی‌شود.',
    group: 'sms', type: 'textarea', default: 'ثبت‌نامِ شما پذیرفته نشد: {reason}', maxLength: 500,
  },
  {
    key: 'sms_follow_up_text', label: 'متنِ پیامکِ فرمِ پیگیریِ پس از عمل',
    hint: 'روزهای ارسال روی خودِ نوعِ عمل تنظیم می‌شود (تعریف‌های پایه — «روزهای پیگیری»).',
    group: 'sms', type: 'textarea', default: 'پیگیریِ پس از عمل — لطفاً وضعیتِ خود را در این فرم ثبت کنید:\n{link}', maxLength: 500,
  },
  {
    key: 'sms_care_unconfirmed_text', label: 'پوششِ پیامِ پس از عمل وقتی «انجام‌شد» ثبت نشده',
    hint: 'پیامِ مراقبت و پیگیری وقتی می‌رود که وضعیتِ عمل هنوز «انجام شد» نخورده باشد. '
      + '`{care}` جای خودِ متنِ مراقبت است. خالی‌گذاشتنِ این کادر یعنی همان متنِ عادی برود.',
    group: 'sms', type: 'textarea', maxLength: 700,
    default: 'اگر عملِ شما انجام شده، این موارد را رعایت کنید:\n{care}\n'
      + 'اگر عمل انجام نشده یا موکول شده، لطفاً با پزشکِ خود در ارتباط باشید.',
  },
  // ── دستیارِ هوشِ مصنوعی ─────────────────────────────────────
  {
    key: 'ai_base_url', label: 'نشانیِ پایهٔ API',
    hint: 'مثلاً https://api.openai.com/v1 یا نشانیِ گیت‌ویِ داخلی — تا /v1 (بدونِ /chat/completions).',
    group: 'ai', type: 'text', default: '', maxLength: 200, ltr: true,
  },
  {
    key: 'ai_api_key', label: 'کلیدِ API',
    group: 'ai', type: 'text', default: '', maxLength: 300, ltr: true,
  },
  {
    key: 'ai_model', label: 'مدلِ گفتگو (متن)',
    hint: 'مثلاً gpt-4o-mini یا claude-sonnet-5 — خالی = مدلِ مرکزی.',
    group: 'ai', type: 'text', default: '', maxLength: 80, ltr: true,
  },
  {
    key: 'ai_model_vision', label: 'مدلِ تحلیلِ عکس',
    hint: 'خالی = مدلِ مرکزی. برای قابلیت‌های آیندهٔ تحلیلِ تصویر.',
    group: 'ai', type: 'text', default: '', maxLength: 80, ltr: true,
  },
  {
    key: 'ai_model_stt', label: 'مدلِ گفتار به متن (ویسپر)',
    hint: 'مثلاً whisper-1 — خالی = مدلِ مرکزی.',
    group: 'ai', type: 'text', default: '', maxLength: 80, ltr: true,
  },
  {
    key: 'ai_model_tts', label: 'مدلِ متن به گفتار',
    group: 'ai', type: 'text', default: '', maxLength: 80, ltr: true,
  },
  {
    key: 'ai_model_image', label: 'مدلِ تصویرسازی',
    group: 'ai', type: 'text', default: '', maxLength: 80, ltr: true,
  },
  {
    key: 'ai_prompt_note', label: 'دستورِ اختصاصیِ {org} — شرح‌نویسی',
    hint: 'اختیاری. به دستورِ دستیارِ شرح‌نویسی اضافه می‌شود؛ مثلاً «همیشه توصیه‌های پس از عمل را جدا بیاور».',
    group: 'ai', type: 'textarea', default: '', maxLength: 2000,
  },
  {
    key: 'ai_prompt_template', label: 'دستورِ اختصاصیِ {org} — قالب‌ساز',
    hint: 'اختیاری. به دستورِ قالب‌سازِ خودکار اضافه می‌شود.',
    group: 'ai', type: 'textarea', default: '', maxLength: 2000,
  },
  {
    key: 'ai_prompt_assistant', label: 'دستورِ اختصاصیِ {org} — دستیارِ مدیریت',
    hint: 'اختیاری. به دستورِ دستیارِ کلیِ مدیریت اضافه می‌شود.',
    group: 'ai', type: 'textarea', default: '', maxLength: 2000,
  },
  {
    key: 'ai_prompt_voice', label: 'دستورِ اختصاصیِ {org} — دستیارِ صوتی',
    hint: 'اختیاری. به تحلیلِ متنِ دیکته‌شده (مثلاً ثبتِ بیمارِ جدید با صدا) اضافه می‌شود؛ مثلاً «نامِ خانوادگی را همیشه بدونِ پیشوند بنویس».',
    group: 'ai', type: 'textarea', default: '', maxLength: 2000,
  },

  // ── سربرگ (با آپلود پر می‌شوند؛ در صفحه پنهان‌اند) ─────────────
  {
    key: 'letterhead_sha', label: 'سربرگ — شناسهٔ فایل',
    group: 'identity', type: 'text', default: '', maxLength: 64, ltr: true, hidden: true,
  },
  {
    key: 'letterhead_mime', label: 'سربرگ — نوعِ فایل',
    group: 'identity', type: 'text', default: '', maxLength: 60, ltr: true, hidden: true,
  },
];

export const SETTING_BY_KEY = new Map(SETTINGS.map((d) => [d.key, d]));

/**
 * واژهٔ «سازمان» در برچسب‌ها و راهنماها — جای‌گیرِ `{org}` → «مطب» یا «شرکت».
 *
 * بازبینیِ UX (۱۴۰۵/۰۷): نصبِ مطب همه‌جا «شرکت» خوانده می‌شد («هویتِ شرکت»، «قالب فاکتور
 * شرکت»، «شناسهٔ ملیِ شرکت»). همان واژهٔ `org`ِ `src/lib/terms.js` است؛ هر برچسبِ تازه‌ای که
 * به خودِ سازمان اشاره می‌کند `{org}` بنویسد، نه «شرکت».
 */
export const orgWord = (kind: string | null | undefined) => (kind === 'clinic' ? 'مطب' : 'شرکت');
export const withOrg = (text: string, org: string) => text.replace(/\{org\}/g, org);

/** ارقامِ فارسی/عربی → انگلیسی. ورودیِ عددی از کیبوردِ فارسی می‌آید. */
export function toEnDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/**
 * اعتبارسنجی + تبدیلِ ورودیِ خام به مقدارِ نوع‌دار.
 *
 * خطا **متن** برمی‌گرداند نه پرتاب می‌کند: ذخیرهٔ گروهی چند فیلد را با هم
 * می‌فرستد و کاربر باید همهٔ ایرادها را یک‌جا ببیند، نه یکی‌یکی.
 */
export function coerce(def: SettingDef, raw: unknown, org = 'شرکت'): { value?: string | number | boolean; error?: string } {
  /* برچسب در پیامِ خطا با واژهٔ همان نصب — «شناسهٔ ملیِ مطب»، نه جای‌گیرِ خام. */
  def = { ...def, label: withOrg(def.label, org) };
  if (def.type === 'bool') {
    if (typeof raw === 'boolean') return { value: raw };
    if (raw === 'true' || raw === '1') return { value: true };
    if (raw === 'false' || raw === '0' || raw === '' || raw === null || raw === undefined) return { value: false };
    return { error: `«${def.label}» باید بله یا خیر باشد` };
  }

  if (def.type === 'number') {
    const s = toEnDigits(String(raw ?? '').trim()).replace(/[،,٬\s]/g, '');
    if (!s) return { value: Number(def.default) };
    if (!/^-?\d+$/.test(s)) return { error: `«${def.label}» باید عدد باشد` };
    const n = Number(s);
    if (def.min !== undefined && n < def.min) return { error: `«${def.label}» نباید کمتر از ${def.min} باشد` };
    if (def.max !== undefined && n > def.max) return { error: `«${def.label}» نباید بیشتر از ${def.max} باشد` };
    return { value: n };
  }

  // ⚠️ رنگ باید `#rrggbb` باشد، نه هر رشته‌ای. مقدارِ نامعتبر در دیتابیس
  // یعنی رابطِ بی‌رنگ برای همان شرکت؛ و چون رنگ از تنظیمات مستقیم به CSS
  // می‌رود، رشتهٔ دلخواه یک راهِ تزریق هم هست.
  if (def.type === 'color') {
    const c = String(raw ?? '').trim().toLowerCase();
    if (!c) return { value: String(def.default) };
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c);
    if (!m) return { error: `«${def.label}» باید رنگی مثلِ #7c3aed باشد` };
    const hex = m[1].length === 3 ? m[1].replace(/./g, (ch) => ch + ch) : m[1];
    return { value: `#${hex}` };
  }

  // ⚠️ شناسه‌ها (شناسهٔ ملی، کدِ اقتصادی، تلفن) با ارقامِ **انگلیسی** ذخیره
  // می‌شوند حتی اگر فارسی تایپ شده باشند: مقدارِ ذخیره‌شده باید یک شکل داشته
  // باشد، وگرنه جست‌وجو و مقایسه‌اش به شکلِ تایپ بستگی پیدا می‌کند. نمایشِ
  // فارسی کارِ رابط است، نه کارِ دیتابیس.
  const s = (def.ltr ? toEnDigits(String(raw ?? '')) : String(raw ?? '')).trim();
  if (def.maxLength && s.length > def.maxLength) {
    return { error: `«${def.label}» نباید بیشتر از ${def.maxLength} نویسه باشد` };
  }
  // متنِ چندخطی خطوط را نگه می‌دارد؛ تک‌خطی نه — وگرنه نشانیِ کپی‌شده،
  // عنوانِ فاکتور را می‌شکند.
  return { value: def.type === 'textarea' ? s : s.replace(/[\r\n]+/g, ' ') };
}

/** مقدارِ نوع‌دار → رشته‌ای که در `settings.value` می‌نشیند. */
export function serialize(value: string | number | boolean): string {
  return typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
}

/** رشتهٔ دیتابیس → مقدارِ نوع‌دار. مقدارِ خراب به پیش‌فرض برمی‌گردد، نه به خطا. */
export function parse(def: SettingDef, raw: string | null | undefined): string | number | boolean {
  if (raw === null || raw === undefined) return def.default;
  const got = coerce(def, raw);
  return got.error !== undefined ? def.default : got.value!;
}

/**
 * آیا این مقدار همان پیش‌فرض است؟
 *
 * ⚠️ سرویس ردیفِ برابرِ پیش‌فرض را **پاک می‌کند** نه اینکه بنویسد. اگر
 * پیش‌فرض‌ها را در دیتابیس کپی کنیم، روزی که پیش‌فرضِ کد عوض شود هیچ نصبی
 * آن را نمی‌گیرد — همه با کپیِ کهنه‌شان می‌مانند و کسی نمی‌فهمد چرا.
 */
export function isDefault(def: SettingDef, value: string | number | boolean): boolean {
  return serialize(value) === serialize(def.default);
}
