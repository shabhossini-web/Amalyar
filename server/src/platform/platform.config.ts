export type PlatformConfig = {
  enabled: boolean;
  secret: string;
  phones: Set<string>;
};

export function normalizePlatformPhone(value: string): string | null {
  let phone = (value || '').replace(/[^0-9]/g, '');
  if (phone.startsWith('98')) phone = '0' + phone.slice(2);
  if (!phone.startsWith('0')) phone = '0' + phone;
  return /^09[0-9]{9}$/.test(phone) ? phone : null;
}

export function platformAdminConfig(): PlatformConfig {
  const enabled = process.env.PLATFORM_ADMIN_ENABLED === 'true';
  if (!enabled) return { enabled: false, secret: '', phones: new Set() };

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
  return { enabled, secret, phones };
}
