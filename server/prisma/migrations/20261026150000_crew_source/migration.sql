-- تیمِ پرونده تنها منبعِ «چه کسی سرِ عمل است»: هر عضو می‌گوید از کجا آمده (فرم/چینش/پذیرش/تحویل)
-- و در تحویل، از چه کسی گرفته.
ALTER TABLE "visit_crew" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'form';
ALTER TABLE "visit_crew" ADD COLUMN "handed_from_id" INTEGER;

-- ردیف‌هایی که مهاجرتِ قبلی از `tech_id` ساخت «قدیمی»اند، نه «فرم».
UPDATE "visit_crew" SET "source" = 'legacy';

-- مراجعه‌هایی که کارشناس دارند ولی هنوز ردیفِ تیم ندارند (انتسابِ چینش/پذیرش پس از مهاجرتِ قبلی).
INSERT INTO "visit_crew" ("visit_id", "account_id", "from_time", "to_time", "sort", "source")
SELECT v."id", v."tech_id", NULL, NULL, 0, 'legacy'
FROM "visits" v
WHERE v."tech_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "visit_crew" c WHERE c."visit_id" = v."id");
