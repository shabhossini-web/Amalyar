-- AlterTable
ALTER TABLE "hospitals" ADD COLUMN     "sector" TEXT NOT NULL DEFAULT 'private';

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "invoice_bank_account_id" INTEGER,
ADD COLUMN     "invoice_type" TEXT;

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "classification" TEXT NOT NULL DEFAULT 'unclassified';

-- AlterTable
ALTER TABLE "form_fields" ADD COLUMN     "roles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_invoice_bank_account_id_fkey" FOREIGN KEY ("invoice_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve legacy field ownership; role remains the first entry for older clients.
UPDATE "form_fields" SET "roles" = ARRAY["role"] WHERE "role" IS NOT NULL;
