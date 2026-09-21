-- چک‌لیستِ ایمنیِ اتاقِ عمل — یک سطر به‌ازای هر بندِ تیک‌خورده.
--
-- ⚠️ سطرِ «تیک‌نخورده» وجود ندارد: برداشتنِ تیک سطر را حذف می‌کند. نبودِ سند
-- با سندی که می‌گوید «انجام نشد» یکی نیست، و در یک برگهٔ ایمنی این تفاوت مهم است.
CREATE TABLE "safety_checks" (
    "id" SERIAL NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "checked_by_id" INTEGER,
    "checked_by_name" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_checks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "safety_checks_visit_id_stage_key_key" ON "safety_checks"("visit_id", "stage", "key");
CREATE INDEX "safety_checks_visit_id_idx" ON "safety_checks"("visit_id");

ALTER TABLE "safety_checks" ADD CONSTRAINT "safety_checks_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ماژولِ «اتاقِ عمل» برای نصب‌های موجود.
--
-- ⚠️ بدونِ این سطر، ماژول فقط روی نصبی روشن می‌شود که **بعد از این** حوزه‌اش را
-- عوض کند: تنها مصرف‌کنندهٔ پلانِ `verticals.ts` همان `setVertical` است و
-- `ensureSeeded` مقدارِ `enabled` را دست نمی‌زند (هشدارِ خودِ `verticals.ts`).
-- سطحِ ۲ (کارشناس) چون کسی که در اتاقِ عمل ایستاده پایین‌ترین سطحِ کاری است.
INSERT INTO "features" ("key", "min_level", "enabled")
VALUES ('theatre', 2, true)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "permissions" ("key", "min_level")
VALUES ('theatre.read', 2), ('theatre.checklist', 2)
ON CONFLICT ("key") DO NOTHING;
