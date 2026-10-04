-- تحویلِ دوطرفه (مالک، ۱۴۰۵/۰۷/۱۱): «ثبتِ تحویل»ِ راننده حواله را ارسال می‌کند و کارشناس باید
-- «تحویل گرفتم» را بزند. تا امروز راننده «تحویل داده شد» می‌زد ولی حواله `planned` می‌ماند و
-- پنلِ کارشناسی «هنوز ارسال نشده» نشان می‌داد. این ستون‌ها دستِ دومِ تحویل‌اند؛ تا خالی‌اند حواله
-- «منتظرِ تأییدِ کارشناس» است و آشکارسازِ لایهٔ کار (`delivery.unconfirmed`) برای دفتر کار می‌سازد.
ALTER TABLE "stock_transfers"
  ADD COLUMN "tech_received_at" TIMESTAMP(3),
  ADD COLUMN "tech_received_by_id" INTEGER,
  ADD COLUMN "tech_receipt_issue" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tech_receipt_note" TEXT;

-- کسری دو جا شمرده می‌شود: هنگامِ تحویل (کارشناس، `receipt`) و هنگامِ برگشت (دفتر، `return`).
-- ردیف‌های تا امروز همه از چک‌لیستِ برگشت‌اند.
ALTER TABLE "set_shortages" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'return';
