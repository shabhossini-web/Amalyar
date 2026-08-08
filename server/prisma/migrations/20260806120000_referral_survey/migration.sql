-- کانالِ آشناییِ بیمار + نظرسنجیِ پس از مراجعه.
--
-- ⚠️ هر دو جدولِ خودشان را دارند و در JSON نمی‌نشینند، چون رویشان **گزارش
-- گرفته می‌شود**: «کدام کانال بیمار می‌آورد» و «میانگینِ رضایت» دو عددی‌اند که
-- تصمیم می‌سازند، و گزارش‌گرفتن از JSON یعنی خواندنِ کلِ جدول در حافظه.

CREATE TABLE IF NOT EXISTS "referral_sources" (
  "id"         SERIAL       PRIMARY KEY,
  "name"       TEXT         NOT NULL,
  "asks_who"   BOOLEAN      NOT NULL DEFAULT false,
  "active"     BOOLEAN      NOT NULL DEFAULT true,
  "sort"       INTEGER      NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "referral_sources_name_key" ON "referral_sources" ("name");

ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "referral_source_id" INTEGER;
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "referral_note" TEXT;

DO $$ BEGIN
  ALTER TABLE "patients" ADD CONSTRAINT "patients_referral_source_id_fkey"
    FOREIGN KEY ("referral_source_id") REFERENCES "referral_sources" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "survey_invites" (
  "id"          SERIAL       PRIMARY KEY,
  "token"       TEXT         NOT NULL,
  "patient_id"  INTEGER      NOT NULL,
  "visit_id"    INTEGER,
  "status"      TEXT         NOT NULL DEFAULT 'pending',
  "answers"     JSONB        NOT NULL DEFAULT '{}',
  "overall"     INTEGER,
  "sent_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answered_at" TIMESTAMP(3),
  "expires_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "survey_invites_patient_id_fkey" FOREIGN KEY ("patient_id")
    REFERENCES "patients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "survey_invites_visit_id_fkey" FOREIGN KEY ("visit_id")
    REFERENCES "visits" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "survey_invites_token_key"   ON "survey_invites" ("token");
CREATE        INDEX IF NOT EXISTS "survey_invites_status_idx"  ON "survey_invites" ("status", "sent_at");
CREATE        INDEX IF NOT EXISTS "survey_invites_patient_idx" ON "survey_invites" ("patient_id");

-- کانال‌های پیش‌فرض — فقط یک شروع؛ کاربر هر کدام را می‌خواهد عوض یا حذف کند.
INSERT INTO "referral_sources" ("name", "asks_who", "sort") VALUES
  ('اینستاگرام', false, 10),
  ('جستجوی اینترنتی', false, 20),
  ('معرفیِ پزشک', true, 30),
  ('معرفیِ بیمارِ دیگر', true, 40),
  ('تابلو یا تبلیغاتِ محیطی', false, 50),
  ('بیمه یا سازمان', true, 60),
  ('سایر', false, 99)
ON CONFLICT ("name") DO NOTHING;
