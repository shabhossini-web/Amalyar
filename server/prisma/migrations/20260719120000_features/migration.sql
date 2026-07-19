-- CreateTable
CREATE TABLE "features" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "min_level" INTEGER NOT NULL DEFAULT 6,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "features_key_key" ON "features"("key");

