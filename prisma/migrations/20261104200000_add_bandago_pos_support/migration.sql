-- CreateEnum
CREATE TYPE "PosSyncStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "PosSyncTrigger" AS ENUM ('EXTENSION_STREAM', 'BACKGROUND_POLL', 'CSV_IMPORT', 'MANUAL_RECONCILE');

-- AlterTable User
ALTER TABLE "User" ADD COLUMN "external_bpartner_id" TEXT,
ADD COLUMN "loyalty_points_balance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pos_credit_balance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
ADD COLUMN "is_chronic_patient" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable Product
ALTER TABLE "Product" ADD COLUMN "slug" TEXT,
ADD COLUMN "barcode" TEXT,
ADD COLUMN "cost_price" DECIMAL(12,2),
ADD COLUMN "stock" INTEGER DEFAULT 0,
ADD COLUMN "virtual_reserved_stock" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "safety_stock_buffer" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "in_stock" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "dosage_form" TEXT,
ADD COLUMN "strength" TEXT,
ADD COLUMN "nearest_expiry_date" TIMESTAMP(3),
ADD COLUMN "external_pos_id" TEXT,
ADD COLUMN "pos_source" TEXT DEFAULT 'BANDAGO',
ADD COLUMN "last_synced_at" TIMESTAMP(3);

-- CreateTable product_batches
CREATE TABLE "product_batches" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL,
    "expiry_date" TIMESTAMP(3) NOT NULL,
    "external_batch_id" TEXT,
    "is_expired" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable pos_sync_logs
CREATE TABLE "pos_sync_logs" (
    "id" TEXT NOT NULL,
    "pos_source" TEXT NOT NULL DEFAULT 'BANDAGO',
    "trigger" "PosSyncTrigger" NOT NULL DEFAULT 'EXTENSION_STREAM',
    "status" "PosSyncStatus" NOT NULL DEFAULT 'SUCCESS',
    "items_received" INTEGER NOT NULL DEFAULT 0,
    "items_upserted" INTEGER NOT NULL DEFAULT 0,
    "items_failed" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,

    CONSTRAINT "pos_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_external_bpartner_id_key" ON "User"("external_bpartner_id");
CREATE INDEX "User_external_bpartner_id_idx" ON "User"("external_bpartner_id");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
CREATE UNIQUE INDEX "Product_external_pos_id_key" ON "Product"("external_pos_id");
CREATE INDEX "Product_external_pos_id_idx" ON "Product"("external_pos_id");
CREATE INDEX "Product_in_stock_stock_idx" ON "Product"("in_stock", "stock");

-- CreateIndex
CREATE INDEX "product_batches_product_id_expiry_date_idx" ON "product_batches"("product_id", "expiry_date");
CREATE UNIQUE INDEX "product_batches_product_id_batch_number_key" ON "product_batches"("product_id", "batch_number");

-- CreateIndex
CREATE INDEX "pos_sync_logs_started_at_idx" ON "pos_sync_logs"("started_at");
CREATE INDEX "pos_sync_logs_status_idx" ON "pos_sync_logs"("status");

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
