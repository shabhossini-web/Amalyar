-- نقش در ماتریسِ دسترسی — AND با سطح؛ آرایهٔ خالی یعنی بدونِ قیدِ نقش.
ALTER TABLE "features" ADD COLUMN IF NOT EXISTS "roles" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "roles" JSONB NOT NULL DEFAULT '[]';
