-- چتِ سازمانی — کانال (dm/گروه)، عضویت با نشانگرِ خوانده، پیام (idempotent)
CREATE TABLE IF NOT EXISTS "chat_channels" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'dm',
    "name" TEXT,
    "dm_key" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_channels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "chat_channels_dm_key_key" ON "chat_channels"("dm_key");

CREATE TABLE IF NOT EXISTS "chat_members" (
    "id" SERIAL NOT NULL,
    "channel_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "last_read_id" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "chat_members_channel_id_account_id_key" ON "chat_members"("channel_id", "account_id");
CREATE INDEX IF NOT EXISTS "chat_members_account_id_idx" ON "chat_members"("account_id");

CREATE TABLE IF NOT EXISTS "chat_messages" (
    "id" SERIAL NOT NULL,
    "channel_id" INTEGER NOT NULL,
    "author_id" INTEGER NOT NULL,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "chat_messages_channel_id_id_idx" ON "chat_messages"("channel_id", "id");

DO $$ BEGIN
  ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
