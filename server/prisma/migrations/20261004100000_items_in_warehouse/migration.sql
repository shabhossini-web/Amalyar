-- دو تیکِ تعریفِ کالا (مالک، ۱۴۰۵/۰۷/۱۱؛ بستهٔ ب): «نمایش در پنلِ کارشناسی» و «یک‌بار/چندبارمصرف».
-- چندبارمصرف با مصرف از موجودی کم نمی‌شود — فقط با خرابی، که به محلِ «خرابی‌ها» می‌رود.
-- ست و دستگاه (برگشتی) ذاتاً چندبارمصرف‌اند؛ بقیه یک‌بارمصرف می‌مانند تا کسی خودش عوض کند.
ALTER TABLE "items"
  ADD COLUMN "show_in_tech_panel" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "usage_mode" TEXT NOT NULL DEFAULT 'single';
UPDATE "items" SET "usage_mode" = 'multi' WHERE "asset_kind" IN ('set', 'device');
