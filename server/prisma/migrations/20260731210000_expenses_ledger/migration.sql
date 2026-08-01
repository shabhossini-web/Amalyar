-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "bank_account_id" INTEGER,
ADD COLUMN     "received_by_id" INTEGER;

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" SERIAL NOT NULL,
    "owner_name" TEXT NOT NULL,
    "bank_name" TEXT,
    "card_number" TEXT,
    "iban" TEXT,
    "partner_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "amount" INTEGER NOT NULL,
    "spent_at" TIMESTAMP(3) NOT NULL,
    "bank_account_id" INTEGER,
    "paid_by_id" INTEGER,
    "notes" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_ledger" (
    "id" SERIAL NOT NULL,
    "entry_type" TEXT NOT NULL,
    "from_partner_id" INTEGER NOT NULL,
    "from_name" TEXT NOT NULL,
    "to_partner_id" INTEGER NOT NULL,
    "to_name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "visit_id" INTEGER,
    "visit_code" TEXT,
    "expense_id" INTEGER,
    "settlement_id" INTEGER,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "settled_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "entry_date" TIMESTAMP(3) NOT NULL,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_spent_at_idx" ON "expenses"("spent_at");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- CreateIndex
CREATE INDEX "partner_ledger_status_voided_at_idx" ON "partner_ledger"("status", "voided_at");

-- CreateIndex
CREATE INDEX "partner_ledger_from_partner_id_to_partner_id_idx" ON "partner_ledger"("from_partner_id", "to_partner_id");

-- CreateIndex
CREATE INDEX "partner_ledger_settlement_id_idx" ON "partner_ledger"("settlement_id");

-- CreateIndex
CREATE INDEX "partner_ledger_expense_id_idx" ON "partner_ledger"("expense_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

