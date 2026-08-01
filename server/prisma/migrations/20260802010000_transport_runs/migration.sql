-- دانهٔ درستِ حمل «مسیر» است نه «عمل»: راننده یک ست را به یک بیمارستان نمی‌برد،
-- چند ست را به ترتیب به چند بیمارستان می‌برد و عصر جمع می‌کند.

CREATE TABLE "transport_runs" (
    "id" SERIAL NOT NULL,
    "staff_id" INTEGER NOT NULL,
    "run_date" TIMESTAMP(3) NOT NULL,
    "vehicle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "notes" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "transport_runs_run_date_staff_id_idx" ON "transport_runs"("run_date", "staff_id");
ALTER TABLE "transport_runs" ADD CONSTRAINT "transport_runs_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "transport_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "transport_stops" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "hospital_id" INTEGER,
    "location_name" TEXT,
    "kind" TEXT NOT NULL,
    "planned_at" TEXT,
    "done_at" TIMESTAMP(3),
    "handed_to" TEXT,
    "notes" TEXT,

    CONSTRAINT "transport_stops_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "transport_stops_run_id_seq_key" ON "transport_stops"("run_id", "seq");
CREATE INDEX "transport_stops_run_id_idx" ON "transport_stops"("run_id");
ALTER TABLE "transport_stops" ADD CONSTRAINT "transport_stops_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "transport_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transport_stops" ADD CONSTRAINT "transport_stops_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- حواله به توقف گره می‌خورد؛ «رانندهٔ این عمل» از همین‌جا مشتق می‌شود.
ALTER TABLE "stock_transfers" ADD COLUMN "stop_id" INTEGER;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "transport_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- تخصیصِ per-visit حذف می‌شود: دو منبع برای «چه کسی این بار را می‌برد» یعنی دو
-- جواب. تخصیص‌های موجود آزمونی‌اند و مسیرِ متناظر ندارند.
DROP TABLE "visit_assignments";
