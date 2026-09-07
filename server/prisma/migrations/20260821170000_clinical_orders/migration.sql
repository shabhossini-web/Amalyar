-- چهار سفارشِ بالینیِ زیرِ ویزیت: آزمایش، عکس‌برداری، مشاوره، ارجاع.
-- هر کدام موجودیتِ خودش را دارد (فیلدهای متفاوت)، ولی چرخهٔ یکسان:
-- ثبت → لینک برای بیمار → پاسخ (متن/لینکِ رمزدار) → نشستن زیرِ همان ویزیت.
CREATE TABLE IF NOT EXISTS "lab_orders" (
  "id" SERIAL PRIMARY KEY,
  "patient_id" INTEGER NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "visit_id" INTEGER REFERENCES "visits"("id") ON DELETE SET NULL,
  "tests" TEXT[] NOT NULL DEFAULT '{}',
  "note" TEXT,
  "due_date" TIMESTAMP(3),
  "token" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sent_at" TIMESTAMP(3),
  "result_text" TEXT,
  "result_link" TEXT,
  "result_user" TEXT,
  "result_pass" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "lab_orders_patient_id_idx" ON "lab_orders"("patient_id");
CREATE INDEX IF NOT EXISTS "lab_orders_visit_id_idx" ON "lab_orders"("visit_id");

CREATE TABLE IF NOT EXISTS "imaging_orders" (
  "id" SERIAL PRIMARY KEY,
  "patient_id" INTEGER NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "visit_id" INTEGER REFERENCES "visits"("id") ON DELETE SET NULL,
  "modalities" TEXT[] NOT NULL DEFAULT '{}',
  "region" TEXT,
  "note" TEXT,
  "due_date" TIMESTAMP(3),
  "token" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sent_at" TIMESTAMP(3),
  "result_text" TEXT,
  "result_link" TEXT,
  "result_user" TEXT,
  "result_pass" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "imaging_orders_patient_id_idx" ON "imaging_orders"("patient_id");
CREATE INDEX IF NOT EXISTS "imaging_orders_visit_id_idx" ON "imaging_orders"("visit_id");

CREATE TABLE IF NOT EXISTS "consult_orders" (
  "id" SERIAL PRIMARY KEY,
  "patient_id" INTEGER NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "visit_id" INTEGER REFERENCES "visits"("id") ON DELETE SET NULL,
  "specialty" TEXT,
  "doctor_name" TEXT,
  "note" TEXT,
  "token" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sent_at" TIMESTAMP(3),
  "answer_text" TEXT,
  "answer_link" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "consult_orders_patient_id_idx" ON "consult_orders"("patient_id");
CREATE INDEX IF NOT EXISTS "consult_orders_visit_id_idx" ON "consult_orders"("visit_id");

CREATE TABLE IF NOT EXISTS "referral_orders" (
  "id" SERIAL PRIMARY KEY,
  "patient_id" INTEGER NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "visit_id" INTEGER REFERENCES "visits"("id") ON DELETE SET NULL,
  "specialty" TEXT,
  "doctor_name" TEXT,
  "note" TEXT,
  "token" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "referral_orders_patient_id_idx" ON "referral_orders"("patient_id");
CREATE INDEX IF NOT EXISTS "referral_orders_visit_id_idx" ON "referral_orders"("visit_id");
