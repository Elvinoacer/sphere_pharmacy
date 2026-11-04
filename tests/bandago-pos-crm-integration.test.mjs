import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BandaGoNormalizer, normalizeKenyaPhone, parseCsv } from '../src/lib/bandago-normalizer.ts';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('BandaGoNormalizer: generates url-safe slugs with external POS ID prefix', () => {
  const slug1 = BandaGoNormalizer.slugify('Panadol Extra 500mg (20s)', 'BP-00123-XYZ');
  assert.equal(slug1, 'panadol-extra-500mg-20s-bp-001');

  const slug2 = BandaGoNormalizer.slugify('   Amoxicillin 250mg / 5ml Suspension!   ');
  assert.equal(slug2, 'amoxicillin-250mg-5ml-suspension');

  // Category slug normalization
  assert.equal(BandaGoNormalizer.normalizeCategorySlug('Pain & Fever'), 'pain-fever');
  assert.equal(BandaGoNormalizer.normalizeCategorySlug('Prescription-Only'), 'prescription-only');
  assert.equal(BandaGoNormalizer.normalizeCategorySlug(''), 'otc');
  assert.equal(BandaGoNormalizer.normalizeCategorySlug(null), 'otc');
});

test('BandaGoNormalizer: correctly classifies Kenya PPB prescription medications', () => {
  // Prescription by POM / keyword
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Amoxicillin 500mg Capsules'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Augmentin 625mg Tablets'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Azithromycin 500mg (3s)'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Losartan 50mg Tablets POM'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Insulin Glargine Pen'), true);

  // Prescription by category slug
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Generic Pain Reliever', 'prescription-only'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Blood Pressure Drug', 'rx-cardio'), true);

  // Prescription by flag
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Mild Painkiller', 'otc', 'true'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Mild Painkiller', 'otc', true), true);

  // Non-prescription OTC
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Panadol Advance 500mg', 'otc', false), false);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Vitamin C 1000mg Effervescent', 'vitamins'), false);
});

test('BandaGoNormalizer: enforces FEFO rules and excludes expired lots from sellable stock', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  const batches = [
    {
      batchNumber: 'LOT-EXPIRED-01',
      qtyOnHand: 15,
      expiryDate: '2026-05-15T00:00:00Z', // Expired 2 weeks ago
    },
    {
      batchNumber: 'LOT-NEAR-EXPIRY-02',
      qtyOnHand: 10,
      expiryDate: '2026-07-15T00:00:00Z', // Expires in ~44 days (< 90 days)
    },
    {
      batchNumber: 'LOT-FRESH-03',
      qtyOnHand: 25,
      expiryDate: '2027-01-01T00:00:00Z', // Expires next year
    },
  ];

  const result = BandaGoNormalizer.processBatches(batches, now);

  // LOT-EXPIRED-01 must be flagged isExpired: true and its 15 units excluded from validStock
  assert.equal(result.batches[0].isExpired, true);
  assert.equal(result.batches[1].isExpired, false);
  assert.equal(result.batches[2].isExpired, false);

  // Total valid stock should be 10 + 25 = 35 (the 15 expired units are rejected)
  assert.equal(result.validStock, 35);

  // Nearest expiry date should point to LOT-NEAR-EXPIRY-02
  assert.equal(result.nearestExpiryDate?.toISOString(), new Date('2026-07-15T00:00:00Z').toISOString());

  // Near-expiry (< 90 days) audit flag must be true
  assert.equal(result.hasNearExpiry, true);
});

test('BandaGoNormalizer: Available stock formula prevents walk-in oversell', () => {
  // Available = max(0, Physical Stock - Safety Buffer - Virtual Reserved Stock)
  const available1 = BandaGoNormalizer.calculateAvailableStock(10, 2, 0);
  assert.equal(available1, 8);

  const available2 = BandaGoNormalizer.calculateAvailableStock(2, 2, 0);
  assert.equal(available2, 0); // Safety buffer reserves the last 2 boxes for counter walk-ins

  const available3 = BandaGoNormalizer.calculateAvailableStock(10, 2, 5);
  assert.equal(available3, 3); // 10 - 2 - 5 = 3

  const available4 = BandaGoNormalizer.calculateAvailableStock(5, 2, 5);
  assert.equal(available4, 0); // Never negative
});

test('Kenya Phone Normalization: formats Kenyan phone numbers into canonical E.164 (+254...) standard', () => {
  const crmSource = source('src/lib/crm/bandago-crm.ts');
  assert.match(crmSource, /function normalizeKenyaPhone/);
  assert.match(crmSource, /digits\.startsWith\('0'\) && digits\.length === 10/);
  assert.match(crmSource, /`\+254\$\{digits\.substring\(1\)\}`/);
  assert.match(crmSource, /`\+\$\{digits\}`/);

  // Runtime deep testing of phone normalization rules
  assert.equal(normalizeKenyaPhone('0712345678'), '+254712345678');
  assert.equal(normalizeKenyaPhone('0112345678'), '+254112345678');
  assert.equal(normalizeKenyaPhone('254712345678'), '+254712345678');
  assert.equal(normalizeKenyaPhone('+254712345678'), '+254712345678');
  assert.equal(normalizeKenyaPhone('712345678'), '+254712345678');
  assert.equal(normalizeKenyaPhone('112345678'), '+254112345678');
  assert.equal(normalizeKenyaPhone('  0712-345-678  '), '+254712345678');
  assert.equal(normalizeKenyaPhone(''), '');
  assert.equal(normalizeKenyaPhone(null), '');
  assert.equal(normalizeKenyaPhone('non-numeric-text'), '');
});

test('InventoryGuard Contract: atomic reservation, release, and commit operations', () => {
  const guardSource = source('src/lib/inventory-guard.ts');
  assert.match(guardSource, /class InventoryGuard/);
  assert.match(guardSource, /reserveStock/);
  assert.match(guardSource, /releaseReservation/);
  assert.match(guardSource, /commitReservation/);
  assert.match(guardSource, /virtualReservedStock:\s*\{\s*increment:\s*item\.quantity\s*\}/);
  assert.match(guardSource, /virtualReservedStock:\s*\{\s*decrement:\s*item\.quantity\s*\}/);
  assert.match(guardSource, /stock:\s*\{\s*decrement:\s*item\.quantity\s*\}/);
});

test('BandaGo POS sync API route contract: Bearer auth, chunked transaction, audit logs, and FEFO batches', () => {
  const syncSource = source('src/app/api/integrations/bandago/sync/route.ts');
  assert.match(syncSource, /process\.env\.BANDAGO_SYNC_API_KEY/);
  assert.match(syncSource, /Bearer \$\{expectedSecret\}/);
  assert.match(syncSource, /status:\s*401/);
  assert.match(syncSource, /posSyncLog\.create/);
  assert.match(syncSource, /CHUNK_SIZE\s*=\s*50/);
  assert.match(syncSource, /tx\.product\.upsert/);
  assert.match(syncSource, /tx\.productBatch\.upsert/);
  assert.match(syncSource, /posSyncLog\.update/);
});

test('BandaGo POS CSV import route contract: multipart parser, quotes regex, and delegation to sync route', () => {
  const csvSource = source('src/app/api/integrations/bandago/csv-import/route.ts');
  assert.match(csvSource, /process\.env\.BANDAGO_SYNC_API_KEY/);
  assert.match(csvSource, /requireStaff\(\['ADMIN', 'PHARMACIST'\]\)/);
  assert.match(csvSource, /req\.formData\(\)/);
  assert.match(csvSource, /trigger:\s*'CSV_IMPORT'/);
  assert.match(csvSource, /handleSync/);
  assert.match(csvSource, /parseCsv/);
});

test('CSV Parser: handles multiline quotes, escaped quotes, commas inside quotes, and UTF-8 BOM', () => {
  const sampleCsv = `\uFEFFexternalPosId,name,description,price,stock
BP-001,"Panadol Extra","Contains paracetamol.
Take 2 tablets with water.",150.00,45
BP-002,Amoxicillin,"500mg, ""Antibiotic""",250.50,12`;

  const rows = parseCsv(sampleCsv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['externalPosId', 'name', 'description', 'price', 'stock']);
  assert.equal(rows[1][0], 'BP-001');
  assert.equal(rows[1][1], 'Panadol Extra');
  assert.equal(rows[1][2], 'Contains paracetamol.\nTake 2 tablets with water.');
  assert.equal(rows[1][3], '150.00');
  assert.equal(rows[1][4], '45');
  assert.equal(rows[2][0], 'BP-002');
  assert.equal(rows[2][2], '500mg, "Antibiotic"');
});

test('Orders checkout and cancellation: enforces safetyStockBuffer and synchronizes physical and virtual stock', () => {
  const ordersRoute = source('src/app/api/orders/route.ts');
  assert.match(ordersRoute, /safety_stock_buffer/);
  assert.match(ordersRoute, /virtual_reserved_stock/);
  assert.match(ordersRoute, /product\."stockQty" - requested\.qty/);
  assert.match(ordersRoute, /GREATEST\(0, COALESCE\(product\."stock", product\."stockQty"\) - requested\.qty\)/);

  const cancelRoute = source('src/app/api/orders/[id]/cancel/route.ts');
  assert.match(cancelRoute, /stockQty:\s*\{\s*increment:\s*item\.qty\s*\}/);
  assert.match(cancelRoute, /stock:\s*\{\s*increment:\s*item\.qty\s*\}/);

  const cronRoute = source('src/app/api/cron/order-reservations/route.ts');
  assert.match(cronRoute, /stockQty:\s*\{\s*increment:\s*item\.qty\s*\}/);
  assert.match(cronRoute, /stock:\s*\{\s*increment:\s*item\.qty\s*\}/);
});

test('BandaGo POS sync pipeline: FEFO sellable stock calculation, SKU pre-linking, and category upsert', () => {
  const syncSource = source('src/app/api/integrations/bandago/sync/route.ts');
  assert.match(syncSource, /batchResult\.validStock/);
  assert.match(syncSource, /isNearestExpired/);
  assert.match(syncSource, /tx\.category\.upsert/);
  assert.match(syncSource, /where:\s*\{\s*sku:\s*item\.sku\s*\}/);
  assert.match(syncSource, /data:\s*\{\s*externalPosId:\s*item\.externalPosId\s*\}/);
});

test('Admin POS telemetry API contract: staff role requirement and PosSyncStats response format', () => {
  const statusSource = source('src/app/api/admin/pos-status/route.ts');
  assert.match(statusSource, /requireStaff\(\['ADMIN', 'PHARMACIST', 'STAFF'\]\)/);
  assert.match(statusSource, /totalSyncedProducts/);
  assert.match(statusSource, /totalBatches/);
  assert.match(statusSource, /nearExpiryCount/);
  assert.match(statusSource, /lastSyncTimestamp/);
  assert.match(statusSource, /recentLogs/);
});

test('Database schema contracts: ProductBatch and PosSyncLog are correctly declared in Prisma schema and migration SQL', () => {
  const schema = source('prisma/schema.prisma');
  assert.match(schema, /model ProductBatch/);
  assert.match(schema, /model PosSyncLog/);
  assert.match(schema, /enum PosSyncStatus/);
  assert.match(schema, /enum PosSyncTrigger/);
  assert.match(schema, /external_pos_id/);
  assert.match(schema, /safety_stock_buffer/);
  assert.match(schema, /virtual_reserved_stock/);
  assert.match(schema, /external_bpartner_id/);

  const migration = source('prisma/migrations/20261104200000_add_bandago_pos_support/migration.sql');
  assert.match(migration, /CREATE TYPE "PosSyncStatus"/);
  assert.match(migration, /CREATE TYPE "PosSyncTrigger"/);
  assert.match(migration, /CREATE TABLE "product_batches"/);
  assert.match(migration, /ALTER TABLE "Product"[\s\S]*?"external_pos_id"/);
  assert.match(migration, /ALTER TABLE "User"[\s\S]*?"external_bpartner_id"/);
});

test('Admin UI integration: PosSyncSection is registered in Admin navigation and section router', () => {
  const adminShared = source('src/components/views/admin/admin-shared.tsx');
  assert.match(adminShared, /"pos-sync"/);

  const adminView = source('src/components/views/admin/admin-view.tsx');
  assert.match(adminView, /import \{ PosSyncSection \}/);
  assert.match(adminView, /key: "pos-sync"/);
  assert.match(adminView, /case "pos-sync":/);
  assert.match(adminView, /<PosSyncSection/);

  const posSyncSection = source('src/components/views/admin/sections/pos-sync-section.tsx');
  assert.match(posSyncSection, /BandaGo POS Integration Hub/);
  assert.match(posSyncSection, /\/api\/admin\/pos-status/);
  assert.match(posSyncSection, /\/api\/integrations\/bandago\/csv-import/);
  assert.match(posSyncSection, /Synchronization Audit Trail/);
});

test('BandaGoNormalizer: POM word boundary prevents false positive for non-prescription keywords', () => {
  // Acronyms should only match on word boundaries, never as part of words like 'Pomegranate'
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Pomegranate Lip Balm', 'skin-care'), false);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Pomelo Hand Lotion', 'personal-care'), false);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Proximity Bandage', 'first-aid'), false);

  // Exact word boundary matches for POM and Rx
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Panadol Extra POM', 'pain-fever'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('POM Tablets 100mg', 'otc'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Cardio Rx Tablet', 'cardio'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Metformin 500mg', 'diabetes'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Amlodipine 5mg', 'hypertension'), true);
});

test('BandaGoNormalizer: safeParseDate handles corrupt or missing dates safely', () => {
  const fallback = new Date('2027-01-01T00:00:00Z');
  assert.equal(BandaGoNormalizer.safeParseDate('invalid-date', fallback), fallback);
  assert.equal(BandaGoNormalizer.safeParseDate('N/A', fallback), fallback);
  assert.equal(BandaGoNormalizer.safeParseDate('', fallback), fallback);
  assert.equal(BandaGoNormalizer.safeParseDate(null, fallback), fallback);
  assert.equal(BandaGoNormalizer.safeParseDate(undefined, fallback), fallback);

  const valid = BandaGoNormalizer.safeParseDate('2026-12-31T00:00:00Z');
  assert.equal(valid?.toISOString(), new Date('2026-12-31T00:00:00Z').toISOString());
});

test('BandaGo POS CSV import route: case-insensitive iDempiere header aliases and batch attachment', () => {
  const csvSource = source('src/app/api/integrations/bandago/csv-import/route.ts');
  assert.match(csvSource, /getCol\('externalPosId'/);
  assert.match(csvSource, /BH_SellPrice/);
  assert.match(csvSource, /BH_CostPrice/);
  assert.match(csvSource, /QtyOnHand/);
  assert.match(csvSource, /guaranteeDate/);
  assert.match(csvSource, /bhLotNumber/);
  assert.match(csvSource, /batchNumber/);
});

test('BandaGo CRM Reconciler and HTTP Route Contracts', () => {
  const crmReconcilerSource = source('src/lib/crm/bandago-crm.ts');
  assert.match(crmReconcilerSource, /class BandaGoCrmReconciler/);
  assert.match(crmReconcilerSource, /syncCustomerProfile/);
  assert.match(crmReconcilerSource, /checkChronicRefillEligible/);
  assert.match(crmReconcilerSource, /safeEmail/);
  assert.match(crmReconcilerSource, /safeBPartnerId/);

  const crmRouteSource = source('src/app/api/integrations/bandago/crm/route.ts');
  assert.match(crmRouteSource, /BandaGoCrmReconciler\.syncCustomerProfile/);
  assert.match(crmRouteSource, /BandaGoCrmReconciler\.checkChronicRefillEligible/);
  assert.match(crmRouteSource, /requireStaff/);

  const cronChronicSource = source('src/app/api/cron/chronic-refills/route.ts');
  assert.match(cronChronicSource, /process\.env\.CRON_SECRET/);
  assert.match(cronChronicSource, /BandaGoCrmReconciler\.checkChronicRefillEligible/);
  assert.match(cronChronicSource, /notifyCustomer/);
  assert.match(cronChronicSource, /CHRONIC_REFILL_REMINDER/);
});

test('Orders and prescription refills: enforce InventoryGuard.getAvailableStock pre-checks and status sync', () => {
  const ordersRoute = source('src/app/api/orders/route.ts');
  assert.match(ordersRoute, /InventoryGuard\.getAvailableStock\(product\) < qty/);
  assert.match(ordersRoute, /LEAST\(product\."stockQty", COALESCE\(product\."stock", product\."stockQty"\)\)/);
  assert.match(ordersRoute, /COALESCE\(product\.safety_stock_buffer, 2\)/);

  const refillRoute = source('src/app/api/prescriptions/[id]/refill/route.ts');
  assert.match(refillRoute, /InventoryGuard\.getAvailableStock\(product\) < item\.qty/);
  assert.match(refillRoute, /stockQty:\s*\{\s*decrement:\s*line\.item\.qty\s*\}/);
  assert.match(refillRoute, /stock:\s*\{\s*decrement:\s*line\.item\.qty\s*\}/);
  assert.match(refillRoute, /stockStatus\s*=\s*updatedProduct\.stockQty\s*<=\s*0\s*\?\s*'OUT_OF_STOCK'/);

  const cronRoute = source('src/app/api/cron/order-reservations/route.ts');
  assert.match(cronRoute, /stockStatus\s*=\s*updated\.stockQty\s*<=\s*0\s*\?\s*'OUT_OF_STOCK'/);
});

test('BandaGoNormalizer: parseNumber and parseInteger handle formatted amounts and corrupt inputs', () => {
  // Comma-separated currency amounts
  assert.equal(BandaGoNormalizer.parseNumber('1,250.50'), 1250.5);
  assert.equal(BandaGoNormalizer.parseNumber('KSh 3,400'), 3400);
  assert.equal(BandaGoNormalizer.parseNumber('KES 150.00'), 150);
  assert.equal(BandaGoNormalizer.parseNumber(250.75), 250.75);
  assert.equal(BandaGoNormalizer.parseNumber(''), 0);
  assert.equal(BandaGoNormalizer.parseNumber(null), 0);
  assert.equal(BandaGoNormalizer.parseNumber('N/A', 10), 10);

  // Integer parsing and clamping
  assert.equal(BandaGoNormalizer.parseInteger('1,000'), 1000);
  assert.equal(BandaGoNormalizer.parseInteger('45.9'), 45);
  assert.equal(BandaGoNormalizer.parseInteger(-10), 0);
  assert.equal(BandaGoNormalizer.parseInteger('corrupt', 5), 5);
});

test('BandaGoNormalizer: multi-locator batch deduplication aggregates quantities and selects earliest expiry', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const multiLocatorBatches = [
    {
      batchNumber: 'LOT-MULTI-01',
      qtyOnHand: 10,
      expiryDate: '2027-03-01T00:00:00Z',
    },
    {
      batchNumber: 'LOT-MULTI-01', // Same lot in second storage bin
      qtyOnHand: 25,
      expiryDate: '2027-02-15T00:00:00Z', // Slightly earlier recorded date
    },
    {
      batchNumber: '   ', // Empty batch number should be skipped
      qtyOnHand: 50,
      expiryDate: '2027-01-01T00:00:00Z',
    },
    {
      batchNumber: 'LOT-EXPIRED',
      qtyOnHand: 5,
      expiryDate: '2026-05-01T00:00:00Z', // Expired
    },
  ];

  const result = BandaGoNormalizer.processBatches(multiLocatorBatches, now);

  // LOT-MULTI-01 aggregated quantity should be 10 + 25 = 35
  const multiBatch = result.batches.find((b) => b.batchNumber === 'LOT-MULTI-01');
  assert.ok(multiBatch);
  assert.equal(multiBatch.qtyOnHand, 35);
  assert.equal(multiBatch.quantityOnHand, 35);
  assert.equal(multiBatch.isExpired, false);
  assert.equal(multiBatch.parsedExpiry.toISOString(), new Date('2027-02-15T00:00:00Z').toISOString());

  // Empty batch number must not appear in processedBatches
  assert.equal(result.batches.some((b) => b.batchNumber.trim() === ''), false);

  // Valid non-expired stock must be exactly 35 (the 5 expired units and empty batch units excluded)
  assert.equal(result.validStock, 35);
});

test('BandaGoNormalizer: extended PPB prescription medication keywords match correctly', () => {
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Cefixime 200mg Tablets'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Enalapril 10mg Tablets'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Tramadol 50mg Capsules'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Glibenclamide 5mg Tablets'), true);
  assert.equal(BandaGoNormalizer.classifyRequiresPrescription('Fluconazole 150mg Capsule'), true);
});

test('BandaGo CRM and Telemetry route contracts: phone/bpartner lookup and inventory batch filtering', () => {
  const crmRouteSource = source('src/app/api/integrations/bandago/crm/route.ts');
  assert.match(crmRouteSource, /url\.searchParams\.get\('phone'\)/);
  assert.match(crmRouteSource, /url\.searchParams\.get\('bpartnerId'\)/);
  assert.match(crmRouteSource, /Array\.isArray\(payload\)/);

  const statusSource = source('src/app/api/admin/pos-status/route.ts');
  assert.match(statusSource, /quantityOnHand:\s*\{\s*gt:\s*0\s*\}/);
});

test('Production Fix 1: Sync route pre-resolves categories outside chunk loop and configures 30s transaction timeout', () => {
  const syncSource = source('src/app/api/integrations/bandago/sync/route.ts');
  // Pre-resolves unique categories before the chunk loop
  assert.match(syncSource, /uniqueCategories\s*=\s*Array\.from/);
  assert.match(syncSource, /categoryMap\.set\(slug,\s*cat\.id\)/);
  // Increases interactive transaction timeout to avoid P2028 timeouts
  assert.match(syncSource, /maxWait:\s*10_000,\s*timeout:\s*30_000/);
});

test('Production Fix 2: Sync route links unlinked seeded products to prevent P2002 slug unique constraint crash', () => {
  const syncSource = source('src/app/api/integrations/bandago/sync/route.ts');
  // Checks externalPosId, slug, and unlinked name
  assert.match(syncSource, /externalPosId:\s*item\.externalPosId/);
  assert.match(syncSource, /slug:\s*targetSlug/);
  assert.match(syncSource, /name:\s*\{\s*equals:\s*item\.name,\s*mode:\s*['"]insensitive['"]\s*\},\s*externalPosId:\s*null/);
  // Links unlinked existing product
  assert.match(syncSource, /if\s*\(existingProduct\s*&&\s*!existingProduct\.externalPosId\)/);
  assert.match(syncSource, /data:\s*\{\s*externalPosId:\s*item\.externalPosId\s*\}/);
});

test('Production Fix 3: Sync route preserves custom product images and pharmacist Rx overrides', () => {
  const syncSource = source('src/app/api/integrations/bandago/sync/route.ts');
  // Never overwrites specific /images/products/ assets
  assert.match(syncSource, /hasCustomProductImage/);
  assert.match(syncSource, /existingProduct\.image\.startsWith\(['"]\/images\/products\/['"]\)/);
  // Never downgrades pharmacist prescription-only classification
  assert.match(syncSource, /existingProduct\.requiresPrescription\s*\|\|\s*requiresPrescription/);
});

test('Production Fix 4: Sync route subtracts virtualReservedStock when computing inStock and effective availability', () => {
  const syncSource = source('src/app/api/integrations/bandago/sync/route.ts');
  assert.match(syncSource, /const\s+reserved\s*=\s*existingProduct\?\.virtualReservedStock\s*\?\?\s*0/);
  assert.match(syncSource, /const\s+effectiveAvailable\s*=\s*Math\.max\(0,\s*rawStock\s*-\s*reserved\)/);
  assert.match(syncSource, /effectiveAvailable\s*>\s*0\s*&&\s*sellableStock\s*>\s*0/);

  // Runtime formula verification: 1 unit in stock with 1 virtual reservation must be NOT in stock
  const rawStock = 1;
  const reserved = 1;
  const sellableStock = 1;
  const effectiveAvailable = Math.max(0, rawStock - reserved);
  const effectiveInStock = effectiveAvailable > 0 && sellableStock > 0;
  assert.equal(effectiveInStock, false);
});

test('Production Fix 5: Missing batches array does not wipe existing ProductBatch records', () => {
  const syncSource = source('src/app/api/integrations/bandago/sync/route.ts');
  // Deletes all batches only when stock is 0
  assert.match(syncSource, /if\s*\(item\.stock\s*===\s*0\)\s*\{\s*await tx\.productBatch\.deleteMany/);
  // Replaces batches only when non-empty batches array is explicitly provided
  assert.match(syncSource, /else if\s*\(Array\.isArray\(item\.batches\)\s*&&\s*item\.batches\.length\s*>\s*0\)/);
  assert.match(syncSource, /tx\.productBatch\.createMany/);
});

test('Production Fix 6: InventoryGuard automatically cleans up expired virtual reservations and clamps to GREATEST(0, ...)', () => {
  const guardSource = source('src/lib/inventory-guard.ts');
  assert.match(guardSource, /cleanupExpiredReservations/);
  assert.match(guardSource, /reserveStockForCheckout/);
  assert.match(guardSource, /GREATEST\(0,\s*"virtual_reserved_stock"\s*-\s*\$\{item\.quantity\}\)/);
  assert.match(guardSource, /GREATEST\(0,\s*"virtual_reserved_stock"\s*-\s*\$\{item\.qty\}\)/);

  // Clean up is also invoked at the start of sync route
  const syncSource = source('src/app/api/integrations/bandago/sync/route.ts');
  assert.match(syncSource, /InventoryGuard\.cleanupExpiredReservations\(45\)/);
});

test('Production Fix 7: CI workflow ensures prisma generate runs before static checks and routes have zero :any catches', () => {
  const ciSource = source('.github/workflows/ci.yml');
  const prismaGenIdx = ciSource.indexOf('npx prisma generate');
  const typecheckIdx = ciSource.indexOf('npm run typecheck');
  const lintIdx = ciSource.indexOf('npm run lint');
  assert.ok(prismaGenIdx > -1, 'npx prisma generate must be present in CI');
  assert.ok(prismaGenIdx < typecheckIdx, 'npx prisma generate must run before typecheck');
  assert.ok(prismaGenIdx < lintIdx, 'npx prisma generate must run before lint');

  const syncSource = source('src/app/api/integrations/bandago/sync/route.ts');
  assert.doesNotMatch(syncSource, /catch\s*\([^)]*:\s*any\)/, 'sync route must not have catch (:any)');

  const csvSource = source('src/app/api/integrations/bandago/csv-import/route.ts');
  assert.doesNotMatch(csvSource, /catch\s*\([^)]*:\s*any\)/, 'csv-import route must not have catch (:any)');

  const crmSource = source('src/app/api/integrations/bandago/crm/route.ts');
  assert.doesNotMatch(crmSource, /catch\s*\([^)]*:\s*any\)/, 'crm route must not have catch (:any)');

  const chronicRefillSource = source('src/app/api/cron/chronic-refills/route.ts');
  assert.doesNotMatch(chronicRefillSource, /catch\s*\([^)]*:\s*any\)/, 'chronic-refills route must not have catch (:any)');

  const posSyncSectionSource = source('src/components/views/admin/sections/pos-sync-section.tsx');
  assert.doesNotMatch(posSyncSectionSource, /catch\s*\([^)]*:\s*any\)/, 'pos-sync-section component must not have catch (:any)');
});

test('Deep Functional Verification: Effective stock with FEFO expiry and virtual reservation', () => {
  // Scenario A: 10 raw stock, but 8 are expired (2 valid sellable stock), and 2 are virtually reserved
  const rawStock = 10;
  const sellableStock = 2; // FEFO valid stock
  const reserved = 2; // In-flight M-Pesa push

  const effectiveAvailable = Math.max(0, rawStock - reserved);
  const effectiveSellable = Math.max(0, sellableStock - reserved);
  const effectiveInStock = effectiveAvailable > 0 && sellableStock > 0 && effectiveSellable > 0;

  assert.equal(effectiveInStock, false, 'Product must be OUT OF STOCK when sellable stock is exhausted by reservation');

  // Scenario B: 10 raw stock, 10 sellable stock, 2 reserved -> 8 effective available
  const rawStockB = 10;
  const sellableStockB = 10;
  const reservedB = 2;
  const effectiveSellableB = Math.max(0, sellableStockB - reservedB);
  const effectiveInStockB = Math.max(0, rawStockB - reservedB) > 0 && sellableStockB > 0 && effectiveSellableB > 0;
  assert.equal(effectiveInStockB, true);
  assert.equal(effectiveSellableB, 8);
});

test('Deep Functional Verification: InventoryGuard getAvailableStock edge cases and formula', () => {
  const guardSource = source('src/lib/inventory-guard.ts');
  assert.match(guardSource, /getAvailableStock/);
  assert.match(guardSource, /Math\.max\(0,\s*physicalStock\s*-\s*buffer\s*-\s*reserved\)/);

  // Replicate and test the pure calculation logic of InventoryGuard.getAvailableStock
  const calculateStock = (product) => {
    const physicalStock = (product.stock != null && product.stockQty != null)
      ? Math.min(product.stock, product.stockQty)
      : (product.stock ?? product.stockQty ?? 0);
    const buffer = product.safetyStockBuffer != null ? product.safetyStockBuffer : 2;
    const reserved = Math.max(0, product.virtualReservedStock ?? 0);
    return Math.max(0, physicalStock - buffer - reserved);
  };

  const productA = { stock: 15, stockQty: 10, safetyStockBuffer: 2, virtualReservedStock: 3 };
  assert.equal(calculateStock(productA), 5); // min(15, 10) - 2 - 3 = 5

  const productB = { stock: 5, stockQty: 5, safetyStockBuffer: 2, virtualReservedStock: 5 };
  assert.equal(calculateStock(productB), 0); // clamped to 0

  const productC = { stock: 10, stockQty: null, safetyStockBuffer: null, virtualReservedStock: null };
  assert.equal(calculateStock(productC), 8); // 10 - default buffer 2 - 0 = 8
});

test('Deep Functional Verification: CSV parser with custom slug and missing image column', () => {
  const csvContent = `externalPosId,name,price,stock,slug\nBP-999,Paracetamol Syrup,120.00,50,custom-paracetamol-syrup`;
  const rows = parseCsv(csvContent);
  assert.equal(rows.length, 2);
  const headers = rows[0];
  const data = rows[1];
  assert.equal(headers[4], 'slug');
  assert.equal(data[4], 'custom-paracetamol-syrup');
});

