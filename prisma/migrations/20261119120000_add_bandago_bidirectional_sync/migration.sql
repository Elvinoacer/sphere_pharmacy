-- AlterEnum
ALTER TYPE "PosSyncTrigger" ADD VALUE IF NOT EXISTS 'OUTBOUND_WRITEBACK';
ALTER TYPE "PosSyncTrigger" ADD VALUE IF NOT EXISTS 'MANUAL_EXPORT_RECONCILE';
ALTER TYPE "PosSyncTrigger" ADD VALUE IF NOT EXISTS 'BRIDGE_ERROR';

-- CreateEnum
CREATE TYPE "PosSyncDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "PosOutboundStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'SYNCED',
    'EXPORTED',
    'RECONCILED_MANUAL',
    'FAILED',
    'CANCELLED',
    'SKIPPED_UNMAPPED'
);

-- CreateEnum
CREATE TYPE "PosOutboundEventType" AS ENUM (
    'ONLINE_SALE',
    'ADMIN_STOCK_ADJUST',
    'REFUND_RESTOCK',
    'ADMIN_PRICE_UPDATE'
);

-- AlterTable Product
ALTER TABLE "Product"
    ADD COLUMN IF NOT EXISTS "last_pos_stock" INTEGER,
    ADD COLUMN IF NOT EXISTS "last_pos_sellable_stock" INTEGER,
    ADD COLUMN IF NOT EXISTS "external_warehouse_id" TEXT,
    ADD COLUMN IF NOT EXISTS "external_locator_id" TEXT,
    ADD COLUMN IF NOT EXISTS "external_org_id" TEXT,
    ADD COLUMN IF NOT EXISTS "external_client_id" TEXT;

-- AlterTable pos_sync_logs
ALTER TABLE "pos_sync_logs"
    ADD COLUMN IF NOT EXISTS "direction" "PosSyncDirection" NOT NULL DEFAULT 'INBOUND';

-- CreateTable pos_outbound_jobs
CREATE TABLE "pos_outbound_jobs" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "event_type" "PosOutboundEventType" NOT NULL,
    "status" "PosOutboundStatus" NOT NULL DEFAULT 'PENDING',
    "order_id" TEXT,
    "order_reference" TEXT,
    "product_id" TEXT NOT NULL,
    "external_pos_id" TEXT,
    "product_name" TEXT NOT NULL,
    "sku" TEXT,
    "qty_delta" INTEGER NOT NULL,
    "target_stock" INTEGER,
    "unit_price" DECIMAL(12,2),
    "line_total" DECIMAL(12,2),
    "payment_method" TEXT,
    "pos_stock_snapshot" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "locked_at" TIMESTAMP(3),
    "lock_token" TEXT,
    "external_document_no" TEXT,
    "external_inventory_uu" TEXT,
    "reconciled_by" TEXT,
    "reconciled_note" TEXT,
    "export_batch_id" TEXT,
    "last_error_code" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "synced_at" TIMESTAMP(3),

    CONSTRAINT "pos_outbound_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable pos_sync_incidents
CREATE TABLE "pos_sync_incidents" (
    "id" TEXT NOT NULL,
    "direction" "PosSyncDirection" NOT NULL DEFAULT 'INBOUND',
    "source" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'ERROR',
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "remediation" TEXT,
    "external_pos_id" TEXT,
    "product_name" TEXT,
    "order_reference" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "meta" JSONB,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_sync_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pos_outbound_jobs_idempotency_key_key" ON "pos_outbound_jobs"("idempotency_key");
CREATE INDEX "pos_outbound_jobs_status_created_at_idx" ON "pos_outbound_jobs"("status", "created_at");
CREATE INDEX "pos_outbound_jobs_product_id_status_idx" ON "pos_outbound_jobs"("product_id", "status");
CREATE INDEX "pos_outbound_jobs_order_id_idx" ON "pos_outbound_jobs"("order_id");
CREATE INDEX "pos_outbound_jobs_export_batch_id_idx" ON "pos_outbound_jobs"("export_batch_id");

CREATE INDEX "pos_sync_incidents_resolved_severity_last_seen_at_idx" ON "pos_sync_incidents"("resolved", "severity", "last_seen_at");
CREATE INDEX "pos_sync_incidents_code_resolved_idx" ON "pos_sync_incidents"("code", "resolved");

-- AddForeignKey
ALTER TABLE "pos_outbound_jobs" ADD CONSTRAINT "pos_outbound_jobs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_outbound_jobs" ADD CONSTRAINT "pos_outbound_jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
