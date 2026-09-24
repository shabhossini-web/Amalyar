import { SERVICES, ServiceKey, TenantProfile, isServiceKey } from '../config/tenant-profile';

/**
 * **خدمتِ یک ثبت‌نام** — نورومانیتورینگ یا ایمپلنت — تا تأیید بر اساسِ همان
 * خدمت تصمیم بگیرد، نه بر اساسِ حوزهٔ کلِ شرکت.
 *
 * ⚠️ چرا لازم شد (مالک، ۱۴۰۵/۰۷/۰۱): تا دیروز تأیید از `vertical`ِ شرکت
 * می‌پرسید «ردیف‌های ایمپلنت لازم است؟». شرکتی که هر دو خدمت را دارد با آن
 * قاعده یا هر ثبت‌نامِ نورومانیتورینگ را بدونِ اقلام رد می‌کرد، یا هیچ
 * ثبت‌نامِ ایمپلنتی ویرایشگرِ اقلام نمی‌گرفت.
 *
 * ترتیبِ منبع‌ها:
 *  ۱. **خودِ فرم** — ستونِ `FormDef.service` (فرمِ دلخواهی که در فرم‌ساز خدمتش را گرفته)، وگرنه
 *     کلیدِ پیش‌فرض (`intake.ionm` / `intake.implant`) — فرم می‌گوید چه خدمتی است،
 *     **به شرطِ اینکه شرکت هنوز همان خدمت را بدهد.** ثبت‌نامِ معلقی که پیش از
 *     برداشتنِ یک خدمت از بسته پر شده، کلیدِ خدمتِ رفته را دارد؛ اگر آن کلید
 *     برنده می‌شد، شرکتِ فقط‌نورومانیتورینگ ردیفِ ایمپلنت می‌خواست (یا شرکتِ
 *     فقط‌ایمپلنت ردیف نمی‌خواست) — قاعدهٔ خدمتی که دیگر وجود ندارد.
 *  ۲. شرکتِ **تک‌خدمته** — ابهامی نیست.
 *  ۳. انتخابِ صریحِ تأییدکننده (فرمِ دلخواه در شرکتِ دوخدمته).
 *  ۴. خدمتِ اصلی — پیش‌فرضِ قابلِ‌ویرایش در پاپ‌آپ، **نه خطای ۴۰۰**: فرم‌های
 *     دلخواهِ زنده نباید با افزودنِ خدمتِ دوم ناگهان تأییدنشدنی شوند.
 *
 * ⚠️ کلیدِ فرمِ دلخواه نقطه نمی‌گیرد، پس فرمِ دلخواه فقط با ستونِ `service` شناخته می‌شود
 * (مهاجرتِ `20260925000000_company_service_columns` آن را برای فرم‌های پیش‌فرض هم پر کرد).
 */
export interface IntakeService {
  service: ServiceKey | null;
  source: 'none' | 'form' | 'single' | 'chosen' | 'primary';
  /** تأییدکننده باید ببیند و بتواند عوضش کند. */
  ambiguous: boolean;
}

export const serviceOfFormKey = (key?: string | null): ServiceKey | null => {
  const m = /^intake\.([a-z]+)$/.exec(key ?? '');
  return m && isServiceKey(m[1]) ? m[1] : null;
};

/** فرم (یا فقط کلیدش، برای فراخوانِ قدیمی) — `service` ستونِ همان فرم است. */
type FormLike = { key?: string | null; service?: string | null } | string | null | undefined;

export function serviceOf(form: FormLike, profile: TenantProfile, chosen?: string | null): IntakeService {
  if (profile.kind === 'clinic') return { service: null, source: 'none', ambiguous: false };
  const f = typeof form === 'object' && form ? form : { key: form ?? null, service: null };
  const fromForm = (isServiceKey(f.service) ? f.service : null) ?? serviceOfFormKey(f.key);
  if (fromForm && profile.services.includes(fromForm)) return { service: fromForm, source: 'form', ambiguous: false };
  if (profile.services.length === 1) return { service: profile.services[0], source: 'single', ambiguous: false };
  if (chosen && isServiceKey(chosen) && profile.services.includes(chosen)) return { service: chosen, source: 'chosen', ambiguous: true };
  return { service: profile.primary === 'clinic' ? null : profile.primary, source: 'primary', ambiguous: true };
}

export const serviceLabel = (s: ServiceKey | null) => (s ? SERVICES[s].label : null);

/**
 * «این مراجعه ایمپلنتی است؟» — برای جایی که مراجعه (نه ثبت‌نام) باید تصمیم
 * بگیرد، مثلِ ویرایشگرِ اقلام در پرتالِ جراح.
 *
 * ۱. ستونِ `Visit.service` (از تأییدِ ثبت‌نام یا انتخابِ فرمِ مراجعه) — مراجعهٔ نورومانیتورینگ
 *    ایمپلنتی نیست حتی اگر شرکت امروز فقط ایمپلنت بدهد: خدمت مالِ روزِ ساختِ مراجعه است.
 * ۲. شرکتِ فقط‌ایمپلنت: همه (همان رفتارِ دیروز).
 * ۳. ردیف‌های قدیمیِ بی‌ستون در شرکتِ دوخدمته: «ردیفِ اقلام دارد» — تأییدِ ثبت‌نامِ ایمپلنت
 *    بی‌ردیف انجام نمی‌شد، پس این نشانه برای مراجعه‌های ثبت‌نامیِ قدیمی قطعی است.
 */
export function visitIsImplant(requiredItems: unknown, profile: TenantProfile, service?: string | null): boolean {
  if (!profile.services.includes('implant')) return false;
  if (isServiceKey(service)) return service === 'implant';
  if (profile.services.length === 1) return true;
  return Array.isArray(requiredItems) && requiredItems.length > 0;
}
