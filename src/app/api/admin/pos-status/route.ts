// src/app/api/admin/pos-status/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireStaff } from '@/lib/session';

export async function GET() {
  const { error } = await requireStaff(['ADMIN', 'PHARMACIST', 'STAFF']);
  if (error) return error;

  const now = new Date();
  const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const [totalSyncedProducts, totalBatches, nearExpiryCount, latestLog, recentLogs] = await Promise.all([
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
    // Recent 20 sync logs for audit trail
    prisma.posSyncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        trigger: true,
        status: true,
        itemsReceived: true,
        itemsUpserted: true,
        durationMs: true,
        startedAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    totalSyncedProducts,
    totalBatches,
    nearExpiryCount,
    lastSyncTimestamp: latestLog ? latestLog.startedAt.toISOString() : null,
    recentLogs: recentLogs.map((log) => ({
      id: log.id,
      trigger: log.trigger,
      status: log.status,
      itemsReceived: log.itemsReceived,
      itemsUpserted: log.itemsUpserted,
      durationMs: log.durationMs ?? 0,
      startedAt: log.startedAt.toISOString(),
    })),
  });
}
