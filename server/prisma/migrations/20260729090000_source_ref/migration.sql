-- ردِ منبع برای دادهٔ وارد‌شده از سامانهٔ قبلی («malekteb:patients:۴۲»).
-- بدونِ آن، وارد کردنِ دوباره ردیفِ تکراری می‌سازد و نمی‌شود ایمپورت را آزمود.

ALTER TABLE "patients" ADD COLUMN "source_ref" TEXT;
ALTER TABLE "visits"   ADD COLUMN "source_ref" TEXT;
CREATE INDEX "patients_source_ref_idx" ON "patients"("source_ref");
CREATE INDEX "visits_source_ref_idx"   ON "visits"("source_ref");
