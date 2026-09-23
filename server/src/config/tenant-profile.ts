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

import { VERTICALS } from './verticals';

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
 * ⚠️ ردیفِ `services`ی که **خدمتِ اصلی‌اش (`primaryOf`) همان `vertical` نیست**
 * کهنه است، نه منبع: یعنی کسی از مسیرِ قدیمی (`PATCH /config/vertical`، یا
 * نسخهٔ قبلیِ کد پس از بازگشت) حوزه را عوض کرده و این ردیف را جا گذاشته. آن‌وقت
 * `vertical` برنده است، چون همان را همهٔ خواننده‌های قدیمی هم می‌بینند —
 * دو منبعِ ناهم‌خوان یعنی نیمی از صفحه ایمپلنت و نیمی نورومانیتورینگ.
 * «شاملِ `vertical` بودن» کافی نیست: `["ionm","implant"]` کنارِ `vertical=implant`
 * هم شاملش است، ولی خدمتِ اصلیِ آن بسته نورومانیتورینگ است و خواننده‌های
 * قدیمی واژه‌های ایمپلنت را نشان می‌دادند — همان دو منبعِ ناهم‌خوان.
 */
export function profileOf(vertical: 'clinic' | ServiceKey, servicesRaw: string | null): TenantProfile {
  if (vertical === 'clinic') return { kind: 'clinic', services: [], primary: 'clinic' };
  const stored = parseServices(servicesRaw);
  const services = stored.length > 0 && primaryOf(stored) === vertical ? stored : [vertical];
  return { kind: 'company', services, primary: vertical };
}

/** برچسبِ فارسیِ یک پروفایل — برای سربرگِ پرتال/فرم‌ساز که یک عنوان لازم دارند. */
export function profileLabel(p: TenantProfile): string {
  if (p.kind === 'clinic') return TENANT_KINDS.clinic.label;
  return `${TENANT_KINDS.company.label} — ${p.services.map((s) => SERVICES[s].label).join(' و ')}`;
}

/**
 * **پلانِ ماژول‌های یک پروفایل** — `key → حداقلِ سطح`.
 *
 * مطب همان پلانِ مطب؛ شرکت **اجتماعِ** پلانِ خدماتش. وقتی دو خدمت برای یک
 * ماژول سطحِ متفاوت دارند (حسابداری ۵ و ۴، انبار ۳ و ۲)، **سطحِ بازتر** —
 * تصمیمِ پیش‌فرضِ مالک: خدمتی که ماژول را بیشتر لازم دارد تعیین می‌کند
 * (ردیابیِ سریالِ ایمپلنت از سطحِ کارشناس)، و سوپرادمین بعداً از «دسترسی‌ها»
 * تنگش می‌کند.
 */
export function featurePlanForProfile(kind: TenantKind, services: readonly ServiceKey[]): Record<string, number> {
  const plans = kind === 'clinic' ? [VERTICALS.clinic.features] : services.map((s) => VERTICALS[s].features);
  const out: Record<string, number> = {};
  for (const plan of plans) {
    for (const [key, level] of Object.entries(plan as Record<string, number>)) {
      out[key] = key in out ? Math.min(out[key], level) : level;
    }
  }
  return out;
}

/** اعتبارسنجیِ پروفایلِ درخواستی؛ خطای فارسی یا `null`. */
export function profileError(kind: unknown, services: unknown): string | null {
  if (kind !== 'clinic' && kind !== 'company') return 'نوعِ نصب باید «مطب / کلینیک» یا «شرکتی» باشد';
  const list = Array.isArray(services) ? services : [];
  if (list.some((s) => !isServiceKey(s))) return 'خدمتِ انتخاب‌شده نامعتبر است';
  if (kind === 'clinic' && list.length) return 'مطب / کلینیک بستهٔ خدمات ندارد';
  if (kind === 'company' && !list.length) return 'دست‌کم یک خدمت انتخاب کنید';
  return null;
}

/** پروفایلِ تمیزشدهٔ یک درخواستِ معتبر — همان شکلی که `profileOf` برمی‌گرداند. */
export function requestedProfile(kind: TenantKind, services: readonly string[]): TenantProfile {
  if (kind === 'clinic') return { kind, services: [], primary: 'clinic' };
  const list = normalizeServices(services);
  return { kind, services: list, primary: primaryOf(list) };
}

/**
 * **تغییرِ ماژول‌ها وقتی پروفایل عوض می‌شود — فقط آنچه عضویتش عوض شده.**
 *
 * ⚠️ `setVertical`ِ قدیمی هر ماژولِ پلان را به سطحِ پیش‌فرض برمی‌گرداند و
 * روشن می‌کرد؛ یعنی اولین «ذخیره» سطح‌هایی را که شرکت در «دسترسی‌ها» تنظیم کرده
 * بود و ماژول‌هایی را که عمداً خاموش کرده بود، بی‌صدا به پیش‌فرض برمی‌گرداند.
 * این‌جا:
 *  - ماژولی که **تازه** در پلان آمده: اگر ردیف ندارد ساخته، اگر خاموش است روشن می‌شود.
 *  - ماژولی که از پلان **بیرون** رفته: خاموش (نه حذف — برگشت همان تنظیم را پس می‌دهد).
 *  - ماژولی که در هر دو هست: فقط اگر سطحش **هنوز همان پیش‌فرضِ قبلی** است، به
 *    پیش‌فرضِ تازه می‌رود؛ سطحِ دست‌خورده دست نمی‌خورد، روشن/خاموشش هم.
 *  - ماژولی که در هیچ‌کدام نیست: دست نمی‌خورد.
 */
export interface FeatureRow { key: string; minLevel: number; enabled: boolean }
export interface FeatureChange { key: string; action: 'create' | 'enable' | 'disable' | 'relevel'; minLevel?: number; from?: number }
export function featureChanges(before: TenantProfile, after: TenantProfile, rows: readonly FeatureRow[]): FeatureChange[] {
  const pb = featurePlanForProfile(before.kind, before.services);
  const pa = featurePlanForProfile(after.kind, after.services);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: FeatureChange[] = [];
  for (const [key, level] of Object.entries(pa)) {
    const row = byKey.get(key);
    if (!row) { out.push({ key, action: 'create', minLevel: level }); continue; }
    if (!(key in pb)) {
      if (!row.enabled) out.push({ key, action: 'enable', minLevel: level, from: row.minLevel });
      continue;
    }
    if (row.minLevel === pb[key] && level !== pb[key]) out.push({ key, action: 'relevel', minLevel: level, from: row.minLevel });
  }
  for (const key of Object.keys(pb)) {
    if (key in pa) continue;
    const row = byKey.get(key);
    if (row?.enabled) out.push({ key, action: 'disable', from: row.minLevel });
  }
  return out;
}
