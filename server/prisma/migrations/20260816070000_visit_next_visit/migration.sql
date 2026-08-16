-- «ویزیتِ بعدی» روی خودِ مراجعه — پایهٔ فازِ یادآوری‌ها (docs/BOOKING.md).
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "next_visit_date" TIMESTAMP(3);
