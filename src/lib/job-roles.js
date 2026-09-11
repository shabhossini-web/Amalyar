/**
 * نقش‌های شغلی — آینهٔ `server/src/common/job-roles.ts`.
 * ⚠️ برچسب‌های نمایش از سرور می‌آیند (`jobRoleLabel` / `roleLabel`)؛ این فهرست
 * فقط برای ساختنِ گزینه‌های انتخاب است.
 */
export const JOB_ROLES = [
  { v: 'doctor', l: 'پزشک' },
  { v: 'secretary', l: 'منشی' },
  { v: 'nurse', l: 'پرستار' },
  { v: 'assistant', l: 'دستیار' },
  { v: 'technician', l: 'کارشناس' },
  { v: 'driver', l: 'راننده' },
  { v: 'courier', l: 'پیک' },
];

export function fieldRoles(field) {
  return Array.isArray(field?.roles) && field.roles.length ? field.roles : field?.role ? [field.role] : [];
}
