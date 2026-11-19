import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { audit } from '@/lib/notify';
import {
  getPosBridgeHeartbeat,
  getPosSyncPolicy,
  savePosSyncPolicy,
} from '@/lib/pos-reconciliation';
import { isUsingInsecureDefaultBandagoKey } from '@/lib/security/bandago-bearer';
import { rejectOversizedRequest } from '@/lib/security/request';
import { requireStaff } from '@/lib/session';

const policyUpdateSchema = z.object({
  inboundEnabled: z.boolean().optional(),
  protectUnreconciledSales: z.boolean().optional(),
  reconciliationBaselineAt: z.string().nullable().optional(),
  expectedTenantUU: z.string().max(120).nullable().optional(),
  sellableWarehouseUUs: z.array(z.string().max(120)).max(50).optional(),
  minShelfLifeDays: z.number().int().min(0).max(365).optional(),
  outboundSyncMode: z.enum(['MANUAL_EXPORT', 'AUTO_SYNC']).optional(),
  autoSyncOnlineSales: z.boolean().optional(),
  autoSyncStockEdits: z.boolean().optional(),
  autoSyncPriceEdits: z.boolean().optional(),
  preferredExportFormat: z.enum(['PDF', 'CSV', 'JSON']).optional(),
  exportGroupBy: z.enum(['PRODUCT_SUMMARY', 'ITEMIZED_ORDERS']).optional(),
  outboundPollIntervalMinutes: z.number().int().min(1).max(60).optional(),
});

export async function GET() {
  const { error } = await requireStaff(['ADMIN', 'PHARMACIST', 'STAFF']);
  if (error) return error;

  const [policy, bridgeHeartbeat] = await Promise.all([
    getPosSyncPolicy(),
    getPosBridgeHeartbeat(),
  ]);

  return NextResponse.json({
    policy,
    bridgeHeartbeat,
    apiKeyConfigured: Boolean(process.env.BANDAGO_SYNC_API_KEY?.trim()),
    usingDefaultKeyWarning: isUsingInsecureDefaultBandagoKey(),
  });
}

export async function PUT(request: NextRequest) {
  const { session, error } = await requireStaff(['ADMIN']);
  if (error || !session) return error;

  const oversized = rejectOversizedRequest(request, 16_384);
  if (oversized) return oversized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const parsed = policyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid policy settings' },
      { status: 400 }
    );
  }

  const policy = await savePosSyncPolicy(parsed.data);

  await audit(
    session.staffName ?? 'Admin',
    session.staffRole,
    'POS_SYNC_POLICY_UPDATED',
    'Setting',
    'posSync',
    JSON.stringify(policy)
  );

  return NextResponse.json({ ok: true, policy });
}
