-- بستهٔ ج (مالک، ۱۴۰۵/۰۷/۱۱): ثبتِ مصرفیِ کارشناس + شمارشِ راننده هنگامِ جمع‌آوری.
--
-- شمارشِ راننده فقط هنگامِ تحویل‌گرفتن از کارشناس است (ستِ استریلِ هنگامِ تحویل شمرده نمی‌شود).
-- کسری‌اش ردیفِ `set_shortages` با `stage = 'pickup'` می‌شود؛ این ستون‌ها امضای راننده‌اند.
ALTER TABLE "stock_transfers"
  ADD COLUMN "driver_counted_at" TIMESTAMP(3),
  ADD COLUMN "driver_counted_by_id" INTEGER,
  ADD COLUMN "driver_count_issue" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "driver_seal_intact" BOOLEAN,
  ADD COLUMN "driver_count_note" TEXT;

-- «این عمل از این کالا چقدر» — یک‌بارمصرف از موجودی کم می‌شود (حرکتِ out هم دارد)، چندبارمصرف
-- فقط شمرده می‌شود. کلید = منبع:لنگر:کالا تا یک کالا هم از ست و هم از انبار ثبت‌شدنی باشد.
CREATE TABLE "visit_usages" (
  "id" SERIAL NOT NULL,
  "visit_id" INTEGER NOT NULL,
  "item_id" INTEGER NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'warehouse',
  "set_lot_id" INTEGER,
  "transfer_id" INTEGER,
  "mode" TEXT NOT NULL DEFAULT 'consume',
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "key" TEXT NOT NULL,
  "recorded_by_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visit_usages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "visit_usages_visit_id_key_key" ON "visit_usages"("visit_id", "key");
CREATE INDEX "visit_usages_item_id_idx" ON "visit_usages"("item_id");
ALTER TABLE "visit_usages" ADD CONSTRAINT "visit_usages_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_usages" ADD CONSTRAINT "visit_usages_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
