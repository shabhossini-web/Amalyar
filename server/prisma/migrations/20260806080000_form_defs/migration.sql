-- تعریفِ فرم به‌شکلِ داده، نه کد.
--
-- ⚠️ فیلدهای هسته‌ای هم ردیف می‌گیرند (builtin = true) — نه فقط فیلدهای دلخواه.
-- دلیلش این است که «اجباری‌بودن» باید یک منبع داشته باشد: اگر ستارهٔ «جراح» در
-- کد بماند و ستارهٔ فیلدِ دلخواه در دیتابیس، کاربر نمی‌فهمد چرا بعضی ستاره‌ها
-- قابلِ تغییرند و بعضی نه.

CREATE TABLE IF NOT EXISTS "form_defs" (
  "id"         SERIAL       PRIMARY KEY,
  "key"        TEXT         NOT NULL,
  "title"      TEXT         NOT NULL,
  "scope"      TEXT         NOT NULL,
  "visit_kind" TEXT,
  "hint"       TEXT,
  "active"     BOOLEAN      NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "form_defs_key_key"      ON "form_defs" ("key");
CREATE        INDEX IF NOT EXISTS "form_defs_scope_active" ON "form_defs" ("scope", "active");

CREATE TABLE IF NOT EXISTS "form_fields" (
  "id"          SERIAL       PRIMARY KEY,
  "form_id"     INTEGER      NOT NULL,
  "key"         TEXT         NOT NULL,
  "label"       TEXT         NOT NULL,
  "type"        TEXT         NOT NULL DEFAULT 'text',
  "required"    BOOLEAN      NOT NULL DEFAULT false,
  "options"     JSONB        NOT NULL DEFAULT '[]',
  "hint"        TEXT,
  "placeholder" TEXT,
  "sort"        INTEGER      NOT NULL DEFAULT 0,
  "builtin"     BOOLEAN      NOT NULL DEFAULT false,
  "active"      BOOLEAN      NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "form_fields_form_id_fkey" FOREIGN KEY ("form_id")
    REFERENCES "form_defs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "form_fields_form_id_key_key"  ON "form_fields" ("form_id", "key");
CREATE        INDEX IF NOT EXISTS "form_fields_form_id_sort_idx" ON "form_fields" ("form_id", "sort");

-- پاسخِ فیلدهای **دلخواه** یک مراجعه. فیلدهای هسته‌ای ستونِ خودشان را دارند و
-- هرگز این‌جا نمی‌آیند — همان قرارِ intake_submissions.data.
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "extra" JSONB NOT NULL DEFAULT '{}';
