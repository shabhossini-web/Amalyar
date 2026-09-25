-- زیرفرمِ فرمِ عمل به‌تفکیکِ مرحله (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳، دور دوم).
--
-- «در عمل، فرمی که الصاق می‌شود باید معلوم باشد مالِ قبل، حین یا بعد از عمل است.» پس هر
-- ردیف مرحلهٔ خودش را دارد و یک زیرفرم در یک عمل در چند مرحله الصاق می‌شود (علائمِ حیاتیِ
-- قبل و بعد از عمل — تا دیروز دو کادرِ ثابت در تب‌ها).
--
-- ⚠️ ردیف‌های موجودِ عمل مرحلهٔ پیش‌فرضِ زیرفرمشان را می‌گیرند (`defaultSurgeryPhase` در
-- `subforms.ts`): «فرم پیگیریِ پس از عمل» → «بعد از عمل»، بقیه (ASA و زیرفرمِ ساختِ مدیر) → «قبل از
-- عمل». این بسته همان روز منتشر شده بود، پس ردیفِ کمی هست. مراجعهٔ غیرجراحی خالی می‌ماند.
--
-- ⚠️ اندازه‌های بی‌مرحلهٔ عمل (عملی که پیش از این بسته از «ویزیت» به «عمل» تغییرِ نوع داده شده)
-- «قبل از عمل» می‌شوند — کارتِ علائمِ هر تب فقط اندازه‌های همان مرحله را می‌بیند و اندازهٔ بی‌مرحله
-- در هیچ تبی دیده نمی‌شد (همان کاری که تغییرِ نوع از این به بعد خودش می‌کند).

ALTER TABLE "visit_subforms" ADD COLUMN "phase" TEXT NOT NULL DEFAULT '';

UPDATE "visit_subforms" AS s SET "phase" = CASE WHEN s."key" = 'subform.postop' THEN 'post' ELSE 'pre' END
  FROM "visits" AS v
 WHERE v."id" = s."visit_id" AND v."kind" = 'surgery';

UPDATE "vital_signs" AS vs SET "phase" = 'pre'
  FROM "visits" AS v
 WHERE v."id" = vs."visit_id" AND v."kind" = 'surgery' AND vs."phase" IS NULL;

DROP INDEX "visit_subforms_visit_id_key_key";
CREATE UNIQUE INDEX "visit_subforms_visit_id_key_phase_key" ON "visit_subforms"("visit_id", "key", "phase");
