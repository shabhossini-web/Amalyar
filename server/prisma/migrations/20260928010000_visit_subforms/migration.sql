-- زیرفرم‌های الصاقی + منتخب‌های شخصی (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳).
--
-- «هر چیزی که به مراجعه اضافه می‌کنیم در قالبِ فرم‌های زیرِ مراجعه باشد — پیش‌فرض پنهان،
-- با الصاق نمایش.» یک ردیف = «این زیرفرم روی این مراجعه است»؛ پاسخِ زیرفرم‌های فرم‌ساز در
-- `data`. علائمِ حیاتی و سفارش‌ها داده‌شان جای خودش است و این‌جا فقط الصاقشان می‌نشیند.
--
-- هر دو تغییر افزایشی‌اند: جدولِ تازه و یک ستونِ با پیش‌فرض. هیچ ردیفِ موجودی دست نمی‌خورد.

CREATE TABLE "visit_subforms" (
    "id" SERIAL NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "form_id" INTEGER,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_subforms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "visit_subforms_visit_id_key_key" ON "visit_subforms"("visit_id", "key");
CREATE INDEX "visit_subforms_form_id_idx" ON "visit_subforms"("form_id");
CREATE INDEX "visit_subforms_key_idx" ON "visit_subforms"("key");

ALTER TABLE "visit_subforms" ADD CONSTRAINT "visit_subforms_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_subforms" ADD CONSTRAINT "visit_subforms_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "form_defs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- منتخب‌های شخصی — سه «فرمِ منتخب» و سه «ابزارکِ منتخب». شکلش را فقط `auth/prefs` می‌سنجد.
ALTER TABLE "accounts" ADD COLUMN "prefs" JSONB NOT NULL DEFAULT '{}';
