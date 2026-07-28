-- لایهٔ انبار: لات/سریال + دفترِ حرکت.
--
-- موجودی عمداً ستون ندارد؛ جمعِ stock_movements.quantity است. عددِ ذخیره‌شده در
-- کنارِ دفتر دیر یا زود از دفتر جدا می‌افتد و بعد معلوم نیست کدام درست است.

CREATE TABLE "stock_lots" (
    "id"         SERIAL       NOT NULL,
    "item_id"    INTEGER      NOT NULL,
    "lot_no"     TEXT,
    "serial_no"  TEXT,
    "expires_at" TIMESTAMP(3),
    "location"   TEXT,
    "notes"      TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_lots_serial_no_key" ON "stock_lots"("serial_no");
CREATE INDEX "stock_lots_item_id_idx"    ON "stock_lots"("item_id");
CREATE INDEX "stock_lots_lot_no_idx"     ON "stock_lots"("lot_no");
CREATE INDEX "stock_lots_expires_at_idx" ON "stock_lots"("expires_at");

-- RESTRICT: کالایی که لات دارد پاک نمی‌شود؛ سرویس آن را غیرفعال می‌کند.
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_movements" (
    "id"            SERIAL       NOT NULL,
    "lot_id"        INTEGER      NOT NULL,
    "kind"          TEXT         NOT NULL,
    "quantity"      INTEGER      NOT NULL,
    "visit_id"      INTEGER,
    "visit_code"    TEXT,
    "charge_id"     INTEGER,
    "reason"        TEXT,
    "reference"     TEXT,
    "created_by_id" INTEGER,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_movements_lot_id_idx"    ON "stock_movements"("lot_id");
CREATE INDEX "stock_movements_visit_id_idx"  ON "stock_movements"("visit_id");
CREATE INDEX "stock_movements_charge_id_idx" ON "stock_movements"("charge_id");

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL و نه CASCADE: اگر مراجعه پاک شود، سابقهٔ مصرفِ ایمپلنت باید بماند.
-- ردیابیِ فراخوان از روی visit_code (عکسِ لحظه‌ای) ادامه پیدا می‌کند.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_visit_id_fkey"
  FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
