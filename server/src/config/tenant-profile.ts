/**
 * **نوعِ نصب و بستهٔ خدمات — «مطب/کلینیک» یا «شرکتی»، و شرکت خودش خدماتش را می‌چیند.**
 *
 * تصمیمِ مالک (۱۴۰۵/۰۷/۰۱): جداکردنِ شرکت‌ها به «حوزهٔ نورومانیتورینگ» و «حوزهٔ
 * ایمپلنت» اشتباه بود. نصب فقط دو نوع دارد — مطب/کلینیک یا شرکتی — و شرکت
 * **خودش** انتخاب می‌کند چه خدماتی می‌دهد (خیلی شرکت‌ها هر دو را دارند).
 *
 * ⚠️ این فایل **خالص** است (بی‌import از Nest/Prisma) تا CI بتواند با esbuild
 * باندلش کند و رابط هم همان قاعده را آینه کند (`src/lib/profile.js`).
 *
 * ⚠️ **چرا ستونِ `vertical` پاک نشد و «company» در آن نوشته نمی‌شود.** چند
 * خوانندهٔ خام مستقیم مقدارش را مقایسه می‌کنند (`ai.service.ts`,
 * `auth.service.ts`، دو migrationِ مخصوصِ مطب) و نسخهٔ قبلیِ کد هم اگر روزی
 * برگردانده شود فقط همان را می‌فهمد. پس `vertical` می‌ماند و همیشه یکی از
 * `clinic | ionm | implant` است: برای شرکت، **خدمتِ اصلی** (اولی به ترتیبِ
 * `SERVICE_ORDER`). بستهٔ خدمات در ردیفِ جدای `services` می‌نشیند.
 *
 * ⚠️ **نصب‌های فعلی هیچ تغییری نمی‌بینند.** ردیفِ `services` برایشان وجود ندارد
 * و از `vertical` مشتق می‌شود: `ionm` ← شرکتی با [نورومانیتورینگ]،
 * `implant` ← شرکتی با [ایمپلنت]، `clinic` ← مطب. هیچ migration و هیچ
 * بازچینیِ ماژولی لازم نیست.
 */

/** دو نوعِ نصب. کلیدِ `clinic` عمداً همان کلیدِ حوزهٔ قدیمی است. */
export const TENANT_KINDS = {
  clinic: { label: 'مطب / کلینیک' },
  company: { label: 'شرکتی' },
} as const;
export type TenantKind = keyof typeof TENANT_KINDS;

/**
 * خدماتی که یک شرکت می‌تواند ارائه کند. کلیدِ هر خدمت همان کلیدِ حوزهٔ
 * قدیمیِ متناظرش است، تا `vertical` بدونِ نگاشت آینه‌اش باشد.
 */
export const SERVICES = {
  ionm: { label: 'نورومانیتورینگ' },
  implant: { label: 'ایمپلنت و تجهیزات' },
} as const;
export type ServiceKey = keyof typeof SERVICES;

/**
 * ترتیبِ خدمات — و همین ترتیب «خدمتِ اصلی» را تعیین می‌کند.
 *
 * ⚠️ تصمیمِ مالک: شرکتِ دوخدمته با واژه‌های نورومانیتورینگ کار می‌کند
 * («مراجعه/کارشناس»)، پس هر جا نورومانیتورینگ جزوِ خدمات است، خدمتِ اصلی
 * همان است. شرکتِ فقط‌ایمپلنت همان «عمل/نمایندهٔ فنی» می‌ماند.
 */
export const SERVICE_ORDER: readonly ServiceKey[] = ['ionm', 'implant'];

export const KEY_SERVICES = 'services';

export const isServiceKey = (v: unknown): v is ServiceKey =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(SERVICES, v);

export interface TenantProfile {
  kind: TenantKind;
  /** برای مطب خالی؛ برای شرکت دست‌کم یکی، به ترتیبِ `SERVICE_ORDER`. */
  services: ServiceKey[];
  /** مقدارِ آینه‌شده در `vertical` — همان چیزی که خواننده‌های قدیمی می‌بینند. */
  primary: 'clinic' | ServiceKey;
}

/** بستهٔ خدماتِ خام را تمیز می‌کند: فقط کلیدهای شناخته، بی‌تکرار، به ترتیبِ ثابت. */
export function normalizeServices(raw: unknown): ServiceKey[] {
  const list = Array.isArray(raw) ? raw : [];
  return SERVICE_ORDER.filter((k) => list.includes(k));
}

/** خدمتِ اصلیِ یک بسته — همان که در `vertical` آینه می‌شود. */
export const primaryOf = (services: readonly ServiceKey[]): ServiceKey =>
  SERVICE_ORDER.find((k) => services.includes(k)) ?? 'ionm';

function parseServices(raw: string | null): ServiceKey[] {
  if (!raw) return [];
  try { return normalizeServices(JSON.parse(raw)); } catch { return []; }
}

/**
 * **تنها جایی که «نوع + خدمات» از دو ردیفِ تنظیمات ساخته می‌شود.**
 *
 * @param vertical مقدارِ معتبرِ ردیفِ `vertical` (خواننده قبلاً پیش‌فرض را گذاشته)
 * @param servicesRaw مقدارِ خامِ ردیفِ `services` یا `null`
 *
 * ⚠️ ردیفِ `services`ی که **خدمتِ آینه‌شده در `vertical` را ندارد** کهنه است،
 * نه منبع: یعنی کسی از مسیرِ قدیمی (`PATCH /config/vertical`، یا نسخهٔ قبلیِ
 * کد پس از بازگشت) حوزه را عوض کرده و این ردیف را جا گذاشته. آن‌وقت
 * `vertical` برنده است، چون همان را همهٔ خواننده‌های قدیمی هم می‌بینند —
 * دو منبعِ ناهم‌خوان یعنی نیمی از صفحه ایمپلنت و نیمی نورومانیتورینگ.
 */
export function profileOf(vertical: 'clinic' | ServiceKey, servicesRaw: string | null): TenantProfile {
  if (vertical === 'clinic') return { kind: 'clinic', services: [], primary: 'clinic' };
  const stored = parseServices(servicesRaw);
  const services = stored.includes(vertical) ? stored : [vertical];
  return { kind: 'company', services, primary: vertical };
}

/** برچسبِ فارسیِ یک پروفایل — برای سربرگِ پرتال/فرم‌ساز که یک عنوان لازم دارند. */
export function profileLabel(p: TenantProfile): string {
  if (p.kind === 'clinic') return TENANT_KINDS.clinic.label;
  return `${TENANT_KINDS.company.label} — ${p.services.map((s) => SERVICES[s].label).join(' و ')}`;
}
