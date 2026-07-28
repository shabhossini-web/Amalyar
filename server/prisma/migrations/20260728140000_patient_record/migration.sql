-- پروندهٔ جامعِ بیمار: پروفایل + مدارک + شرح‌های بالینی.
-- بیمار از «چند فیلدِ هویتی روی مراجعه» به یک آبجکتِ کامل تبدیل می‌شود که
-- مراجعات، مدارک و شرح‌ها همه به آن می‌چسبند.

-- ۱) پروفایلِ بیمار
ALTER TABLE "patients"
  ADD COLUMN "gender"               TEXT,
  ADD COLUMN "city"                 TEXT,
  ADD COLUMN "address"              TEXT,
  ADD COLUMN "blood_type"           TEXT,
  ADD COLUMN "allergies"            TEXT,
  ADD COLUMN "chronic_conditions"   TEXT,
  ADD COLUMN "medications"          TEXT,
  ADD COLUMN "insurer"              TEXT,
  ADD COLUMN "insurance_no"         TEXT,
  ADD COLUMN "supplemental_insurer" TEXT,
  ADD COLUMN "emergency_name"       TEXT,
  ADD COLUMN "emergency_phone"      TEXT,
  ADD COLUMN "emergency_relation"   TEXT,
  ADD COLUMN "notes"                TEXT,
  ADD COLUMN "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ۲) مدارکِ پزشکی
CREATE TABLE "documents" (
  "id"             SERIAL       NOT NULL,
  "patient_id"     INTEGER      NOT NULL,
  "visit_id"       INTEGER,
  "category"       TEXT         NOT NULL,
  "title"          TEXT,
  "file_name"      TEXT         NOT NULL,
  "mime_type"      TEXT         NOT NULL,
  "size"           INTEGER      NOT NULL,
  "sha256"         TEXT         NOT NULL,
  "taken_at"       TIMESTAMP(3),
  "uploaded_by_id" INTEGER,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"     TIMESTAMP(3),
  "deleted_by_id"  INTEGER,
  CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "documents_patient_id_category_idx" ON "documents"("patient_id", "category");
CREATE INDEX "documents_visit_id_idx"            ON "documents"("visit_id");
CREATE INDEX "documents_sha256_idx"              ON "documents"("sha256");
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "documents_visit_id_fkey"   FOREIGN KEY ("visit_id")   REFERENCES "visits"("id")   ON DELETE SET NULL ON UPDATE CASCADE;

-- ۳) شرح‌های بالینی (نسخه‌دار و تغییرناپذیر)
CREATE TABLE "clinical_notes" (
  "id"          SERIAL       NOT NULL,
  "patient_id"  INTEGER      NOT NULL,
  "visit_id"    INTEGER,
  "kind"        TEXT         NOT NULL,
  "body"        TEXT         NOT NULL,
  "author_id"   INTEGER,
  "author_name" TEXT,
  "replaces_id" INTEGER,
  "replaced_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clinical_notes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "clinical_notes_replaces_id_key"  ON "clinical_notes"("replaces_id");
CREATE INDEX "clinical_notes_patient_id_kind_idx"     ON "clinical_notes"("patient_id", "kind");
CREATE INDEX "clinical_notes_visit_id_idx"            ON "clinical_notes"("visit_id");
ALTER TABLE "clinical_notes"
  ADD CONSTRAINT "clinical_notes_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id")       ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "clinical_notes_visit_id_fkey"   FOREIGN KEY ("visit_id")   REFERENCES "visits"("id")         ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "clinical_notes_replaces_id_fkey" FOREIGN KEY ("replaces_id") REFERENCES "clinical_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ۴) شرحِ عملِ موجود به شرحِ بالینی منتقل می‌شود، بعد ستونش حذف.
--    دو منبعِ حقیقت برای یک متن، همان اشتباهی است که با opType داشتیم.
INSERT INTO "clinical_notes" ("patient_id", "visit_id", "kind", "body", "created_at")
SELECT v."patient_id", v."id", 'op', v."op_report", v."created_at"
  FROM "visits" v
 WHERE v."op_report" IS NOT NULL AND TRIM(v."op_report") <> '';

ALTER TABLE "visits" DROP COLUMN "op_report";
