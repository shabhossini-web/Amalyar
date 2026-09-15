/**
 * دسته‌های مدرک — فهرستِ بسته، تا گزارش‌گیری روی متنِ آزاد نیفتد.
 *
 * ⚠️ فایلِ جدا، چون هم `record.service` (مدارکِ پرونده) و هم `forms.service`
 * (دستهٔ پیش‌فرضِ باکسِ عکس/لینکِ فرم) لازمش دارند و آن دو همدیگر را ایمپورت
 * می‌کنند — یک ثابتِ مشترک نباید حلقهٔ ایمپورت بسازد.
 */
export const DOCUMENT_CATEGORIES = [
  'lab', // آزمایش
  'imaging', // تصویربرداری (MRI/CT/رادیولوژی)
  'report', // گزارشِ عمل/مانیتورینگ
  'consent', // رضایت‌نامه
  'identity', // مدرکِ شناسایی
  'receipt', // فیشِ پرداخت
  'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
