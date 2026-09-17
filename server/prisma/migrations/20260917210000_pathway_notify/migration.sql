-- «اطلاع‌رسانی و عدمِ پاسخ» روی گامِ دوره (W4.2 گامِ ۱).
--
-- ⚠️ هر سه nullable: گام‌های موجود پیامی نداشتند و نباید مقدارِ ساختگی بگیرند.
-- `reminder_id` عمداً کلیدِ خارجی **نیست**: یادآوری چرخهٔ عمرِ خودش را دارد
-- (ارسال، شکست، پاک‌سازیِ دوره‌ای) و نباید حذفش گامِ پرونده را با خودش ببرد.
ALTER TABLE "episode_steps"
  ADD COLUMN "notify" TEXT,
  ADD COLUMN "reminder_id" INTEGER,
  ADD COLUMN "escalate_days" INTEGER;
