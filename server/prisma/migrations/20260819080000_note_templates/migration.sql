-- قالب‌های شرحِ بالینی (HIS-گونه) — به تفکیکِ نوعِ شرح و عمل/تشخیص/موضوع (idempotent)
CREATE TABLE IF NOT EXISTS "note_templates" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "procedure_type_id" INTEGER,
    "diagnosis_id" INTEGER,
    "topic_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "note_templates_kind_active_idx" ON "note_templates"("kind", "active");

DO $$ BEGIN
  ALTER TABLE "note_templates" ADD CONSTRAINT "note_templates_procedure_type_id_fkey"
    FOREIGN KEY ("procedure_type_id") REFERENCES "procedure_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "note_templates" ADD CONSTRAINT "note_templates_diagnosis_id_fkey"
    FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "note_templates" ADD CONSTRAINT "note_templates_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "visit_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
