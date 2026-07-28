-- «هر کد ملی، یک بیمار، یک شمارهٔ پرونده» — اصلِ MPI.
-- تا امروز national_id فقط یک ستونِ متنی بود، پس یک بیمار می‌توانست با هر
-- مراجعه یک پروندهٔ تازه بگیرد. این migration آن را کلیدِ هویت می‌کند.

-- ۱) رشتهٔ خالی هویت نیست؛ NULL است. (چند NULL با ایندکسِ یکتا سازگار است.)
UPDATE "patients" SET "national_id" = NULL WHERE TRIM(COALESCE("national_id", '')) = '';

-- ۲) اگر داده‌ای از قبل تکراری است، خودمان ادغامش نمی‌کنیم: ادغامِ هویتِ بیمار
--    تصمیمِ انسانی است، نه کارِ یک UPDATE. migration با فهرستِ تکراری‌ها متوقف می‌شود.
DO $$
DECLARE dupes TEXT;
BEGIN
  SELECT string_agg(t.nid || ' (' || t.n || ' پرونده)', ', ')
    INTO dupes
    FROM (SELECT "national_id" AS nid, count(*) AS n
            FROM "patients"
           WHERE "national_id" IS NOT NULL
           GROUP BY "national_id"
          HAVING count(*) > 1) t;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'کد ملیِ تکراری در patients: %. پیش از اجرای این migration پرونده‌ها را دستی ادغام کنید.', dupes;
  END IF;
END $$;

-- ۳) کلیدِ یکتا.
CREATE UNIQUE INDEX "patients_national_id_key" ON "patients"("national_id");
