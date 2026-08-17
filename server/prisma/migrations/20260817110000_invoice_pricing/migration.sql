-- مدلِ قیمت‌گذاریِ فاکتور: coded (جمعِ اقلام) | global (مبلغِ کلِ توافقی)
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "pricing_model" TEXT NOT NULL DEFAULT 'coded';
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "global_amount" INTEGER;
