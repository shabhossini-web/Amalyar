-- مسیرِ درمان (W4.1) — یافتهٔ A4.
--
-- ⚠️ این فایل **دستی** از خروجیِ `migrate diff` جدا شد و فقط چهار جدولِ تازه را
-- دارد. خروجیِ خام دریفتِ **از قبل موجودِ** دیتابیس را هم می‌آورد (drop/re-add
-- کلیدهای خارجیِ سفارش‌ها و یادآوری‌ها، `DROP DEFAULT` روی `updated_at`، و
-- حذفِ یک ایندکس) — هیچ‌کدام مالِ این بسته نیستند و اجرایشان روی نصبِ زنده
-- تغییرِ ناخواسته است. همان کاری که برای migrationِ «دلیلِ لغو» شد.
--
-- ⚠️ هیچ دادهٔ موجودی دست نمی‌خورد: فقط CREATE TABLE. نصبی که امروز کار می‌کند
-- بعد از این migration دقیقاً همان رفتار را دارد — تا وقتی کسی الگویی را
-- منتشر و دوره‌ای را شروع کند.

-- CreateTable
CREATE TABLE "pathway_templates" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "vertical" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pathway_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pathway_versions" (
    "id" SERIAL NOT NULL,
    "template_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "steps" JSONB NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pathway_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "template_id" INTEGER NOT NULL,
    "version_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "visit_id" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_by_id" INTEGER,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_steps" (
    "id" SERIAL NOT NULL,
    "episode_id" INTEGER NOT NULL,
    "key" TEXT,
    "title" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "owner_role" TEXT,
    "owner_id" INTEGER,
    "due_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "done_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pathway_templates_key_key" ON "pathway_templates"("key");

CREATE INDEX "pathway_versions_template_id_status_idx" ON "pathway_versions"("template_id", "status");

CREATE UNIQUE INDEX "pathway_versions_template_id_version_key" ON "pathway_versions"("template_id", "version");

CREATE INDEX "episodes_patient_id_status_idx" ON "episodes"("patient_id", "status");

CREATE INDEX "episode_steps_episode_id_seq_idx" ON "episode_steps"("episode_id", "seq");

CREATE INDEX "episode_steps_status_due_at_idx" ON "episode_steps"("status", "due_at");

ALTER TABLE "pathway_versions" ADD CONSTRAINT "pathway_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "pathway_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "episodes" ADD CONSTRAINT "episodes_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "episodes" ADD CONSTRAINT "episodes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "pathway_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "episodes" ADD CONSTRAINT "episodes_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "pathway_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "episodes" ADD CONSTRAINT "episodes_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "episode_steps" ADD CONSTRAINT "episode_steps_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "episode_steps" ADD CONSTRAINT "episode_steps_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
