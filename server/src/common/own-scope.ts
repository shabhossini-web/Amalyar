import { LEVEL } from './levels';

/**
 * «دادهٔ منتسب به خودش» — قاعدهٔ object-authz برای کاربرِ زیرِ سوپروایزر (قانونِ ۴).
 *
 * تا امروز «خودش» فقط یعنی کارشناسِ مراجعه (`techId`). پزشکی که به یک تعریفِ
 * جراح وصل است (`account.person` ↔ `surgeon.person`) هیچ‌جا «خودش» شمرده نمی‌شد:
 * در مطب، پزشک با سطحِ ۲–۴ پروندهٔ بیمارِ خودش را ۴۰۴ می‌گرفت، سفارشش را
 * نمی‌توانست بررسی کند و فرمِ ویزیتش را باز کند — پس «پرتالی که پزشک همه‌کارش
 * را از آن انجام بدهد» (بازخوردِ مالک ۱۴۰۵/۰۶/۲۹) ممکن نبود.
 *
 * `user.surgeonId` یک‌بار در `validateSession` حل می‌شود (جراحِ فعالِ متصل به
 * شخصِ حساب)؛ این‌جا فقط خوانده می‌شود. سوپروایزر به بالا اصلاً scope ندارد.
 *
 * ⚠️ خروجی ممکن است `OR` داشته باشد؛ در جایی که خودِ `where` هم `OR` دارد با
 * `AND` ترکیبش کن، نه با spread (spread یکی را روی دیگری می‌نویسد).
 */
export const isScoped = (user: any) => (user?.level ?? 0) < LEVEL.SUPERVISOR;

/** شرطِ «مراجعهٔ منتسب به این کاربر» — برای جدولِ `visit`. */
export function ownVisitWhere(user: any): Record<string, any> {
  const own: Record<string, any>[] = [{ techId: user?.id ?? -1 }];
  if (Number.isInteger(user?.surgeonId) && user.surgeonId > 0) own.push({ surgeonId: user.surgeonId });
  return own.length === 1 ? own[0] : { OR: own };
}

/** شرطِ «بیماری که دستِ‌کم یک مراجعهٔ منتسب دارد» — برای جدولِ `patient`. */
export const ownPatientWhere = (user: any): Record<string, any> => ({ visits: { some: ownVisitWhere(user) } });

/** میان‌بُر: شرطِ مراجعه فقط اگر کاربر scope دارد، وگرنه خالی. */
export const scopedVisitWhere = (user: any): Record<string, any> => (isScoped(user) ? ownVisitWhere(user) : {});
export const scopedPatientWhere = (user: any): Record<string, any> => (isScoped(user) ? ownPatientWhere(user) : {});
