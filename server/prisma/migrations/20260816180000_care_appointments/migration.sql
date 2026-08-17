-- قالبِ مراقبتِ قبل/بعدِ عمل به تفکیکِ نوعِ عمل + اتصالِ یادآوری به نوبت
ALTER TABLE "procedure_types" ADD COLUMN IF NOT EXISTS "pre_op_care" TEXT;
ALTER TABLE "procedure_types" ADD COLUMN IF NOT EXISTS "post_op_care" TEXT;
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "appointment_id" INTEGER;
CREATE INDEX IF NOT EXISTS "reminders_appointment_id_idx" ON "reminders"("appointment_id");
