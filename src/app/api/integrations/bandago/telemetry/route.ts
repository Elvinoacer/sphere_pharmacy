import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { authorizeBandagoRequest } from '@/lib/security/bandago-auth';
import {
  getDefaultRemediation,
  getPosSyncPolicy,
  recordPosIncident,
  savePosBridgeHeartbeat,
} from '@/lib/pos-reconciliation';

/**
 * Receives strictly Zero-PHI structural heartbeats and error diagnostics from the
 * Chrome bridge extension, and returns the live server policy + pending outbound count.
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeBandagoRequest(req, ['ADMIN', 'PHARMACIST']);
  if (!auth.authorized) return auth.error;

  try {
    const body = await req.json().catch(() => ({}));

    if (body.heartbeat && typeof body.heartbeat === 'object' && !Array.isArray(body.heartbeat)) {
      const hb = body.heartbeat as Record<string, unknown>;
      await savePosBridgeHeartbeat({
        extensionVersion: typeof hb.extensionVersion === 'string' ? hb.extensionVersion.slice(0, 32) : null,
        pharmacyId: typeof hb.pharmacyId === 'string' ? hb.pharmacyId.slice(0, 64) : null,
        bandagoTabOpen: Boolean(hb.bandagoTabOpen),
        bandagoOrigin: typeof hb.bandagoOrigin === 'string' ? hb.bandagoOrigin.slice(0, 120) : null,
        tenantUU: typeof hb.tenantUU === 'string' && hb.tenantUU.trim() ? hb.tenantUU.trim().slice(0, 64) : null,
        inboundQueuePending: Math.max(0, Math.floor(Number(hb.inboundQueuePending) || 0)),
        inboundQueueFailed: Math.max(0, Math.floor(Number(hb.inboundQueueFailed) || 0)),
        lastInboundPollAt: typeof hb.lastInboundPollAt === 'string' ? hb.lastInboundPollAt.slice(0, 40) : null,
        lastInboundPollOk: typeof hb.lastInboundPollOk === 'boolean' ? hb.lastInboundPollOk : null,
        lastInboundPollMessage:
          typeof hb.lastInboundPollMessage === 'string' ? hb.lastInboundPollMessage.slice(0, 300) : null,
        lastOutboundRunAt: typeof hb.lastOutboundRunAt === 'string' ? hb.lastOutboundRunAt.slice(0, 40) : null,
        lastOutboundOk: typeof hb.lastOutboundOk === 'boolean' ? hb.lastOutboundOk : null,
        lastOutboundMessage:
          typeof hb.lastOutboundMessage === 'string' ? hb.lastOutboundMessage.slice(0, 300) : null,
      });
    }

    const rawErrors = Array.isArray(body.errors) ? body.errors : [];
    for (const err of rawErrors.slice(0, 20)) {
      if (!err || typeof err !== 'object') continue;
      const e = err as Record<string, unknown>;
      const code = typeof e.code === 'string' && e.code.trim() ? e.code.trim() : 'BRIDGE_ERROR';
      const message =
        typeof e.message === 'string' && e.message.trim()
          ? e.message.trim()
          : 'Extension bridge reported an error';
      const severity =
        e.severity === 'CRITICAL' || e.severity === 'WARNING' || e.severity === 'ERROR'
          ? e.severity
          : 'ERROR';
      const direction = e.direction === 'OUTBOUND' ? 'OUTBOUND' : 'INBOUND';

      await recordPosIncident({
        direction,
        source: typeof e.source === 'string' ? e.source.slice(0, 60) : 'EXTENSION_BRIDGE',
        severity,
        code,
        message,
        remediation: typeof e.remediation === 'string' ? e.remediation : getDefaultRemediation(code),
        externalPosId: typeof e.externalPosId === 'string' ? e.externalPosId : null,
        productName: typeof e.productName === 'string' ? e.productName : null,
        orderReference: typeof e.orderReference === 'string' ? e.orderReference : null,
      });
    }

    const [policy, pendingOutboundCount] = await Promise.all([
      getPosSyncPolicy(),
      prisma.posOutboundJob.count({ where: { status: { in: ['PENDING', 'FAILED', 'EXPORTED'] } } }),
    ]);

    return NextResponse.json({
      ok: true,
      policy,
      pendingOutboundCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Telemetry ingestion failed';
    return NextResponse.json(
      { error: 'Could not store bridge telemetry', details: message },
      { status: 500 }
    );
  }
}
