-- بستهٔ ۹الف — موضوعِ ویزیت: کلیدِ پایدار + «فرم‌های خودکار».
--
-- ⚠️ کلیدِ پایدار به‌جای نام: `syncPostOpVisit` موضوعِ پست‌آپ را با `name LIKE '%پست‌آپ%'` پیدا
-- می‌کرد، پس مطبی که نامش را عوض می‌کرد ویزیتِ پست‌آپِ خودکارش بی‌موضوع ساخته می‌شد.
-- ⚠️ idempotent: هر گام دوباره اجراشدنی است و موضوعِ دست‌سازِ مشتری کلید نمی‌گیرد.
ALTER TABLE "visit_topics" ADD COLUMN IF NOT EXISTS "system_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "visit_topics_system_key_key" ON "visit_topics"("system_key");
ALTER TABLE "visit_topics" ADD COLUMN IF NOT EXISTS "default_subforms" TEXT[] NOT NULL DEFAULT '{}';

-- چهار موضوعِ استانداردِ `20260820190000_visit_decisions` — اول با نامِ دقیق.
UPDATE "visit_topics" SET "system_key" = 'initial'
  WHERE "name" = 'ویزیتِ اولیه' AND "system_key" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "visit_topics" WHERE "system_key" = 'initial');
UPDATE "visit_topics" SET "system_key" = 'preop'
  WHERE "name" = 'ویزیتِ قبل از عمل (پره‌آپ)' AND "system_key" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "visit_topics" WHERE "system_key" = 'preop');
UPDATE "visit_topics" SET "system_key" = 'postop'
  WHERE "name" = 'ویزیتِ بعد از عمل (پست‌آپ)' AND "system_key" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "visit_topics" WHERE "system_key" = 'postop');
UPDATE "visit_topics" SET "system_key" = 'followup'
  WHERE "name" = 'پیگیریِ درمان' AND "system_key" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "visit_topics" WHERE "system_key" = 'followup');

-- نامِ عوض‌شده: همان قاعدهٔ دیروزِ کد (نخستین موضوعی که «پره‌آپ»/«پست‌آپ» در نامش دارد) —
-- پس رفتارِ هیچ نصبی عوض نمی‌شود، فقط از این به بعد به نام وابسته نیست.
UPDATE "visit_topics" SET "system_key" = 'preop'
  WHERE "id" = (SELECT MIN("id") FROM "visit_topics" WHERE "name" LIKE '%پره‌آپ%' AND "system_key" IS NULL)
    AND NOT EXISTS (SELECT 1 FROM "visit_topics" WHERE "system_key" = 'preop');
UPDATE "visit_topics" SET "system_key" = 'postop'
  WHERE "id" = (SELECT MIN("id") FROM "visit_topics" WHERE "name" LIKE '%پست‌آپ%' AND "system_key" IS NULL)
    AND NOT EXISTS (SELECT 1 FROM "visit_topics" WHERE "system_key" = 'postop');
