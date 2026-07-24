CREATE TABLE "platform_otps" (
    "id" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_otps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "csrf_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provisioning_jobs" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "tenant_id" TEXT,
    "requested_by_hash" TEXT NOT NULL,
    "error_code" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "provisioning_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_audit_events" (
    "id" TEXT NOT NULL,
    "actor_hash" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "ip_hash" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_otps_phone_hash_created_at_idx" ON "platform_otps"("phone_hash", "created_at");
CREATE UNIQUE INDEX "platform_sessions_token_hash_key" ON "platform_sessions"("token_hash");
CREATE INDEX "platform_sessions_phone_hash_expires_at_idx" ON "platform_sessions"("phone_hash", "expires_at");
CREATE UNIQUE INDEX "provisioning_jobs_slug_key" ON "provisioning_jobs"("slug");
CREATE UNIQUE INDEX "provisioning_jobs_hostname_key" ON "provisioning_jobs"("hostname");
CREATE INDEX "provisioning_jobs_status_created_at_idx" ON "provisioning_jobs"("status", "created_at");
CREATE INDEX "platform_audit_events_created_at_idx" ON "platform_audit_events"("created_at");
CREATE INDEX "platform_audit_events_actor_hash_created_at_idx" ON "platform_audit_events"("actor_hash", "created_at");
