-- «لقمان»، «لقمان حکیم»، «بیمارستان لقمان» یک جا هستند ولی چهار رشتهٔ متفاوت.
-- این جدول حافظهٔ تصمیمِ آدم است، نه حدسِ ماشین.
CREATE TABLE "hospital_aliases" (
    "id" SERIAL NOT NULL,
    "hospital_id" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,
    "alias_norm" TEXT NOT NULL,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospital_aliases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hospital_aliases_alias_norm_key" ON "hospital_aliases"("alias_norm");
CREATE INDEX "hospital_aliases_hospital_id_idx" ON "hospital_aliases"("hospital_id");
ALTER TABLE "hospital_aliases" ADD CONSTRAINT "hospital_aliases_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
