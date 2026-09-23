-- **هستهٔ ثابتِ مراجعه** (بستهٔ ۶) — تصمیمِ مالک پس از بررسیِ HIS: «ویزیت یک
-- استانداردِ ثابت دارد، عمل یک استانداردِ ثابت».
--
-- سه تغییرِ ساختار و یک جابه‌جاییِ داده:
--   ۱. نوعِ بیهوشی و وضعیتِ خروجِ ترخیص ستون می‌شوند (گزارش‌پذیر).
--   ۲. جدولِ علائمِ حیاتی (هر ردیف یک نوبتِ اندازه‌گیری).
--   ۳. بخش‌های متنیِ پایه (شرحِ حال، معاینه، یافته‌ها، طرحِ درمان، نسخه) از
--      `visits.extra` به سندِ نسخه‌دارِ `clinical_notes` می‌روند.
--   ۴. فیلدِ تک‌انتخابیِ `plan` در ستونِ چندتاییِ `decisions` ادغام می‌شود.
--
-- ⚠️ همان قاعدهٔ مهاجرتِ شکایتِ اولیه: کلید از `extra` **برداشته** می‌شود، نه
-- کپی — دو نسخه از یک داده یعنی اولین ویرایش یکی را کهنه می‌کند. فقط
-- مقدارِ **رشته‌ای** جابه‌جا می‌شود؛ مقدارِ غیرِ رشته (اگر مطبی با همین کلید
-- فیلدِ دیگری ساخته بود) دست نمی‌خورد تا چیزی بی‌صدا گم نشود.

-- ── ۱. ستون‌ها ──────────────────────────────────────────────────────────
ALTER TABLE "visits" ADD COLUMN "anesthesia" TEXT,
ADD COLUMN "discharge_disposition" TEXT;

-- ── ۲. علائمِ حیاتی ─────────────────────────────────────────────────────
CREATE TABLE "vital_signs" (
    "id" SERIAL NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "phase" TEXT,
    "taken_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bp_sys" INTEGER,
    "bp_dia" INTEGER,
    "hr" INTEGER,
    "rr" INTEGER,
    "temp" DOUBLE PRECISION,
    "spo2" INTEGER,
    "weight" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "pain" INTEGER,
    "note" TEXT,
    "recorded_by_id" INTEGER,
    "recorded_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vital_signs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vital_signs_visit_id_idx" ON "vital_signs"("visit_id");
CREATE INDEX "vital_signs_patient_id_taken_at_idx" ON "vital_signs"("patient_id", "taken_at");

ALTER TABLE "vital_signs" ADD CONSTRAINT "vital_signs_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vital_signs" ADD CONSTRAINT "vital_signs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ۳. بخش‌های متنی: extra → clinical_notes ─────────────────────────────
-- کلیدِ فرم → نوعِ سند؛ همان `SECTION_NOTES` در `clinical-note.ts`.
-- زمانِ سند = آخرین ذخیرهٔ مراجعه (نزدیک‌ترین تقریبِ «کِی نوشته شد»)؛ نویسنده
-- خالی، چون ثبت نشده بود — نامِ ساختگی از نامِ خالی بدتر است.
-- ⚠️ نگاشت درون‌خطی (`VALUES`) و نه جدولِ موقت: اجراکنندهٔ مهاجرت ممکن است
-- هر دستور را جدا commit کند و جدولِ `ON COMMIT DROP` همان لحظه ناپدید شود.
INSERT INTO "clinical_notes" ("patient_id", "visit_id", "kind", "body", "created_at")
SELECT v."patient_id", v."id", m."kind", btrim(v."extra" ->> m."fkey"), v."updated_at"
  FROM "visits" v
  JOIN (VALUES
         ('history', 'history'), ('exam', 'exam'), ('findings', 'findings'),
         ('planNote', 'plan'), ('prescription', 'rx')
       ) AS m ("fkey", "kind")
    ON jsonb_typeof(v."extra" -> m."fkey") = 'string'
 WHERE jsonb_typeof(v."extra") = 'object'
   AND btrim(v."extra" ->> m."fkey") <> ''
   AND NOT EXISTS (
     SELECT 1 FROM "clinical_notes" n
      WHERE n."visit_id" = v."id" AND n."kind" = m."kind" AND n."replaced_at" IS NULL
   );

-- هر کلید جدا، و فقط وقتی رشته است: اگر یک کلید رشته و کلیدِ دیگری
-- (فیلدِ دلخواهِ هم‌نامِ یک مطب) غیرِ رشته بود، دومی نباید همراهِ اولی پاک شود.
UPDATE "visits" SET "extra" = "extra" - 'history'
 WHERE jsonb_typeof("extra") = 'object' AND jsonb_typeof("extra" -> 'history') = 'string';
UPDATE "visits" SET "extra" = "extra" - 'exam'
 WHERE jsonb_typeof("extra") = 'object' AND jsonb_typeof("extra" -> 'exam') = 'string';
UPDATE "visits" SET "extra" = "extra" - 'findings'
 WHERE jsonb_typeof("extra") = 'object' AND jsonb_typeof("extra" -> 'findings') = 'string';
UPDATE "visits" SET "extra" = "extra" - 'planNote'
 WHERE jsonb_typeof("extra") = 'object' AND jsonb_typeof("extra" -> 'planNote') = 'string';
UPDATE "visits" SET "extra" = "extra" - 'prescription'
 WHERE jsonb_typeof("extra") = 'object' AND jsonb_typeof("extra" -> 'prescription') = 'string';

-- ── ۴. نوعِ بیهوشی: extra → ستون ────────────────────────────────────────
UPDATE "visits"
   SET "anesthesia" = "extra" ->> 'anesthesia',
       "extra" = "extra" - 'anesthesia'
 WHERE jsonb_typeof("extra") = 'object'
   AND jsonb_typeof("extra" -> 'anesthesia') = 'string'
   AND "extra" ->> 'anesthesia' IN ('general', 'spinal', 'local', 'sedation');

-- ── ۵. «تصمیم»ِ تک‌انتخابی → decisions ──────────────────────────────────
-- `refer`ِ قالبِ قدیمی همان `referral`ِ ستون است؛ دو واژه برای یک تصمیم.
UPDATE "visits" v
   SET "decisions" = ARRAY(
         SELECT DISTINCT d FROM unnest(
           v."decisions" || ARRAY[CASE v."extra" ->> 'plan' WHEN 'refer' THEN 'referral' ELSE v."extra" ->> 'plan' END]
         ) AS d
       ),
       "extra" = v."extra" - 'plan'
 WHERE jsonb_typeof(v."extra") = 'object'
   AND jsonb_typeof(v."extra" -> 'plan') = 'string'
   AND v."extra" ->> 'plan' IN ('conservative', 'imaging', 'lab', 'surgery', 'refer');

-- و خودِ فیلدِ تکراری از فرم برداشته می‌شود — فقط اگر گزینه‌هایش همان گزینه‌های
-- قالب باشد. مطبی که گزینهٔ خودش را افزوده بود، فیلدش را نگه می‌دارد.
UPDATE "form_fields" f
   SET "active" = false, "deleted_at" = CURRENT_TIMESTAMP
  FROM "form_defs" d
 WHERE f."form_id" = d."id"
   AND d."scope" = 'visit'
   AND f."key" = 'plan'
   AND f."builtin" = false
   AND f."type" = 'select'
   AND f."deleted_at" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(f."options") = 'array' THEN f."options" ELSE '[]'::jsonb END
     ) o
      WHERE (o ->> 'v') NOT IN ('conservative', 'imaging', 'lab', 'surgery', 'refer')
   );
