-- بستهٔ ۸ — شرحِ عملِ ساخت‌یافته و سمتِ هر عمل (بندِ «د» گزارشِ HIS).
--
-- دو جدولِ تازه، هیچ ستونی از جدول‌های قبلی عوض نمی‌شود:
--  • visit_op_details: یک ردیف برای هر عمل — ASA، رضایت، ناشتایی، ضدانعقاد، تیم،
--    خون‌ریزی، نمونه، درن، ایمپلنت، عارضه (Clavien–Dindo). null = «ثبت نشده».
--  • visit_procedure_details: سمت و سطحِ هر عمل، کلید (مراجعه، نوعِ عمل) نه رتبه.
--
-- ⚠️ قیدهای CHECK فقط در همین SQL‌اند (Prisma نمی‌بیند). نویسندهٔ سرور همین
-- قواعد را پیش از نوشتن می‌سنجد و پیامِ فارسی می‌دهد؛ این‌ها پشتیبانِ آخرند —
-- اگر روزی نویسندهٔ دومی قاعده را جا انداخت، داده خراب نمی‌نشیند.

CREATE TABLE IF NOT EXISTS "visit_op_details" (
  "visit_id" INTEGER NOT NULL,
  "asa_class" TEXT,
  "asa_emergency" BOOLEAN,
  "consent_signed" BOOLEAN,
  "npo_confirmed" BOOLEAN,
  "anticoagulant" TEXT,
  "anticoag_note" TEXT,
  "assistant_surgeon_name" TEXT,
  "anesthesiologist_name" TEXT,
  "performed_as_planned" BOOLEAN,
  "blood_loss_ml" INTEGER,
  "specimen_sent" BOOLEAN,
  "specimen_note" TEXT,
  "drain_placed" BOOLEAN,
  "drain_note" TEXT,
  "implant_note" TEXT,
  "complication" BOOLEAN,
  "complication_note" TEXT,
  "clavien_grade" TEXT,
  "complication_date" TIMESTAMP(3),
  "postop_dx_confirmed" BOOLEAN,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "visit_op_details_pkey" PRIMARY KEY ("visit_id"),
  CONSTRAINT "visit_op_details_asa_chk" CHECK ("asa_class" IS NULL OR "asa_class" IN ('I','II','III','IV','V')),
  CONSTRAINT "visit_op_details_asa_e_chk" CHECK ("asa_emergency" IS NOT TRUE OR "asa_class" IS NOT NULL),
  CONSTRAINT "visit_op_details_anticoag_chk" CHECK ("anticoagulant" IS NULL OR "anticoagulant" IN ('none','stopped','bridged','continued')),
  CONSTRAINT "visit_op_details_ebl_chk" CHECK ("blood_loss_ml" IS NULL OR ("blood_loss_ml" >= 0 AND "blood_loss_ml" <= 20000)),
  CONSTRAINT "visit_op_details_clavien_chk" CHECK ("clavien_grade" IS NULL OR ("complication" IS TRUE AND "clavien_grade" IN ('I','II','IIIa','IIIb','IVa','IVb','V')))
);

DO $$ BEGIN
  ALTER TABLE "visit_op_details" ADD CONSTRAINT "visit_op_details_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "visit_procedure_details" (
  "id" SERIAL NOT NULL,
  "visit_id" INTEGER NOT NULL,
  "procedure_type_id" INTEGER NOT NULL,
  "side" TEXT,
  "level" TEXT,
  CONSTRAINT "visit_procedure_details_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "visit_procedure_details_side_chk" CHECK ("side" IS NULL OR "side" IN ('right','left','bilateral','midline'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "visit_procedure_details_visit_id_procedure_type_id_key" ON "visit_procedure_details"("visit_id", "procedure_type_id");
CREATE INDEX IF NOT EXISTS "visit_procedure_details_procedure_type_id_idx" ON "visit_procedure_details"("procedure_type_id");

DO $$ BEGIN
  ALTER TABLE "visit_procedure_details" ADD CONSTRAINT "visit_procedure_details_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "visit_procedure_details" ADD CONSTRAINT "visit_procedure_details_procedure_type_id_fkey"
    FOREIGN KEY ("procedure_type_id") REFERENCES "procedure_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
