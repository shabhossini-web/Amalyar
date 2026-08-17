-- تعرفه‌های سراسری — سالی یک‌بار، برای همهٔ شرکت‌ها یکسان.
CREATE TABLE IF NOT EXISTS "central_tariffs" (
    "id" SERIAL NOT NULL,
    "year" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "professional" INTEGER NOT NULL,
    "technical" INTEGER NOT NULL,
    "anesthesia" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "central_tariffs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "central_tariffs_year_sector_key" ON "central_tariffs"("year", "sector");
