ALTER TABLE "accounts" ADD COLUMN "system_key" TEXT;
CREATE UNIQUE INDEX "accounts_system_key_key" ON "accounts"("system_key");
ALTER TABLE "reminders"
 ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'sms',
 ADD COLUMN "dedupe_key" TEXT,
 ADD COLUMN "recipient_account_id" INTEGER,
 ADD COLUMN "recipient_name" TEXT,
 ADD COLUMN "chat_message_id" INTEGER,
 ADD COLUMN "provider_id" TEXT,
 ADD COLUMN "delivery_status" TEXT NOT NULL DEFAULT 'unknown',
 ADD COLUMN "attempted_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "reminders_dedupe_key_key" ON "reminders"("dedupe_key");
CREATE TABLE "hospital_duties" (
 "id" SERIAL NOT NULL PRIMARY KEY,
 "date" DATE NOT NULL,
 "hospital_id" INTEGER NOT NULL REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "tech_id" INTEGER NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "arrive_time" TEXT NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "hospital_duties_date_hospital_id_tech_id_key" ON "hospital_duties"("date", "hospital_id", "tech_id");
CREATE INDEX "hospital_duties_tech_id_date_idx" ON "hospital_duties"("tech_id", "date");
