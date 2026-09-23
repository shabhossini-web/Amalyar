-- بستهٔ ۷ — چند تشخیص و چند عمل برای یک مراجعه.
--
-- تشخیص و عملِ **اصلی** (رتبهٔ ۱) همان visits.diagnosis_id / procedure_type_id
-- می‌مانند؛ این دو جدول فقط «سایر»ها را با رتبهٔ ۲ به بعد نگه می‌دارند. پس هیچ
-- داده‌ای جابه‌جا نمی‌شود (بدونِ backfill) و «دقیقاً یک اصلی» را ساختار تضمین
-- می‌کند. تنها خواننده/نویسنده: server/src/patients/visit-coding.ts.
--
-- ⚠️ RESTRICT روی تعریف (نه SET NULL): ستونِ NOT NULLِ جدولِ پیوند با SET NULL
-- ناسازگار است، و حذفِ تعریفِ به‌کاررفته باید شکست بخورد تا
-- deleteOrDeactivate آن را غیرفعال کند — نه اینکه تشخیص از تاریخچه بپرد.

CREATE TABLE IF NOT EXISTS "visit_other_diagnoses" (
    "id" SERIAL NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "diagnosis_id" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    CONSTRAINT "visit_other_diagnoses_pkey" PRIMARY KEY ("id"),
    -- رتبهٔ ۱ مالِ ستونِ visits است؛ Prisma این قید را نمی‌بیند و عمداً این‌جاست.
    CONSTRAINT "visit_other_diagnoses_rank_check" CHECK ("rank" >= 2)
);

CREATE TABLE IF NOT EXISTS "visit_other_procedures" (
    "id" SERIAL NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "procedure_type_id" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    CONSTRAINT "visit_other_procedures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "visit_other_procedures_rank_check" CHECK ("rank" >= 2)
);

CREATE INDEX IF NOT EXISTS "visit_other_diagnoses_diagnosis_id_idx" ON "visit_other_diagnoses"("diagnosis_id");
CREATE UNIQUE INDEX IF NOT EXISTS "visit_other_diagnoses_visit_id_diagnosis_id_key" ON "visit_other_diagnoses"("visit_id", "diagnosis_id");
CREATE UNIQUE INDEX IF NOT EXISTS "visit_other_diagnoses_visit_id_rank_key" ON "visit_other_diagnoses"("visit_id", "rank");
CREATE INDEX IF NOT EXISTS "visit_other_procedures_procedure_type_id_idx" ON "visit_other_procedures"("procedure_type_id");
CREATE UNIQUE INDEX IF NOT EXISTS "visit_other_procedures_visit_id_procedure_type_id_key" ON "visit_other_procedures"("visit_id", "procedure_type_id");
CREATE UNIQUE INDEX IF NOT EXISTS "visit_other_procedures_visit_id_rank_key" ON "visit_other_procedures"("visit_id", "rank");

DO $$ BEGIN
  ALTER TABLE "visit_other_diagnoses" ADD CONSTRAINT "visit_other_diagnoses_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "visit_other_diagnoses" ADD CONSTRAINT "visit_other_diagnoses_diagnosis_id_fkey"
    FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "visit_other_procedures" ADD CONSTRAINT "visit_other_procedures_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "visit_other_procedures" ADD CONSTRAINT "visit_other_procedures_procedure_type_id_fkey"
    FOREIGN KEY ("procedure_type_id") REFERENCES "procedure_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
