-- نقشِ شغلی روی حساب + بخشِ نقش روی فیلدِ فرم — `docs/BOOKING.md` مرحلهٔ ۴.
-- «هر کس قسمتِ خودش را پر کند»: سطح می‌گوید چقدر می‌بینی، نقش می‌گوید کدام
-- بخشِ فرم مالِ توست. null = بی‌نقش/عمومی؛ رفتارِ همهٔ نصب‌های موجود عوض نمی‌شود.
ALTER TABLE "accounts"    ADD COLUMN IF NOT EXISTS "job_role" TEXT;
ALTER TABLE "form_fields" ADD COLUMN IF NOT EXISTS "role"     TEXT;
