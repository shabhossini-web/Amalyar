-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "content_text" TEXT,
ADD COLUMN     "ref_id" INTEGER,
ADD COLUMN     "ref_type" TEXT;

-- AlterTable
ALTER TABLE "lab_orders" ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_id" INTEGER;

-- AlterTable
ALTER TABLE "imaging_orders" ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_id" INTEGER;

-- AlterTable
ALTER TABLE "consult_orders" ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_id" INTEGER;

-- AlterTable
ALTER TABLE "referral_orders" ADD COLUMN     "answer_link" TEXT,
ADD COLUMN     "answer_text" TEXT,
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_id" INTEGER;

-- CreateIndex
CREATE INDEX "documents_ref_type_ref_id_idx" ON "documents"("ref_type", "ref_id");

