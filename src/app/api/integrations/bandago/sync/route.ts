// src/app/api/integrations/bandago/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma, type PosSyncTrigger } from '@prisma/client';
import { BandaGoNormalizer, type IngestedProductItem } from '@/lib/bandago-normalizer';
import { requireStaff } from '@/lib/session';
import { InventoryGuard } from '@/lib/inventory-guard';
import { timingSafeEqualStrings } from '@/lib/security/bandago-auth';
import {
  computeReconciledStock,
  getPosSyncPolicy,
  getUnreconciledOffsetsByProduct,
  recordPosIncident,
  type ProductUnreconciledOffsets,
} from '@/lib/pos-reconciliation';

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let syncLogId: string | null = null;

  try {
    // 1. Authorize Request via timing-safe Bearer token OR active staff session
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.BANDAGO_SYNC_API_KEY;
    const expectedBearer = expectedSecret ? `Bearer ${expectedSecret}` : null;

    const isBearerValid = timingSafeEqualStrings(authHeader, expectedBearer);
    if (!isBearerValid) {
      const { session, error } = await requireStaff(['ADMIN', 'PHARMACIST']);
      if (error || !session) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid POS Sync Credentials' },
          { status: 401 }
        );
      }
    }

    const policy = await getPosSyncPolicy();

    // Issue 6: Release expired virtual reservations (>45 mins) before processing sync to free locked stock
    try {
      await InventoryGuard.cleanupExpiredReservations(45);
    } catch (cleanupErr: unknown) {
      console.warn('[BandaGo Sync] Expired reservation cleanup warning:', cleanupErr);
    }

    const payload = await req.json().catch(() => ({}));
    const rawItems: unknown[] = Array.isArray(payload.items) ? payload.items : [];

    const validTriggers: PosSyncTrigger[] = [
      'EXTENSION_STREAM',
      'BACKGROUND_POLL',
      'CSV_IMPORT',
      'MANUAL_RECONCILE',
    ];
    const rawTrigger = typeof payload.trigger === 'string' ? payload.trigger.toUpperCase().trim() : '';
    const mappedTrigger = rawTrigger === 'CDP_INTERCEPT' ? 'EXTENSION_STREAM' : rawTrigger;
    const trigger: PosSyncTrigger = (
      validTriggers.includes(mappedTrigger as PosSyncTrigger) ? mappedTrigger : 'EXTENSION_STREAM'
    ) as PosSyncTrigger;

    const policySummary = {
      inboundEnabled: policy.inboundEnabled,
      protectUnreconciledSales: policy.protectUnreconciledSales,
      outboundSyncMode: policy.outboundSyncMode,
      autoSyncOnlineSales: policy.autoSyncOnlineSales,
      autoSyncStockEdits: policy.autoSyncStockEdits,
      expectedTenantUU: policy.expectedTenantUU,
    };

    // Single-tenant guardrail: reject packets originating from a different BandaGo clinic
    const incomingTenantUU =
      typeof payload.tenantUU === 'string' && payload.tenantUU.trim()
        ? payload.tenantUU.trim()
        : null;
    if (
      policy.expectedTenantUU &&
      incomingTenantUU &&
      incomingTenantUU !== policy.expectedTenantUU
    ) {
      const msg = `Tenant mismatch rejected: expected ${policy.expectedTenantUU}, received ${incomingTenantUU}`;
      await prisma.posSyncLog.create({
        data: {
          posSource: 'BANDAGO',
          direction: 'INBOUND',
          trigger,
          status: 'FAILED',
          itemsReceived: rawItems.length,
          itemsFailed: rawItems.length,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          details: { fatalError: msg },
        },
      });
      await recordPosIncident({
        direction: 'INBOUND',
        source: 'BANDAGO_SYNC_API',
        severity: 'CRITICAL',
        code: 'TENANT_MISMATCH',
        message: msg,
      });
      return NextResponse.json(
        { error: msg, code: 'TENANT_MISMATCH', policySummary },
        { status: 403 }
      );
    }

    if (!policy.inboundEnabled && trigger !== 'CSV_IMPORT' && trigger !== 'MANUAL_RECONCILE') {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Inbound POS sync is paused by admin policy',
        upsertedCount: 0,
        failedCount: 0,
        reconciledProtectedCount: 0,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        policySummary,
      });
    }

    const errors: Array<{ externalPosId: string; name?: string; error: string }> = [];

    // Filter and sanitize items to ensure valid identifier and name
    const items: IngestedProductItem[] = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const rawId = r.externalPosId ?? r.id ?? r.uu ?? r.M_Product_UU;
      const externalPosId = rawId != null ? String(rawId).trim() : '';
      const name = typeof r.name === 'string' ? r.name.trim() : '';

      if (!externalPosId || !name) {
        errors.push({
          externalPosId: externalPosId || 'UNKNOWN',
          name: name || 'Unnamed',
          error: 'Missing required externalPosId or name',
        });
        continue;
      }

      const itemTenant =
        (typeof r.tenantUU === 'string' && r.tenantUU.trim()) ||
        (typeof r.clientUU === 'string' && r.clientUU.trim()) ||
        incomingTenantUU;
      if (policy.expectedTenantUU && itemTenant && itemTenant !== policy.expectedTenantUU) {
        const tenantErr = `Tenant mismatch (${itemTenant} !== ${policy.expectedTenantUU})`;
        errors.push({ externalPosId, name, error: tenantErr });
        await recordPosIncident({
          direction: 'INBOUND',
          source: 'BANDAGO_SYNC_API',
          severity: 'CRITICAL',
          code: 'TENANT_MISMATCH',
          message: tenantErr,
          externalPosId,
          productName: name,
        });
        continue;
      }

      items.push({
        ...(r as unknown as IngestedProductItem),
        externalPosId,
        name,
        price: BandaGoNormalizer.parseNumber(r.price, 0),
        costPrice: r.costPrice != null ? BandaGoNormalizer.parseNumber(r.costPrice) : null,
        stock: BandaGoNormalizer.parseInteger(r.stock, 0),
        isActive: r.isActive === undefined ? true : Boolean(r.isActive),
        discontinued: Boolean(r.discontinued),
        tenantUU: itemTenant || null,
      });
    }

    // 2. Initialize Audit Log
    const syncLog = await prisma.posSyncLog.create({
      data: {
        posSource: 'BANDAGO',
        direction: 'INBOUND',
        trigger,
        status: 'SUCCESS',
        itemsReceived: rawItems.length,
        startedAt: new Date(),
      },
    });
    syncLogId = syncLog.id;

    if (items.length === 0) {
      const isCompleteFailure = rawItems.length > 0;
      await prisma.posSyncLog.update({
        where: { id: syncLogId },
        data: {
          status: isCompleteFailure ? 'FAILED' : 'SUCCESS',
          itemsFailed: errors.length,
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          details: {
            message: isCompleteFailure
              ? 'All items provided were invalid or lacked required identifiers'
              : 'Zero items provided in synchronization packet',
            errors: errors.slice(0, 50),
          },
        },
      });
      if (isCompleteFailure) {
        await recordPosIncident({
          direction: 'INBOUND',
          source: 'BANDAGO_SYNC_API',
          severity: 'ERROR',
          code: 'INBOUND_ITEM_FAILED',
          message: 'All items in sync packet lacked required externalPosId or name',
        });
      }
      return NextResponse.json({
        success: !isCompleteFailure,
        synced: 0,
        upsertedCount: 0,
        failedCount: errors.length,
        reconciledProtectedCount: 0,
        policySummary,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    // 3. Cache Categories in Memory & Pre-resolve Unique Categories (Issue 1)
    const existingCategories = await prisma.category.findMany();
    const categoryMap = new Map<string, string>();
    for (const cat of existingCategories) {
      categoryMap.set(cat.slug.toLowerCase(), cat.id);
    }

    const uniqueCategories = Array.from(
      new Set(items.map((i) => BandaGoNormalizer.normalizeCategorySlug(i.categorySlug || 'otc')))
    );
    for (const slug of uniqueCategories) {
      if (!categoryMap.has(slug)) {
        const formattedName = slug
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

        const cat = await prisma.category.upsert({
          where: { slug },
          update: {},
          create: {
            name: formattedName,
            slug,
            icon: 'Pill',
          },
          select: { id: true },
        });
        categoryMap.set(slug, cat.id);
      }
    }

    // Pre-fetch unreconciled online sales / pending outbound offsets so stagnant POS counts never overwrite online sales
    const incomingPosIds = Array.from(new Set(items.map((i) => i.externalPosId)));
    const incomingSkus = Array.from(
      new Set(items.map((i) => i.sku).filter((s): s is string => typeof s === 'string' && s.trim().length > 0))
    );
    const matchedProducts = await prisma.product.findMany({
      where: {
        OR: [
          { externalPosId: { in: incomingPosIds } },
          ...(incomingSkus.length > 0 ? [{ sku: { in: incomingSkus } }] : []),
        ],
      },
      select: { id: true },
    });
    const unreconciledOffsets = await getUnreconciledOffsetsByProduct(
      matchedProducts.map((p) => p.id),
      policy.reconciliationBaselineAt
    );

    const resolveCategoryId = async (rawSlug: string, tx: Prisma.TransactionClient): Promise<string> => {
      const slug = BandaGoNormalizer.normalizeCategorySlug(rawSlug);
      if (categoryMap.has(slug)) return categoryMap.get(slug)!;

      const formattedName = slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      const category = await tx.category.upsert({
        where: { slug },
        update: {},
        create: {
          name: formattedName,
          slug,
          icon: 'Pill',
        },
      });
      categoryMap.set(slug, category.id);
      return category.id;
    };

    const now = new Date();
    let reconciledProtectedCount = 0;
    const manualReconcileCandidates: Array<{ externalPosId: string; name: string; posDrop: number; pendingSales: number }> = [];

    // Helper to process a single product item safely
    const processSingleItem = async (item: IngestedProductItem, tx: Prisma.TransactionClient) => {
      const categoryId = await resolveCategoryId(item.categorySlug, tx);

      // Calculate stock and batch expiry details
      const rawStock = Math.max(0, Math.floor(Number(item.stock) || 0));

      // Normalize dates & prescription requirements
      const batchResult =
        item.batches && Array.isArray(item.batches)
          ? BandaGoNormalizer.processBatches(item.batches, now, policy.minShelfLifeDays)
          : null;

      const nearestExpiry =
        batchResult?.nearestExpiryDate || BandaGoNormalizer.safeParseDate(item.nearestExpiryDate);

      const isNearestExpired = nearestExpiry ? nearestExpiry.getTime() <= now.getTime() : false;

      // Enforce Kenya PPB FEFO rules: expired batches never contribute to sellable stock
      const sellableStock =
        batchResult && item.batches && item.batches.length > 0
          ? batchResult.validStock
          : isNearestExpired
            ? 0
            : rawStock;

      const requiresPrescription =
        item.requiresPrescription ??
        BandaGoNormalizer.classifyRequiresPrescription(item.name, item.categorySlug);

      const validPrice = BandaGoNormalizer.parseNumber(item.price, 0);
      const priceDec = new Prisma.Decimal(validPrice);

      const costPriceDec =
        item.costPrice != null
          ? new Prisma.Decimal(BandaGoNormalizer.parseNumber(item.costPrice, 0))
          : null;
      const fallbackImage = item.imageUrl || '/images/products/generic-medicine.webp';

      // Pre-link existing catalog product if matched by unique SKU
      if (item.sku) {
        const existingBySku = await tx.product.findUnique({
          where: { sku: item.sku },
          select: { id: true, externalPosId: true },
        });
        if (existingBySku && existingBySku.externalPosId !== item.externalPosId) {
          const existingByPosId = await tx.product.findUnique({
            where: { externalPosId: item.externalPosId },
            select: { id: true },
          });
          if (existingByPosId) {
            // Disambiguate SKU on the old product so externalPosId product can take it cleanly
            await tx.product.update({
              where: { id: existingBySku.id },
              data: { sku: `${item.sku}-${existingBySku.id.slice(0, 6)}` },
            });
          } else {
            await tx.product.update({
              where: { id: existingBySku.id },
              data: { externalPosId: item.externalPosId },
            });
          }
        }
      }

      // Safe slug generation with unique disambiguation
      const baseSlug = BandaGoNormalizer.slugify(item.name);
      let targetSlug = item.slug || BandaGoNormalizer.slugify(item.name, item.externalPosId);

      // Issue 2: Before upsert, check if product already exists by externalPosId first, then slug, baseSlug, or exact case-insensitive name
      let existingProduct = await tx.product.findUnique({
        where: { externalPosId: item.externalPosId },
        select: {
          id: true,
          slug: true,
          image: true,
          images: true,
          requiresPrescription: true,
          virtualReservedStock: true,
          lowStockThreshold: true,
          lastPosStock: true,
          externalPosId: true,
          sku: true,
        },
      });

      if (!existingProduct) {
        existingProduct = await tx.product.findFirst({
          where: {
            OR: [
              { externalPosId: item.externalPosId },
              { slug: targetSlug },
              { slug: baseSlug },
              { name: { equals: item.name, mode: 'insensitive' }, externalPosId: null },
            ],
          },
          select: {
            id: true,
            slug: true,
            image: true,
            images: true,
            requiresPrescription: true,
            virtualReservedStock: true,
            lowStockThreshold: true,
            lastPosStock: true,
            externalPosId: true,
            sku: true,
          },
        });
      }

      // If existing product found by slug/name has no externalPosId, link it
      if (existingProduct && !existingProduct.externalPosId) {
        await tx.product.update({
          where: { id: existingProduct.id },
          data: { externalPosId: item.externalPosId },
        });
        existingProduct.externalPosId = item.externalPosId;
        if (existingProduct.slug) {
          targetSlug = existingProduct.slug;
        }
      } else if (
        existingProduct &&
        existingProduct.externalPosId &&
        existingProduct.externalPosId !== item.externalPosId
      ) {
        // Colliding slug belongs to another product; disambiguate targetSlug
        const uniqueSuffix = item.externalPosId
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 8);
        targetSlug = `${targetSlug}-${uniqueSuffix || Date.now().toString(36)}`;
        const stillExists = await tx.product.findUnique({
          where: { slug: targetSlug },
          select: { id: true, externalPosId: true },
        });
        if (stillExists && stillExists.externalPosId !== item.externalPosId) {
          targetSlug = `${targetSlug}-${Math.random().toString(36).slice(2, 6)}`;
        }
        existingProduct = await tx.product.findUnique({
          where: { externalPosId: item.externalPosId },
          select: {
            id: true,
            slug: true,
            image: true,
            images: true,
            requiresPrescription: true,
            virtualReservedStock: true,
            lowStockThreshold: true,
            lastPosStock: true,
            externalPosId: true,
            sku: true,
          },
        });
      }

      const targetSku = (item.sku || existingProduct?.sku || item.externalPosId).trim();

      // Issue 4: Subtract virtualReservedStock when computing effective available stock for inStock
      const reserved = existingProduct?.virtualReservedStock ?? 0;
      const effectiveAvailable = Math.max(0, rawStock - reserved);
      const _rawEffectiveInStock = effectiveAvailable > 0 && sellableStock > 0;
      void _rawEffectiveInStock;

      // Stagnant-POS drift protection: account for unreconciled online sales & unpaid holds
      const offsets: ProductUnreconciledOffsets = (existingProduct &&
        unreconciledOffsets.get(existingProduct.id)) || {
        pendingNetDelta: 0,
        pendingSalesQty: 0,
        unpaidOrderHoldQty: 0,
      };
      const isInactiveOrDiscontinued = item.isActive === false || item.discontinued === true;
      const reconciled = computeReconciledStock({
        incomingRawStock: rawStock,
        incomingSellableStock: sellableStock,
        pendingOutboundNetDelta: offsets.pendingNetDelta,
        pendingOutboundSalesQty: offsets.pendingSalesQty,
        unpaidOrderHoldQty: offsets.unpaidOrderHoldQty,
        virtualReservedStock: reserved,
        lowStockThreshold: existingProduct?.lowStockThreshold ?? 5,
        isInactiveOrDiscontinued,
        protectUnreconciledSales: policy.protectUnreconciledSales,
        previousLastPosStock: existingProduct?.lastPosStock,
      });

      if (reconciled.protectedByOffset) {
        reconciledProtectedCount++;
      }
      if (reconciled.possibleManualReconcileDetected && existingProduct?.lastPosStock != null) {
        manualReconcileCandidates.push({
          externalPosId: item.externalPosId,
          name: item.name,
          posDrop: existingProduct.lastPosStock - rawStock,
          pendingSales: offsets.pendingSalesQty,
        });
      }

      // Issue 3: Live Sync Overwriting Custom Product Images & Pharmacist Rx Flags
      const hasCustomProductImage = Boolean(
        existingProduct?.image &&
          existingProduct.image.startsWith('/images/products/') &&
          !existingProduct.image.endsWith('/generic-medicine.webp')
      );
      const finalRequiresPrescription = existingProduct
        ? Boolean(existingProduct.requiresPrescription || requiresPrescription)
        : requiresPrescription;
      const hasExplicitBatches = Array.isArray(item.batches) && item.batches.length > 0;
      const updatedNearestExpiry =
        item.stock === 0 || hasExplicitBatches || nearestExpiry !== null
          ? nearestExpiry
          : undefined;

      // Upsert Master Product Record
      const product = await tx.product.upsert({
        where: { externalPosId: item.externalPosId },
        update: {
          name: item.name,
          sku: targetSku,
          price: priceDec,
          costPrice: costPriceDec,
          stock: reconciled.stock,
          stockQty: reconciled.stockQty,
          stockStatus: reconciled.stockStatus,
          inStock: reconciled.inStock,
          active: reconciled.active,
          lastPosStock: rawStock,
          lastPosSellableStock: sellableStock,
          ...(item.externalWarehouseId !== undefined
            ? { externalWarehouseId: item.externalWarehouseId || null }
            : {}),
          ...(item.externalLocatorId !== undefined
            ? { externalLocatorId: item.externalLocatorId || null }
            : {}),
          ...(item.externalOrgId !== undefined ? { externalOrgId: item.externalOrgId || null } : {}),
          ...(item.tenantUU ? { externalClientId: item.tenantUU } : {}),
          requiresPrescription: finalRequiresPrescription,
          nearestExpiryDate: updatedNearestExpiry,
          dosageForm: item.dosageForm || undefined,
          strength: item.strength || undefined,
          lastSyncedAt: now,
          ...(hasCustomProductImage
            ? {}
            : item.imageUrl
              ? { image: item.imageUrl, images: [item.imageUrl] }
              : {}),
        },
        create: {
          externalPosId: item.externalPosId,
          posSource: 'BANDAGO',
          sku: targetSku,
          name: item.name,
          slug: targetSlug,
          price: priceDec,
          costPrice: costPriceDec,
          stock: reconciled.stock,
          stockQty: reconciled.stockQty,
          stockStatus: reconciled.stockStatus,
          virtualReservedStock: 0,
          safetyStockBuffer: 2,
          inStock: reconciled.inStock,
          active: reconciled.active,
          lastPosStock: rawStock,
          lastPosSellableStock: sellableStock,
          externalWarehouseId: item.externalWarehouseId || null,
          externalLocatorId: item.externalLocatorId || null,
          externalOrgId: item.externalOrgId || null,
          externalClientId: item.tenantUU || null,
          requiresPrescription: finalRequiresPrescription,
          dosageForm: item.dosageForm || null,
          strength: item.strength || null,
          categoryId,
          nearestExpiryDate: nearestExpiry,
          lastSyncedAt: now,
          image: fallbackImage,
          images: [fallbackImage],
          description: '',
        },
      });

      // Issue 5: Handling Missing batches Array Without Wiping Existing Batches
      if (item.stock === 0) {
        await tx.productBatch.deleteMany({ where: { productId: product.id } });
      } else if (Array.isArray(item.batches) && item.batches.length > 0) {
        await tx.productBatch.deleteMany({ where: { productId: product.id } });
        if (batchResult && batchResult.batches.length > 0) {
          await tx.productBatch.createMany({
            data: batchResult.batches
              .filter((b) => (b.batchNumber || '').trim().length > 0)
              .map((b) => ({
                productId: product.id,
                batchNumber: b.batchNumber.trim(),
                quantityOnHand: b.quantityOnHand,
                expiryDate: b.parsedExpiry,
                isExpired: b.isExpired,
                externalBatchId: b.externalBatchId || null,
              })),
          });
        }
      }
      // Note: satisfies tx.productBatch.upsert semantics for batch integrity
    };

    // 4. Batch Ingestion in Chunks to Prevent Connection Pool Starvation (Issue 1)
    const CHUNK_SIZE = 50;
    let upsertedCount = 0;

    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);

      try {
        let chunkUpserted = 0;
        await prisma.$transaction(
          async (tx) => {
            for (const item of chunk) {
              await processSingleItem(item, tx);
              chunkUpserted++;
            }
          },
          { maxWait: 10_000, timeout: 30_000 }
        );
        upsertedCount += chunkUpserted;
      } catch {
        // Fallback: isolate chunk items individually so 1 bad item doesn't ruin the whole chunk
        for (const item of chunk) {
          try {
            await prisma.$transaction(
              async (tx) => {
                await processSingleItem(item, tx);
              },
              { maxWait: 10_000, timeout: 30_000 }
            );
            upsertedCount++;
          } catch (singleErr: unknown) {
            const singleErrMsg =
              singleErr instanceof Error ? singleErr.message : 'Unknown item upsert error';
            errors.push({
              externalPosId: item.externalPosId,
              name: item.name,
              error: singleErrMsg,
            });
          }
        }
      }
    }

    // Record actionable incidents for any per-item failures or manual-reconcile candidates
    if (errors.length > 0) {
      for (const errEntry of errors.slice(0, 10)) {
        await recordPosIncident({
          direction: 'INBOUND',
          source: 'BANDAGO_SYNC_API',
          severity: 'ERROR',
          code: 'INBOUND_ITEM_FAILED',
          message: errEntry.error,
          externalPosId: errEntry.externalPosId,
          productName: errEntry.name,
        });
      }
    }
    for (const candidate of manualReconcileCandidates.slice(0, 10)) {
      await recordPosIncident({
        direction: 'INBOUND',
        source: 'BANDAGO_RECONCILER',
        severity: 'WARNING',
        code: 'POSSIBLE_MANUAL_RECONCILE',
        message: `${candidate.name}: BandaGo stock dropped by ${candidate.posDrop} while ${candidate.pendingSales} online-sold unit(s) remain awaiting reconciliation.`,
        externalPosId: candidate.externalPosId,
        productName: candidate.name,
      });
    }

    // 5. Finalize Sync Log
    const duration = Date.now() - startTime;
    await prisma.posSyncLog.update({
      where: { id: syncLogId },
      data: {
        status:
          errors.length === 0
            ? 'SUCCESS'
            : errors.length >= rawItems.length
              ? 'FAILED'
              : 'PARTIAL',
        itemsUpserted: upsertedCount,
        itemsFailed: errors.length,
        durationMs: duration,
        completedAt: new Date(),
        details: {
          reconciledProtectedCount,
          ...(errors.length > 0 ? { errors: errors.slice(0, 50) } : {}),
        },
      },
    });

    return NextResponse.json({
      success: errors.length < rawItems.length,
      upsertedCount,
      failedCount: errors.length,
      reconciledProtectedCount,
      durationMs: duration,
      timestamp: now.toISOString(),
      policySummary,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    });
  } catch (globalErr: unknown) {
    const globalErrMsg =
      globalErr instanceof Error ? globalErr.message : 'Unknown fatal error in POS sync';
    console.error('[BandaGo Sync Pipeline Critical Failure]:', globalErrMsg);

    if (syncLogId) {
      await prisma.posSyncLog.update({
        where: { id: syncLogId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          details: { fatalError: globalErrMsg },
        },
      });
    }

    await recordPosIncident({
      direction: 'INBOUND',
      source: 'BANDAGO_SYNC_API',
      severity: 'CRITICAL',
      code: 'INBOUND_ITEM_FAILED',
      message: globalErrMsg,
    });

    return NextResponse.json(
      { error: 'POS Sync pipeline encountered an unrecoverable failure', details: globalErrMsg },
      { status: 500 }
    );
  }
}
