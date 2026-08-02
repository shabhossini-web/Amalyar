-- رسیدِ تحویل: سندِ عملیاتی، نه مدرکِ بالینیِ بیمار. بیشترین اختلاف با
-- بیمارستان («ما تحویل نگرفتیم» / «ست ناقص بود») همین‌جاست.
CREATE TABLE "stop_proofs" (
    "id" SERIAL NOT NULL,
    "stop_id" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "caption" TEXT,
    "uploaded_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stop_proofs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stop_proofs_stop_id_idx" ON "stop_proofs"("stop_id");
ALTER TABLE "stop_proofs" ADD CONSTRAINT "stop_proofs_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "transport_stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- محتویاتِ ست: بدونِ این، ستی که با ۲۰ قلم رفت و با ۱۹ برگشت در دفتر همان
-- «۱ ست» است و نشتی دیده نمی‌شود.
CREATE TABLE "item_components" (
    "id" SERIAL NOT NULL,
    "set_id" INTEGER NOT NULL,
    "part_id" INTEGER,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,

    CONSTRAINT "item_components_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "item_components_set_id_idx" ON "item_components"("set_id");
ALTER TABLE "item_components" ADD CONSTRAINT "item_components_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_components" ADD CONSTRAINT "item_components_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- فقط کسری ثبت می‌شود، نه کلِ شمارش: ثبتِ ۲۰ ردیفِ «سالم» یعنی هیچ‌کس این
-- کار را نمی‌کند و کسری هم ثبت نمی‌شود.
CREATE TABLE "set_shortages" (
    "id" SERIAL NOT NULL,
    "transfer_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "missing" INTEGER NOT NULL DEFAULT 1,
    "kind" TEXT NOT NULL DEFAULT 'missing',
    "notes" TEXT,
    "reported_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "set_shortages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "set_shortages_transfer_id_idx" ON "set_shortages"("transfer_id");
ALTER TABLE "set_shortages" ADD CONSTRAINT "set_shortages_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "set_shortages" ADD CONSTRAINT "set_shortages_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
