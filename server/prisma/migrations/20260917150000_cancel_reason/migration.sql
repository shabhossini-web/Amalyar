-- دلیلِ لغو (تصمیمِ مالک ۱۴۰۵/۰۶/۲۶)
--
-- دو ستون روی هر دو جدول، چون «لغو» دو جای متفاوت دارد که یکی نیستند:
-- لغوِ نوبت (هنوز مراجعه‌ای نبود) و لغوِ مراجعه (کارِ ثبت‌شده لغو شد).
--
-- ⚠️ `cancel_reason` کلیدی از مجموعهٔ بستهٔ `CANCEL_REASONS` است و متنش **به
-- دستِ بیمار می‌رسد**؛ `cancel_note` یادداشتِ داخلی است و هرگز فرستاده نمی‌شود.
-- هر دو nullable: رکوردهای موجود لغو نشده‌اند و نباید مقدارِ ساختگی بگیرند.
ALTER TABLE "visits"       ADD COLUMN "cancel_reason" TEXT, ADD COLUMN "cancel_note" TEXT;
ALTER TABLE "appointments" ADD COLUMN "cancel_reason" TEXT, ADD COLUMN "cancel_note" TEXT;
