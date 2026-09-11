-- سایتِ عمومیِ شرکت (لندینگِ tenant): متنِ بخش‌ها، روشن/خاموشِ بخش‌ها و قلم‌های محتوا.
-- CreateTable
CREATE TABLE "site_blocks" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_blocks_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "site_sections" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_sections_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "site_items" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "body" TEXT,
    "image_sha" TEXT,
    "image_mime" TEXT,
    "image2_sha" TEXT,
    "image2_mime" TEXT,
    "icon" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_items_kind_active_sort_idx" ON "site_items"("kind", "active", "sort");
