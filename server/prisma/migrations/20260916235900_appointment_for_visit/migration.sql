-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "for_visit_id" INTEGER;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_for_visit_id_fkey" FOREIGN KEY ("for_visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

