-- هستهٔ هویت: Person تک‌منبعِ مشخصاتِ انسان می‌شود و Account/Surgeon نقش‌هایی روی آن.
-- این migration برای نصبِ تازه نوشته شده (هیچ tenantی داده ندارد)؛ جدولِ accounts و
-- surgeons بازساخته می‌شوند تا ستون‌های هویتی جای درستشان بنشینند.

CREATE TABLE "people" (
    "id" SERIAL NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "national_id" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "birth_date" TIMESTAMP(3),
    "photo" TEXT,
    "address" TEXT,
    "city" TEXT,
    "iban" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "people_national_id_key" ON "people"("national_id");
CREATE UNIQUE INDEX "people_phone_key" ON "people"("phone");
CREATE INDEX "people_last_name_first_name_idx" ON "people"("last_name", "first_name");

-- هر حسابِ موجود یک Person می‌گیرد؛ نامِ خالی با placeholder پر می‌شود چون
-- Person.firstName/lastName اجباری‌اند و رکوردِ بی‌نام بی‌معناست.
INSERT INTO "people" ("first_name", "last_name", "phone", "photo", "created_at")
SELECT COALESCE(NULLIF(TRIM("first_name"), ''), 'بدون'),
       COALESCE(NULLIF(TRIM("last_name"), ''), 'نام'),
       "phone", "selfie", "created_at"
FROM "accounts";

ALTER TABLE "accounts" ADD COLUMN "person_id" INTEGER;
UPDATE "accounts" a SET "person_id" = p."id"
FROM "people" p
WHERE p."created_at" = a."created_at"
  AND COALESCE(p."phone", '') = COALESCE(a."phone", '')
  AND a."person_id" IS NULL;

-- حسابی که به هر دلیل نگاشته نشد باید صریح بترکد، نه اینکه بی‌صدا بی‌هویت بماند.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "accounts" WHERE "person_id" IS NULL) THEN
    RAISE EXCEPTION 'accounts without person mapping remain; aborting migration';
  END IF;
END $$;

ALTER TABLE "accounts"
    ALTER COLUMN "person_id" SET NOT NULL,
    DROP COLUMN "first_name",
    DROP COLUMN "last_name",
    DROP COLUMN "phone",
    DROP COLUMN "selfie",
    ADD COLUMN "fee" INTEGER;

CREATE UNIQUE INDEX "accounts_person_id_key" ON "accounts"("person_id");
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- جراح: نام/تلفن به Person می‌روند و خودِ رکورد فقط نقش می‌مانَد.
-- نامِ تک‌کلمه‌ای باید نام‌خانوادگیِ خالی بگیرد، نه تکرارِ خودش. بدونِ این CASE،
-- position(' ' IN name) صفر می‌شود و substring از ۱ کلِ رشته را برمی‌گرداند.
INSERT INTO "people" ("first_name", "last_name", "phone", "created_at")
SELECT CASE WHEN position(' ' IN TRIM("name")) > 0
            THEN split_part(TRIM("name"), ' ', 1)
            ELSE TRIM("name") END,
       CASE WHEN position(' ' IN TRIM("name")) > 0
            THEN TRIM(substring(TRIM("name") FROM position(' ' IN TRIM("name")) + 1))
            ELSE '—' END,
       "phone", "created_at"
FROM "surgeons";

ALTER TABLE "surgeons" ADD COLUMN "person_id" INTEGER;
UPDATE "surgeons" s SET "person_id" = p."id"
FROM "people" p
WHERE p."created_at" = s."created_at"
  AND COALESCE(p."phone", '') = COALESCE(s."phone", '')
  AND s."person_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "surgeons" WHERE "person_id" IS NULL) THEN
    RAISE EXCEPTION 'surgeons without person mapping remain; aborting migration';
  END IF;
END $$;

ALTER TABLE "surgeons"
    ALTER COLUMN "person_id" SET NOT NULL,
    DROP COLUMN "name",
    DROP COLUMN "phone",
    ADD COLUMN "specialty" TEXT,
    ADD COLUMN "license_no" TEXT;

CREATE UNIQUE INDEX "surgeons_person_id_key" ON "surgeons"("person_id");
ALTER TABLE "surgeons" ADD CONSTRAINT "surgeons_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- بیمارستان از استاب به پروفایل کامل
ALTER TABLE "hospitals"
    ADD COLUMN "city" TEXT,
    ADD COLUMN "address" TEXT,
    ADD COLUMN "phone" TEXT,
    ADD COLUMN "contact_name" TEXT,
    ADD COLUMN "contact_phone" TEXT,
    ADD COLUMN "notes" TEXT;

-- نوعِ عمل و تشخیص: موجودیت به‌جای متنِ آزاد، تا گزارش‌گیری و تحلیل ممکن شود.
CREATE TABLE "procedure_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "procedure_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "procedure_types_name_key" ON "procedure_types"("name");

CREATE TABLE "diagnoses" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "icd_code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "diagnoses_title_key" ON "diagnoses"("title");

-- نوع‌های عملِ آزادِ موجود به موجودیت تبدیل می‌شوند تا داده‌ای از دست نرود.
INSERT INTO "procedure_types" ("name")
SELECT DISTINCT TRIM("op_type") FROM "visits"
WHERE "op_type" IS NOT NULL AND TRIM("op_type") <> ''
ON CONFLICT ("name") DO NOTHING;

ALTER TABLE "visits"
    ADD COLUMN "procedure_type_id" INTEGER,
    ADD COLUMN "diagnosis_id" INTEGER,
    ADD COLUMN "op_report" TEXT;

UPDATE "visits" v SET "procedure_type_id" = t."id"
FROM "procedure_types" t
WHERE TRIM(v."op_type") = t."name";

CREATE INDEX "visits_surgeon_id_idx" ON "visits"("surgeon_id");
CREATE INDEX "visits_procedure_type_id_idx" ON "visits"("procedure_type_id");
CREATE INDEX "visits_diagnosis_id_idx" ON "visits"("diagnosis_id");

ALTER TABLE "visits" ADD CONSTRAINT "visits_procedure_type_id_fkey"
    FOREIGN KEY ("procedure_type_id") REFERENCES "procedure_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_diagnosis_id_fkey"
    FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
