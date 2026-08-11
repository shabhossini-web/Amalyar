-- لینکِ ثبت‌نام به فرم و به حسابِ بانکی وصل می‌شود، و حساب شمارهٔ حساب پیدا می‌کند.
--
-- ⚠️ هر سه ستون nullable است و هیچ داده‌ای بازنویسی نمی‌شود: لینک‌های موجود با
-- `form_id = NULL` همان مسیرِ امروز را می‌روند و با `bank_account_id = NULL`
-- همان فهرستِ سراسریِ `show_on_intake` را نشان می‌دهند. اگر یکی از این دو
-- fallback نبود، این مهاجرت روی نصبِ زنده «هیچ فرمی» و «هیچ شماره‌ای» می‌ساخت.

ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "account_number" TEXT;

ALTER TABLE "intake_links" ADD COLUMN IF NOT EXISTS "form_id" INTEGER;
ALTER TABLE "intake_links" ADD COLUMN IF NOT EXISTS "bank_account_id" INTEGER;

ALTER TABLE "intake_submissions" ADD COLUMN IF NOT EXISTS "form_id" INTEGER;

-- ⚠️ `RESTRICT` روی لینک و `SET NULL` روی ثبت‌نام، و این تفاوت عمدی است:
-- حذفِ فرمی که یک لینکِ **زنده** می‌فرستدش باید جلویش گرفته شود (وگرنه لینک
-- بی‌صدا به مسیرِ هاردکد برمی‌گردد)، ولی ثبت‌نامِ **گذشته** یک سندِ تاریخی است
-- و پاسخ‌هایش در `data` نشسته — نباید جلوی پاک‌سازیِ یک فرمِ متروک را بگیرد.
DO $$ BEGIN
  ALTER TABLE "intake_links"
    ADD CONSTRAINT "intake_links_form_id_fkey" FOREIGN KEY ("form_id")
    REFERENCES "form_defs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "intake_links"
    ADD CONSTRAINT "intake_links_bank_account_id_fkey" FOREIGN KEY ("bank_account_id")
    REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "intake_submissions"
    ADD CONSTRAINT "intake_submissions_form_id_fkey" FOREIGN KEY ("form_id")
    REFERENCES "form_defs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "intake_links_form_id_idx" ON "intake_links"("form_id");
CREATE INDEX IF NOT EXISTS "intake_links_bank_account_id_idx" ON "intake_links"("bank_account_id");
