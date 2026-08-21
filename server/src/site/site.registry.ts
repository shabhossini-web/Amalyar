/**
 * رجیستریِ سایتِ عمومیِ شرکت — **خالص**، بدونِ Prisma و Nest.
 *
 * ⚠️ همان قاعدهٔ `settings-registry.ts` و `access-registry.ts`:
 * **کلید و متنِ پیش‌فرض از کد می‌آید، مقدار از کاربر.**
 *
 * دلیلش این‌جا از همیشه پررنگ‌تر است: این صفحه چیزی است که مراجعه‌کننده پیش
 * از هر ورودی می‌بیند. اگر پیش‌فرض در DB بود (seedِ ردیف‌های خالی)، شرکتِ
 * تازه تا وقتی کسی ده‌ها فیلد را پر نکند یک صفحهٔ نیمه‌خالی منتشر می‌کرد. با
 * پیش‌فرضِ کد، سایت از همان دقیقهٔ اول کامل است و ویرایش یعنی **جایگزینی**
 * نه **پرکردن**.
 */

/** بخش‌های صفحه، به ترتیبِ چیدمانِ پیش‌فرض. */
export interface SiteSectionDef {
  key: string;
  /** برچسبِ فارسی — چیزی که مدیر در ویرایشگر می‌خواند، نه کلیدِ کد. */
  label: string;
  hint?: string;
  /** آیا این بخش از `SiteItem` تغذیه می‌شود؟ اگر بله، `kind`ِ قلم‌هایش. */
  kind?: string;
}

export const SITE_SECTIONS: SiteSectionDef[] = [
  { key: 'hero', label: 'سرصفحه', hint: 'تیتر، توضیح و دو دکمهٔ اصلی. همیشه اولین چیزی است که دیده می‌شود.' },
  { key: 'marquee', label: 'نوارِ نکته‌ها', hint: 'نوارِ روانِ نکته‌های کوتاه زیرِ سرصفحه. هر خط یک نکته.' },
  { key: 'stats', label: 'اعداد', kind: 'stat', hint: 'سه تا چهار عددِ کوتاه — سابقه، تعدادِ عمل، رضایت.' },
  { key: 'services', label: 'خدمات', kind: 'service' },
  { key: 'gallery', label: 'نمونه‌کارها', kind: 'gallery', hint: 'با دو تصویر، اسلایدرِ قبل/بعد می‌شود؛ با یک تصویر، عکسِ ساده.' },
  { key: 'process', label: 'مسیرِ مراجعه', kind: 'process', hint: 'گام‌به‌گام از تماسِ اول تا پیگیری.' },
  { key: 'doctors', label: 'تیمِ درمان', kind: 'doctor' },
  { key: 'testimonials', label: 'نظرِ مراجعان', kind: 'testimonial' },
  { key: 'faq', label: 'پرسش‌های پرتکرار', kind: 'faq' },
  { key: 'contact', label: 'تماس و نشانی', hint: 'از هویتِ شرکت در تنظیمات خوانده می‌شود — تلفن، نشانی و نامِ رسمی.' },
];

export const SITE_SECTION_BY_KEY = new Map(SITE_SECTIONS.map((s) => [s.key, s]));

/**
 * چیدمانِ پیش‌فرضِ بخش‌ها به تفکیکِ حوزهٔ کاری.
 *
 * ⚠️ ماژول یکی است، **بخش‌ها** فرق می‌کنند. شرکتِ نورومانیتورینگ نه گالریِ
 * قبل/بعد دارد نه نظرِ مراجع — مخاطبش بیمارستان و جراح است نه بیمار. اگر
 * همان چیدمانِ کلینیک را می‌گرفت، سایتش با بخش‌های خالی منتشر می‌شد.
 */
export const SITE_SECTION_PLAN: Record<string, string[]> = {
  clinic: ['hero', 'marquee', 'stats', 'services', 'gallery', 'process', 'doctors', 'testimonials', 'faq', 'contact'],
  ionm: ['hero', 'marquee', 'stats', 'services', 'process', 'faq', 'contact'],
  implant: ['hero', 'marquee', 'stats', 'services', 'faq', 'contact'],
};

/** بخش‌های روشنِ پیش‌فرض برای یک حوزه — حوزهٔ ناشناخته → چیدمانِ کلینیک. */
export function sectionPlanFor(vertical: string): string[] {
  return SITE_SECTION_PLAN[vertical] ?? SITE_SECTION_PLAN.clinic;
}

/**
 * کلیدِ رزروشدهٔ «منتشر شده».
 *
 * ⚠️ **پیش‌فرض خاموش است و باید بماند.** این ماژول روی نصب‌هایی می‌نشیند که
 * همین حالا کار می‌کنند و ریشهٔ دامنه‌شان به فرمِ ورود می‌رود. اگر پیش‌فرض
 * روشن بود، همان روزِ انتشار سایتِ **همهٔ** شرکت‌ها با متنِ نمونه بالا می‌آمد
 * و هیچ‌کس چنین چیزی نخواسته بود. انتشار تصمیمِ خودِ شرکت است.
 *
 * در همان جدولِ `site_blocks` می‌نشیند (یک ماژول، یک نویسنده) ولی جدا اعلام
 * می‌شود چون متن نیست: `saveBlocks` کلیدهای متنی را می‌پذیرد و این را نه.
 */
export const SITE_PUBLISHED_KEY = '__published';

/** یک متنِ ویرایش‌شدنی. `multiline` فقط به ویرایشگر می‌گوید کدام کادر را بدهد. */
export interface SiteBlockDef {
  key: string;
  label: string;
  section: string;
  value: string;
  multiline?: boolean;
  hint?: string;
}

/**
 * متن‌های پیش‌فرض.
 *
 * ⚠️ عمداً **عام** نوشته شده‌اند، نه مالِ یک کلینیکِ خاص: این متن روی سایتِ
 * هر شرکتی که ماژول را روشن کند منتشر می‌شود. جمله‌ای که نامِ یک تخصص را
 * ببرد، برای بقیه یعنی متنِ غلط روی صفحهٔ عمومی.
 */
export const SITE_BLOCKS: SiteBlockDef[] = [
  { key: 'hero_badge', label: 'نشانِ بالای تیتر', section: 'hero', value: 'مرکزِ تخصصیِ خدماتِ درمانی' },
  { key: 'hero_title', label: 'تیترِ اصلی', section: 'hero', value: 'درمانی که با آرامش شروع می‌شود' },
  {
    key: 'hero_title_accent', label: 'واژهٔ برجستهٔ تیتر', section: 'hero', value: 'آرامش',
    hint: 'اگر این واژه در تیتر باشد، با رنگِ برند و درخشش نشان داده می‌شود. خالی بگذارید تا تیتر یک‌دست بماند.',
  },
  {
    key: 'hero_sub', label: 'توضیحِ زیرِ تیتر', section: 'hero', multiline: true,
    value: 'تیمِ درمانیِ باتجربه، تجهیزاتِ به‌روز و پیگیریِ منظم پس از درمان. از نخستین مشاوره تا آخرین جلسهٔ پیگیری، کنارِ شما هستیم.',
  },
  { key: 'hero_cta', label: 'متنِ دکمهٔ اصلی', section: 'hero', value: 'درخواستِ نوبت' },
  { key: 'hero_cta2', label: 'متنِ دکمهٔ دوم', section: 'hero', value: 'تماس با ما' },
  {
    key: 'marquee_items', label: 'نکته‌های نوار', section: 'marquee', multiline: true,
    value: 'مشاورهٔ تخصصی\nپیگیریِ پس از درمان\nتجهیزاتِ به‌روز\nپروندهٔ الکترونیک\nنوبت‌دهیِ آنلاین\nتیمِ باتجربه',
    hint: 'هر خط یک نکته.',
  },
  { key: 'services_title', label: 'تیترِ بخشِ خدمات', section: 'services', value: 'خدماتِ ما' },
  { key: 'services_sub', label: 'توضیحِ بخشِ خدمات', section: 'services', multiline: true, value: 'آن‌چه در این مرکز انجام می‌شود.' },
  { key: 'gallery_title', label: 'تیترِ نمونه‌کارها', section: 'gallery', value: 'نمونه‌کارها' },
  { key: 'gallery_sub', label: 'توضیحِ نمونه‌کارها', section: 'gallery', multiline: true, value: 'تصاویر با رضایتِ کتبیِ مراجعان منتشر شده‌اند.' },
  { key: 'process_title', label: 'تیترِ مسیرِ مراجعه', section: 'process', value: 'مسیرِ مراجعه' },
  { key: 'process_sub', label: 'توضیحِ مسیرِ مراجعه', section: 'process', multiline: true, value: 'از تماسِ اول تا پیگیری، هر گام روشن است.' },
  { key: 'doctors_title', label: 'تیترِ تیمِ درمان', section: 'doctors', value: 'تیمِ درمان' },
  { key: 'testimonials_title', label: 'تیترِ نظرها', section: 'testimonials', value: 'نظرِ مراجعان' },
  { key: 'faq_title', label: 'تیترِ پرسش‌ها', section: 'faq', value: 'پرسش‌های پرتکرار' },
  { key: 'contact_title', label: 'تیترِ تماس', section: 'contact', value: 'برای شروع تماس بگیرید' },
  {
    key: 'contact_sub', label: 'توضیحِ تماس', section: 'contact', multiline: true,
    value: 'برای مشاوره و رزروِ نوبت با ما تماس بگیرید یا پیام بگذارید.',
  },
  {
    key: 'seo_description', label: 'توضیحِ صفحه برای موتورهای جستجو', section: 'hero', multiline: true, value: '',
    hint: 'یک تا دو جمله. خالی بگذارید تا از توضیحِ زیرِ تیتر ساخته شود.',
  },
];

export const SITE_BLOCK_BY_KEY = new Map(SITE_BLOCKS.map((b) => [b.key, b]));

/** `kind`های مجازِ قلمِ محتوا — از خودِ بخش‌ها مشتق می‌شود، نه فهرستِ دوم. */
export const SITE_ITEM_KINDS: readonly string[] = SITE_SECTIONS
  .map((s) => s.kind)
  .filter((k): k is string => !!k);

export const isSiteItemKind = (value: unknown): value is string =>
  typeof value === 'string' && SITE_ITEM_KINDS.includes(value);
