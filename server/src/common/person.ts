import { BadRequestException } from '@nestjs/common';
import { isValidIban, isValidNationalId, normalizeIban, toEnDigits } from './identity';

/** فیلدهای هویتیِ مشترک — هر نقشی که Person می‌سازد یا ویرایش می‌کند از این شکل استفاده می‌کند. */
export type PersonInput = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  nationalId?: string;
  email?: string;
  birthDate?: string;
  city?: string;
  address?: string;
  iban?: string;
  photo?: string;
  notes?: string;
};

/**
 * ساختِ patchِ Person با اعتبارسنجی و نرمال‌سازیِ یکسان.
 *
 * عمداً تابعِ خالص و بیرونِ سرویس‌هاست: جراح و کارشناس هر دو Person می‌سازند و
 * اگر هرکدام قاعدهٔ خودش را داشته باشد، دوباره همان پراکندگی‌ای می‌شود که این
 * بازطراحی برای بستنش انجام شد.
 *
 * forCreate=true یعنی نام و نام‌خانوادگی حتماً باید بیایند.
 */
export function buildPersonPatch(dto: PersonInput, forCreate: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (forCreate || dto.firstName !== undefined) {
    const v = dto.firstName?.trim();
    if (forCreate && (!v || v.length < 2)) throw new BadRequestException('نام را کامل وارد کنید');
    if (v !== undefined) out.firstName = v;
  }
  if (forCreate || dto.lastName !== undefined) {
    const v = dto.lastName?.trim();
    if (forCreate && (!v || v.length < 2)) throw new BadRequestException('نام خانوادگی را کامل وارد کنید');
    if (v !== undefined) out.lastName = v;
  }

  if (dto.phone !== undefined) out.phone = toEnDigits(dto.phone).trim() || null;
  if (dto.email !== undefined) out.email = dto.email?.trim() || null;
  if (dto.city !== undefined) out.city = dto.city?.trim() || null;
  if (dto.address !== undefined) out.address = dto.address?.trim() || null;
  if (dto.photo !== undefined) out.photo = dto.photo || null;
  if (dto.notes !== undefined) out.notes = dto.notes?.trim() || null;

  if (dto.birthDate !== undefined) {
    const raw = dto.birthDate?.trim();
    if (!raw) out.birthDate = null;
    else {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخِ تولد معتبر نیست');
      out.birthDate = d;
    }
  }

  if (dto.nationalId !== undefined) {
    const nid = toEnDigits(dto.nationalId).replace(/[^0-9]/g, '');
    if (nid && !isValidNationalId(nid)) throw new BadRequestException('کدِ ملی معتبر نیست');
    out.nationalId = nid || null;
  }

  if (dto.iban !== undefined) {
    const raw = (dto.iban ?? '').trim();
    if (raw && !isValidIban(raw)) throw new BadRequestException('شمارهٔ شبا معتبر نیست');
    out.iban = raw ? normalizeIban(raw) : null;
  }

  return out;
}
