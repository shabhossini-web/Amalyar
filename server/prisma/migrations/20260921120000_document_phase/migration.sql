-- مرحلهٔ مدرک نسبت به عمل: pre | intra | post.
-- NULL می‌ماند برای مدرکی که به عملِ مشخصی گره نخورده — از جمله **همهٔ** مدارکِ
-- موجود، تا هیچ ردیفِ قدیمی با فرضِ اشتباه «قبل از عمل» برچسب نخورد.
ALTER TABLE "documents" ADD COLUMN "phase" TEXT;
CREATE INDEX "documents_visit_id_phase_idx" ON "documents"("visit_id", "phase");
