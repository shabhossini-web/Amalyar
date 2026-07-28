-- تنظیماتِ سطحِ شرکت (کلید/مقدار). فعلاً حوزهٔ کاری و نامِ برند.
CREATE TABLE "settings" (
  "key"        TEXT         NOT NULL,
  "value"      TEXT         NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);
