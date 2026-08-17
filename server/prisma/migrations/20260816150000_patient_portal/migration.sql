-- پروندهٔ الکترونیکِ بیمار — لینکِ دائمیِ /p/<token>
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "portal_token" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "patients_portal_token_key" ON "patients"("portal_token");
