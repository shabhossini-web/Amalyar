-- کاتالوگِ کالا (ست، پیچ، ایمپلنت، مصرفی).
-- ⚠️ کاتالوگ است نه انبار؛ موجودی و لات لایهٔ بعدی و جدولِ جداست.
CREATE TABLE "items" (
  "id"         SERIAL       NOT NULL,
  "name"       TEXT         NOT NULL,
  "sku"        TEXT,
  "irc"        TEXT,
  "brand"      TEXT,
  "size"       TEXT,
  "category"   TEXT,
  "unit"       TEXT         NOT NULL DEFAULT 'عدد',
  "price"      INTEGER,
  "notes"      TEXT,
  "active"     BOOLEAN      NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "items_sku_key"    ON "items"("sku");
CREATE INDEX        "items_name_idx"     ON "items"("name");
CREATE INDEX        "items_category_idx" ON "items"("category");

-- قلمِ کالا روی فاکتور به کاتالوگ اشاره می‌کند، ولی نام و مبلغش را خودش دارد
-- (عکسِ لحظهٔ صدور) تا تغییرِ بعدیِ قیمت فاکتورِ قدیمی را عوض نکند.
ALTER TABLE "charges" ADD COLUMN "item_id" INTEGER;
ALTER TABLE "charges"
  ADD CONSTRAINT "charges_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "charges_item_id_idx" ON "charges"("item_id");
