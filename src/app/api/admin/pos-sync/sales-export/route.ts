import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/notify';
import { buildDailySalesPdfBuffer, type DailySalesPdfRow } from '@/lib/pdf/daily-sales-pdf';
import { getPosSyncPolicy } from '@/lib/pos-reconciliation';
import { requireStaff } from '@/lib/session';

interface ExportLineRow {
  jobId: string | null;
  status: string;
  eventType: string;
  productId: string | null;
  productName: string;
  sku: string;
  externalPosId: string | null;
  orderReference: string | null;
  action: 'DEDUCT' | 'RESTOCK' | 'ADJUST';
  qtyUnits: number;
  qtyDelta: number;
  unitPrice: number;
  lineTotal: number;
  paymentMethod: string;
  currentSphereStock: number | null;
  lastPosStock: number | null;
  suggestedTargetPosStock: number | null;
  createdAt: string;
}

function getEatDayStart(now: Date): Date {
  const eatOffsetMs = 3 * 60 * 60 * 1000;
  const eat = new Date(now.getTime() + eatOffsetMs);
  return new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate()) - eatOffsetMs);
}

/**
 * Neutralizes spreadsheet formula injection (=, +, -, @, tab, CR) and quotes RFC 4180 CSV cells.
 */
function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function buildCsvPayload(rows: ExportLineRow[], exportBatchId: string, scopeLabel: string): string {
  const header = [
    'Batch ID',
    'Scope',
    'Action in BandaGo',
    'Product Name',
    'SKU',
    'BandaGo Product UU',
    'Order Reference',
    'Qty Units',
    'Signed Qty Delta',
    'Current Sphere Stock',
    'Last Known POS Stock',
    'Suggested Target POS Stock',
    'Unit Price (KES)',
    'Line Total (KES)',
    'Payment Method',
    'Status',
    'Timestamp (UTC)',
  ];

  const lines = [
    header.map((h) => csvCell(h)).join(','),
    ...rows.map((r) =>
      [
        exportBatchId,
        scopeLabel,
        r.action,
        r.productName,
        r.sku,
        r.externalPosId ?? '',
        r.orderReference ?? '',
        r.qtyUnits,
        r.qtyDelta,
        r.currentSphereStock ?? '',
        r.lastPosStock ?? '',
        r.suggestedTargetPosStock ?? '',
        r.unitPrice.toFixed(2),
        r.lineTotal.toFixed(2),
        r.paymentMethod,
        r.status,
        r.createdAt,
      ]
        .map((v) => csvCell(v))
        .join(',')
    ),
  ];

  return `\uFEFF${lines.join('\r\n')}`;
}

export async function GET(request: NextRequest) {
  const { session, error } = await requireStaff(['ADMIN', 'PHARMACIST']);
  if (error || !session) return error;

  const policy = await getPosSyncPolicy();
  const { searchParams } = request.nextUrl;

  const formatParam = (searchParams.get('format') || policy.preferredExportFormat).toUpperCase();
  const format = formatParam === 'CSV' || formatParam === 'JSON' ? formatParam : 'PDF';

  const scopeParam = (searchParams.get('scope') || 'unreconciled').toLowerCase();
  const scope =
    scopeParam === 'today' || scopeParam === 'range' ? scopeParam : 'unreconciled';

  const groupParam = (searchParams.get('groupBy') || policy.exportGroupBy).toUpperCase();
  const groupBy = groupParam === 'ITEMIZED_ORDERS' ? 'ITEMIZED_ORDERS' : 'PRODUCT_SUMMARY';

  const markExported = searchParams.get('markExported') === '1';

  const now = new Date();
  let fromDate = getEatDayStart(now);
  let toDate = now;
  let scopeLabel = 'Unreconciled Online Sales & Adjustments';

  if (scope === 'today') {
    scopeLabel = `Today EAT (${fromDate.toISOString().slice(0, 10)})`;
  } else if (scope === 'range') {
    const rawFrom = searchParams.get('from');
    const rawTo = searchParams.get('to');
    if (rawFrom && !Number.isNaN(Date.parse(rawFrom))) {
      fromDate = new Date(rawFrom);
    }
    if (rawTo && !Number.isNaN(Date.parse(rawTo))) {
      toDate = new Date(rawTo);
      if (rawTo.length <= 10) {
        toDate.setUTCHours(23, 59, 59, 999);
      }
    }
    scopeLabel = `Range ${fromDate.toISOString().slice(0, 10)} to ${toDate.toISOString().slice(0, 10)}`;
  }

  const jobs = await prisma.posOutboundJob.findMany({
    where:
      scope === 'unreconciled'
        ? {
            status: { in: ['PENDING', 'PROCESSING', 'EXPORTED', 'FAILED'] },
            eventType: { in: ['ONLINE_SALE', 'REFUND_RESTOCK', 'ADMIN_STOCK_ADJUST'] },
          }
        : {
            createdAt: { gte: fromDate, lte: toDate },
            status: { not: 'CANCELLED' },
            eventType: { in: ['ONLINE_SALE', 'REFUND_RESTOCK', 'ADMIN_STOCK_ADJUST'] },
          },
    orderBy: [{ createdAt: 'asc' }],
    include: {
      product: {
        select: {
          stockQty: true,
          lastPosStock: true,
          externalPosId: true,
          sku: true,
        },
      },
    },
  });

  const exportBatchId = `EXP-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 6).toUpperCase()}`;

  let rawRows: ExportLineRow[] = jobs.map((job) => {
    const action: ExportLineRow['action'] =
      job.eventType === 'ONLINE_SALE'
        ? 'DEDUCT'
        : job.eventType === 'REFUND_RESTOCK'
          ? 'RESTOCK'
          : 'ADJUST';
    const lastPos = job.product?.lastPosStock ?? job.posStockSnapshot ?? null;
    const suggestedTarget =
      job.targetStock != null
        ? job.targetStock
        : lastPos != null
          ? Math.max(0, lastPos + job.qtyDelta)
          : job.product?.stockQty ?? null;

    return {
      jobId: job.id,
      status: job.status,
      eventType: job.eventType,
      productId: job.productId,
      productName: job.productName,
      sku: job.sku || job.product?.sku || '—',
      externalPosId: job.externalPosId || job.product?.externalPosId || null,
      orderReference: job.orderReference || null,
      action,
      qtyUnits: Math.abs(job.qtyDelta),
      qtyDelta: job.qtyDelta,
      unitPrice: Number(job.unitPrice ?? 0),
      lineTotal: Number(job.lineTotal ?? 0),
      paymentMethod: job.paymentMethod || '—',
      currentSphereStock: job.product?.stockQty ?? null,
      lastPosStock: lastPos,
      suggestedTargetPosStock: suggestedTarget,
      createdAt: job.createdAt.toISOString(),
    };
  });

  // Historical fallback for today/range if no outbound jobs were previously queued in that period
  if (rawRows.length === 0 && (scope === 'today' || scope === 'range')) {
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          createdAt: { gte: fromDate, lte: toDate },
          status: { notIn: ['CANCELLED', 'REJECTED', 'REFUNDED'] },
          OR: [
            { payments: { some: { status: 'COMPLETED' } } },
            {
              status: {
                in: [
                  'PAID',
                  'PREPARING',
                  'READY_FOR_PICKUP',
                  'OUT_FOR_DELIVERY',
                  'DELIVERED',
                  'COMPLETED',
                ],
              },
            },
          ],
        },
      },
      include: {
        order: { select: { reference: true, paymentMethod: true, createdAt: true } },
      },
      orderBy: { order: { createdAt: 'asc' } },
    });

    const productIds = Array.from(
      new Set(orderItems.map((i) => i.productId).filter((id): id is string => Boolean(id)))
    );
    const linkedProducts = productIds.length
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sku: true, externalPosId: true, stockQty: true, lastPosStock: true },
        })
      : [];
    const productMap = new Map(linkedProducts.map((p) => [p.id, p]));

    rawRows = orderItems.map((item) => {
      const prod = item.productId ? productMap.get(item.productId) : undefined;
      return {
        jobId: null,
        status: 'HISTORICAL',
        eventType: 'ONLINE_SALE',
        productId: item.productId,
        productName: item.name,
        sku: prod?.sku || '—',
        externalPosId: prod?.externalPosId || null,
        orderReference: item.order.reference,
        action: 'DEDUCT',
        qtyUnits: item.qty,
        qtyDelta: -item.qty,
        unitPrice: Number(item.price),
        lineTotal: Number(item.lineTotal),
        paymentMethod: item.order.paymentMethod || '—',
        currentSphereStock: prod?.stockQty ?? null,
        lastPosStock: prod?.lastPosStock ?? null,
        suggestedTargetPosStock: prod?.stockQty ?? null,
        createdAt: item.order.createdAt.toISOString(),
      };
    });
  }

  let markedExportedCount = 0;
  if (markExported) {
    const pendingIds = jobs.filter((j) => j.status === 'PENDING').map((j) => j.id);
    if (pendingIds.length > 0) {
      const updated = await prisma.posOutboundJob.updateMany({
        where: { id: { in: pendingIds }, status: 'PENDING' },
        data: { status: 'EXPORTED', exportBatchId },
      });
      markedExportedCount = updated.count;
      for (const row of rawRows) {
        if (row.jobId && pendingIds.includes(row.jobId) && row.status === 'PENDING') {
          row.status = 'EXPORTED';
        }
      }
      await audit(
        session.staffName ?? 'Staff',
        session.staffRole,
        'POS_DAILY_SALES_EXPORTED',
        'PosOutboundJob',
        exportBatchId,
        `Exported batch ${exportBatchId} (${markedExportedCount} job(s) marked EXPORTED)`
      );
    }
  }

  // Group rows if PRODUCT_SUMMARY requested
  let outputRows: ExportLineRow[] = rawRows;
  if (groupBy === 'PRODUCT_SUMMARY') {
    const byProduct = new Map<string, ExportLineRow & { orderRefs: Set<string>; methods: Set<string> }>();
    for (const row of rawRows) {
      const key = `${row.productId || row.productName}::${row.action}`;
      const existing = byProduct.get(key);
      if (existing) {
        existing.qtyUnits += row.qtyUnits;
        existing.qtyDelta += row.qtyDelta;
        existing.lineTotal += row.lineTotal;
        if (row.orderReference) existing.orderRefs.add(row.orderReference);
        if (row.paymentMethod && row.paymentMethod !== '—') existing.methods.add(row.paymentMethod);
        if (row.status !== existing.status) existing.status = 'MIXED';
        if (row.suggestedTargetPosStock !== null) {
          existing.suggestedTargetPosStock = row.suggestedTargetPosStock;
        }
      } else {
        const orderRefs = new Set<string>();
        if (row.orderReference) orderRefs.add(row.orderReference);
        const methods = new Set<string>();
        if (row.paymentMethod && row.paymentMethod !== '—') methods.add(row.paymentMethod);
        byProduct.set(key, {
          ...row,
          orderRefs,
          methods,
        });
      }
    }
    outputRows = Array.from(byProduct.values()).map((entry) => ({
      ...entry,
      orderReference:
        entry.orderRefs.size > 0
          ? `${entry.orderRefs.size} order(s): ${Array.from(entry.orderRefs).slice(0, 3).join(', ')}${entry.orderRefs.size > 3 ? '...' : ''}`
          : '—',
      paymentMethod: entry.methods.size > 0 ? Array.from(entry.methods).join('/') : '—',
    }));
  }

  const orderSet = new Set(rawRows.map((r) => r.orderReference).filter(Boolean));
  const totalUnitsDeducted = rawRows
    .filter((r) => r.qtyDelta < 0)
    .reduce((sum, r) => sum + Math.abs(r.qtyDelta), 0);
  const totalRevenueKes = rawRows
    .filter((r) => r.eventType === 'ONLINE_SALE')
    .reduce((sum, r) => sum + r.lineTotal, 0);
  const pendingCount = rawRows.filter((r) => r.status === 'PENDING' || r.status === 'EXPORTED').length;
  const syncedCount = rawRows.filter((r) => r.status === 'SYNCED' || r.status === 'RECONCILED_MANUAL').length;

  const baseHeaders: Record<string, string> = {
    'X-Export-Batch-Id': exportBatchId,
    'X-Marked-Exported-Count': String(markedExportedCount),
    'Cache-Control': 'no-store',
  };

  if (format === 'CSV') {
    const csv = buildCsvPayload(outputRows, exportBatchId, scopeLabel);
    const filename = `sphere-pos-sales-${exportBatchId.toLowerCase()}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  if (format === 'PDF') {
    const pdfRows: DailySalesPdfRow[] = outputRows.map((r) => ({
      productName: r.productName,
      sku: r.sku,
      externalPosId: r.externalPosId,
      orderReference: r.orderReference,
      qtyDeducted: r.qtyDelta < 0 ? Math.abs(r.qtyDelta) : -Math.abs(r.qtyDelta),
      unitPrice: r.unitPrice,
      lineTotal: r.lineTotal,
      targetPosStock: r.suggestedTargetPosStock,
      status: r.status,
    }));

    const pdfBuffer = buildDailySalesPdfBuffer({
      exportBatchId,
      generatedAtIso: now.toISOString(),
      scopeLabel,
      groupByLabel: groupBy === 'PRODUCT_SUMMARY' ? 'Grouped by Product' : 'Itemized Order Lines',
      totalOrders: orderSet.size,
      totalUnitsDeducted,
      totalRevenueKes,
      pendingCount,
      syncedCount,
      rows: pdfRows,
    });

    const filename = `sphere-pos-sales-${exportBatchId.toLowerCase()}.pdf`;
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json(
    {
      exportBatchId,
      generatedAt: now.toISOString(),
      scope,
      scopeLabel,
      groupBy,
      markedExportedCount,
      summary: {
        totalOrders: orderSet.size,
        totalRows: outputRows.length,
        totalUnitsDeducted,
        totalRevenueKes,
        pendingCount,
        syncedCount,
      },
      rows: outputRows,
    },
    { status: 200, headers: baseHeaders }
  );
}
