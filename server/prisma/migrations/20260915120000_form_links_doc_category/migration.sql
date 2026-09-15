-- باکسِ لینک (نوعِ فیلدِ `links`) + دستهٔ پیش‌فرضِ مدرک برای باکس‌های عکس/لینکِ فرم،
-- و ورودِ پورتال روی مدرکِ لینکی (نامِ کاربری/رمزِ پکس یا آزمایشگاه).
ALTER TABLE "form_fields" ADD COLUMN IF NOT EXISTS "doc_category" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "external_user" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "external_pass" TEXT;
