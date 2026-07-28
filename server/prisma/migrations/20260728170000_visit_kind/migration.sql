-- نوعِ ملاقات. رکوردهای موجود همه «عمل»اند (نورومانیتورینگ)، پس پیش‌فرضِ
-- surgery هم برای ستونِ جدید و هم برای backfill درست است.
ALTER TABLE "visits" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'surgery';
CREATE INDEX "visits_kind_idx" ON "visits"("kind");
