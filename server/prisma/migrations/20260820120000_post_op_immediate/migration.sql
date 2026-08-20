-- ارسالِ «بلافاصله بعد از ثبت» برای پیامکِ مراقبتِ پس از عمل (به‌جای فردای عمل)
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "post_op_immediate" BOOLEAN NOT NULL DEFAULT FALSE;
