-- ارسالِ فوریِ مراقبتِ قبل از عمل، **علاوه بر** زمان‌بندیِ مقرر
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "pre_op_immediate" BOOLEAN NOT NULL DEFAULT FALSE;
