-- مراقبتِ قبل از عمل، اختصاصیِ همین مراجعه (override قالبِ نوعِ عمل)
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "pre_op_care" TEXT;
