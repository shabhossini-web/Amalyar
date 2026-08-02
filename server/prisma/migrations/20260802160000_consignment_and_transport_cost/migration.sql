-- داراییِ امانیِ مستقر + صورت‌برداریِ دوره‌ای + هزینهٔ حملِ مسیر

ALTER TABLE "stock_lots"
  ADD COLUMN IF NOT EXISTS "consigned_to_id"   INTEGER,
  ADD COLUMN IF NOT EXISTS "consigned_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "count_every_days"  INTEGER;

DO $$ BEGIN
  ALTER TABLE "stock_lots"
    ADD CONSTRAINT "stock_lots_consigned_to_id_fkey"
    FOREIGN KEY ("consigned_to_id") REFERENCES "hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "consignment_counts" (
  "id"            SERIAL       NOT NULL,
  "lot_id"        INTEGER      NOT NULL,
  "hospital_id"   INTEGER,
  "counted_at"    TIMESTAMP(3) NOT NULL,
  "notes"         TEXT,
  "counted_by_id" INTEGER,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consignment_counts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "consignment_counts_lot_id_counted_at_idx"
  ON "consignment_counts"("lot_id", "counted_at");

CREATE TABLE IF NOT EXISTS "consignment_count_lines" (
  "id"       SERIAL  NOT NULL,
  "count_id" INTEGER NOT NULL,
  "label"    TEXT    NOT NULL,
  "expected" INTEGER NOT NULL DEFAULT 0,
  "counted"  INTEGER NOT NULL DEFAULT 0,
  "used"     INTEGER NOT NULL DEFAULT 0,
  "notes"    TEXT,
  CONSTRAINT "consignment_count_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "consignment_count_lines_count_id_idx"
  ON "consignment_count_lines"("count_id");

DO $$ BEGIN
  ALTER TABLE "consignment_counts"
    ADD CONSTRAINT "consignment_counts_lot_id_fkey"
    FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "consignment_counts"
    ADD CONSTRAINT "consignment_counts_hospital_id_fkey"
    FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "consignment_count_lines"
    ADD CONSTRAINT "consignment_count_lines_count_id_fkey"
    FOREIGN KEY ("count_id") REFERENCES "consignment_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- هزینهٔ حمل روی مسیر؛ ردیفِ واقعیِ دفتر همان `expenses` است.
ALTER TABLE "transport_runs"
  ADD COLUMN IF NOT EXISTS "fuel_cost"  INTEGER,
  ADD COLUMN IF NOT EXISTS "driver_fee" INTEGER,
  ADD COLUMN IF NOT EXISTS "other_cost" INTEGER,
  ADD COLUMN IF NOT EXISTS "cost_note"  TEXT,
  ADD COLUMN IF NOT EXISTS "expense_id" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "transport_runs_expense_id_key"
  ON "transport_runs"("expense_id");

DO $$ BEGIN
  ALTER TABLE "transport_runs"
    ADD CONSTRAINT "transport_runs_expense_id_fkey"
    FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
