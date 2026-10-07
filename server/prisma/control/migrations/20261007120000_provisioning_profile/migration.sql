-- نوعِ نصبِ درخواستی (مطب/شرکتی) و بستهٔ خدمات روی کارِ ساختِ شرکت.
ALTER TABLE "provisioning_jobs" ADD COLUMN IF NOT EXISTS "profile_kind" TEXT;
ALTER TABLE "provisioning_jobs" ADD COLUMN IF NOT EXISTS "profile_services" TEXT;
