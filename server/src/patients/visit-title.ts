import { SERVICES, isServiceKey } from '../config/tenant-profile';
import { COMPANY_MULTI_SERVICE_TITLE, OPERATION_FORM_TITLE } from './form-presets';

/**
 * **نامِ مراجعهٔ شرکت = نامِ خدمتش** — «نورومانیتورینگ»، نه «فرمِ عمل».
 *
 * مالک (۱۴۰۵/۰۷/۰۵): «برای بیمار چرا فرمِ عمل تشکیل می‌شود؛ وقتی فرمِ نورومانیتورینگ پر
 * می‌شود مراجعهٔ نورومانیتورینگ ساخته شود، وقتی فرمِ ایمپلنت مراجعهٔ ایمپلنت». نوعِ داده همان
 * `surgery` می‌ماند — خدمت حینِ یک عمل ارائه می‌شود و تقویم، چینش، یادآوری‌ها و دفترِ کارشناس
 * روی همین نوع سوارند — فقط **نامی** که همه‌جا دیده می‌شود از `Visit.service` می‌آید.
 *
 * ⚠️ یک تابع برای هر جایی که نامِ مراجعه را می‌سازد (غنی‌سازیِ مراجعه، پرونده، خطِ زمانِ «الان
 * کجاییم»، پرتالِ بیمار): تا دیروز هر کدام نگاشتِ `kind → عنوانِ فرم` خودش را داشت، و اگر فقط
 * یکی‌شان خدمت را می‌شناخت یک مراجعه در دو صفحه دو نام می‌گرفت.
 * ⚠️ `service` فقط روی مراجعهٔ شرکتی پر است؛ مطب و مراجعهٔ بی‌خدمت `null` می‌گیرند و همان نامِ
 * فرمِ نوعشان می‌ماند.
 * ⚠️ **فقط مراجعهٔ خدمت** (`surgery`): شرکتِ تک‌خدمته روی هر مراجعه‌ای خدمت می‌نشاند
 * (`visitServiceOf`)، ولی نوعی که خودِ شرکت در فرم‌ساز ساخته («پیگیریِ تلفنی»، …) نامِ فرمِ خودش را
 * دارد و «نورومانیتورینگ» نامیدنش دروغ است — `dashboard-kind` همین را گرفت.
 */
export const SERVICE_VISIT_KIND = 'surgery';

export const serviceTitleOf = (v: { kind?: string | null; service?: string | null } | null | undefined): string | null =>
  (v?.kind === SERVICE_VISIT_KIND && isServiceKey(v.service) ? SERVICES[v.service as keyof typeof SERVICES].label : null);

const SERVICE_LABELS = new Set<string>(Object.values(SERVICES).map((x) => x.label));

/**
 * عنوانی که **خودِ سامانه** روی فرمِ مراجعهٔ شرکت گذاشته — قالبِ قدیمی («فرمِ عمل»)، نامِ خدمت
 * (تک‌خدمته) یا «خدمت» (دوخدمته) — نه نامی که مدیر در فرم‌ساز نوشته.
 */
export const isAutoCompanyFormTitle = (title: string | null | undefined) =>
  !title || title === OPERATION_FORM_TITLE || title === COMPANY_MULTI_SERVICE_TITLE || SERVICE_LABELS.has(title);

/**
 * **نامِ نمایشیِ یک مراجعه** — همهٔ نماها از همین (غنی‌سازی، پرونده، خطِ زمان و «الان کجاییم»،
 * پرتالِ بیمار، خلاصه).
 *
 * `formTitle` نامِ فرمِ نوعِ همین مراجعه است. قاعده: **نامی که مشتری گذاشته برنده است** (قانونِ ۱۵)؛
 * فقط وقتی آن نام خودکار است، نامِ خدمتِ خودِ مراجعه جایش می‌نشیند — در شرکتِ دوخدمته یعنی
 * «نورومانیتورینگ»/«ایمپلنت» به‌جای «خدمت»ِ مشترک، و در نصبی که هنوز فرم‌ها را نخوانده به‌جای
 * «فرمِ عمل»ِ قدیمی. در شرکتِ تک‌خدمته هر دو یک چیزند و نوار، کارت و فیلتر یک نام می‌گویند.
 */
export function visitTitleOf(
  v: { kind?: string | null; service?: string | null } | null | undefined,
  formTitle: string | null | undefined,
): string | null {
  const service = serviceTitleOf(v);
  return service && isAutoCompanyFormTitle(formTitle) ? service : (formTitle ?? null);
}
