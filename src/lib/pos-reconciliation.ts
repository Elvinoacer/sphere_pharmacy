import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { notifyStaff } from '@/lib/notify';
import {
  computeReconciledStock,
  DEFAULT_POS_SYNC_POLICY,
  deterministicUuidFromKey,
  getDefaultRemediation,
  normalizePosSyncPolicy,
  POS_ERROR_REMEDIATIONS,
  type PosBridgeHeartbeat,
  type PosSyncPolicy,
} from './pos-reconciliation-core';

export {
  computeReconciledStock,
  DEFAULT_POS_SYNC_POLICY,
  deterministicUuidFromKey,
  getDefaultRemediation,
  normalizePosSyncPolicy,
  POS_ERROR_REMEDIATIONS,
  type ExportGroupBy,
  type OutboundSyncMode,
  type PosBridgeHeartbeat,
  type PosSyncPolicy,
  type PreferredExportFormat,
  type ReconciledStockInput,
  type ReconciledStockResult,
} from './pos-reconciliation-core';

const POLICY_SETTING_KEY = 'posSync';
const HEARTBEAT_SETTING_KEY = 'posBridgeHeartbeat';

export async function getPosSyncPolicy(): Promise<PosSyncPolicy> {
  try {
    const row = await db.setting.findUnique({ where: { key: POLICY_SETTING_KEY } });
    if (!row) return { ...DEFAULT_POS_SYNC_POLICY };
    return normalizePosSyncPolicy(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_POS_SYNC_POLICY };
  }
}

export async function savePosSyncPolicy(patch: Partial<PosSyncPolicy>): Promise<PosSyncPolicy> {
  const current = await getPosSyncPolicy();
  const next = normalizePosSyncPolicy({ ...current, ...patch });
  await db.setting.upsert({
    where: { key: POLICY_SETTING_KEY },
    create: { key: POLICY_SETTING_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}

export async function getPosBridgeHeartbeat(): Promise<PosBridgeHeartbeat | null> {
  try {
    const row = await db.setting.findUnique({ where: { key: HEARTBEAT_SETTING_KEY } });
    if (!row) return null;
    const parsed = JSON.parse(row.value) as PosBridgeHeartbeat;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function savePosBridgeHeartbeat(heartbeat: Omit<PosBridgeHeartbeat, 'reportedAt'>): Promise<PosBridgeHeartbeat> {
  const payload: PosBridgeHeartbeat = {
    ...heartbeat,
    reportedAt: new Date().toISOString(),
  };
  await db.setting.upsert({
    where: { key: HEARTBEAT_SETTING_KEY },
    create: { key: HEARTBEAT_SETTING_KEY, value: JSON.stringify(payload) },
    update: { value: JSON.stringify(payload) },
  });
  return payload;
}

export interface ProductUnreconciledOffsets {
  pendingNetDelta: number;
  pendingSalesQty: number;
  unpaidOrderHoldQty: number;
}

const OPEN_OUTBOUND_STATUSES = ['PENDING', 'PROCESSING', 'EXPORTED', 'FAILED'] as const;

export async function getUnreconciledOffsetsByProduct(
  productIds: string[],
  baselineAt: string | null
): Promise<Map<string, ProductUnreconciledOffsets>> {
  const map = new Map<string, ProductUnreconciledOffsets>();
  if (productIds.length === 0) return map;

  for (const id of productIds) {
    map.set(id, { pendingNetDelta: 0, pendingSalesQty: 0, unpaidOrderHoldQty: 0 });
  }

  const openJobs = await db.posOutboundJob.findMany({
    where: {
      productId: { in: productIds },
      status: { in: [...OPEN_OUTBOUND_STATUSES] },
    },
    select: {
      productId: true,
      eventType: true,
      qtyDelta: true,
    },
  });

  for (const job of openJobs) {
    const entry = map.get(job.productId) ?? { pendingNetDelta: 0, pendingSalesQty: 0, unpaidOrderHoldQty: 0 };
    entry.pendingNetDelta += job.qtyDelta;
    if (job.eventType === 'ONLINE_SALE' && job.qtyDelta < 0) {
      entry.pendingSalesQty += Math.abs(job.qtyDelta);
    }
    map.set(job.productId, entry);
  }

  const baselineDate = baselineAt && !Number.isNaN(Date.parse(baselineAt)) ? new Date(baselineAt) : null;
  const heldOrderItems = await db.orderItem.findMany({
    where: {
      productId: { in: productIds },
      order: {
        status: { notIn: ['CANCELLED', 'REJECTED', 'REFUNDED'] },
        inventoryReservedAt: { not: null },
        inventoryReleasedAt: null,
        posOutboundJobs: { none: {} },
        ...(baselineDate ? { createdAt: { gte: baselineDate } } : {}),
      },
    },
    select: {
      productId: true,
      qty: true,
    },
  });

  for (const item of heldOrderItems) {
    if (!item.productId) continue;
    const entry = map.get(item.productId) ?? { pendingNetDelta: 0, pendingSalesQty: 0, unpaidOrderHoldQty: 0 };
    entry.unpaidOrderHoldQty += Math.max(0, item.qty);
    map.set(item.productId, entry);
  }

  return map;
}

/**
 * Idempotently queues a POS stock deduction job for every product in a committed/paid online order.
 * Safe to invoke multiple times for the same order (e.g. prepare followed by cash-confirm).
 */
export async function enqueueOrderPosDeduction(
  tx: Prisma.TransactionClient,
  orderId: string,
  paymentMethod?: string | null
): Promise<number> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      reference: true,
      paymentMethod: true,
      items: {
        select: {
          productId: true,
          name: true,
          price: true,
          qty: true,
          lineTotal: true,
        },
      },
    },
  });

  if (!order) return 0;

  // Aggregate duplicate lines if the same product appears in multiple items
  const byProduct = new Map<
    string,
    { productId: string; name: string; qty: number; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }
  >();

  for (const item of order.items) {
    if (!item.productId || item.qty <= 0) continue;
    const existing = byProduct.get(item.productId);
    if (existing) {
      existing.qty += item.qty;
      existing.lineTotal = existing.lineTotal.plus(item.lineTotal);
    } else {
      byProduct.set(item.productId, {
        productId: item.productId,
        name: item.name,
        qty: item.qty,
        unitPrice: item.price,
        lineTotal: item.lineTotal,
      });
    }
  }

  if (byProduct.size === 0) return 0;

  const products = await tx.product.findMany({
    where: { id: { in: Array.from(byProduct.keys()) } },
    select: {
      id: true,
      name: true,
      sku: true,
      externalPosId: true,
      lastPosStock: true,
      stockQty: true,
    },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  let createdCount = 0;
  const resolvedPaymentMethod = paymentMethod ?? order.paymentMethod ?? null;

  for (const line of byProduct.values()) {
    const product = productMap.get(line.productId);
    if (!product) continue;

    const idempotencyKey = `sale:${order.id}:${product.id}`;
    const existing = await tx.posOutboundJob.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) continue;

    await tx.posOutboundJob.create({
      data: {
        idempotencyKey,
        eventType: 'ONLINE_SALE',
        status: 'PENDING',
        orderId: order.id,
        orderReference: order.reference,
        productId: product.id,
        externalPosId: product.externalPosId,
        productName: product.name || line.name,
        sku: product.sku,
        qtyDelta: -Math.abs(line.qty),
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        paymentMethod: resolvedPaymentMethod,
        posStockSnapshot: product.lastPosStock ?? product.stockQty,
        externalInventoryUU: deterministicUuidFromKey(idempotencyKey),
      },
    });
    createdCount++;
  }

  return createdCount;
}

/**
 * Cancels un-synced outbound jobs when an order is cancelled/rejected/expired/refunded,
 * or creates a compensating REFUND_RESTOCK job if the deduction had already synced to BandaGo.
 */
export async function cancelOrderPosDeduction(
  tx: Prisma.TransactionClient,
  orderId: string,
  actor: string
): Promise<void> {
  const jobs = await tx.posOutboundJob.findMany({
    where: {
      orderId,
      eventType: 'ONLINE_SALE',
    },
  });

  if (jobs.length === 0) return;

  for (const job of jobs) {
    if (['PENDING', 'PROCESSING', 'EXPORTED', 'FAILED'].includes(job.status)) {
      await tx.posOutboundJob.update({
        where: { id: job.id },
        data: {
          status: 'CANCELLED',
          lockedAt: null,
          lockToken: null,
          reconciledBy: actor,
          reconciledNote: 'Order cancelled/expired before POS sync',
        },
      });
    } else if (['SYNCED', 'RECONCILED_MANUAL'].includes(job.status) && job.qtyDelta < 0) {
      const restockKey = `restock:${orderId}:${job.productId}`;
      const existingRestock = await tx.posOutboundJob.findUnique({
        where: { idempotencyKey: restockKey },
        select: { id: true },
      });
      if (!existingRestock) {
        await tx.posOutboundJob.create({
          data: {
            idempotencyKey: restockKey,
            eventType: 'REFUND_RESTOCK',
            status: 'PENDING',
            orderId: job.orderId,
            orderReference: job.orderReference,
            productId: job.productId,
            externalPosId: job.externalPosId,
            productName: job.productName,
            sku: job.sku,
            qtyDelta: Math.abs(job.qtyDelta),
            unitPrice: job.unitPrice,
            lineTotal: job.lineTotal,
            paymentMethod: job.paymentMethod,
            posStockSnapshot: job.posStockSnapshot,
            externalInventoryUU: deterministicUuidFromKey(restockKey),
            reconciledNote: `Compensating restock after ${actor} cancellation/refund`,
          },
        });
      }
    }
  }
}

/**
 * Queues an outbound POS stock adjustment when an admin/pharmacist edits stockQty in Sphere.
 */
export async function enqueueAdminStockEdit(
  client: Prisma.TransactionClient | typeof db,
  input: {
    productId: string;
    previousQty: number;
    newQty: number;
    actor: string;
  }
): Promise<void> {
  const delta = input.newQty - input.previousQty;
  if (delta === 0) return;

  const product = await client.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true,
      name: true,
      sku: true,
      externalPosId: true,
      lastPosStock: true,
      price: true,
    },
  });
  if (!product || !product.externalPosId) return;

  const idempotencyKey = `admin_adj:${product.id}:${Date.now()}:${input.newQty}`;
  await client.posOutboundJob.create({
    data: {
      idempotencyKey,
      eventType: 'ADMIN_STOCK_ADJUST',
      status: 'PENDING',
      productId: product.id,
      externalPosId: product.externalPosId,
      productName: product.name,
      sku: product.sku,
      qtyDelta: delta,
      targetStock: input.newQty,
      unitPrice: product.price,
      posStockSnapshot: product.lastPosStock ?? input.previousQty,
      externalInventoryUU: deterministicUuidFromKey(idempotencyKey),
      reconciledNote: `Admin stock edit (${input.previousQty} -> ${input.newQty}) by ${input.actor}`,
    },
  });
}

export interface RecordPosIncidentInput {
  direction?: 'INBOUND' | 'OUTBOUND';
  source: string;
  severity?: 'CRITICAL' | 'ERROR' | 'WARNING';
  code: string;
  message: string;
  remediation?: string;
  externalPosId?: string | null;
  productName?: string | null;
  orderReference?: string | null;
  meta?: Prisma.InputJsonValue;
}

/**
 * Deduplicates and persists structured POS sync incidents, notifying staff on CRITICAL errors.
 */
export async function recordPosIncident(input: RecordPosIncidentInput): Promise<void> {
  try {
    const direction = input.direction ?? 'INBOUND';
    const severity = input.severity ?? 'ERROR';
    const externalPosId = input.externalPosId?.trim() || null;
    const remediation = input.remediation?.trim() || getDefaultRemediation(input.code);
    const now = new Date();

    const existing = await db.posSyncIncident.findFirst({
      where: {
        code: input.code,
        resolved: false,
        externalPosId,
      },
      orderBy: { lastSeenAt: 'desc' },
    });

    if (existing) {
      await db.posSyncIncident.update({
        where: { id: existing.id },
        data: {
          occurrences: { increment: 1 },
          lastSeenAt: now,
          message: input.message.slice(0, 1000),
          remediation: remediation.slice(0, 1000),
          severity,
          ...(input.productName ? { productName: input.productName.slice(0, 200) } : {}),
          ...(input.orderReference ? { orderReference: input.orderReference.slice(0, 100) } : {}),
          ...(input.meta !== undefined ? { meta: input.meta } : {}),
        },
      });
    } else {
      await db.posSyncIncident.create({
        data: {
          direction,
          source: input.source.slice(0, 80),
          severity,
          code: input.code.slice(0, 80),
          message: input.message.slice(0, 1000),
          remediation: remediation.slice(0, 1000),
          externalPosId,
          productName: input.productName?.slice(0, 200) || null,
          orderReference: input.orderReference?.slice(0, 100) || null,
          meta: input.meta,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });
    }

    if (severity === 'CRITICAL') {
      const dayBucket = now.toISOString().slice(0, 13); // throttle max once per hour per code
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spherepharmacy.co.ke';
      await notifyStaff({
        dedupeKey: `pos-incident:${input.code}:${dayBucket}`,
        roles: ['ADMIN', 'PHARMACIST'],
        event: 'POS_SYNC_CRITICAL',
        title: `BandaGo POS Sync Alert (${input.code})`,
        message: `${input.message.slice(0, 240)} — ${remediation.slice(0, 200)}`,
        link: `${appUrl}/admin?section=pos-sync`,
      });
    }
  } catch (err: unknown) {
    console.warn('[PosSyncIncident] Could not record incident:', err);
  }
}
