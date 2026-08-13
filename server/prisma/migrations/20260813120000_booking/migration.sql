-- نوبت‌دهی — `docs/BOOKING.md` مرحلهٔ ۲: برنامهٔ کاری، استثنا و خودِ نوبت.

-- برنامهٔ کاری. دو حالت (`slot` / `capacity`) در یک جدول: تفاوتشان فقط
-- «واحدِ ظرفیت» است و بقیهٔ قاعده‌ها یکی؛ دو جدول یعنی هر قاعدهٔ تازه دوبار.
CREATE TABLE IF NOT EXISTS "availability_rules" (
    "id"           SERIAL       NOT NULL,
    "doctor_id"    INTEGER,
    "weekday"      INTEGER      NOT NULL,   -- شنبه = ۰ (شمسی)
    "start_min"    INTEGER      NOT NULL,   -- دقیقه از نیمه‌شب
    "end_min"      INTEGER      NOT NULL,
    "mode"         TEXT         NOT NULL DEFAULT 'slot',
    "slot_minutes" INTEGER,
    "capacity"     INTEGER,
    "active_from"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_to"    TIMESTAMP(3),
    "active"       BOOLEAN      NOT NULL DEFAULT true,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "availability_rules_weekday_active_idx" ON "availability_rules"("weekday", "active");

CREATE TABLE IF NOT EXISTS "availability_rule_topics" (
    "rule_id"  INTEGER NOT NULL,
    "topic_id" INTEGER NOT NULL,

    CONSTRAINT "availability_rule_topics_pkey" PRIMARY KEY ("rule_id", "topic_id")
);

-- استثنا: «پنجشنبهٔ این هفته تعطیل است» بدونِ بردنِ همهٔ پنجشنبه‌های آینده.
CREATE TABLE IF NOT EXISTS "availability_exceptions" (
    "id"           SERIAL       NOT NULL,
    "date"         DATE         NOT NULL,
    "doctor_id"    INTEGER,
    "closed"       BOOLEAN      NOT NULL DEFAULT true,
    "start_min"    INTEGER,
    "end_min"      INTEGER,
    "mode"         TEXT,
    "slot_minutes" INTEGER,
    "capacity"     INTEGER,
    "note"         TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "availability_exceptions_date_idx" ON "availability_exceptions"("date");

-- نوبت. عمداً جدا از `visits`: نوبتی که کنسل شود نباید در جدولِ مراجعات
-- بنشیند و گزارش‌های مالی رویش حساب کنند.
CREATE TABLE IF NOT EXISTS "appointments" (
    "id"            SERIAL       NOT NULL,
    "patient_id"    INTEGER,
    "doctor_id"     INTEGER,
    "topic_id"      INTEGER,
    "date"          DATE         NOT NULL,
    "start_min"     INTEGER,
    "seq"           INTEGER,
    "status"        TEXT         NOT NULL DEFAULT 'held',
    "submission_id" INTEGER,
    "visit_id"      INTEGER,
    "note"          TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- ⚠️ همین قید جلوی «دو بیمار، یک اسلات» را می‌گیرد. بدونِ آن «اول بخوان بعد
-- بنویس» دو درخواستِ همزمان را هر دو موفق می‌کند.
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_doctor_id_date_start_min_key"
  ON "appointments"("doctor_id", "date", "start_min");
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_submission_id_key" ON "appointments"("submission_id");
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_visit_id_key"      ON "appointments"("visit_id");
CREATE INDEX IF NOT EXISTS "appointments_date_status_idx"          ON "appointments"("date", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_rules_doctor_id_fkey') THEN
    ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_doctor_id_fkey"
      FOREIGN KEY ("doctor_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_rule_topics_rule_id_fkey') THEN
    ALTER TABLE "availability_rule_topics" ADD CONSTRAINT "availability_rule_topics_rule_id_fkey"
      FOREIGN KEY ("rule_id") REFERENCES "availability_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_rule_topics_topic_id_fkey') THEN
    ALTER TABLE "availability_rule_topics" ADD CONSTRAINT "availability_rule_topics_topic_id_fkey"
      FOREIGN KEY ("topic_id") REFERENCES "visit_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_exceptions_doctor_id_fkey') THEN
    ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_doctor_id_fkey"
      FOREIGN KEY ("doctor_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_patient_id_fkey') THEN
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey"
      FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_doctor_id_fkey') THEN
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_fkey"
      FOREIGN KEY ("doctor_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_topic_id_fkey') THEN
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_topic_id_fkey"
      FOREIGN KEY ("topic_id") REFERENCES "visit_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_visit_id_fkey') THEN
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_visit_id_fkey"
      FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
