ALTER TABLE "people" ADD COLUMN "phone_scope" TEXT NOT NULL DEFAULT 'primary';
DROP INDEX "people_phone_key";
CREATE UNIQUE INDEX "people_phone_phone_scope_key" ON "people"("phone", "phone_scope");
