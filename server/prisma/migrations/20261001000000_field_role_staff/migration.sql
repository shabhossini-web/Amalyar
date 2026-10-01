-- حسابِ «راننده/پیک» بدونِ رکوردِ نیرو (گزارشِ مالک ۱۴۰۵/۰۷/۰۹، حسابِ «test car»).
-- نقشی که از صفحهٔ کاربران ست می‌شد رکوردِ `transport_staff` نمی‌ساخت؛ پس کاشیِ «حمل‌ونقل»
-- پنهان بود و پرتالِ راننده خطا می‌داد. این‌جا فقط کمبود پر می‌شود: رکوردی که هست دست نمی‌خورد.
INSERT INTO "transport_staff" ("person_id", "role")
SELECT a."person_id", a."job_role"
FROM "accounts" a
WHERE a."job_role" IN ('driver', 'courier')
  AND a."status" = 'active'
  AND a."system_key" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "transport_staff" s WHERE s."person_id" = a."person_id");
