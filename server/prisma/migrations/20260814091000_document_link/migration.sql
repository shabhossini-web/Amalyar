-- مدرکِ لینکی: MRI/پاراکلینیکی که جای دیگری میزبانی می‌شود (پکس، درایو…)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS external_url TEXT;
