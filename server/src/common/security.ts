/** تنظیمات امنیتی باید در production صریح و fail-closed باشند. */
export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET ?? '';
  const production = process.env.NODE_ENV === 'production';
  if (production && secret.length < 32) {
    throw new Error('JWT_SECRET با حداقل ۳۲ کاراکتر در production الزامی است');
  }
  return secret || 'development-only-secret-change-before-production';
}

export function allowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? '';
  const origins = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (process.env.NODE_ENV === 'production' && origins.length === 0) {
    throw new Error('CORS_ORIGINS در production الزامی است');
  }
  return origins.length ? origins : ['http://localhost:5173'];
}
