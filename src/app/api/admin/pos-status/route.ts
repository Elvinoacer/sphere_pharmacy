// src/app/api/admin/pos-status/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireStaff } from '@/lib/session';
import { getPosBridgeHeartbeat, getPosSyncPolicy } from '@/lib/pos-reconciliation';
import { isUsingInsecureDefaultBandagoKey } from '@/lib/security/bandago-bearer';

/** Returns the UTC Date representing 00:00:00 EAT (UTC+3 Nairobi) for the current day. */
function getEatDayStart(now: Date): Date {
  const eatOffsetMs = 3 * 60 * 60 * 1000;
  const eat = new Date(now.getTime() + eatOffsetMs);
  return new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate()) - eatOffsetMs);
}

export async function GET() {
  const { error } = await requireStaff(['ADMIN', 'PHARMACIST', 'STAFF']);
  if (error) return error;

  try {
    const now = new Date();
    const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const eatDayStart = getEatDayStart(now);

    const [
      totalSyncedProducts,
      totalBatches,
      nearExpiryCount,
      latestLog,
      recentLogs,
      policy,
      bridgeHeartbeat,
      pendingOutboundCount,
      exportedAwaitingConfirmCount,
      failedOutboundCount,
      syncedOutboundTodayCount,
      openSaleJobs,
      openIncidentsCount,
      criticalIncidentsCount,
    ] = await Promise.all([
      // Products mapped via BandaGo POS
      prisma.product.count({
        where: {
          externalPosId: { not: null },
        },
      }),
      // Total active lots/batches
      prisma.productBatch.count(),
      // Near-expiry flag (<90 days, not already expired) covering both lot batches and master products
      Promise.all([
        prisma.productBatch.count({
          where: {
            isExpired: false,
            quantityOnHand: { gt: 0 },
            expiryDate: {
              gt: now,
              lte: ninetyDaysFromNow,
            },
          },
        }),
        prisma.product.count({
          where: {
            OR: [
              { stock: { gt: 0 } },
              { stockQty: { gt: 0 } },
            ],
            nearestExpiryDate: {
              gt: now,
              lte: ninetyDaysFromNow,
            },
          },
        }),
      ]).then(([batchCount, prodCount]) => Math.max(batchCount, prodCount)),
      // Last synchronization attempt
      prisma.posSyncLog.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      }),
      // Recent 25 sync logs for audit trail
      prisma.posSyncLog.findMany({
        orderBy: { startedAt: 'desc' },
        take: 25,
        select: {
          id: true,
          direction: true,
          trigger: true,
          status: true,
          itemsReceived: true,
          itemsUpserted: true,
          itemsFailed: true,
          details: true,
          durationMs: true,
          startedAt: true,
        },
      }),
      getPosSyncPolicy(),
      getPosBridgeHeartbeat(),
      prisma.posOutboundJob.count({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
      }),
      prisma.posOutboundJob.count({
        where: { status: 'EXPORTED' },
      }),
      prisma.posOutboundJob.count({
        where: { status: 'FAILED' },
      }),
      prisma.posOutboundJob.count({
        where: {
          status: { in: ['SYNCED', 'RECONCILED_MANUAL'] },
          syncedAt: { gte: eatDayStart },
        },
      }),
      prisma.posOutboundJob.findMany({
        where: {
          eventType: 'ONLINE_SALE',
          status: { in: ['PENDING', 'PROCESSING', 'EXPORTED', 'FAILED'] },
        },
        select: { qtyDelta: true },
      }),
      prisma.posSyncIncident.count({
        where: { resolved: false },
      }),
      prisma.posSyncIncident.count({
        where: { resolved: false, severity: 'CRITICAL' },
      }),
    ]);

    const unreconciledUnitsTotal = openSaleJobs.reduce(
      (sum, job) => sum + Math.abs(job.qtyDelta),
      0
    );

    return NextResponse.json({
      totalSyncedProducts,
      totalBatches,
      nearExpiryCount,
      lastSyncTimestamp: latestLog ? latestLog.startedAt.toISOString() : null,
      recentLogs: recentLogs.map((log) => ({
        id: log.id,
        direction: log.direction,
        trigger: log.trigger,
        status: log.status,
        itemsReceived: log.itemsReceived,
        itemsUpserted: log.itemsUpserted,
        itemsFailed: log.itemsFailed ?? 0,
        details: log.details ?? null,
        durationMs: log.durationMs ?? 0,
        startedAt: log.startedAt.toISOString(),
      })),
      policy,
      bridgeHeartbeat,
      pendingOutboundCount,
      exportedAwaitingConfirmCount,
      failedOutboundCount,
      syncedOutboundTodayCount,
      unreconciledUnitsTotal,
      openIncidentsCount,
      criticalIncidentsCount,
      apiKeyConfigured: Boolean(process.env.BANDAGO_SYNC_API_KEY?.trim()),
      usingDefaultKeyWarning: isUsingInsecureDefaultBandagoKey(),
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2021' || code === 'P2022') {
      return NextResponse.json(
        {
          error:
            'POS sync database tables/columns are missing in this environment. Run `npx prisma migrate deploy` against the production database.',
          code: 'MIGRATION_REQUIRED',
        },
        { status: 503 }
      );
    }
    console.error('[GET /api/admin/pos-status] failed:', err);
    return NextResponse.json(
      { error: 'Unable to load POS sync status right now.' },
      { status: 500 }
    );
  }
}
