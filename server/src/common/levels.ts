// سطوحِ دسترسیِ استاندارد (۱..۶)
export const LEVEL = {
  VIEWER: 1, // بازدید
  TECH: 2, // کارشناس
  TECH_ADMIN: 3, // کارشناس‌ادمین
  SUPERVISOR: 4, // سوپروایزر
  ADMIN: 5, // ادمین
  SUPER_ADMIN: 6, // سوپرادمین
} as const;

export const LEVEL_NAMES: Record<number, string> = {
  1: 'بازدید',
  2: 'کارشناس',
  3: 'کارشناس‌ادمین',
  4: 'سوپروایزر',
  5: 'ادمین',
  6: 'سوپرادمین',
};

export const levelName = (n: number) => LEVEL_NAMES[n] || '—';
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 6;
