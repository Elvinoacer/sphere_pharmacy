import { NextRequest, NextResponse } from 'next/server';
import type { Prisma, PosOutboundStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/notify';
import {
  deterministicUuidFromKey,
  getPosSyncPolicy,
  getUnreconciledOffsetsByProduct,
  savePosSyncPolicy,
} from '@/lib/pos-reconciliation';
import { rejectOversizedRequest } from '@/lib/security/request';
import { requireStaff } from '@/lib/session';

const reconcileActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('MARK_RECONCILED'),
    jobIds: z.array(z.string().min(1)).max(500).optional(),
    exportBatchId: z.string().min(1).max(120).optional(),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('RETRY_JOBS'),
    jobIds: z.array(z.string().min(1)).min(1).max(200),
  }),
  z.object({
    action: z.literal('CANCEL_JOBS'),
    jobIds: z.array(z.string().min(1)).min(1).max(200),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('RESOLVE_INCIDENT'),
    incidentId: z.string().min(1).max(120),
  }),
  z.object({
    action: z.literal('RESOLVE_ALL_INCIDENTS'),
    direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
  }),
  z.object({
    action: z.literal('QUEUE_STOCK_PUSH'),
    productId: z.string().min(1).max(120),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('SET_BASELINE_NOW'),
    markOpenAsReconciled: z.boolean().optional(),
    note: z.string().max(500).optional(),
  }),
]);

export async function GET() {
  const { error } = await requireStaff(['ADMIN', 'PHARMACIST', 'STAFF']);
  if (error) return error;

  try {
    const policy = await getPosSyncPolicy();

    const [jobs, incidents, mappedProducts] = await Promise.all([
      prisma.posOutboundJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 150,
        select: {
          id: true,
          idempotencyKey: true,
          eventType: true,
          status: true,
          orderId: true,
          orderReference: true,
          productId: true,
          externalPosId: true,
          productName: true,
          sku: true,
          qtyDelta: true,
          targetStock: true,
          unitPrice: true,
          lineTotal: true,
          paymentMethod: true,
          posStockSnapshot: true,
          attempts: true,
          maxAttempts: true,
          externalDocumentNo: true,
          externalInventoryUU: true,
          reconciledBy: true,
          reconciledNote: true,
          exportBatchId: true,
          lastErrorCode: true,
          lastError: true,
          createdAt: true,
          updatedAt: true,
          syncedAt: true,
          product: {
            select: {
              stock: true,
              stockQty: true,
              lastPosStock: true,
              externalPosId: true,
            },
          },
        },
      }),
      prisma.posSyncIncident.findMany({
        orderBy: [{ resolved: 'asc' }, { lastSeenAt: 'desc' }],
        take: 100,
      }),
      prisma.product.findMany({
        where: { externalPosId: { not: null } },
        select: {
          id: true,
          name: true,
          sku: true,
          externalPosId: true,
          stock: true,
          stockQty: true,
          lastPosStock: true,
          lastPosSellableStock: true,
          virtualReservedStock: true,
          lastSyncedAt: true,
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    const offsets = await getUnreconciledOffsetsByProduct(
      mappedProducts.map((p) => p.id),
      policy.reconciliationBaselineAt
    );

    const varianceItems = mappedProducts
      .map((p) => {
        const off = offsets.get(p.id) ?? {
          pendingNetDelta: 0,
          pendingSalesQty: 0,
          unpaidOrderHoldQty: 0,
        };
        const hasStockGap = p.lastPosStock != null && p.lastPosStock !== p.stockQty;
        const hasOffsets =
          off.pendingNetDelta !== 0 || off.unpaidOrderHoldQty > 0 || p.virtualReservedStock > 0;
        if (!hasStockGap && !hasOffsets) return null;

        const status =
          off.pendingNetDelta !== 0 || off.unpaidOrderHoldQty > 0
            ? 'DRIFT_PROTECTED'
            : hasStockGap
              ? 'VARIANCE'
              : 'MATCHED';

        return {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          externalPosId: p.externalPosId,
          lastPosStock: p.lastPosStock,
          lastPosSellableStock: p.lastPosSellableStock,
          sphereStock: p.stock,
          sphereStockQty: p.stockQty,
          pendingOutboundNetDelta: off.pendingNetDelta,
          pendingOutboundSalesQty: off.pendingSalesQty,
          unpaidOrderHoldQty: off.unpaidOrderHoldQty,
          virtualReservedStock: p.virtualReservedStock,
          lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null,
          status,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    let pendingCount = 0;
    let exportedCount = 0;
    let failedCount = 0;
    let syncedCount = 0;
    let reconciledManualCount = 0;

    for (const job of jobs) {
      if (job.status === 'PENDING' || job.status === 'PROCESSING') pendingCount++;
      else if (job.status === 'EXPORTED') exportedCount++;
      else if (job.status === 'FAILED') failedCount++;
      else if (job.status === 'SYNCED') syncedCount++;
      else if (job.status === 'RECONCILED_MANUAL') reconciledManualCount++;
    }

    const openIncidentsCount = incidents.filter((inc) => !inc.resolved).length;
    const criticalIncidentsCount = incidents.filter(
      (inc) => !inc.resolved && inc.severity === 'CRITICAL'
    ).length;

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        ...job,
        unitPrice: job.unitPrice != null ? Number(job.unitPrice) : null,
        lineTotal: job.lineTotal != null ? Number(job.lineTotal) : null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        syncedAt: job.syncedAt?.toISOString() ?? null,
      })),
      varianceItems,
      incidents: incidents.map((inc) => ({
        ...inc,
        firstSeenAt: inc.firstSeenAt.toISOString(),
        lastSeenAt: inc.lastSeenAt.toISOString(),
        resolvedAt: inc.resolvedAt?.toISOString() ?? null,
      })),
      summary: {
        pendingCount,
        exportedCount,
        failedCount,
        syncedCount,
        reconciledManualCount,
        openIncidentsCount,
        criticalIncidentsCount,
        varianceCount: varianceItems.length,
      },
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2021' || code === 'P2022') {
      return NextResponse.json(
        {
          error:
            'POS reconciliation database tables/columns are missing in this environment. Run `npx prisma migrate deploy` against the production database.',
          code: 'MIGRATION_REQUIRED',
        },
        { status: 503 }
      );
    }
    console.error('[GET /api/admin/pos-sync/reconcile] failed:', err);
    return NextResponse.json(
      { error: 'Unable to load POS reconciliation data right now.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireStaff(['ADMIN', 'PHARMACIST']);
  if (error || !session) return error;

  const oversized = rejectOversizedRequest(request, 65_536);
  if (oversized) return oversized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const parsed = reconcileActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid reconciliation command' },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const actor = session.staffName ?? 'Staff';
  const now = new Date();

  switch (payload.action) {
    case 'MARK_RECONCILED': {
      const openStatuses: PosOutboundStatus[] = ['PENDING', 'PROCESSING', 'EXPORTED', 'FAILED'];
      const whereClause: Prisma.PosOutboundJobWhereInput = payload.jobIds?.length
        ? { id: { in: payload.jobIds }, status: { in: openStatuses } }
        : payload.exportBatchId
          ? { exportBatchId: payload.exportBatchId, status: { in: openStatuses } }
          : { status: { in: ['EXPORTED'] } };

      const updated = await prisma.posOutboundJob.updateMany({
        where: whereClause,
        data: {
          status: 'RECONCILED_MANUAL',
          reconciledBy: actor,
          reconciledNote: payload.note?.trim() || 'Confirmed entered in BandaGo POS by staff',
          syncedAt: now,
          lockedAt: null,
          lockToken: null,
        },
      });

      if (updated.count > 0) {
        await prisma.posSyncLog.create({
          data: {
            direction: 'OUTBOUND',
            trigger: 'MANUAL_EXPORT_RECONCILE',
            status: 'SUCCESS',
            itemsReceived: updated.count,
            itemsUpserted: updated.count,
            itemsFailed: 0,
            details: {
              actor,
              exportBatchId: payload.exportBatchId ?? null,
              note: payload.note?.trim() || null,
            },
            completedAt: now,
            durationMs: 0,
          },
        });
      }

      await audit(
        actor,
        session.staffRole,
        'POS_JOBS_MARKED_RECONCILED',
        'PosOutboundJob',
        payload.exportBatchId ?? null,
        `Marked ${updated.count} job(s) RECONCILED_MANUAL`
      );

      return NextResponse.json({ ok: true, affectedCount: updated.count });
    }

    case 'RETRY_JOBS': {
      const jobs = await prisma.posOutboundJob.findMany({
        where: { id: { in: payload.jobIds } },
        select: {
          id: true,
          externalPosId: true,
          product: { select: { externalPosId: true } },
        },
      });

      let affectedCount = 0;
      for (const job of jobs) {
        const mappedPosId = job.externalPosId || job.product.externalPosId || null;
        await prisma.posOutboundJob.update({
          where: { id: job.id },
          data: {
            status: 'PENDING',
            attempts: 0,
            lockedAt: null,
            lockToken: null,
            lastError: null,
            lastErrorCode: null,
            ...(mappedPosId ? { externalPosId: mappedPosId } : {}),
          },
        });
        affectedCount++;
      }

      await audit(
        actor,
        session.staffRole,
        'POS_JOBS_RETRIED',
        'PosOutboundJob',
        null,
        `Re-queued ${affectedCount} outbound job(s) for retry`
      );

      return NextResponse.json({ ok: true, affectedCount });
    }

    case 'CANCEL_JOBS': {
      const updated = await prisma.posOutboundJob.updateMany({
        where: {
          id: { in: payload.jobIds },
          status: { in: ['PENDING', 'PROCESSING', 'EXPORTED', 'FAILED', 'SKIPPED_UNMAPPED'] },
        },
        data: {
          status: 'CANCELLED',
          lockedAt: null,
          lockToken: null,
          reconciledBy: actor,
          reconciledNote: payload.note?.trim() || `Cancelled manually by ${actor}`,
        },
      });

      await audit(
        actor,
        session.staffRole,
        'POS_JOBS_CANCELLED',
        'PosOutboundJob',
        null,
        `Cancelled ${updated.count} outbound job(s)`
      );

      return NextResponse.json({ ok: true, affectedCount: updated.count });
    }

    case 'RESOLVE_INCIDENT': {
      const updated = await prisma.posSyncIncident.updateMany({
        where: { id: payload.incidentId, resolved: false },
        data: { resolved: true, resolvedBy: actor, resolvedAt: now },
      });

      await audit(
        actor,
        session.staffRole,
        'POS_INCIDENT_RESOLVED',
        'PosSyncIncident',
        payload.incidentId,
        `Resolved POS incident ${payload.incidentId}`
      );

      return NextResponse.json({ ok: true, affectedCount: updated.count });
    }

    case 'RESOLVE_ALL_INCIDENTS': {
      const updated = await prisma.posSyncIncident.updateMany({
        where: {
          resolved: false,
          ...(payload.direction ? { direction: payload.direction } : {}),
        },
        data: { resolved: true, resolvedBy: actor, resolvedAt: now },
      });

      await audit(
        actor,
        session.staffRole,
        'POS_INCIDENTS_BULK_RESOLVED',
        'PosSyncIncident',
        null,
        `Resolved ${updated.count} open incident(s)`
      );

      return NextResponse.json({ ok: true, affectedCount: updated.count });
    }

    case 'QUEUE_STOCK_PUSH': {
      const product = await prisma.product.findUnique({
        where: { id: payload.productId },
        select: {
          id: true,
          name: true,
          sku: true,
          price: true,
          stockQty: true,
          lastPosStock: true,
          externalPosId: true,
        },
      });

      if (!product) {
        return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
      }
      if (!product.externalPosId) {
        return NextResponse.json(
          { error: 'Product has no BandaGo externalPosId mapping yet.' },
          { status: 400 }
        );
      }

      const idempotencyKey = `manual-push:${product.id}:${now.getTime()}`;
      const qtyDelta = product.stockQty - (product.lastPosStock ?? product.stockQty);

      const job = await prisma.posOutboundJob.create({
        data: {
          idempotencyKey,
          eventType: 'ADMIN_STOCK_ADJUST',
          status: 'PENDING',
          productId: product.id,
          externalPosId: product.externalPosId,
          productName: product.name,
          sku: product.sku,
          qtyDelta,
          targetStock: product.stockQty,
          unitPrice: product.price,
          posStockSnapshot: product.lastPosStock ?? product.stockQty,
          externalInventoryUU: deterministicUuidFromKey(idempotencyKey),
          reconciledNote: payload.note?.trim() || `Manual push to BandaGo queued by ${actor}`,
        },
      });

      await audit(
        actor,
        session.staffRole,
        'POS_MANUAL_STOCK_PUSH_QUEUED',
        'Product',
        product.id,
        `Queued stock push to ${product.stockQty} units (job ${job.id})`
      );

      return NextResponse.json({ ok: true, jobId: job.id });
    }

    case 'SET_BASELINE_NOW': {
      if (session.staffRole !== 'ADMIN') {
        return NextResponse.json(
          { error: 'Only ADMIN staff can reset the reconciliation baseline.' },
          { status: 403 }
        );
      }

      const baselineIso = now.toISOString();
      const policy = await savePosSyncPolicy({ reconciliationBaselineAt: baselineIso });

      let markedCount = 0;
      if (payload.markOpenAsReconciled) {
        const res = await prisma.posOutboundJob.updateMany({
          where: {
            status: { in: ['PENDING', 'PROCESSING', 'EXPORTED', 'FAILED'] },
            createdAt: { lte: now },
          },
          data: {
            status: 'RECONCILED_MANUAL',
            reconciledBy: actor,
            reconciledNote: payload.note?.trim() || `Cleared on baseline cutover (${baselineIso})`,
            syncedAt: now,
            lockedAt: null,
            lockToken: null,
          },
        });
        markedCount = res.count;
      }

      await audit(
        actor,
        session.staffRole,
        'POS_RECONCILIATION_BASELINE_SET',
        'Setting',
        'posSync',
        `Baseline set to ${baselineIso}; cleared ${markedCount} prior open job(s)`
      );

      return NextResponse.json({ ok: true, policy, markedCount });
    }
  }
}
