-- نامهٔ اداری — سندِ رسمیِ چاپ‌شونده روی سربرگِ شرکت (idempotent برای نصب‌های موجود)
CREATE TABLE IF NOT EXISTS "letters" (
    "id" SERIAL NOT NULL,
    "no" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachment" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "letters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "letters_no_key" ON "letters"("no");
CREATE INDEX IF NOT EXISTS "letters_created_at_idx" ON "letters"("created_at");
