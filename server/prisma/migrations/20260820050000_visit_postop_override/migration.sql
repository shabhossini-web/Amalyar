-- پیگیریِ اختصاصیِ هر عمل: متنِ مراقبت و روزهای پیگیری روی خودِ مراجعه (idempotent)
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "post_op_care" TEXT;
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "follow_up_days" TEXT;
