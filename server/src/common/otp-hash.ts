import { createHmac } from 'crypto';
import { requireJwtSecret } from './security';

/**
 * هشِ کدِ یک‌بارمصرفِ پیامکی — **HMAC با رازِ سرور**، گره‌خورده به هدف و شماره (بستهٔ PF، PF11).
 *
 * تا دیروز `sha256(code)`ِ بی‌کلید بود: کد فقط شش رقم است، پس هر کس یک نسخه از جدولِ `otp_codes` داشت
 * (پشتیبان، دامپ، دسترسیِ فقط‌خواندنی) همهٔ کدهای زنده را با یک میلیون هش در کسری از ثانیه برمی‌گرداند.
 * با کلید، آن جدول بی‌رازِ سرور بی‌مصرف است؛ و چون هدف و شماره در پیام‌اند، کدِ یک هدف یا یک شماره در
 * دیگری پذیرفته نمی‌شود حتی اگر ردیف جابه‌جا شود.
 *
 * کلید همان `JWT_SECRET` است (`requireJwtSecret`: در production اجباری و دست‌کم ۳۲ نویسه). هشدار: عوض‌شدنِ
 * آن فقط کدهای زندهٔ همان پنج دقیقه را باطل می‌کند — همان اثری که روی نشست‌ها هم دارد.
 */
export function otpHash(purpose: string, phone: string, code: string): string {
  return createHmac('sha256', requireJwtSecret()).update(`${purpose}:${phone}:${code}`).digest('hex');
}
