-- کتابِ ارزش نسبیِ خدماتِ سلامت + ضریبِ ریالی.
-- ارزش‌ها «هزارم‌واحد» و عددِ صحیح‌اند؛ مبالغ «تومان» و عددِ صحیح.

CREATE TABLE "service_codes" (
  "code"             TEXT    NOT NULL,
  "title"            TEXT    NOT NULL,
  "notes"            TEXT,
  "modifier"         TEXT,
  "rvu_total"        INTEGER,
  "rvu_professional" INTEGER,
  "rvu_technical"    INTEGER,
  "rvu_anesthesia"   INTEGER,
  "anesthesia_flat"  BOOLEAN NOT NULL DEFAULT false,
  "version"          TEXT    NOT NULL,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "service_codes_pkey" PRIMARY KEY ("code")
);
CREATE INDEX "service_codes_title_idx" ON "service_codes"("title");

CREATE TABLE "tariffs" (
  "id"           SERIAL       NOT NULL,
  "year"         TEXT         NOT NULL,
  "sector"       TEXT         NOT NULL,
  "professional" INTEGER      NOT NULL,
  "technical"    INTEGER      NOT NULL,
  "anesthesia"   INTEGER      NOT NULL,
  "active"       BOOLEAN      NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tariffs_year_sector_key" ON "tariffs"("year", "sector");

ALTER TABLE "procedure_types" ADD COLUMN "service_code_ref" TEXT;
ALTER TABLE "procedure_types"
  ADD CONSTRAINT "procedure_types_service_code_ref_fkey"
  FOREIGN KEY ("service_code_ref") REFERENCES "service_codes"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- عکسِ لحظهٔ صدور روی قلمِ صورت‌حساب: فاکتورِ صادرشده نباید با ویرایشِ بعدیِ
-- کتاب تغییر کند، و بیمه همین رشته را می‌خواهد.
ALTER TABLE "charges" ADD COLUMN "service_code" TEXT;
