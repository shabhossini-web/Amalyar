-- CreateTable
CREATE TABLE "patients" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "national_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "surgeon_name" TEXT,
    "hospital_name" TEXT,
    "op_date" TIMESTAMP(3),
    "op_status" TEXT NOT NULL DEFAULT 'pending',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "paid" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patients_code_key" ON "patients"("code");

-- CreateIndex
CREATE INDEX "patients_phone_idx" ON "patients"("phone");

-- CreateIndex
CREATE INDEX "visits_patient_id_idx" ON "visits"("patient_id");

-- CreateIndex
CREATE INDEX "visits_op_status_idx" ON "visits"("op_status");

-- CreateIndex
CREATE INDEX "visits_op_date_idx" ON "visits"("op_date");

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

