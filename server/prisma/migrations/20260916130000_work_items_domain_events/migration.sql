-- لایهٔ کار (W2.1): «کار» با مسئول و مهلت و ارجاعِ صریح + outboxِ رویدادهای دامنه.
-- قرارداد: docs/plan/CONTRACTS.md §۱–۲. بدونِ FK تا مدل‌های موجود دست نخورند.
CREATE TABLE IF NOT EXISTS "work_items" (
  "id" SERIAL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'open',
  "performer" TEXT NOT NULL DEFAULT 'human',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "due_at" TIMESTAMP(3),
  "owner_role" TEXT,
  "owner_account_id" INTEGER,
  "patient_id" INTEGER,
  "visit_id" INTEGER,
  "appointment_id" INTEGER,
  "ref_type" TEXT,
  "ref_id" INTEGER,
  "title" TEXT NOT NULL,
  "note" TEXT,
  "outcome" JSONB,
  "blocked_reason" TEXT,
  "source_event_id" INTEGER,
  "idempotency_key" TEXT NOT NULL,
  "created_by_id" INTEGER,
  "completed_by_id" INTEGER,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_items_idempotency_key_key" ON "work_items"("idempotency_key");
CREATE INDEX IF NOT EXISTS "work_items_state_owner_role_due_at_idx" ON "work_items"("state", "owner_role", "due_at");
CREATE INDEX IF NOT EXISTS "work_items_state_owner_account_id_due_at_idx" ON "work_items"("state", "owner_account_id", "due_at");
CREATE INDEX IF NOT EXISTS "work_items_patient_id_idx" ON "work_items"("patient_id");
CREATE INDEX IF NOT EXISTS "work_items_ref_type_ref_id_idx" ON "work_items"("ref_type", "ref_id");

CREATE TABLE IF NOT EXISTS "domain_events" (
  "id" SERIAL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "patient_id" INTEGER,
  "visit_id" INTEGER,
  "appointment_id" INTEGER,
  "ref_type" TEXT,
  "ref_id" INTEGER,
  "payload" JSONB,
  "actor_id" INTEGER,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "domain_events_processed_at_idx" ON "domain_events"("processed_at");
CREATE INDEX IF NOT EXISTS "domain_events_type_at_idx" ON "domain_events"("type", "at");
CREATE INDEX IF NOT EXISTS "domain_events_patient_id_idx" ON "domain_events"("patient_id");
