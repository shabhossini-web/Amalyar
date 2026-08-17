-- لینکِ عمومیِ خلاصهٔ ویزیت + دفترِ یادآوری‌ها (docs/BOOKING.md — فازِ یادآوری‌ها)
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "summary_token" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "visits_summary_token_key" ON "visits"("summary_token");

CREATE TABLE IF NOT EXISTS "reminders" (
  "id" SERIAL PRIMARY KEY,
  "patient_id" INTEGER REFERENCES "patients"("id") ON DELETE CASCADE,
  "visit_id" INTEGER REFERENCES "visits"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "due_at" TIMESTAMP(3) NOT NULL,
  "phone" TEXT,
  "text" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "sent_at" TIMESTAMP(3),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "reminders_status_due_at_idx" ON "reminders"("status", "due_at");
CREATE INDEX IF NOT EXISTS "reminders_visit_id_kind_idx" ON "reminders"("visit_id", "kind");
