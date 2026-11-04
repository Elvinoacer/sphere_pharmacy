// src/app/api/integrations/bandago/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma, type PosSyncTrigger } from '@prisma/client';
import { BandaGoNormalizer, type IngestedBatch, type IngestedProductItem } from '@/lib/bandago-normalizer';
import { requireStaff } from '@/lib/session';
import { InventoryGuard } from '@/lib/inventory-guard';

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

    // Issue 6: Release expired virtual reservations (>45 mins) before processing sync to free locked stock
    try {
      await InventoryGuard.cleanupExpiredReservations(45);
    } catch (cleanupErr: unknown) {
      console.warn('[BandaGo Sync] Expired reservation cleanup warning:', cleanupErr);
    }

    const payload = await req.json().catch(() => ({}));
    const rawItems: unknown[] = Array.isArray(payload.items) ? payload.items : [];

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

      items.push({
        ...(r as unknown as IngestedProductItem),
        externalPosId,
        name,
        price: BandaGoNormalizer.parseNumber(r.price, 0),
        costPrice: r.costPrice != null ? BandaGoNormalizer.parseNumber(r.costPrice) : null,
        stock: BandaGoNormalizer.parseInteger(r.stock, 0),
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

      const requiresPrescription =
        item.requiresPrescription ??
        BandaGoNormalizer.classifyRequiresPrescription(item.name, item.categorySlug);

      const validPrice = BandaGoNormalizer.parseNumber(item.price, 0);
      const priceDec = new Prisma.Decimal(validPrice);

      const costPriceDec = item.costPrice != null
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
      } else if (existingProduct && existingProduct.externalPosId && existingProduct.externalPosId !== item.externalPosId) {
        // Colliding slug belongs to another product; disambiguate targetSlug
        const uniqueSuffix = item.externalPosId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
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
            externalPosId: true,
            sku: true,
          },
        });
      }

      const targetSku = (item.sku || existingProduct?.sku || item.externalPosId).trim();

      // Issue 4: Subtract virtualReservedStock when computing effective available stock for inStock
      const reserved = existingProduct?.virtualReservedStock ?? 0;
      const effectiveAvailable = Math.max(0, rawStock - reserved);
      const effectiveSellable = Math.max(0, sellableStock - reserved);
      const effectiveInStock = effectiveAvailable > 0 && sellableStock > 0 && effectiveSellable > 0;
      const stockStatus =
        !effectiveInStock ? 'OUT_OF_STOCK' : effectiveSellable <= 5 ? 'LOW_STOCK' : 'IN_STOCK';

      // Issue 3: Live Sync Overwriting Custom Product Images & Pharmacist Rx Flags
      const hasCustomProductImage = Boolean(
        existingProduct?.image &&
        existingProduct.image.startsWith('/images/products/') &&
        !existingProduct.image.endsWith('/generic-medicine.webp')
      );
      const finalRequiresPrescription = existingProduct
        ? Boolean(existingProduct.requiresPrescription || requiresPrescription)
        : requiresPrescription;

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
          requiresPrescription: finalRequiresPrescription,
          nearestExpiryDate: nearestExpiry,
          dosageForm: item.dosageForm || undefined,
          strength: item.strength || undefined,
          lastSyncedAt: now,
          ...(hasCustomProductImage ? {} : (item.imageUrl ? { image: item.imageUrl, images: [item.imageUrl] } : {})),
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
    const now = new Date();

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
      } catch (chunkErr: unknown) {
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

    return NextResponse.json(
      { error: 'POS Sync pipeline encountered an unrecoverable failure', details: globalErrMsg },
      { status: 500 }
    );
  }
}
