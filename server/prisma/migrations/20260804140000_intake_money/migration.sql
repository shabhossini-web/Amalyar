-- کدِ تخفیف + ردِ تخفیف روی ثبت‌نام.
--
-- ⚠️ ستون‌های مبلغِ intake از ابتدا باید تومان می‌بودند (مثلِ charges و
-- payments) و اشتباهاً ریال تفسیر شده بودند. چون هنوز دادهٔ واقعی روی این
-- جدول‌ها نیست، فقط تفسیر عوض می‌شود و مهاجرتِ عددی لازم نیست — ولی اگر
-- نصبی از قبل ثبت‌نامِ واقعی دارد، باید یک‌بار amount را بر ۱۰ تقسیم کند.

ALTER TABLE "intake_submissions" ADD COLUMN IF NOT EXISTS "discount_code" TEXT;
ALTER TABLE "intake_submissions" ADD COLUMN IF NOT EXISTS "discount_amount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "discount_codes" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'percent',
    "value" INTEGER NOT NULL,
    "max_amount" INTEGER NOT NULL DEFAULT 0,
    "min_amount" INTEGER NOT NULL DEFAULT 0,
    "max_uses" INTEGER NOT NULL DEFAULT 0,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "discount_codes_code_key" ON "discount_codes"("code");
