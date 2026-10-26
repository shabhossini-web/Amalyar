-- فرمِ خدمتِ شرکتی: تیمِ کارشناسی با ساعتِ ورود/خروج + دستگاهِ سرِ خدمت.
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "device_lot_id" INTEGER;
ALTER TABLE "visits" ADD CONSTRAINT "visits_device_lot_id_fkey" FOREIGN KEY ("device_lot_id") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "visits_device_lot_id_idx" ON "visits"("device_lot_id");

CREATE TABLE "visit_crew" (
    "id" SERIAL NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "from_time" TEXT,
    "to_time" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visit_crew_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "visit_crew_visit_id_account_id_key" ON "visit_crew"("visit_id", "account_id");
CREATE INDEX "visit_crew_account_id_idx" ON "visit_crew"("account_id");
ALTER TABLE "visit_crew" ADD CONSTRAINT "visit_crew_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_crew" ADD CONSTRAINT "visit_crew_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- کارشناسِ تکیِ مراجعه‌های موجود، اولین عضوِ تیمِ همان مراجعه می‌شود (ساعتِ کلِ عمل همان ساعتِ او).
INSERT INTO "visit_crew" ("visit_id", "account_id", "from_time", "to_time", "sort")
SELECT "id", "tech_id", "op_start_time", "op_end_time", 0 FROM "visits" WHERE "tech_id" IS NOT NULL
ON CONFLICT DO NOTHING;
