-- سفرِ ست: محلِ حرکت روی دفتر + سندِ حواله.

ALTER TABLE "stock_movements" ADD COLUMN "location" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "transfer_id" INTEGER;

-- عقب‌پرکردن: حرکت‌های موجود در محلِ خانهٔ همان لات رخ داده‌اند. بدونِ این،
-- موجودیِ per-location برای کلِ سابقه زیرِ محلِ «نامعلوم» جمع می‌شود و اولین
-- گزارشِ «در دسترس» صفر نشان می‌دهد.
UPDATE "stock_movements" m
SET "location" = l."location"
FROM "stock_lots" l
WHERE m."lot_id" = l."id" AND m."location" IS NULL;

CREATE TABLE "stock_transfers" (
  "id"            SERIAL       NOT NULL,
  "code"          TEXT         NOT NULL,
  "from_location" TEXT         NOT NULL,
  "to_location"   TEXT         NOT NULL,
  "hospital_id"   INTEGER,
  "visit_id"      INTEGER,
  "status"        TEXT         NOT NULL DEFAULT 'sent',
  "sent_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received_at"   TIMESTAMP(3),
  "received_by"   TEXT,
  "notes"         TEXT,
  "created_by_id" INTEGER,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfers_code_key" ON "stock_transfers"("code");
CREATE INDEX "stock_transfers_status_idx"      ON "stock_transfers"("status");
CREATE INDEX "stock_transfers_visit_id_idx"    ON "stock_transfers"("visit_id");
CREATE INDEX "stock_transfers_hospital_id_idx" ON "stock_transfers"("hospital_id");

CREATE INDEX "stock_movements_transfer_id_idx"    ON "stock_movements"("transfer_id");
CREATE INDEX "stock_movements_lot_id_location_idx" ON "stock_movements"("lot_id", "location");

ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_hospital_id_fkey"
  FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_visit_id_fkey"
  FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_id_fkey"
  FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
