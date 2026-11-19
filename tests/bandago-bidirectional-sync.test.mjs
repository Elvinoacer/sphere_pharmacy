import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  computeReconciledStock,
  deterministicUuidFromKey,
  normalizePosSyncPolicy,
  DEFAULT_POS_SYNC_POLICY,
} from '../src/lib/pos-reconciliation-core.ts';
import { buildDailySalesPdfBuffer } from '../src/lib/pdf/daily-sales-pdf.ts';
import {
  verifyBandagoBearerHeader,
  timingSafeEqualStrings,
  isUsingInsecureDefaultBandagoKey,
} from '../src/lib/security/bandago-bearer.ts';

const readText = (relPath) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');

test('Stagnant-POS drift protection: stale POS count cannot resurrect unreconciled online sales', () => {
  // POS held 20 units, customer bought 2 on Sphere (so Sphere stockQty dropped to 18 and an open ONLINE_SALE job has qtyDelta = -2).
  // Stagnant POS polls back at 20 units -> reconciled Sphere stock must stay 18!
  const result = computeReconciledStock({
    incomingRawStock: 20,
    incomingSellableStock: 20,
    pendingOutboundNetDelta: -2,
    pendingOutboundSalesQty: 2,
    unpaidOrderHoldQty: 0,
    virtualReservedStock: 0,
    lowStockThreshold: 5,
    protectUnreconciledSales: true,
    previousLastPosStock: 20,
  });

  assert.equal(result.stock, 18);
  assert.equal(result.stockQty, 18);
  assert.equal(result.inStock, true);
  assert.equal(result.signedOffset, -2);
  assert.equal(result.protectedByOffset, true);
  assert.equal(result.possibleManualReconcileDetected, false);
});

test('Stagnant-POS drift protection: preserves genuine walk-in deductions and restocks while offsetting online sales', () => {
  // Walk-in customer in pharmacy also bought 5 (POS dropped from 20 to 15), while 2 online units remain unreconciled.
  // Effective sellable stock should reflect BOTH deductions: 15 - 2 = 13.
  const walkInSale = computeReconciledStock({
    incomingRawStock: 15,
    incomingSellableStock: 15,
    pendingOutboundNetDelta: -2,
    pendingOutboundSalesQty: 2,
    unpaidOrderHoldQty: 1,
    virtualReservedStock: 0,
    lowStockThreshold: 5,
    protectUnreconciledSales: true,
    previousLastPosStock: 20,
  });

  // Offset = -2 - 1 = -3 => 15 - 3 = 12
  assert.equal(walkInSale.signedOffset, -3);
  assert.equal(walkInSale.stockQty, 12);
  // Drop was 5 (>= 2 pending sales), so heuristic flags possible manual POS entry for review
  assert.equal(walkInSale.possibleManualReconcileDetected, true);

  // Restock in BandaGo: POS jumped from 20 to 50 (+30 received), still 2 online sales pending
  const restock = computeReconciledStock({
    incomingRawStock: 50,
    incomingSellableStock: 50,
    pendingOutboundNetDelta: -2,
    pendingOutboundSalesQty: 2,
    unpaidOrderHoldQty: 0,
    virtualReservedStock: 0,
    lowStockThreshold: 5,
    protectUnreconciledSales: true,
    previousLastPosStock: 20,
  });
  assert.equal(restock.stockQty, 48);
  assert.equal(restock.possibleManualReconcileDetected, false);
});

test('Stagnant-POS drift protection: clamps at zero, honors inactive/discontinued, and supports disable toggle', () => {
  const clamped = computeReconciledStock({
    incomingRawStock: 2,
    incomingSellableStock: 2,
    pendingOutboundNetDelta: -5,
    pendingOutboundSalesQty: 5,
    unpaidOrderHoldQty: 0,
    virtualReservedStock: 0,
    lowStockThreshold: 5,
    protectUnreconciledSales: true,
  });
  assert.equal(clamped.stockQty, 0);
  assert.equal(clamped.inStock, false);
  assert.equal(clamped.stockStatus, 'OUT_OF_STOCK');

  const discontinued = computeReconciledStock({
    incomingRawStock: 25,
    incomingSellableStock: 25,
    pendingOutboundNetDelta: 0,
    pendingOutboundSalesQty: 0,
    unpaidOrderHoldQty: 0,
    virtualReservedStock: 0,
    lowStockThreshold: 5,
    isInactiveOrDiscontinued: true,
    protectUnreconciledSales: true,
  });
  assert.equal(discontinued.stockQty, 0);
  assert.equal(discontinued.active, false);
  assert.equal(discontinued.stockStatus, 'DISCONTINUED');

  const unprotected = computeReconciledStock({
    incomingRawStock: 20,
    incomingSellableStock: 20,
    pendingOutboundNetDelta: -4,
    pendingOutboundSalesQty: 4,
    unpaidOrderHoldQty: 2,
    virtualReservedStock: 0,
    lowStockThreshold: 5,
    protectUnreconciledSales: false,
  });
  assert.equal(unprotected.stockQty, 20);
  assert.equal(unprotected.protectedByOffset, false);
});

test('Policy normalization & deterministic UUID generation stay stable and safe', () => {
  const policy = normalizePosSyncPolicy({
    outboundSyncMode: 'AUTO_SYNC',
    minShelfLifeDays: 999,
    outboundPollIntervalMinutes: 0,
    sellableWarehouseUUs: [' wh-1 ', 'wh-1', ''],
  });
  assert.equal(policy.outboundSyncMode, 'AUTO_SYNC');
  assert.equal(policy.minShelfLifeDays, 365);
  assert.equal(policy.outboundPollIntervalMinutes, 1);
  assert.deepEqual(policy.sellableWarehouseUUs, ['wh-1']);

  const fallback = normalizePosSyncPolicy('corrupt');
  assert.equal(fallback.outboundSyncMode, DEFAULT_POS_SYNC_POLICY.outboundSyncMode);

  const uuidA = deterministicUuidFromKey('order-sale:ord1:prod1');
  const uuidB = deterministicUuidFromKey('order-sale:ord1:prod1');
  const uuidC = deterministicUuidFromKey('order-sale:ord2:prod1');
  assert.equal(uuidA, uuidB);
  assert.notEqual(uuidA, uuidC);
  assert.match(uuidA, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('DailySalesPdf: generates multi-page A4 %PDF-1.4 document with pharmacist sign-off and batch ID', () => {
  const manyRows = Array.from({ length: 42 }, (_, idx) => ({
    productName: `Amoxicillin 500mg Caps Batch #${idx + 1}`,
    sku: `AMX-${100 + idx}`,
    externalPosId: `pos-uuid-${idx}`,
    orderReference: `ORD-2026-${1000 + idx}`,
    qtyDeducted: (idx % 5) + 1,
    unitPrice: 250,
    lineTotal: ((idx % 5) + 1) * 250,
    targetPosStock: 40 - (idx % 5),
    status: 'PENDING',
  }));

  const pdfBuffer = buildDailySalesPdfBuffer({
    exportBatchId: 'EXP-20261119-AABB11',
    generatedAtIso: '2026-11-19T18:00:00.000Z',
    scopeLabel: 'Today EAT (2026-11-19)',
    groupByLabel: 'Grouped by Medication',
    totalOrders: 15,
    totalUnitsDeducted: 95,
    totalRevenueKes: 23750,
    pendingCount: 42,
    syncedCount: 0,
    rows: manyRows,
  });

  const ascii = pdfBuffer.toString('latin1');
  assert.ok(ascii.startsWith('%PDF-1.4'));
  assert.ok(ascii.trimEnd().endsWith('%%EOF'));
  assert.ok(ascii.includes('EXP-20261119-AABB11'));
  assert.ok(ascii.includes('PHARMACIST BANDAGO POS ENTRY SIGN-OFF'));
  assert.ok(ascii.includes('Page 1 of 2') && ascii.includes('Page 2 of 2'));
});

test('Security helper: verifyBandagoBearerHeader is fail-closed and constant-time', () => {
  assert.equal(verifyBandagoBearerHeader('Bearer super-secret-key', 'super-secret-key'), true);
  assert.equal(verifyBandagoBearerHeader('Bearer wrong-key', 'super-secret-key'), false);
  assert.equal(verifyBandagoBearerHeader('Bearer super-secret-key', ''), false);
  assert.equal(verifyBandagoBearerHeader(null, 'super-secret-key'), false);
  assert.equal(timingSafeEqualStrings('Bearer abc', 'Bearer abc'), true);
  assert.equal(timingSafeEqualStrings('Bearer abc', 'Bearer abd'), false);

  const legacyPlaceholder = ['sphere', 'bandago', 'live', 'sync', 'secret', 'key', '2026'].join('_');
  assert.equal(isUsingInsecureDefaultBandagoKey(legacyPlaceholder), true);
  assert.equal(isUsingInsecureDefaultBandagoKey('genuinely-rotated-random-secret-value'), false);
});

test('Security & API contracts: H1 remediated, no hardcoded fallback secrets, guards enforced on new routes', () => {
  const envExample = readText('.env.example');
  const posSection = readText('src/components/views/admin/sections/pos-sync-section.tsx');
  const csvImport = readText('src/app/api/integrations/bandago/csv-import/route.ts');
  const outbound = readText('src/app/api/integrations/bandago/outbound/route.ts');
  const outboundAck = readText('src/app/api/integrations/bandago/outbound/ack/route.ts');
  const telemetry = readText('src/app/api/integrations/bandago/telemetry/route.ts');
  const policyRoute = readText('src/app/api/admin/pos-sync/policy/route.ts');
  const reconcileRoute = readText('src/app/api/admin/pos-sync/reconcile/route.ts');
  const exportRoute = readText('src/app/api/admin/pos-sync/sales-export/route.ts');

  // H1 eliminated
  assert.ok(!envExample.includes('NEXT_PUBLIC_POS_SYNC_SECRET'));
  assert.ok(!posSection.includes('NEXT_PUBLIC_POS_SYNC_SECRET'));
  assert.ok(/BANDAGO_SYNC_API_KEY\s*=\s*""/.test(envExample));

  const legacyPlaceholder = ['sphere', 'bandago', 'live', 'sync', 'secret', 'key', '2026'].join('_');
  assert.ok(!csvImport.includes(legacyPlaceholder));
  assert.ok(!envExample.includes(legacyPlaceholder));

  // Auth guards on all new endpoints
  assert.ok(outbound.includes('authorizeBandagoRequest'));
  assert.ok(outboundAck.includes('authorizeBandagoRequest'));
  assert.ok(telemetry.includes('authorizeBandagoRequest'));
  assert.ok(policyRoute.includes("requireStaff(['ADMIN'])"));
  assert.ok(reconcileRoute.includes("requireStaff(['ADMIN', 'PHARMACIST'])"));
  assert.ok(exportRoute.includes("requireStaff(['ADMIN', 'PHARMACIST'])"));

  // No catch (...: any) in any updated/new BandaGo file
  for (const [name, content] of [
    ['pos-sync-section', posSection],
    ['csv-import', csvImport],
    ['outbound', outbound],
    ['outbound-ack', outboundAck],
    ['telemetry', telemetry],
    ['policy', policyRoute],
    ['reconcile', reconcileRoute],
    ['sales-export', exportRoute],
  ]) {
    assert.ok(
      !/catch\s*\([^)]*:\s*any\)/.test(content),
      `Unexpected catch(...: any) in ${name}`
    );
  }
});
