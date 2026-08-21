-- ویزیتِ پست‌آپِ خودکار: مراجعهٔ مستقلی که از «اولین مراجعهٔ بعد از عمل» ساخته می‌شود
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "follow_of_visit_id" INTEGER;
CREATE INDEX IF NOT EXISTS "visits_follow_of_visit_id_idx" ON "visits"("follow_of_visit_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visits_follow_of_visit_id_fkey') THEN
    ALTER TABLE "visits" ADD CONSTRAINT "visits_follow_of_visit_id_fkey"
      FOREIGN KEY ("follow_of_visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
