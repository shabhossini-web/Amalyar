import { api } from './api.js';
import { applyBrand } from './brand-palette.js';
import { applyTheme, resolveTheme } from './theme.js';

/**
 * **هویت و تمِ مطب روی صفحه‌های بیمار** — جانشینِ `ConfigProvider` برای مسیرهای عمومی.
 *
 * ⚠️ صفحه‌های `/r` `/f` `/p` `/v` بیرونِ `AuthProvider`/`ConfigProvider` رندر می‌شوند
 * (بازبینیِ UX، بندِ ۹۴): تا دیروز هر بارِ بازشدنشان `/config` و `/auth/me` و
 * `/auth/accounts` را می‌زد که برای بیمارِ بی‌حساب همه ۴۰۱ بودند — چهار درخواستِ
 * بی‌فایده روی اینترنتِ کندِ گوشی، و چون `/config` نمی‌رسید، تم و رنگِ مطب هم هیچ‌وقت
 * به بیمار نمی‌رسید. حالا پاسخِ خودِ هر صفحه (`brand` + `vertical`) همین را می‌آورد.
 *
 * قاعدهٔ تم همان قاعدهٔ کارکنان است (`resolveTheme`): انتخابِ ذخیره‌شدهٔ همین مرورگر
 * مقدم است، بعد پیش‌فرضِ حوزه (مطب روشن، بقیه تیره).
 */

let last = null;
let pending = null;

/** پاسخی که `brand`/`vertical` دارد ← رنگ و تم روی `<html>`. پاسخِ بی‌این‌ها (mock، سرورِ قدیمی) بی‌اثر است. */
export function adoptFace(face) {
  if (!face || typeof face !== 'object') return;
  const { brand, vertical } = face;
  if (!brand && !vertical) return;
  last = { brand: brand ?? last?.brand ?? null, vertical: vertical ?? last?.vertical ?? null };
  if (vertical) applyTheme(resolveTheme(vertical));
  if (brand?.color) applyBrand(brand.color);
}

/** آخرین هویتِ رسیده — مرزِ خطا (`ErrorBoundary`) تلفنِ مطب را از همین برمی‌دارد. */
export const lastFace = () => last;

/**
 * هویتِ مطب وقتی دادهٔ خودِ صفحه نیامد (لینکِ ناقص، منقضی، قطعِ اتصال) — یک‌بار در عمرِ
 * صفحه. شکست `null` است نه خطا: صفحهٔ خطا بی‌تلفن هم باید رندر شود.
 */
export function fetchFace() {
  if (last) return Promise.resolve(last);
  if (!pending) {
    pending = api('/public/intake/brand', { quiet401: true })
      .then((f) => { adoptFace(f); return last; })
      .catch(() => { pending = null; return null; });
  }
  return pending;
}
