-- چرخهٔ کاملِ حمل‌ونقل: الگوی اقلامِ نوعِ عمل، توقفِ بی‌مسیر،
-- تحویل‌گیرندهٔ واقعی، و اعلامِ پایان با ساعت و محل.

-- ① الگوی اقلام — «این نوعِ عمل چه می‌خواهد». نیاز است نه تعهد.
CREATE TABLE IF NOT EXISTS "procedure_type_items" (
    "id" SERIAL NOT NULL,
    "procedure_type_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "procedure_type_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "procedure_type_items_procedure_type_id_item_id_key"
    ON "procedure_type_items"("procedure_type_id", "item_id");
ALTER TABLE "procedure_type_items" DROP CONSTRAINT IF EXISTS "procedure_type_items_procedure_type_id_fkey";
ALTER TABLE "procedure_type_items" ADD CONSTRAINT "procedure_type_items_procedure_type_id_fkey"
    FOREIGN KEY ("procedure_type_id") REFERENCES "procedure_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "procedure_type_items" DROP CONSTRAINT IF EXISTS "procedure_type_items_item_id_fkey";
ALTER TABLE "procedure_type_items" ADD CONSTRAINT "procedure_type_items_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ② توقفِ بی‌مسیر: جمع‌آوری‌ای که کارشناس خواسته ولی هنوز راننده ندارد.
ALTER TABLE "transport_stops" ALTER COLUMN "run_id" DROP NOT NULL;

-- ③ تحویل‌گیرندهٔ واقعی، جدا از برنامه.
ALTER TABLE "transport_stops" ADD COLUMN IF NOT EXISTS "handed_actual" TEXT;

-- ④ اعلامِ پایانِ کارشناس: ساعتِ درخواستی و محلِ تحویل.
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "pickup_at" TEXT;
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "left_at" TEXT;
