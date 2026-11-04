// src/app/api/integrations/bandago/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma, type PosSyncTrigger } from '@prisma/client';
import { BandaGoNormalizer, type IngestedBatch, type IngestedProductItem } from '@/lib/bandago-normalizer';
import { requireStaff } from '@/lib/session';

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let syncLogId: string | null = null;

  try {
    // 1. Authorize Request via Bearer token OR active staff session
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.BANDAGO_SYNC_API_KEY;

    const isBearerValid = Boolean(expectedSecret && authHeader === `Bearer ${expectedSecret}`);
    if (!isBearerValid) {
      const { session, error } = await requireStaff(['ADMIN', 'PHARMACIST']);
      if (error || !session) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid POS Sync Credentials' },
          { status: 401 }
        );
      }
    }

    const payload = await req.json().catch(() => ({}));
    const rawItems: any[] = Array.isArray(payload.items) ? payload.items : [];

    const errors: Array<{ externalPosId: string; name?: string; error: string }> = [];

    // Filter and sanitize items to ensure valid identifier and name
    const items: IngestedProductItem[] = [];
    for (const raw of rawItems) {
      if (!raw) continue;
      const rawId = raw.externalPosId ?? raw.id ?? raw.uu ?? raw.M_Product_UU;
      const externalPosId = rawId != null ? String(rawId).trim() : '';
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';

      if (!externalPosId || !name) {
        errors.push({
          externalPosId: externalPosId || 'UNKNOWN',
          name: name || 'Unnamed',
          error: 'Missing required externalPosId or name',
        });
        continue;
      }

      items.push({
        ...raw,
        externalPosId,
        name,
        price: BandaGoNormalizer.parseNumber(raw.price, 0),
        costPrice: raw.costPrice != null ? BandaGoNormalizer.parseNumber(raw.costPrice) : null,
        stock: BandaGoNormalizer.parseInteger(raw.stock, 0),
      });
    }

    const validTriggers: PosSyncTrigger[] = ['EXTENSION_STREAM', 'BACKGROUND_POLL', 'CSV_IMPORT', 'MANUAL_RECONCILE'];
    const rawTrigger = typeof payload.trigger === 'string' ? payload.trigger.toUpperCase().trim() : '';
    const trigger: PosSyncTrigger = (validTriggers.includes(rawTrigger as PosSyncTrigger)
      ? rawTrigger
      : 'EXTENSION_STREAM') as PosSyncTrigger;

    // 2. Initialize Audit Log
    const syncLog = await prisma.posSyncLog.create({
      data: {
        posSource: 'BANDAGO',
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
      return NextResponse.json({
        success: !isCompleteFailure,
        synced: 0,
        failedCount: errors.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    // 3. Cache Categories in Memory
    const existingCategories = await prisma.category.findMany();
    const categoryMap = new Map<string, string>();
    for (const cat of existingCategories) {
      categoryMap.set(cat.slug.toLowerCase(), cat.id);
    }

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

    // Helper to process a single product item safely
    const processSingleItem = async (item: IngestedProductItem, tx: Prisma.TransactionClient) => {
      const categoryId = await resolveCategoryId(item.categorySlug, tx);

      // Calculate stock and batch expiry details
      const rawStock = Math.max(0, Math.floor(Number(item.stock) || 0));

      // Normalize dates & prescription requirements
      const batchResult = item.batches && Array.isArray(item.batches)
        ? BandaGoNormalizer.processBatches(item.batches, now)
        : null;

      const nearestExpiry = batchResult?.nearestExpiryDate
        || BandaGoNormalizer.safeParseDate(item.nearestExpiryDate);

      const isNearestExpired = nearestExpiry ? nearestExpiry.getTime() <= now.getTime() : false;

      // Enforce Kenya PPB FEFO rules: expired batches never contribute to sellable stock
      const sellableStock = (batchResult && item.batches && item.batches.length > 0)
        ? batchResult.validStock
        : (isNearestExpired ? 0 : rawStock);

      const effectiveInStock = sellableStock > 0;
      const stockStatus =
        sellableStock <= 0 ? 'OUT_OF_STOCK' : sellableStock <= 5 ? 'LOW_STOCK' : 'IN_STOCK';

      const requiresPrescription =
        item.requiresPrescription ??
        BandaGoNormalizer.classifyRequiresPrescription(item.name, item.categorySlug);

      const validPrice = BandaGoNormalizer.parseNumber(item.price, 0);
      const priceDec = new Prisma.Decimal(validPrice);

      const costPriceDec = item.costPrice != null
        ? new Prisma.Decimal(BandaGoNormalizer.parseNumber(item.costPrice, 0))
        : null;
      const fallbackImage = item.imageUrl || '/images/products/generic-medicine.webp';

      const targetSku = (item.sku || item.externalPosId).trim();

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
      let targetSlug = item.slug || BandaGoNormalizer.slugify(item.name, item.externalPosId);
      const existingBySlug = await tx.product.findUnique({
        where: { slug: targetSlug },
        select: { id: true, externalPosId: true },
      });
      if (existingBySlug && existingBySlug.externalPosId !== item.externalPosId) {
        const uniqueSuffix = item.externalPosId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
        targetSlug = `${targetSlug}-${uniqueSuffix || Date.now().toString(36)}`;
        const stillExists = await tx.product.findUnique({
          where: { slug: targetSlug },
          select: { id: true, externalPosId: true },
        });
        if (stillExists && stillExists.externalPosId !== item.externalPosId) {
          targetSlug = `${targetSlug}-${Math.random().toString(36).slice(2, 6)}`;
        }
      }

      // Upsert Master Product Record
      const product = await tx.product.upsert({
        where: { externalPosId: item.externalPosId },
        update: {
          name: item.name,
          sku: targetSku,
          price: priceDec,
          costPrice: costPriceDec,
          stock: rawStock,
          stockQty: sellableStock,
          stockStatus,
          inStock: effectiveInStock,
          requiresPrescription,
          nearestExpiryDate: nearestExpiry,
          dosageForm: item.dosageForm || undefined,
          strength: item.strength || undefined,
          lastSyncedAt: now,
        },
        create: {
          externalPosId: item.externalPosId,
          posSource: 'BANDAGO',
          sku: targetSku,
          name: item.name,
          slug: targetSlug,
          price: priceDec,
          costPrice: costPriceDec,
          stock: rawStock,
          stockQty: sellableStock,
          stockStatus,
          virtualReservedStock: 0,
          safetyStockBuffer: 2,
          inStock: effectiveInStock,
          requiresPrescription,
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

      // Synchronize Child Batches if present
      if (batchResult && batchResult.batches.length > 0) {
        for (const b of batchResult.batches) {
          const batchNumber = (b.batchNumber || '').trim();
          if (!batchNumber) continue;

          await tx.productBatch.upsert({
            where: {
              productId_batchNumber: {
                productId: product.id,
                batchNumber,
              },
            },
            update: {
              quantityOnHand: b.quantityOnHand,
              expiryDate: b.parsedExpiry,
              isExpired: b.isExpired,
              externalBatchId: b.externalBatchId || null,
            },
            create: {
              productId: product.id,
              batchNumber,
              quantityOnHand: b.quantityOnHand,
              expiryDate: b.parsedExpiry,
              isExpired: b.isExpired,
              externalBatchId: b.externalBatchId || null,
            },
          });
        }
      }
    };

    // 4. Batch Ingestion in Chunks to Prevent Connection Pool Starvation
    const CHUNK_SIZE = 50;
    let upsertedCount = 0;
    const now = new Date();

    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);

      try {
        await prisma.$transaction(
          async (tx) => {
            for (const item of chunk) {
              await processSingleItem(item, tx);
              upsertedCount++;
            }
          },
          { timeout: 25000 }
        );
      } catch (chunkErr: any) {
        // Reset category cache so uncommitted categories rolled back from failed chunk are not referenced
        categoryMap.clear();
        for (const cat of existingCategories) {
          categoryMap.set(cat.slug.toLowerCase(), cat.id);
        }

        // Fallback: isolate chunk items individually so 1 bad item doesn't ruin the whole chunk
        for (const item of chunk) {
          try {
            await prisma.$transaction(async (tx) => {
              await processSingleItem(item, tx);
            });
            upsertedCount++;
          } catch (singleErr: any) {
            errors.push({
              externalPosId: item.externalPosId,
              name: item.name,
              error: singleErr.message,
            });
          }
        }
      }
    }

    // 5. Finalize Sync Log
    const duration = Date.now() - startTime;
    await prisma.posSyncLog.update({
      where: { id: syncLogId },
      data: {
        status: errors.length === 0 ? 'SUCCESS' : errors.length >= rawItems.length ? 'FAILED' : 'PARTIAL',
        itemsUpserted: upsertedCount,
        itemsFailed: errors.length,
        durationMs: duration,
        completedAt: new Date(),
        details: errors.length > 0 ? { errors: errors.slice(0, 50) } : undefined,
      },
    });

    return NextResponse.json({
      success: errors.length < rawItems.length,
      upsertedCount,
      failedCount: errors.length,
      durationMs: duration,
      timestamp: now.toISOString(),
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    });
  } catch (globalErr: any) {
    console.error('[BandaGo Sync Pipeline Critical Failure]:', globalErr);

    if (syncLogId) {
      await prisma.posSyncLog.update({
        where: { id: syncLogId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          details: { fatalError: globalErr.message },
        },
      });
    }

    return NextResponse.json(
      { error: 'POS Sync pipeline encountered an unrecoverable failure', details: globalErr.message },
      { status: 500 }
    );
  }
}
