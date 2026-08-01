-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "job_role" TEXT;

-- CreateTable
CREATE TABLE "visit_assignments" (
    "id" SERIAL NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_assignments_visit_id_idx" ON "visit_assignments"("visit_id");

-- CreateIndex
CREATE INDEX "visit_assignments_account_id_idx" ON "visit_assignments"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "visit_assignments_visit_id_account_id_role_key" ON "visit_assignments"("visit_id", "account_id", "role");

-- AddForeignKey
ALTER TABLE "visit_assignments" ADD CONSTRAINT "visit_assignments_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_assignments" ADD CONSTRAINT "visit_assignments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

