import { createHash } from 'crypto';

export type OutboundSyncMode = 'MANUAL_EXPORT' | 'AUTO_SYNC';
export type PreferredExportFormat = 'PDF' | 'CSV' | 'JSON';
export type ExportGroupBy = 'PRODUCT_SUMMARY' | 'ITEMIZED_ORDERS';

export interface PosSyncPolicy {
  inboundEnabled: boolean;
  protectUnreconciledSales: boolean;
  reconciliationBaselineAt: string | null;
  expectedTenantUU: string | null;
  sellableWarehouseUUs: string[];
  minShelfLifeDays: number;
  outboundSyncMode: OutboundSyncMode;
  autoSyncOnlineSales: boolean;
  autoSyncStockEdits: boolean;
  autoSyncPriceEdits: boolean;
  preferredExportFormat: PreferredExportFormat;
  exportGroupBy: ExportGroupBy;
  outboundPollIntervalMinutes: number;
}

export const DEFAULT_POS_SYNC_POLICY: PosSyncPolicy = {
  inboundEnabled: true,
  protectUnreconciledSales: true,
  reconciliationBaselineAt: null,
  expectedTenantUU: null,
  sellableWarehouseUUs: [],
  minShelfLifeDays: 0,
  outboundSyncMode: 'MANUAL_EXPORT',
  autoSyncOnlineSales: true,
  autoSyncStockEdits: true,
  autoSyncPriceEdits: false,
  preferredExportFormat: 'PDF',
  exportGroupBy: 'PRODUCT_SUMMARY',
  outboundPollIntervalMinutes: 2,
};

export interface PosBridgeHeartbeat {
  extensionVersion: string | null;
  pharmacyId: string | null;
  bandagoTabOpen: boolean;
  bandagoOrigin: string | null;
  tenantUU: string | null;
  inboundQueuePending: number;
  inboundQueueFailed: number;
  lastInboundPollAt: string | null;
  lastInboundPollOk: boolean | null;
  lastInboundPollMessage: string | null;
  lastOutboundRunAt: string | null;
  lastOutboundOk: boolean | null;
  lastOutboundMessage: string | null;
  reportedAt: string;
}

export interface ReconciledStockInput {
  incomingRawStock: number;
  incomingSellableStock: number;
  pendingOutboundNetDelta: number;
  pendingOutboundSalesQty: number;
  unpaidOrderHoldQty: number;
  virtualReservedStock: number;
  lowStockThreshold: number;
  isInactiveOrDiscontinued?: boolean;
  protectUnreconciledSales: boolean;
  previousLastPosStock?: number | null;
}

export interface ReconciledStockResult {
  stock: number;
  stockQty: number;
  effectiveAvailable: number;
  effectiveSellable: number;
  inStock: boolean;
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'DISCONTINUED';
  active: boolean;
  signedOffset: number;
  protectedByOffset: boolean;
  possibleManualReconcileDetected: boolean;
}

export const POS_ERROR_REMEDIATIONS: Record<string, string> = {
  AUTH_EXPIRED:
    'BandaGo session expired. Open go.bandahealth.org in Chrome, sign back in to your pharmacy account, and click Sync Now.',
  POS_PERMISSION_DENIED:
    'The signed-in BandaGo user role lacks write permissions for Physical Inventory (M_Inventory). Grant inventory access or switch to Manual Daily Sales Export.',
  SPHERE_AUTH_FAILED:
    'BANDAGO_SYNC_API_KEY mismatch. Ensure the Bearer Sync API Key in the extension Settings matches the server environment variable.',
  TENANT_MISMATCH:
    'A BandaGo tab from a different clinic tenant (AD_Client_UU) attempted to sync. Switch back to Sphere Pharmacy in BandaGo or update the Expected Tenant UU in Policy.',
  NO_POS_TAB:
    'No active go.bandahealth.org tab is open in Chrome. Keep an authenticated BandaGo tab open on the dispensary workstation for automatic two-way sync.',
  UNMAPPED_PRODUCT:
    'This product has no externalPosId (M_Product_UU) mapped from BandaGo. Sync the product from BandaGo or enter its UU in Catalogue.',
  INSUFFICIENT_POS_STOCK:
    'BandaGo had fewer units on hand than the online sale quantity. POS inventory was clamped to 0 — please check the physical shelf and reconcile counts.',
  GRAPHQL_SCHEMA_ERROR:
    'BandaGo GraphQL rejected one or more query/mutation fields. Check the error detail or reload the updated Chrome extension.',
  NETWORK_TIMEOUT:
    'Network request timed out or Sphere/BandaGo was temporarily unreachable. Jobs remain safely queued and will retry automatically.',
  POSSIBLE_MANUAL_RECONCILE:
    'BandaGo stock dropped by at least your pending online sales quantity while those sales are still marked Pending/Exported. Confirm in Sales Export & Reconciliation if you already entered them in BandaGo so stock is not double-deducted.',
  INBOUND_ITEM_FAILED:
    'A product payload failed validation or database upsert during inbound sync. Review the product SKU, slug, price, and identifiers.',
  OUTBOUND_WRITEBACK_FAILED:
    'Automatic writeback to BandaGo failed. Review the error code or export Daily Sales (PDF/CSV) and enter the deductions in BandaGo manually.',
};

export function getDefaultRemediation(code: string): string {
  return (
    POS_ERROR_REMEDIATIONS[code] ||
    'Inspect the error detail and Audit Trail, verify BandaGo tab session & API key, then retry.'
  );
}

/**
 * Generates a deterministic UUIDv4-formatted string from a stable idempotency key
 * so BandaGo M_Inventory.UU stays idempotent across retries and worker restarts.
 */
export function deterministicUuidFromKey(key: string): string {
  const hash = createHash('sha256').update(`sphere-bandago:${key}`, 'utf8').digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4 marker
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant RFC 4122
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Normalizes and merges a partial PosSyncPolicy onto defaults safely.
 */
export function normalizePosSyncPolicy(raw: unknown): PosSyncPolicy {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const outboundSyncMode: OutboundSyncMode =
    obj.outboundSyncMode === 'AUTO_SYNC' ? 'AUTO_SYNC' : 'MANUAL_EXPORT';
  const preferredExportFormat: PreferredExportFormat =
    obj.preferredExportFormat === 'CSV' || obj.preferredExportFormat === 'JSON'
      ? obj.preferredExportFormat
      : 'PDF';
  const exportGroupBy: ExportGroupBy =
    obj.exportGroupBy === 'ITEMIZED_ORDERS' ? 'ITEMIZED_ORDERS' : 'PRODUCT_SUMMARY';

  const expectedTenantUU =
    typeof obj.expectedTenantUU === 'string' && obj.expectedTenantUU.trim()
      ? obj.expectedTenantUU.trim()
      : null;

  const reconciliationBaselineAt =
    typeof obj.reconciliationBaselineAt === 'string' && !Number.isNaN(Date.parse(obj.reconciliationBaselineAt))
      ? new Date(obj.reconciliationBaselineAt).toISOString()
      : null;

  const sellableWarehouseUUs = Array.isArray(obj.sellableWarehouseUUs)
    ? Array.from(
        new Set(
          obj.sellableWarehouseUUs
            .map((v) => String(v ?? '').trim())
            .filter(Boolean)
        )
      ).slice(0, 50)
    : [];

  const minShelfLifeDaysRaw = Number(obj.minShelfLifeDays);
  const minShelfLifeDays = Number.isFinite(minShelfLifeDaysRaw)
    ? Math.max(0, Math.min(365, Math.floor(minShelfLifeDaysRaw)))
    : 0;

  const intervalRaw = Number(obj.outboundPollIntervalMinutes);
  const outboundPollIntervalMinutes = Number.isFinite(intervalRaw)
    ? Math.max(1, Math.min(60, Math.floor(intervalRaw)))
    : 2;

  return {
    inboundEnabled: typeof obj.inboundEnabled === 'boolean' ? obj.inboundEnabled : DEFAULT_POS_SYNC_POLICY.inboundEnabled,
    protectUnreconciledSales:
      typeof obj.protectUnreconciledSales === 'boolean'
        ? obj.protectUnreconciledSales
        : DEFAULT_POS_SYNC_POLICY.protectUnreconciledSales,
    reconciliationBaselineAt,
    expectedTenantUU,
    sellableWarehouseUUs,
    minShelfLifeDays,
    outboundSyncMode,
    autoSyncOnlineSales:
      typeof obj.autoSyncOnlineSales === 'boolean'
        ? obj.autoSyncOnlineSales
        : DEFAULT_POS_SYNC_POLICY.autoSyncOnlineSales,
    autoSyncStockEdits:
      typeof obj.autoSyncStockEdits === 'boolean'
        ? obj.autoSyncStockEdits
        : DEFAULT_POS_SYNC_POLICY.autoSyncStockEdits,
    autoSyncPriceEdits:
      typeof obj.autoSyncPriceEdits === 'boolean'
        ? obj.autoSyncPriceEdits
        : DEFAULT_POS_SYNC_POLICY.autoSyncPriceEdits,
    preferredExportFormat,
    exportGroupBy,
    outboundPollIntervalMinutes,
  };
}

/**
 * Pure stagnant-POS reconciliation math.
 * Prevents stale POS snapshots from resurrecting units already sold or held online,
 * while preserving genuine walk-in deductions/restocks reported by BandaGo.
 */
export function computeReconciledStock(input: ReconciledStockInput): ReconciledStockResult {
  if (input.isInactiveOrDiscontinued) {
    return {
      stock: 0,
      stockQty: 0,
      effectiveAvailable: 0,
      effectiveSellable: 0,
      inStock: false,
      stockStatus: 'DISCONTINUED',
      active: false,
      signedOffset: 0,
      protectedByOffset: false,
      possibleManualReconcileDetected: false,
    };
  }

  const incomingRaw = Math.max(0, Math.floor(Number(input.incomingRawStock) || 0));
  const incomingSellable = Math.max(0, Math.floor(Number(input.incomingSellableStock) || 0));
  const reserved = Math.max(0, Math.floor(Number(input.virtualReservedStock) || 0));
  const threshold = Math.max(0, Math.floor(Number(input.lowStockThreshold) || 5));
  const unpaidHolds = Math.max(0, Math.floor(Number(input.unpaidOrderHoldQty) || 0));
  const pendingNetDelta = Math.trunc(Number(input.pendingOutboundNetDelta) || 0);
  const pendingSalesQty = Math.max(0, Math.floor(Number(input.pendingOutboundSalesQty) || 0));

  const signedOffset = input.protectUnreconciledSales ? pendingNetDelta - unpaidHolds : 0;
  const stock = Math.max(0, incomingRaw + signedOffset);
  const stockQty = Math.max(0, incomingSellable + signedOffset);

  const effectiveAvailable = Math.max(0, stock - reserved);
  const effectiveSellable = Math.max(0, stockQty - reserved);
  const inStock = effectiveAvailable > 0 && stockQty > 0 && effectiveSellable > 0;
  const stockStatus: ReconciledStockResult['stockStatus'] = !inStock
    ? 'OUT_OF_STOCK'
    : effectiveSellable <= threshold
      ? 'LOW_STOCK'
      : 'IN_STOCK';

  const prevPos = input.previousLastPosStock;
  const possibleManualReconcileDetected = Boolean(
    input.protectUnreconciledSales &&
      prevPos != null &&
      pendingSalesQty > 0 &&
      incomingRaw < prevPos &&
      prevPos - incomingRaw >= pendingSalesQty
  );

  return {
    stock,
    stockQty,
    effectiveAvailable,
    effectiveSellable,
    inStock,
    stockStatus,
    active: true,
    signedOffset,
    protectedByOffset: signedOffset !== 0,
    possibleManualReconcileDetected,
  };
}
