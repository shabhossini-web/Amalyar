-- داراییِ برگشتی: ست و دستگاه برمی‌گردند و فردا دوباره می‌روند، پس سؤالشان
-- «چند تا داریم» نیست، «فردا آزاد است؟» است.
ALTER TABLE "items" ADD COLUMN "asset_kind" TEXT NOT NULL DEFAULT 'consumable';
ALTER TABLE "items" ADD COLUMN "turnaround_hours" INTEGER;

-- کالیبراسیون/سرویسِ بعدیِ دستگاه
ALTER TABLE "stock_lots" ADD COLUMN "next_service_at" TIMESTAMP(3);

-- روزی که حواله برای آن است — مبنای تقویمِ دارایی و تشخیصِ تعارض
ALTER TABLE "stock_transfers" ADD COLUMN "planned_for" TIMESTAMP(3);
-- حواله‌های موجود: روزِ عمل، وگرنه روزِ ارسال
UPDATE "stock_transfers" t
SET "planned_for" = COALESCE((SELECT v."op_date" FROM "visits" v WHERE v."id" = t."visit_id"), t."sent_at");

-- نیازِ استانداردِ هر بیمارستان
CREATE TABLE "hospital_items" (
    "id" SERIAL NOT NULL,
    "hospital_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospital_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hospital_items_hospital_id_item_id_key" ON "hospital_items"("hospital_id", "item_id");
CREATE INDEX "hospital_items_item_id_idx" ON "hospital_items"("item_id");

ALTER TABLE "hospital_items" ADD CONSTRAINT "hospital_items_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hospital_items" ADD CONSTRAINT "hospital_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
