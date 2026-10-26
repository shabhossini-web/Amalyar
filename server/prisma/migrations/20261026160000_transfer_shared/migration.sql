-- ستِ عمومیِ «بیمارستان + روز»: حوالهٔ تختهٔ حمل مالِ همهٔ بیمارانِ همان بیمارستان در همان روز است.
ALTER TABLE "stock_transfers" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;
