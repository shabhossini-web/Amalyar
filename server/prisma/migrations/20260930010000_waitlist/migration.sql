-- بستهٔ ۹ب/ج — عملِ «هنوز تاریخ ندارد» (تاریخِ تقریبی) و بستنِ تصمیمِ جراحیِ بی‌عمل.
-- هر سه ستون اختیاری‌اند؛ هیچ ردیفِ موجودی عوض نمی‌شود.
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "planned_date" TIMESTAMP(3);
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "surgery_decision_closed_at" TIMESTAMP(3);
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "surgery_decision_close_reason" TEXT;

-- بستن فقط با دلیلِ معتبر، و دلیل فقط کنارِ زمانِ بستن — همان کلیدهای `DECISION_CLOSE_LABELS`.
DO $$ BEGIN
  ALTER TABLE "visits" ADD CONSTRAINT "visits_decision_close_chk" CHECK (
    ("surgery_decision_closed_at" IS NULL AND "surgery_decision_close_reason" IS NULL)
    OR ("surgery_decision_closed_at" IS NOT NULL
        AND "surgery_decision_close_reason" IN ('declined', 'elsewhere', 'not_indicated', 'deceased'))
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ماژولِ `waitlist`: ردیفِ features برای **هر** نصب، روشن فقط روی مطب.
-- ⚠️ `ensureSeeded` کلیدِ غایب را روشن می‌سازد — بی‌این سطر ماژولِ مطب روی نورومانیتورینگ و
-- ایمپلنت هم روشن می‌شد (`verticals.ts`: پلانِ حوزه روی نصبِ موجود خودبه‌خود اعمال نمی‌شود).
INSERT INTO "features" ("key", "min_level", "enabled")
VALUES ('waitlist', 2, EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'vertical' AND "value" = 'clinic'))
ON CONFLICT ("key") DO NOTHING;
