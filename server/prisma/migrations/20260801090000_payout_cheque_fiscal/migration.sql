-- CreateTable
CREATE TABLE "payouts" (
    "id" SERIAL NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "party" TEXT NOT NULL,
    "party_id" INTEGER,
    "party_name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "bank_account_id" INTEGER,
    "reference" TEXT,
    "notes" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheques" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "bank_name" TEXT,
    "amount" INTEGER NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL,
    "party_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "status_at" TIMESTAMP(3),
    "bank_account_id" INTEGER,
    "visit_id" INTEGER,
    "payout_id" INTEGER,
    "notes" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "closed_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payouts_visit_id_idx" ON "payouts"("visit_id");

-- CreateIndex
CREATE INDEX "payouts_party_party_id_idx" ON "payouts"("party", "party_id");

-- CreateIndex
CREATE INDEX "payouts_paid_at_idx" ON "payouts"("paid_at");

-- CreateIndex
CREATE INDEX "cheques_status_due_at_idx" ON "cheques"("status", "due_at");

-- CreateIndex
CREATE INDEX "cheques_direction_idx" ON "cheques"("direction");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_title_key" ON "fiscal_years"("title");

-- CreateIndex
CREATE INDEX "fiscal_years_starts_at_ends_at_idx" ON "fiscal_years"("starts_at", "ends_at");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

