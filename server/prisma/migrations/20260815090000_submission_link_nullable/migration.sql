-- ثبت‌نامِ مستقیم (ارسالِ فرم از کارتِ مراجعه) لینکِ عمومی ندارد؛ و حذفِ
-- لینک نباید ثبت‌نام‌های پرشده را پاک کند — SetNull به‌جای Cascade.
ALTER TABLE intake_submissions ALTER COLUMN link_id DROP NOT NULL;
ALTER TABLE intake_submissions DROP CONSTRAINT IF EXISTS intake_submissions_link_id_fkey;
ALTER TABLE intake_submissions
  ADD CONSTRAINT intake_submissions_link_id_fkey
  FOREIGN KEY (link_id) REFERENCES intake_links(id) ON DELETE SET NULL;
