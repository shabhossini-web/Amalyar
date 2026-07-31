-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "case_cost" INTEGER,
ADD COLUMN     "payer" TEXT NOT NULL DEFAULT 'patient',
ADD COLUMN     "payer_hospital_id" INTEGER,
ADD COLUMN     "surgeon_share_kind" TEXT,
ADD COLUMN     "surgeon_share_value" INTEGER;

-- CreateTable
CREATE TABLE "surgeon_contracts" (
    "id" SERIAL NOT NULL,
    "surgeon_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "percent" INTEGER,
    "amount" INTEGER,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgeon_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "color" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" SERIAL NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "revenue" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "superseded_at" TIMESTAMP(3),
    "finalized_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_entries" (
    "id" SERIAL NOT NULL,
    "settlement_id" INTEGER NOT NULL,
    "party" TEXT NOT NULL,
    "party_id" INTEGER,
    "party_name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "basis" JSONB,

    CONSTRAINT "share_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "surgeon_contracts_surgeon_id_effective_from_idx" ON "surgeon_contracts"("surgeon_id", "effective_from");

-- CreateIndex
CREATE INDEX "settlements_visit_id_superseded_at_idx" ON "settlements"("visit_id", "superseded_at");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_visit_id_version_key" ON "settlements"("visit_id", "version");

-- CreateIndex
CREATE INDEX "share_entries_settlement_id_idx" ON "share_entries"("settlement_id");

-- CreateIndex
CREATE INDEX "share_entries_party_party_id_idx" ON "share_entries"("party", "party_id");

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_payer_hospital_id_fkey" FOREIGN KEY ("payer_hospital_id") REFERENCES "hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgeon_contracts" ADD CONSTRAINT "surgeon_contracts_surgeon_id_fkey" FOREIGN KEY ("surgeon_id") REFERENCES "surgeons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_entries" ADD CONSTRAINT "share_entries_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

