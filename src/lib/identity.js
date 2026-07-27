/**
 * اعتبارسنجیِ شناسه‌های هویتی — نسخهٔ فرانت برای بازخوردِ فوری هنگام تایپ.
 *
 * ⚠️ آینهٔ `server/src/common/identity.ts` است. اعتبارِ واقعی سمتِ سرور گرفته
 * می‌شود؛ این‌جا فقط تجربهٔ کاربری است. اگر قاعده‌ای عوض شد، هر دو باید عوض شوند.
 */

/** ارقامِ فارسی/عربی → انگلیسی. کاربر معمولاً با کیبوردِ فارسی عدد می‌زند. */
export const toEnDigits = (v) =>
  (v ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** کدِ ملیِ ایران: ۱۰ رقم با رقمِ کنترلیِ وزنی. */
export function isValidNationalId(value) {
  const id = toEnDigits(value).replace(/[^0-9]/g, '');
  if (!/^\d{10}$/.test(id)) return false;
  if (/^(\d)\1{9}$/.test(id)) return false; // ۰۰۰۰۰۰۰۰۰۰ و مانندش واقعی نیستند
  const check = Number(id[9]);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(id[i]) * (10 - i);
  const r = sum % 11;
  return r < 2 ? check === r : check === 11 - r;
}

/** شبا: IR + ۲۴ رقم، با آزمونِ mod-97 استانداردِ IBAN. */
export function isValidIban(value) {
  const raw = toEnDigits(value).replace(/\s+/g, '').toUpperCase();
  const iban = raw.startsWith('IR') ? raw : `IR${raw}`;
  if (!/^IR\d{24}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of numeric) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

/** موبایلِ ایران: ۱۱ رقم با پیشوندِ ۰۹. */
export const isValidPhone = (v) => /^09\d{9}$/.test(toEnDigits(v).replace(/[^0-9]/g, ''));
