-- حسابی که روی فرمِ عمومیِ ثبت‌نام به بیمار نشان داده می‌شود.
-- پیش‌فرض خاموش: هیچ حسابی بدونِ انتخابِ صریحِ ادمین عمومی نمی‌شود.
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "show_on_intake" BOOLEAN NOT NULL DEFAULT false;
