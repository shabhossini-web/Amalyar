-- تصمیمِ درمانیِ ویزیت (چندتایی: مثلاً آزمایش + مشاوره)
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "decisions" TEXT[] NOT NULL DEFAULT '{}';

-- چهار موضوعِ استانداردِ ویزیت — «اولیه، پره‌آپ، پست‌آپ، پیگیریِ درمان».
-- idempotent: نامِ موضوع یکتاست، پس نصبِ دوباره چیزی تکرار نمی‌کند و
-- موضوع‌های دست‌سازِ مشتری هم دست نمی‌خورند.
INSERT INTO "visit_topics" (name, color, sort, active, created_at) VALUES
  ('ویزیتِ اولیه',            'sky',    10, TRUE, NOW()),
  ('ویزیتِ قبل از عمل (پره‌آپ)', 'amber', 20, TRUE, NOW()),
  ('ویزیتِ بعد از عمل (پست‌آپ)', 'emerald', 30, TRUE, NOW()),
  ('پیگیریِ درمان',           'violet', 40, TRUE, NOW())
ON CONFLICT (name) DO NOTHING;

-- «فرمِ پیگیری» گمراه‌کننده بود: پیگیری یک **موضوعِ ویزیت** است، نه نوعِ
-- جدای مراجعه. از فهرستِ ساختِ مراجعه برداشته می‌شود؛ مراجعاتِ ثبت‌شده با
-- این نوع دست نمی‌خورند و در پرونده و فهرست خوانده می‌شوند.
UPDATE "form_defs" SET active = FALSE WHERE key = 'visit.followup';
