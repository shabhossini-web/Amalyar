-- حذفِ شرکت هم مثلِ ساختِ آن از صف عبور می‌کند: API فقط درخواست را ثبت می‌کند و
-- تنها Worker (که credentialِ CREATEDB/CREATEROLE دارد) دیتابیس و نقش را حذف می‌کند.
CREATE TABLE "tenant_deletion_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "requested_by_hash" TEXT NOT NULL,
    "error_code" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "tenant_deletion_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_deletion_jobs_status_created_at_idx" ON "tenant_deletion_jobs"("status", "created_at");
CREATE INDEX "tenant_deletion_jobs_tenant_id_idx" ON "tenant_deletion_jobs"("tenant_id");

-- یک شرکت نباید هم‌زمان دو درخواستِ حذفِ باز داشته باشد.
CREATE UNIQUE INDEX "tenant_deletion_jobs_open_tenant_key"
    ON "tenant_deletion_jobs"("tenant_id")
    WHERE "status" IN ('queued', 'running');
