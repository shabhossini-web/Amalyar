-- AlterTable
ALTER TABLE "intake_submissions" ADD COLUMN     "approval_key" TEXT,
ADD COLUMN     "approval_result" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "intake_submissions_approval_key_key" ON "intake_submissions"("approval_key");
