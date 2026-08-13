-- موضوعِ ویزیت — ویزیتِ اولیه / پست‌آپ / زیبایی / …
--
-- ⚠️ عمداً جدا از `visits.kind`: آن یکی تعیین می‌کند کدام فرم رندر شود،
-- این یکی یک دسته‌بندی داخلِ همان فرم است. مرحلهٔ ۱ از `docs/BOOKING.md`.
CREATE TABLE IF NOT EXISTS "visit_topics" (
    "id"         SERIAL       NOT NULL,
    "name"       TEXT         NOT NULL,
    "color"      TEXT,
    "notes"      TEXT,
    "active"     BOOLEAN      NOT NULL DEFAULT true,
    "sort"       INTEGER      NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_topics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "visit_topics_name_key" ON "visit_topics"("name");

ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "topic_id" INTEGER;

-- SET NULL: حذفِ یک موضوع نباید مراجعهٔ ثبت‌شده را ببرد.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visits_topic_id_fkey') THEN
    ALTER TABLE "visits"
      ADD CONSTRAINT "visits_topic_id_fkey"
      FOREIGN KEY ("topic_id") REFERENCES "visit_topics"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
