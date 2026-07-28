-- مالیِ مراجعه از دو ستونِ سرجمع به ردیف‌های مستقل.
--
-- ⚠️ ستون‌های visits.amount/paid عملاً همیشه صفر بودند: DTO قبولشان می‌کرد ولی
-- سرویس هرگز نمی‌نوشتشان. با این حال اگر نصبی مقدارِ غیرصفر داشته باشد،
-- پیش از حذفِ ستون به ردیف تبدیل می‌شود تا هیچ عددی گم نشود.

CREATE TABLE "charges" (
  "id"            SERIAL       NOT NULL,
  "visit_id"      INTEGER      NOT NULL,
  "kind"          TEXT         NOT NULL DEFAULT 'service',
  "title"         TEXT         NOT NULL,
  "quantity"      INTEGER      NOT NULL DEFAULT 1,
  "unit_price"    INTEGER      NOT NULL,
  "amount"        INTEGER      NOT NULL,
  "notes"         TEXT,
  "created_by_id" INTEGER,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "charges_visit_id_idx" ON "charges"("visit_id");
ALTER TABLE "charges"
  ADD CONSTRAINT "charges_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payments" (
  "id"            SERIAL       NOT NULL,
  "visit_id"      INTEGER      NOT NULL,
  "amount"        INTEGER      NOT NULL,
  "method"        TEXT         NOT NULL DEFAULT 'cash',
  "paid_at"       TIMESTAMP(3) NOT NULL,
  "reference"     TEXT,
  "notes"         TEXT,
  "created_by_id" INTEGER,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payments_visit_id_idx" ON "payments"("visit_id");
CREATE INDEX "payments_paid_at_idx"  ON "payments"("paid_at");
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- انتقالِ مقادیرِ غیرصفرِ احتمالی
INSERT INTO "charges" ("visit_id", "kind", "title", "quantity", "unit_price", "amount", "created_at")
SELECT v."id", 'service', 'مبلغِ مراجعه', 1, v."amount", v."amount", v."created_at"
  FROM "visits" v WHERE v."amount" <> 0;

INSERT INTO "payments" ("visit_id", "amount", "method", "paid_at", "notes", "created_at")
SELECT v."id", v."paid", 'cash', COALESCE(v."op_date", v."created_at"), 'منتقل‌شده از ستونِ قدیمِ paid', v."created_at"
  FROM "visits" v WHERE v."paid" <> 0;

ALTER TABLE "visits" DROP COLUMN "amount", DROP COLUMN "paid";
