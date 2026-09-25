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

/**
 * **سوپرادمین بی‌محدودیت است** (خواستهٔ صریحِ مالک ۱۴۰۵/۰۷/۰۳): هر صفحه‌ای که
 * «مالِ من» را نشان می‌دهد — «امروز» و صفِ کار، پنلِ کارشناسی، میزِ پزشک،
 * حمل‌ونقل — برای او «مالِ همه» است، و هر عملیاتی که آن صفحه به صاحبش اجازه
 * می‌دهد برای او هم باز است. سوپرادمین برای انجامِ هیچ کاری نباید پروفایل عوض
 * کند یا از کسِ دیگری بخواهد وارد شود.
 *
 * ⚠️ این استثنای تازه نیست؛ همان قاعدهٔ گاردهاست (عبورِ بی‌قیدِ سطحِ ۶ در
 * `FeatureGuard` / `PermissionGuard` / `FeaturesService.forUser`) که تا امروز
 * فقط به «دیدنِ کاشی» رسیده بود، نه به «دامنهٔ داده». هر جا دامنه را به «خودِ
 * کاربر» می‌بندی (`techId: user.id`، `ownerAccountId: user.id`، `staffId` …)
 * اول همین را بپرس. رابط سطح را حساب نمی‌کند (قانونِ ۳): سرور در پاسخ می‌گوید
 * دامنه «همه» است (مثلاً `team: true`) و رابط فقط همان را نشان می‌دهد.
 */
export const isUnrestricted = (user: any) => (user?.level ?? 0) >= LEVEL.SUPER_ADMIN;

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
