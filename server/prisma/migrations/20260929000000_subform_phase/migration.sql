-- زیرفرمِ فرمِ عمل به‌تفکیکِ مرحله (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳، دور دوم).
--
-- «در عمل، فرمی که الصاق می‌شود باید معلوم باشد مالِ قبل، حین یا بعد از عمل است.» پس هر
-- ردیف مرحلهٔ خودش را دارد و یک زیرفرم در یک عمل در چند مرحله الصاق می‌شود (علائمِ حیاتیِ
-- قبل و بعد از عمل — تا دیروز دو کادرِ ثابت در تب‌ها).
--
-- ⚠️ ردیف‌های موجودِ عمل «قبل از عمل» می‌شوند: تنها زیرفرم‌های آمادهٔ جراحی (ASA، پیگیری)
-- ارزیابیِ پیش از عمل‌اند و این بسته همان روز منتشر شده بود. مراجعهٔ غیرجراحی خالی می‌ماند.

ALTER TABLE "visit_subforms" ADD COLUMN "phase" TEXT NOT NULL DEFAULT '';

UPDATE "visit_subforms" AS s SET "phase" = 'pre'
  FROM "visits" AS v
 WHERE v."id" = s."visit_id" AND v."kind" = 'surgery';

DROP INDEX "visit_subforms_visit_id_key_key";
CREATE UNIQUE INDEX "visit_subforms_visit_id_key_phase_key" ON "visit_subforms"("visit_id", "key", "phase");
