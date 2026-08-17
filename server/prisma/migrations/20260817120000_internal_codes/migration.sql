-- کدهای داخلیِ مطب (جراحی/خدمتِ داخلِ مطب) + منبعِ کد روی قلمِ فاکتور
CREATE TABLE IF NOT EXISTS "internal_codes" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "internal_codes_code_key" ON "internal_codes"("code");

ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "code_system" TEXT;
