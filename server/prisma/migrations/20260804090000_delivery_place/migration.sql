-- محلِ تحویلِ استاندارد — تا «CSR» و «سی اس آر» یک چیز شمرده شوند.
CREATE TABLE IF NOT EXISTS "delivery_places" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "delivery_places_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_places_key_key" ON "delivery_places"("key");

