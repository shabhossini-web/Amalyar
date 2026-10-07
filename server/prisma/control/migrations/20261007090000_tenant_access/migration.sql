-- چرخهٔ عمرِ تجاریِ شرکت (خواستهٔ مالک ۱۴۰۵/۰۷/۱۵): فعال/معلق، مهلتِ اشتراک، حالتِ دمو، یادداشت.
-- جدا از `status` که فقط چرخهٔ ساخت/حذف است. همهٔ شرکت‌های موجود «اشتراکِ بی‌مهلت» می‌مانند.
ALTER TABLE "tenants"
    ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'paid',
    ADD COLUMN "access_until" TIMESTAMP(3),
    ADD COLUMN "suspended_at" TIMESTAMP(3),
    ADD COLUMN "access_note" TEXT;

-- نوعِ حساب و مهلتِ اولیه روی درخواستِ ساخت، تا Worker شرکتِ تازه را از همان ابتدا دمو بسازد.
ALTER TABLE "provisioning_jobs"
    ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'paid',
    ADD COLUMN "access_days" INTEGER;
