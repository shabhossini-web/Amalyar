-- «تأییدِ نهاییِ مصرفی»ِ هر بیمار (ب-۲)
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "usage_confirmed_at" TIMESTAMP(3);
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "usage_confirmed_by_id" INTEGER;
