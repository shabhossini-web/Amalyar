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
 *  ۱. کلیدِ **خودِ فرم** (`intake.ionm` / `intake.implant`) — فرم می‌گوید چه خدمتی است،
 *     **به شرطِ اینکه شرکت هنوز همان خدمت را بدهد.** ثبت‌نامِ معلقی که پیش از
 *     برداشتنِ یک خدمت از بسته پر شده، کلیدِ خدمتِ رفته را دارد؛ اگر آن کلید
 *     برنده می‌شد، شرکتِ فقط‌نورومانیتورینگ ردیفِ ایمپلنت می‌خواست (یا شرکتِ
 *     فقط‌ایمپلنت ردیف نمی‌خواست) — قاعدهٔ خدمتی که دیگر وجود ندارد.
 *  ۲. شرکتِ **تک‌خدمته** — ابهامی نیست.
 *  ۳. انتخابِ صریحِ تأییدکننده (فرمِ دلخواه در شرکتِ دوخدمته).
 *  ۴. خدمتِ اصلی — پیش‌فرضِ قابلِ‌ویرایش در پاپ‌آپ، **نه خطای ۴۰۰**: فرم‌های
 *     دلخواهِ زنده نباید با افزودنِ خدمتِ دوم ناگهان تأییدنشدنی شوند.
 *
 * ⚠️ کلیدِ فرمِ دلخواه نقطه نمی‌گیرد، پس فقط فرمِ پیش‌فرض با کلید شناخته
 * می‌شود. راهِ ماندگار ستونِ `FormDef.service` است (بستهٔ ستون‌ها، پشتِ کلیمِ
 * `server/prisma/`) — تا آن موقع همین قاعده.
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

export function serviceOf(formKey: string | null | undefined, profile: TenantProfile, chosen?: string | null): IntakeService {
  if (profile.kind === 'clinic') return { service: null, source: 'none', ambiguous: false };
  const fromForm = serviceOfFormKey(formKey);
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
 * شرکتِ فقط‌ایمپلنت: همه (همان رفتارِ دیروز). شرکتِ دوخدمته: مراجعه‌ای که
 * ردیفِ اقلام دارد — تأییدِ ثبت‌نامِ ایمپلنت بی‌ردیف انجام نمی‌شود، پس این
 * نشانه برای مراجعه‌های ثبت‌نامی قطعی است. ⚠️ مراجعهٔ دستیِ ایمپلنتی که هنوز
 * ردیفی ندارد در شرکتِ دوخدمته دیده نمی‌شود؛ راهِ ماندگار ستونِ `Visit.service`.
 */
export function visitIsImplant(requiredItems: unknown, profile: TenantProfile): boolean {
  if (!profile.services.includes('implant')) return false;
  if (profile.services.length === 1) return true;
  return Array.isArray(requiredItems) && requiredItems.length > 0;
}
