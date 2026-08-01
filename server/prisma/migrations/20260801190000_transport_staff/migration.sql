-- نیروی حمل‌ونقل از «حسابِ کاربری با نقشِ شغلی» به موجودیتِ مستقل تبدیل می‌شود.
-- دلیل: راننده به سامانه وارد نمی‌شود؛ اجبار به ساختنِ حساب یعنی در عمل هیچ
-- راننده‌ای تعریف نمی‌شود.

-- CreateTable
CREATE TABLE "transport_staff" (
    "id" SERIAL NOT NULL,
    "person_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "vehicle" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transport_staff_person_id_key" ON "transport_staff"("person_id");

-- CreateIndex
CREATE INDEX "transport_staff_role_active_idx" ON "transport_staff"("role", "active");

-- AddForeignKey
ALTER TABLE "transport_staff" ADD CONSTRAINT "transport_staff_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- انتقالِ نیروهایی که قبلاً با حسابِ کاربری تعریف شده بودند
INSERT INTO "transport_staff" ("person_id", "role", "updated_at")
SELECT a."person_id", a."job_role", CURRENT_TIMESTAMP
FROM "accounts" a
WHERE a."job_role" IN ('driver', 'courier')
ON CONFLICT ("person_id") DO NOTHING;

-- تخصیص‌ها به نیرو گره می‌خورند، نه به حسابِ کاربری
ALTER TABLE "visit_assignments" ADD COLUMN "staff_id" INTEGER;

UPDATE "visit_assignments" va
SET "staff_id" = ts."id"
FROM "accounts" a
JOIN "transport_staff" ts ON ts."person_id" = a."person_id"
WHERE va."account_id" = a."id";

-- تخصیصی که نیروی متناظر ندارد (نقشِ شغلی‌اش پاک شده بود) بی‌معناست
DELETE FROM "visit_assignments" WHERE "staff_id" IS NULL;

ALTER TABLE "visit_assignments" ALTER COLUMN "staff_id" SET NOT NULL;
ALTER TABLE "visit_assignments" DROP CONSTRAINT "visit_assignments_account_id_fkey";
DROP INDEX "visit_assignments_visit_id_account_id_role_key";
DROP INDEX "visit_assignments_account_id_idx";
ALTER TABLE "visit_assignments" DROP COLUMN "account_id";

-- CreateIndex
CREATE INDEX "visit_assignments_staff_id_idx" ON "visit_assignments"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "visit_assignments_visit_id_staff_id_role_key" ON "visit_assignments"("visit_id", "staff_id", "role");

-- AddForeignKey
ALTER TABLE "visit_assignments" ADD CONSTRAINT "visit_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "transport_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- نقشِ شغلی دیگر روی حسابِ کاربری معنا ندارد
ALTER TABLE "accounts" DROP COLUMN "job_role";

-- ساعتِ تحویلِ بار به بیمارستان — جدا از ساعتِ حضورِ کارشناس
ALTER TABLE "visits" ADD COLUMN "cargo_due_time" TEXT;
