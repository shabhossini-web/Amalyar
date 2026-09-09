-- prisma migrate diff against migration shadow; unrelated existing drift excluded.
ALTER TABLE "visits" ADD COLUMN "required_items" JSONB,
ADD COLUMN "surgeon_instructions" TEXT;
