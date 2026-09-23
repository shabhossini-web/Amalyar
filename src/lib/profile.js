/**
 * **آینهٔ کلاینتیِ `server/src/config/tenant-profile.ts`** — نوعِ نصب
 * (مطب/کلینیک یا شرکتی) و بستهٔ خدماتِ شرکت.
 *
 * سرور `kind` و `services` را در `/config` می‌فرستد و این‌جا فقط همان‌ها خوانده
 * می‌شوند. قاعدهٔ بازگشت (`vertical` ← پروفایل) فقط برای وقتی است که پاسخ
 * هنوز نرسیده یا از یک mockِ قدیمی آمده که فقط `vertical` دارد — همان قاعدهٔ
 * سرور برای نصبی که ردیفِ `services` ندارد، تا دو طرف هرگز دو حرف نزنند.
 * سنجه: `scripts/e2e/tenant-profile-unit.mjs` هر دو را روی یک جدول می‌سنجد.
 */
export const SERVICE_ORDER = ['ionm', 'implant'];

export function profileFromConfig(cfg) {
  const vertical = cfg?.vertical ?? 'ionm';
  const kind = cfg?.kind ?? (vertical === 'clinic' ? 'clinic' : 'company');
  if (kind === 'clinic') return { kind, services: [] };
  const given = Array.isArray(cfg?.services) ? SERVICE_ORDER.filter((k) => cfg.services.includes(k)) : [];
  return { kind, services: given.length ? given : [vertical] };
}

/** «این شرکت فلان خدمت را دارد؟» — به‌جای مقایسهٔ `vertical === '…'`. */
export const hasService = (cfg, key) => profileFromConfig(cfg).services.includes(key);
