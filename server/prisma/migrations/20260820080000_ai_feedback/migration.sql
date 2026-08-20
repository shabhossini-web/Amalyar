-- اصلاح‌های کاربر روی پیش‌نویس‌های دستیار (یادگیریِ retrieval)
CREATE TABLE IF NOT EXISTS "ai_feedback" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "draft" TEXT NOT NULL,
    "final" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_feedback_kind_created_at_idx" ON "ai_feedback"("kind", "created_at");
