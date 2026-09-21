-- بنیان‌گذارِ یک نصبِ مطب باید نقشِ شغلیِ «پزشک» داشته باشد.
--
-- `auth.service.ts` این را فقط لحظهٔ ثبت‌نام و فقط اگر حوزه از قبل `clinic` باشد
-- می‌داد؛ ولی پیش‌فرضِ حوزه `ionm` است و صاحبِ مطب بعد از ثبت‌نام عوضش می‌کند،
-- پس روی هر نصبِ مطبِ واقعی `job_role` خالی مانده. نتیجه: صفِ نقشِ `doctor`
-- (کارِ «بررسیِ نتیجه») هیچ‌وقت به او نمی‌رسید و «کارهای من» همیشه خالی بود.
--
-- فقط نصبی که **یک** سوپرادمینِ فعال دارد — یعنی مطبِ تک‌پزشکه. با چند
-- سوپرادمین نمی‌شود حدس زد کدام پزشک است، و حدسِ غلط یعنی کارِ بررسیِ نتیجهٔ
-- پزشکی روی میزِ آدمِ اشتباه.
UPDATE "accounts" SET "job_role" = 'doctor'
WHERE "job_role" IS NULL
  AND "level" = 6
  AND "status" = 'active'
  AND EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'vertical' AND "value" = 'clinic')
  AND (SELECT COUNT(*) FROM "accounts" WHERE "level" = 6 AND "status" = 'active') = 1;

-- و همان قرارِ «حسابِ پزشک همیشه تعریفِ جراح دارد» برای همان حساب.
INSERT INTO "surgeons" ("person_id")
SELECT a."person_id" FROM "accounts" a
WHERE a."job_role" = 'doctor'
  AND NOT EXISTS (SELECT 1 FROM "surgeons" s WHERE s."person_id" = a."person_id")
ON CONFLICT DO NOTHING;
