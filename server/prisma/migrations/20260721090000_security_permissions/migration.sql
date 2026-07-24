-- Fine-grained permissions, audit trail, soft-delete metadata and integrity constraints.
CREATE TABLE "permissions" (
  "id" SERIAL NOT NULL,
  "key" TEXT NOT NULL,
  "min_level" INTEGER NOT NULL DEFAULT 6,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

CREATE TABLE "audit_events" (
  "id" BIGSERIAL NOT NULL,
  "actor_id" INTEGER,
  "action" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "before_json" JSONB,
  "after_json" JSONB,
  "ip" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_events_actor_id_created_at_idx" ON "audit_events"("actor_id", "created_at");
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

ALTER TABLE "patients"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by_id" INTEGER,
  ADD COLUMN "delete_reason" TEXT;

-- Abort migration if existing duplicates need manual resolution; never silently rewrite medical history.
CREATE UNIQUE INDEX "visits_patient_id_seq_key" ON "visits"("patient_id", "seq");
