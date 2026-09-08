-- Generated with prisma migrate diff against the migration shadow database.
-- Existing unrelated schema drift is intentionally excluded.
ALTER TABLE "charges" ADD COLUMN "neuro_detail" JSONB;
CREATE TABLE "invoice_documents" (
    "id" SERIAL NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "variant" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMP(3),
    CONSTRAINT "invoice_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invoice_documents_number_key" ON "invoice_documents"("number");
CREATE INDEX "invoice_documents_visit_id_variant_id_idx" ON "invoice_documents"("visit_id", "variant", "id");
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
