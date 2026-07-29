-- ساعتِ عمل و حضورِ کارشناس.
--
-- TEXT و نه TIMESTAMP: این‌ها ساعتِ ساعتِ دیوارند («۰۸:۳۰»)، نه لحظه‌ای روی خطِ
-- زمان. چسباندنشان به تاریخِ عمل و ذخیره به‌شکلِ timestamp، عملِ ۲۳:۳۰ را با یک
-- جابه‌جاییِ منطقهٔ زمانی به روزِ بعد می‌برد.

ALTER TABLE "visits" ADD COLUMN "op_start_time"       TEXT;
ALTER TABLE "visits" ADD COLUMN "op_end_time"         TEXT;
ALTER TABLE "visits" ADD COLUMN "tech_arrive_time"    TEXT;
ALTER TABLE "visits" ADD COLUMN "op_times_updated_at" TIMESTAMP(3);
