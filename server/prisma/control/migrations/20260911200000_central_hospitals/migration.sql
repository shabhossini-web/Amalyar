CREATE TABLE "central_hospitals" (
"id" TEXT NOT NULL, "source_key" TEXT NOT NULL, "name" TEXT NOT NULL,
"province" TEXT, "city" TEXT, "address" TEXT, "phone" TEXT, "sector" TEXT, "website" TEXT,
"source_url" TEXT, "source_name" TEXT, "checked_at" TIMESTAMP(3),
"verified" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT true,
"search_text" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "central_hospitals_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "central_hospitals_source_key_key" ON "central_hospitals"("source_key");
CREATE INDEX "central_hospitals_province_city_idx" ON "central_hospitals"("province", "city");
