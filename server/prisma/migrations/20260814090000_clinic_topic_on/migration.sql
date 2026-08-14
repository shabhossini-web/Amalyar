-- «شرحِ ویزیت» (topicId) روی فرم‌های مطب روشن می‌شود — یک‌بار.
--
-- backfillِ کاتالوگ این ردیف را «حاضر ولی خاموش» ساخته بود و پریستِ مطب هم
-- نداشتش؛ نتیجه: هیچ مطبی موضوعِ ویزیت (اولیه/پست‌آپ/زیبایی) را در فرمِ
-- ویزیت نمی‌دید — روی نصبِ واقعی گزارش شد. این مهاجرتِ داده‌ای فقط فرم‌های
-- «مطب‌گونه» را می‌گیرد (فرمی که ساعتِ شروعِ فعال ندارد): فرمِ عمل/
-- نورومانیتورینگ دست‌نخورده می‌ماند. عمداً migration است نه backfillِ هر
-- بوت: اگر سازنده بعداً خاموشش کند، باید خاموش بماند.
UPDATE form_fields ff
SET active = true
WHERE ff.key = 'topicId'
  AND ff.builtin = true
  AND ff.active = false
  AND NOT EXISTS (
    SELECT 1 FROM form_fields s
    WHERE s.form_id = ff.form_id
      AND s.key = 'opStartTime'
      AND s.active = true
  );
