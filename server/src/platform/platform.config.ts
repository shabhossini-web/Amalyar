import { createHmac, timingSafeEqual } from 'crypto';
import { sanitizeWebOtpHost } from '../common/webotp';

export type PlatformConfig = {
  enabled: boolean;
  secret: string;
  phones: Set<string>;
  webOtpHost: string;
};

export function normalizePlatformPhone(value: string): string | null {
  let phone = (value || '').replace(/[^0-9]/g, '');
  if (phone.startsWith('98')) phone = '0' + phone.slice(2);
  if (!phone.startsWith('0')) phone = '0' + phone;
  return /^09[0-9]{9}$/.test(phone) ? phone : null;
}

/**
 * fallbackِ env برای میزبانِ WebOTP. خالی مجاز است (میزبانِ درخواست به‌کار می‌رود)
 * ولی مقدارِ نامعتبر باید در startup سروصدا کند، نه اینکه بی‌صدا نادیده گرفته شود.
 */
export function normalizeWebOtpHost(value: string): string {
  if (!(value || '').trim()) return '';
  const host = sanitizeWebOtpHost(value);
  if (!host) {
    throw new Error('PLATFORM_ADMIN_WEBOTP_HOST must be a valid hostname without protocol or path');
  }
  return host;
}

/**
 * دامنهٔ کدِ یکبارمصرف. کدِ ورود و کدِ عملیاتِ حساس (مثلِ حذفِ شرکت) هرگز نباید
 * یکی باشند، و کدِ حذفِ یک شرکت نباید روی شرکتِ دیگر کار کند — پس دامنه داخلِ
 * خودِ hash می‌رود. تابعِ خالص است تا بدونِ بارگذاریِ Prisma قابلِ تست بماند.
 */
export function platformOtpScopeHash(secret: string, phone: string, scope: string): string {
  const value = scope === 'login' ? phone : `${scope}:${phone}`;
  return createHmac('sha256', secret).update(`phone:${value}`).digest('hex');
}

export function platformPhoneRef(secret: string, phone: string): string {
  return createHmac('sha256', secret).update(`platform-phone-ref:${phone}`).digest('hex');
}

export function resolvePlatformPhoneRef(config: PlatformConfig, ref: string): string | null {
  if (!/^[a-f0-9]{64}$/.test(ref || '')) return null;
  const actual = Buffer.from(ref);
  for (const phone of config.phones) {
    const expected = Buffer.from(platformPhoneRef(config.secret, phone));
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return phone;
  }
  return null;
}

export function platformAdminConfig(): PlatformConfig {
  const enabled = process.env.PLATFORM_ADMIN_ENABLED === 'true';
  if (!enabled) return { enabled: false, secret: '', phones: new Set(), webOtpHost: '' };

  const secret = process.env.PLATFORM_ADMIN_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('PLATFORM_ADMIN_SECRET with at least 32 characters is required when Platform Admin is enabled');
  }

  const phones = new Set(
    (process.env.PLATFORM_ADMIN_PHONES ?? '')
      .split(',')
      .map((value) => normalizePlatformPhone(value.trim()))
      .filter((value): value is string => Boolean(value)),
  );
  if (phones.size === 0) {
    throw new Error('PLATFORM_ADMIN_PHONES must contain at least one valid allowlisted phone');
  }

  const webOtpHost = normalizeWebOtpHost(process.env.PLATFORM_ADMIN_WEBOTP_HOST ?? '');
  return { enabled, secret, phones, webOtpHost };
}
