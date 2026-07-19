-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "birth_date" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "hospital_id" INTEGER,
ADD COLUMN     "op_type" TEXT,
ADD COLUMN     "surgeon_id" INTEGER,
ADD COLUMN     "tech_id" INTEGER;

-- CreateTable
CREATE TABLE "surgeons" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgeons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospitals" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospitals_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_surgeon_id_fkey" FOREIGN KEY ("surgeon_id") REFERENCES "surgeons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_tech_id_fkey" FOREIGN KEY ("tech_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

