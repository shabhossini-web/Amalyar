-- اثرِ قلمِ فاکتور روی انبار — صریح‌سازیِ چیزی که تا حالا ضمنی بود.
ALTER TABLE "charges" ADD COLUMN "stock_effect" TEXT NOT NULL DEFAULT 'virtual';

-- عقب‌پرکردن: قلم‌هایی که واقعاً از انبار خارج شده‌اند نباید «مجازی» برچسب
-- بخورند. بدونِ این، اولین گزارشِ مغایرت کلِ سابقه را غلط نشان می‌دهد و
-- کاربر به گزارش بی‌اعتماد می‌شود — که بدتر از نداشتنِ گزارش است.
UPDATE "charges" c SET "stock_effect" = 'consumed'
WHERE EXISTS (
  SELECT 1 FROM "stock_movements" m
  WHERE m."charge_id" = c."id" AND m."kind" = 'out'
);

CREATE INDEX "charges_stock_effect_idx" ON "charges"("stock_effect");
