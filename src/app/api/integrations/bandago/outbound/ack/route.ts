import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { authorizeBandagoRequest } from '@/lib/security/bandago-auth';
import { getDefaultRemediation, recordPosIncident } from '@/lib/pos-reconciliation';

const NON_RETRYABLE_CODES = new Set([
  'POS_PERMISSION_DENIED',
  'TENANT_MISMATCH',
  'UNMAPPED_PRODUCT',
]);

const CRITICAL_CODES = new Set(['AUTH_EXPIRED', 'TENANT_MISMATCH', 'POS_PERMISSION_DENIED']);

interface OutboundAckItem {
  jobId: string;
  lockToken?: string | null;
  status: 'SYNCED' | 'FAILED' | 'RELEASE';
  externalDocumentNo?: string | null;
  externalInventoryUU?: string | null;
  posStockAfter?: number | null;
  warningCode?: string | null;
  warningMessage?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  remediation?: string | null;
}

export async function POST(req: NextRequest) {
  const auth = await authorizeBandagoRequest(req, ['ADMIN', 'PHARMACIST']);
  if (!auth.authorized) return auth.error;

  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const rawResults = Array.isArray(body.results) ? (body.results as OutboundAckItem[]) : [];
    const reportedDuration =
      typeof body.durationMs === 'number' && Number.isFinite(body.durationMs)
        ? Math.max(0, Math.floor(body.durationMs))
        : null;

    if (rawResults.length === 0) {
      return NextResponse.json({
        ok: true,
        syncedCount: 0,
        releasedCount: 0,
        failedCount: 0,
      });
    }

    let syncedCount = 0;
    let releasedCount = 0;
    let failedCount = 0;
    const errorSummaries: Array<{ jobId: string; code: string; error: string }> = [];
    const now = new Date();

    for (const item of rawResults) {
      if (!item || typeof item.jobId !== 'string') continue;

      const job = await prisma.posOutboundJob.findUnique({ where: { id: item.jobId } });
      if (!job) continue;

      if (item.lockToken && job.lockToken && item.lockToken !== job.lockToken) {
        continue;
      }

      if (item.status === 'SYNCED') {
        await prisma.posOutboundJob.update({
          where: { id: job.id },
          data: {
            status: 'SYNCED',
            syncedAt: now,
            lockedAt: null,
            lockToken: null,
            reconciledBy: 'BANDAGO_BRIDGE',
            externalDocumentNo: item.externalDocumentNo?.trim() || job.externalDocumentNo,
            externalInventoryUU: item.externalInventoryUU?.trim() || job.externalInventoryUU,
            lastErrorCode: null,
            lastError: null,
          },
        });

        if (typeof item.posStockAfter === 'number' && Number.isFinite(item.posStockAfter)) {
          const clampedPos = Math.max(0, Math.floor(item.posStockAfter));
          await prisma.product.update({
            where: { id: job.productId },
            data: { lastPosStock: clampedPos },
          });
        }

        // Resolve prior transient outbound failure incidents for this product/order
        await prisma.posSyncIncident.updateMany({
          where: {
            direction: 'OUTBOUND',
            resolved: false,
            code: { in: ['NO_POS_TAB', 'OUTBOUND_WRITEBACK_FAILED', 'NETWORK_TIMEOUT', 'AUTH_EXPIRED'] },
            OR: [
              ...(job.externalPosId ? [{ externalPosId: job.externalPosId }] : []),
              ...(job.orderReference ? [{ orderReference: job.orderReference }] : []),
            ],
          },
          data: {
            resolved: true,
            resolvedBy: 'AUTO_SYNC_RECOVERY',
            resolvedAt: now,
          },
        });

        if (item.warningCode) {
          await recordPosIncident({
            direction: 'OUTBOUND',
            source: 'BANDAGO_WRITEBACK',
            severity: 'WARNING',
            code: item.warningCode,
            message:
              item.warningMessage ||
              `${job.productName}: BandaGo stock adjusted with warning (${item.warningCode}).`,
            remediation: item.remediation || getDefaultRemediation(item.warningCode),
            externalPosId: job.externalPosId,
            productName: job.productName,
            orderReference: job.orderReference,
          });
        }

        syncedCount++;
      } else if (item.status === 'RELEASE') {
        await prisma.posOutboundJob.update({
          where: { id: job.id },
          data: {
            status: 'PENDING',
            attempts: Math.max(0, job.attempts - 1),
            lockedAt: null,
            lockToken: null,
            lastErrorCode: item.warningCode || 'NO_POS_TAB',
            lastError: item.warningMessage || 'Released because no BandaGo tab was open.',
          },
        });

        await recordPosIncident({
          direction: 'OUTBOUND',
          source: 'BANDAGO_WRITEBACK',
          severity: 'WARNING',
          code: item.warningCode || 'NO_POS_TAB',
          message:
            item.warningMessage ||
            `Deferred outbound sync for ${job.productName} — no active go.bandahealth.org tab was open.`,
          remediation: item.remediation || getDefaultRemediation(item.warningCode || 'NO_POS_TAB'),
          externalPosId: job.externalPosId,
          productName: job.productName,
          orderReference: job.orderReference,
        });

        releasedCount++;
      } else {
        const errCode = (item.errorCode || 'OUTBOUND_WRITEBACK_FAILED').trim();
        const errMsg = (item.errorMessage || 'Writeback to BandaGo failed').trim().slice(0, 1000);
        const exhausted = NON_RETRYABLE_CODES.has(errCode) || job.attempts >= job.maxAttempts;

        await prisma.posOutboundJob.update({
          where: { id: job.id },
          data: {
            status: exhausted ? 'FAILED' : 'PENDING',
            lockedAt: null,
            lockToken: null,
            lastErrorCode: errCode,
            lastError: errMsg,
          },
        });

        await recordPosIncident({
          direction: 'OUTBOUND',
          source: 'BANDAGO_WRITEBACK',
          severity: CRITICAL_CODES.has(errCode) ? 'CRITICAL' : 'ERROR',
          code: errCode,
          message: errMsg,
          remediation: item.remediation || getDefaultRemediation(errCode),
          externalPosId: job.externalPosId,
          productName: job.productName,
          orderReference: job.orderReference,
        });

        errorSummaries.push({ jobId: job.id, code: errCode, error: errMsg });
        failedCount++;
      }
    }

    // Write telemetry audit log only when actual completions/failures occurred (not empty releases)
    if (syncedCount > 0 || failedCount > 0) {
      await prisma.posSyncLog.create({
        data: {
          posSource: 'BANDAGO',
          direction: 'OUTBOUND',
          trigger: 'OUTBOUND_WRITEBACK',
          status:
            failedCount === 0
              ? 'SUCCESS'
              : syncedCount === 0
                ? 'FAILED'
                : 'PARTIAL',
          itemsReceived: rawResults.length,
          itemsUpserted: syncedCount,
          itemsFailed: failedCount,
          startedAt: new Date(startTime),
          completedAt: now,
          durationMs: reportedDuration ?? Date.now() - startTime,
          details:
            errorSummaries.length > 0
              ? { errors: errorSummaries.slice(0, 50) }
              : { releasedCount },
        },
      });
    }

    return NextResponse.json({
      ok: true,
      syncedCount,
      releasedCount,
      failedCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to acknowledge outbound jobs';
    return NextResponse.json(
      { error: 'Could not acknowledge outbound POS jobs', details: message },
      { status: 500 }
    );
  }
}
