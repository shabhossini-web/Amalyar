-- پیکربندیِ مرکزیِ هوشِ مصنوعی («مادر») — شرکت‌ها پیش‌فرض از همین می‌خوانند (idempotent)
CREATE TABLE IF NOT EXISTS "central_ai_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL DEFAULT 'custom',
    "base_url" TEXT NOT NULL DEFAULT '',
    "api_key" TEXT NOT NULL DEFAULT '',
    "model_chat" TEXT NOT NULL DEFAULT '',
    "model_vision" TEXT NOT NULL DEFAULT '',
    "model_stt" TEXT NOT NULL DEFAULT '',
    "model_tts" TEXT NOT NULL DEFAULT '',
    "model_image" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "central_ai_config_pkey" PRIMARY KEY ("id")
);
