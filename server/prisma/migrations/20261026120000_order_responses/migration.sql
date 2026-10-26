-- «هر ارسال، پاسخِ جدا» + چک‌لیستِ کامل‌بودن برای درخواست‌های پاراکلینیک (تصمیمِ مالک ۱۴۰۵/۰۸/۰۴).
ALTER TABLE "lab_orders" ADD COLUMN IF NOT EXISTS "received_items" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "imaging_orders" ADD COLUMN IF NOT EXISTS "received_items" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "consult_orders" ADD COLUMN IF NOT EXISTS "received_items" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "response_id" INTEGER;

CREATE TABLE "order_responses" (
    "id" SERIAL NOT NULL,
    "order_ref" TEXT NOT NULL,
    "order_id" INTEGER NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'patient',
    "text" TEXT,
    "link" TEXT,
    "link_user" TEXT,
    "link_pass" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "review_note" TEXT,
    "reviewed_by_id" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_responses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_responses_patient_id_idx" ON "order_responses"("patient_id");
CREATE UNIQUE INDEX "order_responses_order_ref_order_id_seq_key" ON "order_responses"("order_ref", "order_id", "seq");
CREATE INDEX "documents_response_id_idx" ON "documents"("response_id");
ALTER TABLE "documents" ADD CONSTRAINT "documents_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "order_responses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_responses" ADD CONSTRAINT "order_responses_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- داده‌های موجود: هر سفارشِ پاسخ‌دار «پاسخِ ۱» می‌گیرد با همان متن/لینک/تصمیم، و مدارکِ پاسخش
-- (هر مدرکِ سفارش جز صدای کارکنان — که توضیحِ درخواست است) به همان پاسخ می‌پیوندند.
INSERT INTO "order_responses" ("order_ref","order_id","patient_id","seq","source","text","link","link_user","link_pass","status","review_note","reviewed_by_id","reviewed_at","created_at")
SELECT 'lab_order', o."id", o."patient_id", 1, 'patient', o."result_text", o."result_link", o."result_user", o."result_pass",
  CASE o."status" WHEN 'reviewed' THEN 'reviewed' WHEN 'needs_action' THEN 'needs_action' ELSE 'new' END,
  CASE WHEN o."status" IN ('reviewed','needs_action') THEN o."review_note" END,
  CASE WHEN o."status" IN ('reviewed','needs_action') THEN o."reviewed_by_id" END,
  CASE WHEN o."status" IN ('reviewed','needs_action') THEN o."reviewed_at" END,
  o."updated_at"
FROM "lab_orders" o WHERE o."status" IN ('answered','in_review','reviewed','needs_action');
INSERT INTO "order_responses" ("order_ref","order_id","patient_id","seq","source","text","link","link_user","link_pass","status","review_note","reviewed_by_id","reviewed_at","created_at")
SELECT 'imaging_order', o."id", o."patient_id", 1, 'patient', o."result_text", o."result_link", o."result_user", o."result_pass",
  CASE o."status" WHEN 'reviewed' THEN 'reviewed' WHEN 'needs_action' THEN 'needs_action' ELSE 'new' END,
  CASE WHEN o."status" IN ('reviewed','needs_action') THEN o."review_note" END,
  CASE WHEN o."status" IN ('reviewed','needs_action') THEN o."reviewed_by_id" END,
  CASE WHEN o."status" IN ('reviewed','needs_action') THEN o."reviewed_at" END,
  o."updated_at"
FROM "imaging_orders" o WHERE o."status" IN ('answered','in_review','reviewed','needs_action');
INSERT INTO "order_responses" ("order_ref","order_id","patient_id","seq","source","text","link","link_user","link_pass","status","review_note","reviewed_by_id","reviewed_at","created_at")
SELECT 'consult_order', o."id", o."patient_id", 1, 'patient', o."answer_text", o."answer_link", NULL, NULL,
  CASE o."status" WHEN 'reviewed' THEN 'reviewed' WHEN 'needs_action' THEN 'needs_action' ELSE 'new' END,
  CASE WHEN o."status" IN ('reviewed','needs_action') THEN o."review_note" END,
  CASE WHEN o."status" IN ('reviewed','needs_action') THEN o."reviewed_by_id" END,
  CASE WHEN o."status" IN ('reviewed','needs_action') THEN o."reviewed_at" END,
  o."updated_at"
FROM "consult_orders" o WHERE o."status" IN ('answered','in_review','reviewed','needs_action');
UPDATE "documents" d SET "response_id" = r."id"
FROM "order_responses" r
WHERE d."ref_type" = r."order_ref" AND d."ref_id" = r."order_id" AND d."response_id" IS NULL AND d."deleted_at" IS NULL
  AND NOT (d."uploaded_by_id" IS NOT NULL AND d."mime_type" LIKE 'audio/%');
