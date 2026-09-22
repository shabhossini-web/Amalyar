-- «شکایتِ اولیه» ستونِ واقعیِ مراجعه می‌شود، نه کلیدی در `extra`.
--
-- ⚠️ چرا ستون و نه JSON: همان قاعدهٔ همیشگیِ پروژه — چیزی که رویش گزارش
-- می‌گیریم یا join می‌کنیم باید ستون باشد. ولی دلیلِ فوری‌اش این بود که
-- شکایتی که منشی در ویزیت ثبت می‌کرد در میزِ اتاقِ عمل **وجود نداشت**:
-- `extra` کیسهٔ پاسخِ همان فرم است و هر میز فرمِ خودش را می‌خواند، پس دو
-- کپیِ بی‌خبر از هم می‌شد نه یک داده.
ALTER TABLE "visits" ADD COLUMN "chief_complaint" TEXT;

-- «این عمل از کدام ویزیت درآمد؟» — پیوندی که ارث‌بریِ شکایتِ اولیه رویش سوار است.
--
-- ⚠️ جدا از `follow_of_visit_id` است و نباید با آن یکی شود: آن یکی «اولین
-- مراجعهٔ **بعد از** این عمل» را می‌گوید (زنجیرهٔ پست‌آپ) و جهتش دقیقاً
-- برعکسِ این است. یکی‌کردنشان یعنی `syncPostOpVisit` عملِ تصمیم‌گرفته‌شده را
-- فرزندِ پست‌آپ بخواند و تاریخش را با `next_visit_date` بازنویسی کند.
ALTER TABLE "visits" ADD COLUMN "decided_in_visit_id" INTEGER;

CREATE INDEX "visits_decided_in_visit_id_idx" ON "visits"("decided_in_visit_id");

-- حذفِ ویزیتِ تصمیم، عمل را نمی‌برد — فقط ارث‌بری‌اش را قطع می‌کند.
ALTER TABLE "visits" ADD CONSTRAINT "visits_decided_in_visit_id_fkey"
    FOREIGN KEY ("decided_in_visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- مهاجرتِ مقادیرِ موجود از `extra` به ستون.
--
-- ⚠️ کلید از `extra` **برداشته** می‌شود، نه اینکه کپی شود: دو نسخه از یک
-- داده یعنی اولین ویرایش یکی‌شان را کهنه می‌کند و هیچ‌کس نمی‌فهمد کدام
-- درست است. عملگرِ `?` عمداً استفاده نشده (`-> IS NOT NULL` معادلِ امنش است)
-- تا هیچ لایه‌ای آن را علامتِ پارامتر نخواند.
UPDATE "visits"
   SET "chief_complaint" = NULLIF(btrim("extra" ->> 'chiefComplaint'), ''),
       "extra" = "extra" - 'chiefComplaint'
 WHERE jsonb_typeof("extra") = 'object'
   AND "extra" -> 'chiefComplaint' IS NOT NULL
   AND jsonb_typeof("extra" -> 'chiefComplaint') = 'string';
