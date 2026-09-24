-- بستهٔ ۹ب/ج — عملِ بی‌تاریخ (برنامه‌ریزی) و «فهرستِ انتظارِ عمل».
--
-- ۱. `visits.planned_date` — «تاریخِ تقریبی» جدا از `op_date`. عمداً ستونِ جدا: هر
--    مصرف‌کننده‌ای (یادآوری، اتاقِ عمل، تقویم، امروز، چینش، کشفِ «عملِ تأییدنشده»)
--    «op_date دارد و لغو نشده» را عملِ رزروشده می‌خواند؛ تاریخِ تقریبی آن‌جا
--    پیامکِ قبل از عمل برای روزی می‌فرستاد که هنوز قطعی نیست.
-- ۲. بستنِ تصمیمِ جراحی بی‌عمل (بیمار نخواست، جای دیگر عمل کرد، …) — بی‌آن ردیفِ
--    «منتظرِ برنامه» تا ابد در فهرست می‌ماند.
-- ۳. ماژولِ `waitlist`: ردیفِ features برای **هر** نصب، روشن فقط روی مطب.
--    ⚠️ `ensureSeeded` کلیدِ غایب را با `enabled = true` می‌سازد — بی‌این سطر
--    ماژولِ مطب روی نورومانیتورینگ و ایمپلنت هم روشن می‌شد.

ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "planned_date" DATE;
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "surgery_decision_closed_at" TIMESTAMP(3);
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "surgery_decision_close_reason" TEXT;

DO $$ BEGIN
  ALTER TABLE "visits" ADD CONSTRAINT "visits_decision_close_chk" CHECK (
    ("surgery_decision_closed_at" IS NULL AND "surgery_decision_close_reason" IS NULL)
    OR ("surgery_decision_closed_at" IS NOT NULL
        AND "surgery_decision_close_reason" IN ('declined','elsewhere','not_indicated','deceased'))
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO "features" ("key", "min_level", "enabled")
VALUES ('waitlist', 2, EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'vertical' AND "value" = 'clinic'))
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "permissions" ("key", "min_level")
VALUES ('waitlist.read', 2), ('waitlist.manage', 2)
ON CONFLICT ("key") DO NOTHING;
