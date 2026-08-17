-- اتوماسیونِ پیگیریِ پس از عمل — نقشِ فرم در پیگیری + روزهای پیگیریِ نوعِ عمل
ALTER TABLE "form_defs" ADD COLUMN IF NOT EXISTS "follow_up" TEXT;
ALTER TABLE "form_defs" ADD COLUMN IF NOT EXISTS "procedure_type_id" INTEGER;
ALTER TABLE "form_defs" ADD COLUMN IF NOT EXISTS "diagnosis_id" INTEGER;
DO $$ BEGIN
  ALTER TABLE "form_defs" ADD CONSTRAINT "form_defs_procedure_type_id_fkey"
    FOREIGN KEY ("procedure_type_id") REFERENCES "procedure_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "form_defs" ADD CONSTRAINT "form_defs_diagnosis_id_fkey"
    FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "procedure_types" ADD COLUMN IF NOT EXISTS "follow_up_days" TEXT;

ALTER TABLE "intake_submissions" ADD COLUMN IF NOT EXISTS "extra_form_ids" INTEGER[] NOT NULL DEFAULT '{}';
