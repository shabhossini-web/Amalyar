-- پیوستگیِ ویزیتِ پست‌آپِ خودکار (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳).
--
-- `syncPostOpVisit` تا امروز فرزندِ پست‌آپ را بی‌پزشک و بی‌مرکز می‌ساخت: کادرِ «پزشک»
-- خالی بود و پزشکی که سطحش زیرِ سوپروایزر است ویزیتِ پست‌آپِ بیمارِ خودش را اصلاً
-- نمی‌دید (دیدِ او با `surgeon_id` است). کد حالا هنگامِ ساخت پر می‌کند؛ این‌جا فقط
-- ردیف‌های قبلی، و فقط جای **خالی** — انتخابِ دستی دست نمی‌خورد. تکرارپذیر.
--
-- پزشک = جراحِ همان عمل؛ مرکز = مرکزِ ویزیتی که تصمیمِ عمل در آن گرفته شد (مطب)، نه
-- بیمارستانِ عمل. شکایتِ اولیه کپی **نمی‌شود**؛ از همان زنجیره مشتق است (قانونِ ۱۵).

UPDATE "visits" AS c
SET "surgeon_id" = p."surgeon_id"
FROM "visits" AS p
WHERE c."follow_of_visit_id" = p."id"
  AND c."surgeon_id" IS NULL
  AND p."surgeon_id" IS NOT NULL;

UPDATE "visits" AS c
SET "hospital_id" = d."hospital_id"
FROM "visits" AS p
JOIN "visits" AS d ON d."id" = p."decided_in_visit_id"
WHERE c."follow_of_visit_id" = p."id"
  AND c."hospital_id" IS NULL
  AND d."hospital_id" IS NOT NULL;
