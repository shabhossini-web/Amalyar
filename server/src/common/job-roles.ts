/**
 * نقش‌های شغلی — «هر کس قسمتِ خودش را پر کند» (`docs/BOOKING.md` مرحلهٔ ۴).
 *
 * ⚠️ عمداً مجموعهٔ **بسته** است نه جدولِ تعریف‌شدنی: نقش دروازهٔ نوشتن است و
 * دروازه‌ای که هر لحظه بشود عوضش کرد، دروازه نیست. اگر روزی نقشِ تازه لازم
 * شد، یک ورودی این‌جا اضافه می‌شود — نه یک ردیفِ آزاد در دیتابیس.
 */
export const JOB_ROLES: Record<string, string> = {
  doctor: 'پزشک',
  secretary: 'منشی',
  nurse: 'پرستار',
  assistant: 'دستیار',
  technician: 'کارشناس',
  driver: 'راننده',
  courier: 'پیک',
};

export const JOB_ROLE_KEYS = Object.keys(JOB_ROLES);

export function jobRoleLabel(key: string | null | undefined): string | null {
  return key ? JOB_ROLES[key] ?? key : null;
}

export function fieldRoles(field: { roles?: unknown; role?: string | null } | null | undefined) {
  return Array.isArray(field?.roles) && field.roles.length ? field.roles : field?.role ? [field.role] : [];
}
