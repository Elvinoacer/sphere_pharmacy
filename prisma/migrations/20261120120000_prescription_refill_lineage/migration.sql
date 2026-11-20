-- Structural refill lineage between original prescriptions/orders and refill dispenses.
-- Enables idempotent refill-slot restoration on order cancel/reject/expiry, prevents
-- refill copies from granting new refill allowances, and surfaces refill context across
-- customer, pharmacist, and admin order views.

-- AlterTable Order
ALTER TABLE "Order"
    ADD COLUMN IF NOT EXISTS "refill_of_order_id" TEXT;

-- AlterTable Prescription
ALTER TABLE "Prescription"
    ADD COLUMN IF NOT EXISTS "parent_prescription_id" TEXT,
    ADD COLUMN IF NOT EXISTS "refill_number" INTEGER,
    ADD COLUMN IF NOT EXISTS "refill_released_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_refill_of_order_id_idx" ON "Order"("refill_of_order_id");
CREATE INDEX IF NOT EXISTS "Prescription_parent_prescription_id_idx" ON "Prescription"("parent_prescription_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Order_refill_of_order_id_fkey'
    ) THEN
        ALTER TABLE "Order"
            ADD CONSTRAINT "Order_refill_of_order_id_fkey"
            FOREIGN KEY ("refill_of_order_id") REFERENCES "Order"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Prescription_parent_prescription_id_fkey'
    ) THEN
        ALTER TABLE "Prescription"
            ADD CONSTRAINT "Prescription_parent_prescription_id_fkey"
            FOREIGN KEY ("parent_prescription_id") REFERENCES "Prescription"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
