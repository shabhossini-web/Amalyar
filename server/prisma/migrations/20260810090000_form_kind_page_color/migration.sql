-- پایهٔ بازمعماریِ فرم‌ها: رنگِ کارت، صفحه‌بندی، و معنیِ تازهٔ `scope`.
--
-- ⚠️ هر سه تغییر عمداً **بی‌خطر برای دادهٔ موجود**اند: دو ستونِ تازه پیش‌فرض
-- دارند و مهاجرتِ scope فقط یک برچسب را عوض می‌کند. درسِ ملک‌طب: فایل زودتر از
-- مهاجرت روی سرور می‌نشیند، پس کد باید نبودِ این ستون‌ها را هم تحمل کند.

-- رنگِ کارتِ فرم — توکن (violet/teal/…) نه هگز. NULL یعنی «خودکار از کلید».
ALTER TABLE "form_defs" ADD COLUMN IF NOT EXISTS "color" TEXT;

-- صفحهٔ فیلد در چینشِ چندصفحه‌ای. همهٔ فیلدهای موجود صفحهٔ ۱ می‌مانند.
ALTER TABLE "form_fields" ADD COLUMN IF NOT EXISTS "page" INTEGER NOT NULL DEFAULT 1;

-- `survey` دیگر یک محدوده نیست، یک **مصداق** از فرمِ زیرپرونده است.
-- ⚠️ فقط ستونِ `scope` عوض می‌شود و نه `key`: کدِ نظرسنجی با کلیدِ `survey`
-- فرم را پیدا می‌کند (`survey.service.ts:218`)، و عوض‌کردنِ کلید آن مسیر را
-- بی‌صدا می‌شکست.
UPDATE "form_defs" SET "scope" = 'record' WHERE "scope" = 'survey';

-- مرتب‌سازیِ واقعیِ فیلدها `(page, sort)` است — `sort` داخلِ صفحه معنی دارد.
DROP INDEX IF EXISTS "form_fields_form_id_sort_idx";
CREATE INDEX IF NOT EXISTS "form_fields_form_id_page_sort_idx" ON "form_fields"("form_id", "page", "sort");
