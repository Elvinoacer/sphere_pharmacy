import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma, type PosOutboundEventType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { authorizeBandagoRequest } from '@/lib/security/bandago-auth';
import { getPosSyncPolicy, recordPosIncident } from '@/lib/pos-reconciliation';

const STALE_LOCK_MS = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const auth = await authorizeBandagoRequest(req, ['ADMIN', 'PHARMACIST']);
  if (!auth.authorized) return auth.error;

  try {
    const url = new URL(req.url);
    const shouldClaim = url.searchParams.get('claim') === '1';
    const limitRaw = Number(url.searchParams.get('limit') || '20');
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 20));

    const policy = await getPosSyncPolicy();

    // Release stale PROCESSING locks from crashed/killed service workers
    const staleCutoff = new Date(Date.now() - STALE_LOCK_MS);
    await prisma.posOutboundJob.updateMany({
      where: {
        status: 'PROCESSING',
        lockedAt: { lt: staleCutoff },
      },
      data: {
        status: 'PENDING',
        lockedAt: null,
        lockToken: null,
      },
    });

    // Surface unmapped pending jobs cleanly as actionable warnings without blocking mapped jobs
    const unmappedPending = await prisma.posOutboundJob.findMany({
      where: {
        status: 'PENDING',
        externalPosId: null,
      },
      include: {
        product: {
          select: { id: true, externalPosId: true, name: true },
        },
      },
      take: 20,
    });

    for (const job of unmappedPending) {
      if (job.product.externalPosId) {
        await prisma.posOutboundJob.update({
          where: { id: job.id },
          data: { externalPosId: job.product.externalPosId },
        });
      } else {
        await recordPosIncident({
          direction: 'OUTBOUND',
          source: 'OUTBOUND_DISPATCHER',
          severity: 'WARNING',
          code: 'UNMAPPED_PRODUCT',
          message: `${job.productName} has no BandaGo M_Product_UU (externalPosId) and cannot auto-sync until mapped.`,
          productName: job.productName,
          orderReference: job.orderReference,
        });
      }
    }

    if (!shouldClaim) {
      const pendingJobs = await prisma.posOutboundJob.findMany({
        where: { status: { in: ['PENDING', 'FAILED', 'EXPORTED'] } },
        include: {
          product: {
            select: {
              externalPosId: true,
              externalWarehouseId: true,
              externalLocatorId: true,
              externalOrgId: true,
              stockQty: true,
              lastPosStock: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });

      return NextResponse.json({
        policy,
        jobs: pendingJobs.map(serializeOutboundJob),
      });
    }

    if (policy.outboundSyncMode !== 'AUTO_SYNC') {
      return NextResponse.json({
        policy,
        jobs: [],
        reason: 'AUTO_SYNC_DISABLED',
      });
    }

    const allowedEventTypes: PosOutboundEventType[] = [];
    if (policy.autoSyncOnlineSales) {
      allowedEventTypes.push('ONLINE_SALE', 'REFUND_RESTOCK');
    }
    if (policy.autoSyncStockEdits) {
      allowedEventTypes.push('ADMIN_STOCK_ADJUST');
    }

    if (allowedEventTypes.length === 0) {
      return NextResponse.json({
        policy,
        jobs: [],
        reason: 'NO_EVENT_TYPES_ENABLED',
      });
    }

    const lockToken = randomUUID();
    const now = new Date();

    const claimedJobs = await prisma.$transaction(
      async (tx) => {
        const candidates = await tx.posOutboundJob.findMany({
          where: {
            status: 'PENDING',
            externalPosId: { not: null },
            eventType: { in: allowedEventTypes },
          },
          orderBy: { createdAt: 'asc' },
          take: limit,
        });

        const eligibleIds = candidates
          .filter((c) => c.attempts < c.maxAttempts)
          .map((c) => c.id);

        if (eligibleIds.length === 0) {
          return [];
        }

        await tx.posOutboundJob.updateMany({
          where: {
            id: { in: eligibleIds },
            status: 'PENDING',
          },
          data: {
            status: 'PROCESSING',
            lockedAt: now,
            lockToken,
            attempts: { increment: 1 },
          },
        });

        return tx.posOutboundJob.findMany({
          where: {
            id: { in: eligibleIds },
            lockToken,
          },
          include: {
            product: {
              select: {
                externalPosId: true,
                externalWarehouseId: true,
                externalLocatorId: true,
                externalOrgId: true,
                stockQty: true,
                lastPosStock: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 15_000 }
    );

    return NextResponse.json({
      policy,
      jobs: claimedJobs.map(serializeOutboundJob),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load outbound POS jobs';
    return NextResponse.json(
      { error: 'Could not query outbound POS jobs', details: message },
      { status: 500 }
    );
  }
}

function serializeOutboundJob(job: {
  id: string;
  idempotencyKey: string;
  eventType: PosOutboundEventType;
  status: string;
  orderId: string | null;
  orderReference: string | null;
  productId: string;
  externalPosId: string | null;
  productName: string;
  sku: string | null;
  qtyDelta: number;
  targetStock: number | null;
  unitPrice: Prisma.Decimal | null;
  lineTotal: Prisma.Decimal | null;
  paymentMethod: string | null;
  posStockSnapshot: number | null;
  attempts: number;
  maxAttempts: number;
  lockToken: string | null;
  externalInventoryUU: string | null;
  createdAt: Date;
  product: {
    externalPosId: string | null;
    externalWarehouseId: string | null;
    externalLocatorId: string | null;
    externalOrgId: string | null;
    stockQty: number;
    lastPosStock: number | null;
  };
}) {
  return {
    id: job.id,
    idempotencyKey: job.idempotencyKey,
    eventType: job.eventType,
    status: job.status,
    orderId: job.orderId,
    orderReference: job.orderReference,
    productId: job.productId,
    externalPosId: job.externalPosId || job.product.externalPosId,
    productName: job.productName,
    sku: job.sku,
    qtyDelta: job.qtyDelta,
    targetStock: job.targetStock,
    unitPrice: job.unitPrice != null ? Number(job.unitPrice) : null,
    lineTotal: job.lineTotal != null ? Number(job.lineTotal) : null,
    paymentMethod: job.paymentMethod,
    posStockSnapshot: job.posStockSnapshot,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    lockToken: job.lockToken,
    externalInventoryUU: job.externalInventoryUU,
    externalWarehouseId: job.product.externalWarehouseId,
    externalLocatorId: job.product.externalLocatorId,
    externalOrgId: job.product.externalOrgId,
    sphereStockQty: job.product.stockQty,
    lastPosStock: job.product.lastPosStock,
    createdAt: job.createdAt.toISOString(),
  };
}
