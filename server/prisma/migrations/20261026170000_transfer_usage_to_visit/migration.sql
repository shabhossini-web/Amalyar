-- مصرفِ ثبت‌شده از «برگهٔ حواله» (پیش از ۱۴۰۵/۰۸/۰۴) روی پروندهٔ بیمارِ همان حواله می‌نشیند (تصمیمِ مالک: «تک‌بیمار منتقل،
-- بقیه فقط نمایش»). فقط حوالهٔ تک‌بیمار (`shared = false`) و فقط قلم‌هایی که خودِ حواله فرستاده (نه قطعاتِ داخلِ ست، که ردیفِ
-- `set:…` دارند). ردیفِ موجودِ بیمار دست نمی‌خورد. حرکتِ انبار تازه‌ای ساخته نمی‌شود — همان حرکت‌های قبلی با `visit_id`ِ همان بیمارند.
INSERT INTO "visit_usages" ("visit_id", "item_id", "source", "transfer_id", "mode", "quantity", "key", "created_at", "updated_at")
SELECT m."visit_id", l."item_id", 'transfer', m."transfer_id", 'consume', -SUM(m."quantity"),
       'transfer:' || m."lot_id" || ':' || l."item_id", now(), now()
FROM "stock_movements" m
JOIN "stock_lots" l ON l."id" = m."lot_id"
JOIN "stock_transfers" t ON t."id" = m."transfer_id"
WHERE m."kind" IN ('out', 'return')
  AND m."visit_id" IS NOT NULL
  AND t."shared" = false
  AND EXISTS (SELECT 1 FROM "stock_movements" s
              WHERE s."transfer_id" = m."transfer_id" AND s."lot_id" = m."lot_id" AND s."kind" = 'transfer' AND s."quantity" > 0)
GROUP BY m."visit_id", m."transfer_id", m."lot_id", l."item_id"
HAVING -SUM(m."quantity") > 0
ON CONFLICT ("visit_id", "key") DO NOTHING;
