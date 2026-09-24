-- بستهٔ ۹الف — کلیدِ پایدارِ موضوعِ ویزیت + فرمِ تکمیلیِ هر موضوع (بندِ «ه» گزارشِ HIS).
--
-- ۱. `visit_topics.system`: خودکارسازی‌ها (موضوعِ «پره‌آپ» با تصمیمِ جراحی، ویزیتِ
--    «پست‌آپ»ِ خودکار) تا امروز با **زیررشتهٔ نام** پیدا می‌شدند؛ مدیری که نام را
--    عوض می‌کرد هر دو را بی‌صدا خاموش می‌کرد. backfill فقط با نامِ **دقیقِ** seed
--    (همان بایت‌ها، با نیم‌فاصله)؛ نامِ دست‌خورده کلید نمی‌گیرد و کد به نام برمی‌گردد.
-- ۲. `visit_topics.form_id`: فرمِ زیرپرونده‌ای که با انتخابِ این موضوع داخلِ فرمِ
--    مراجعه پر می‌شود. Restrict (پیشینهٔ `intake_links.form_id`): حذفِ فرمِ در
--    استفاده خطای خامِ DB نمی‌دهد چون `formUsage` این ارجاع را می‌شمارد.
-- ۳. `visit_supplements`: پاسخ‌های همان فرم به‌ازای هر مراجعه — نه `Visit.extra`
--    (فضای نامِ مشترک با فیلدهای فرمِ نوع) و نه `intake_submissions.visit_id`
--    (یکتا، و ردیفِ بازِ آن در پرتالِ بیمار و صفِ پذیرش دیده می‌شد).

ALTER TABLE "visit_topics" ADD COLUMN IF NOT EXISTS "system" TEXT;
ALTER TABLE "visit_topics" ADD COLUMN IF NOT EXISTS "form_id" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "visit_topics_system_key" ON "visit_topics"("system");

DO $$ BEGIN
  ALTER TABLE "visit_topics" ADD CONSTRAINT "visit_topics_system_chk"
    CHECK ("system" IS NULL OR "system" IN ('initial','preop','postop','treatment'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "visit_topics" ADD CONSTRAINT "visit_topics_form_id_fkey"
    FOREIGN KEY ("form_id") REFERENCES "form_defs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE "visit_topics" SET "system" = 'initial'
WHERE "name" = 'ویزیتِ اولیه' AND "system" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "visit_topics" WHERE "system" = 'initial');
UPDATE "visit_topics" SET "system" = 'preop'
WHERE "name" = 'ویزیتِ قبل از عمل (پره‌آپ)' AND "system" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "visit_topics" WHERE "system" = 'preop');
UPDATE "visit_topics" SET "system" = 'postop'
WHERE "name" = 'ویزیتِ بعد از عمل (پست‌آپ)' AND "system" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "visit_topics" WHERE "system" = 'postop');
UPDATE "visit_topics" SET "system" = 'treatment'
WHERE "name" = 'پیگیریِ درمان' AND "system" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "visit_topics" WHERE "system" = 'treatment');

CREATE TABLE IF NOT EXISTS "visit_supplements" (
  "id" SERIAL NOT NULL,
  "visit_id" INTEGER NOT NULL,
  "form_id" INTEGER NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "visit_supplements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "visit_supplements_visit_id_form_id_key" ON "visit_supplements"("visit_id", "form_id");
CREATE INDEX IF NOT EXISTS "visit_supplements_form_id_idx" ON "visit_supplements"("form_id");

DO $$ BEGIN
  ALTER TABLE "visit_supplements" ADD CONSTRAINT "visit_supplements_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "visit_supplements" ADD CONSTRAINT "visit_supplements_form_id_fkey"
    FOREIGN KEY ("form_id") REFERENCES "form_defs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
