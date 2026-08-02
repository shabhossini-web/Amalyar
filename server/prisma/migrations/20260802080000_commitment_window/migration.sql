-- تعارضِ دارایی «همان روز» نبود، **هم‌پوشانیِ بازه** است: یک دستگاه در یک روز
-- بینِ چند بیمارستان می‌چرخد — صبح لقمان، بعدازظهر میلاد.
ALTER TABLE "stock_transfers" ADD COLUMN "window_from" TIMESTAMP(3);
ALTER TABLE "stock_transfers" ADD COLUMN "window_to" TIMESTAMP(3);

-- اعلامِ پایانیِ کارشناسِ سرِ عمل: هم بازه را می‌بندد هم صفِ جمع‌آوری را می‌سازد.
ALTER TABLE "stock_transfers" ADD COLUMN "released_at" TIMESTAMP(3);
ALTER TABLE "stock_transfers" ADD COLUMN "released_by_id" INTEGER;
ALTER TABLE "stock_transfers" ADD COLUMN "release_note" TEXT;

-- حواله‌های موجود: شروعِ بازه از روزِ تعهد
UPDATE "stock_transfers" SET "window_from" = COALESCE("planned_for", "sent_at") WHERE "window_from" IS NULL;
