-- بستهٔ ۸ — ردِ منشأِ «افزودن به پیش‌فرض» روی قالب‌های شرح.
--
-- قالب به همهٔ همکاران نشان داده می‌شود؛ اگر روزی متنی با نام یا مشخصاتِ بیمار
-- قالب شد، باید بشود فهمید از کدام مراجعه و به دستِ چه کسی آمده و پاکش کرد.
-- تا امروز این فقط در ممیزی بود. شناسهٔ خام است نه کلیدِ خارجی (مثلِ
-- `clinical_notes.author_id`): حذفِ حساب یا مراجعه نباید قالب را بشکند.
ALTER TABLE "note_templates" ADD COLUMN IF NOT EXISTS "created_by_id" INTEGER;
ALTER TABLE "note_templates" ADD COLUMN IF NOT EXISTS "created_by_name" TEXT;
ALTER TABLE "note_templates" ADD COLUMN IF NOT EXISTS "source_visit_id" INTEGER;
CREATE INDEX IF NOT EXISTS "note_templates_source_visit_id_idx" ON "note_templates" ("source_visit_id");
