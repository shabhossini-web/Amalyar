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

export type SettingType = 'text' | 'textarea' | 'number' | 'bool';

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
}

export const SETTING_GROUPS: { key: string; label: string; hint?: string }[] = [
  {
    key: 'identity',
    label: 'هویتِ شرکت',
    hint: 'روی فاکتورِ رسمی و سربرگ چاپ می‌شود. فاکتورِ بدونِ شناسهٔ ملی و کدِ اقتصادی سندِ مالیاتی نیست.',
  },
  {
    key: 'inventory',
    label: 'انبار و دارایی',
    hint: 'پیش‌فرض‌های انبار. تغییرشان روی دادهٔ ثبت‌شده اثر ندارد؛ از این به بعد اعمال می‌شود.',
  },
  {
    key: 'transport',
    label: 'حمل و نقل',
  },
];

export const SETTINGS: SettingDef[] = [
  // ── هویتِ شرکت ────────────────────────────────────────────────
  {
    key: 'brand_name',
    label: 'نامِ برند',
    hint: 'نامی که در رابط و بالای فاکتور دیده می‌شود.',
    group: 'identity', type: 'text', default: '', maxLength: 60,
  },
  {
    key: 'company_legal_name',
    label: 'نامِ رسمیِ حقوقی',
    hint: 'اگر با نامِ برند فرق دارد. روی فاکتور همین چاپ می‌شود، چون سندِ رسمی نامِ ثبتی می‌خواهد.',
    group: 'identity', type: 'text', default: '', maxLength: 120,
  },
  {
    key: 'company_national_id',
    label: 'شناسهٔ ملیِ شرکت',
    group: 'identity', type: 'text', default: '', maxLength: 20, ltr: true,
  },
  {
    key: 'company_econ_code',
    label: 'کدِ اقتصادی',
    group: 'identity', type: 'text', default: '', maxLength: 20, ltr: true,
  },
  {
    key: 'company_phone',
    label: 'تلفنِ شرکت',
    group: 'identity', type: 'text', default: '', maxLength: 30, ltr: true,
  },
  {
    key: 'company_address',
    label: 'نشانی',
    group: 'identity', type: 'textarea', default: '', maxLength: 300,
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
];

export const SETTING_BY_KEY = new Map(SETTINGS.map((d) => [d.key, d]));

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
export function coerce(def: SettingDef, raw: unknown): { value?: string | number | boolean; error?: string } {
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
