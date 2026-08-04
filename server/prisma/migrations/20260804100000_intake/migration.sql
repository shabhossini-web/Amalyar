-- فرمِ ثبت‌نامِ بیمار: لینکِ دائمی + ثبت‌نامِ در جریان.

CREATE TABLE IF NOT EXISTS "intake_links" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intake_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "intake_links_token_key" ON "intake_links"("token");

CREATE TABLE IF NOT EXISTS "intake_submissions" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "link_id" INTEGER NOT NULL,
    "patient_id" INTEGER,
    "visit_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending_fill',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL DEFAULT '{}',
    "review_note" TEXT,
    "reviewed_by_id" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intake_submissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "intake_submissions_token_key" ON "intake_submissions"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "intake_submissions_visit_id_key" ON "intake_submissions"("visit_id");
CREATE INDEX IF NOT EXISTS "intake_submissions_status_created_at_idx" ON "intake_submissions"("status", "created_at");

ALTER TABLE "intake_submissions" DROP CONSTRAINT IF EXISTS "intake_submissions_link_id_fkey";
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_link_id_fkey"
    FOREIGN KEY ("link_id") REFERENCES "intake_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intake_submissions" DROP CONSTRAINT IF EXISTS "intake_submissions_patient_id_fkey";
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "intake_submissions" DROP CONSTRAINT IF EXISTS "intake_submissions_visit_id_fkey";
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
