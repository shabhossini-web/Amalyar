ALTER TABLE "hospitals" ADD COLUMN "central_id" TEXT, ADD COLUMN "central_snapshot" JSONB, ADD COLUMN "province" TEXT;
CREATE UNIQUE INDEX "hospitals_central_id_key" ON "hospitals"("central_id");
