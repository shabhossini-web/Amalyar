-- «اصلاحاتِ شرکتی» (مالک، ۱۴۰۵/۰۷/۰۱) — سه بدهیِ آخر: خدمتِ فرم، خدمتِ مراجعه، دستهٔ مدرکِ «دستورِ پزشک».
--
-- هر سه افزایشی‌اند: دو ستونِ nullable و چند UPDATEِ یک‌باره روی داده‌ای که معنایش قطعی است.
-- هیچ ردیفی با حدس پر نمی‌شود — خدمتِ مراجعه فقط از فرمِ ثبت‌نامی که آن را ساخت، نه از بستهٔ
-- خدماتِ امروزِ شرکت (که ممکن است از روزِ ساختِ مراجعه عوض شده باشد).

ALTER TABLE "form_defs" ADD COLUMN "service" TEXT;
ALTER TABLE "visits" ADD COLUMN "service" TEXT;

-- ۱) فرم‌های پیش‌فرضِ ثبت‌نامِ هر خدمت — همان چیزی که کلیدشان می‌گفت.
UPDATE "form_defs" SET "service" = substring("key" from 8)
WHERE "key" IN ('intake.ionm', 'intake.implant') AND "service" IS NULL;

-- ۲) مراجعه‌هایی که از ثبت‌نامِ همین فرم‌ها ساخته شدند.
UPDATE "visits" AS v SET "service" = substring(f."key" from 8)
FROM "intake_submissions" AS s
JOIN "form_defs" AS f ON f."id" = s."form_id"
WHERE s."visit_id" = v."id" AND f."key" IN ('intake.ionm', 'intake.implant') AND v."service" IS NULL;

-- ۳) کادرِ «تصویر دستور پزشک»ِ فرم‌های نصب‌شده مدرکِ دستهٔ خودش را بسازد، نه «متفرقه».
UPDATE "form_fields" SET "doc_category" = 'prescription'
WHERE "key" = 'prescription' AND "type" = 'image' AND "doc_category" IS NULL
  AND "form_id" IN (SELECT "id" FROM "form_defs" WHERE "key" IN ('intake.ionm', 'intake.implant'));

-- ۴) مدارکی که پیش از این از همان کادر آمده‌اند — هم آن‌هایی که در پاسخِ فرم‌اند و هم آن‌هایی
--    که برگشت برای اصلاح کنار گذاشته (`_returns`). فقط «متفرقه»ها: دستهٔ دستی‌اصلاح‌شده دست نمی‌خورد.
--    مقایسه به‌صورتِ متن، تا شناسهٔ خرابِ داخلِ JSON به‌جای ردشدن مهاجرت را نشکند.
UPDATE "documents" SET "category" = 'prescription'
WHERE "category" = 'other' AND "id"::text IN (
  SELECT jsonb_path_query(s."data", 'lax $.prescription[*].id') #>> '{}' FROM "intake_submissions" AS s
  UNION
  SELECT jsonb_path_query(s."data", 'lax $._returns[*].images.prescription[*].id') #>> '{}' FROM "intake_submissions" AS s
);
