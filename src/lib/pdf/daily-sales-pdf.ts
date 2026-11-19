/**
 * Zero-dependency PDF 1.4 generator for Sphere Pharmacy Daily Online Sales &
 * BandaGo POS Reconciliation sheets (A4 portrait, Helvetica Type1 fonts).
 */

export interface DailySalesPdfRow {
  productName: string;
  sku: string;
  externalPosId: string | null;
  orderReference: string | null;
  qtyDeducted: number;
  unitPrice: number;
  lineTotal: number;
  targetPosStock: number | null;
  status: string;
}

export interface DailySalesPdfInput {
  exportBatchId: string;
  generatedAtIso: string;
  scopeLabel: string;
  groupByLabel: string;
  totalOrders: number;
  totalUnitsDeducted: number;
  totalRevenueKes: number;
  pendingCount: number;
  syncedCount: number;
  rows: DailySalesPdfRow[];
}

function pdfEscapeText(value: string): string {
  // Strip non-printable ASCII and escape PDF string literals
  const ascii = value
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
  return ascii;
}

function truncateText(value: string, maxLen: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, Math.max(1, maxLen - 3)) + '...';
}

function formatMoney(amount: number): string {
  return `KES ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Generates a valid multi-page A4 PDF binary buffer containing the pharmacy's
 * daily sales & POS reconciliation ledger with pharmacist sign-off block.
 */
export function buildDailySalesPdfBuffer(input: DailySalesPdfInput): Buffer {
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN_L = 36;
  const MARGIN_R = 36;
  const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R; // ~523pt

  const rowsPerFirstPage = 24;
  const rowsPerSubsequentPage = 32;

  const chunks: DailySalesPdfRow[][] = [];
  if (input.rows.length === 0) {
    chunks.push([]);
  } else {
    chunks.push(input.rows.slice(0, rowsPerFirstPage));
    let cursor = rowsPerFirstPage;
    while (cursor < input.rows.length) {
      chunks.push(input.rows.slice(cursor, cursor + rowsPerSubsequentPage));
      cursor += rowsPerSubsequentPage;
    }
  }

  const totalPages = chunks.length;
  const objects: string[] = [];

  // Placeholder IDs:
  // 1: Catalog
  // 2: Pages
  // 3: Font Regular (Helvetica)
  // 4: Font Bold (Helvetica-Bold)
  // Then for each page i: Content stream (5 + 2*i), Page dict (6 + 2*i)
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const pageKidsRefs = chunks.map((_, i) => `${6 + i * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${pageKidsRefs}] /Count ${totalPages} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  const drawText = (x: number, y: number, text: string, size = 9, bold = false, rgb = '0.1 0.1 0.12'): string => {
    const font = bold ? '/F2' : '/F1';
    return `BT ${rgb} rg ${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscapeText(text)}) Tj ET\n`;
  };

  const drawRect = (x: number, y: number, w: number, h: number, fillRgb?: string, strokeRgb?: string): string => {
    let op = '';
    if (fillRgb) op += `${fillRgb} rg `;
    if (strokeRgb) op += `${strokeRgb} RG 0.6 w `;
    op += `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re `;
    if (fillRgb && strokeRgb) op += 'B\n';
    else if (fillRgb) op += 'f\n';
    else op += 'S\n';
    return op;
  };

  const drawLine = (x1: number, y1: number, x2: number, y2: number, strokeRgb = '0.82 0.84 0.87'): string => {
    return `${strokeRgb} RG 0.5 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
  };

  chunks.forEach((pageRows, pageIndex) => {
    const isFirstPage = pageIndex === 0;
    const isLastPage = pageIndex === totalPages - 1;
    let stream = '';
    let y = PAGE_H - 36;

    if (isFirstPage) {
      // Brand Header Banner
      stream += drawRect(MARGIN_L, y - 54, CONTENT_W, 56, '0.06 0.31 0.25');
      stream += drawText(MARGIN_L + 14, y - 20, 'SPHERE PHARMACY - DAILY SALES & BANDAGO POS RECONCILIATION', 12, true, '1 1 1');
      stream += drawText(
        MARGIN_L + 14,
        y - 36,
        `Roysambu, Nairobi | Batch: ${input.exportBatchId} | Scope: ${input.scopeLabel} | Mode: ${input.groupByLabel}`,
        8,
        false,
        '0.85 0.96 0.92'
      );
      stream += drawText(
        MARGIN_L + 14,
        y - 47,
        `Generated: ${input.generatedAtIso}`,
        7.5,
        false,
        '0.78 0.92 0.88'
      );
      y -= 68;

      // KPI Summary Row
      const boxW = (CONTENT_W - 18) / 4;
      const kpis = [
        { label: 'ORDERS INCLUDED', value: String(input.totalOrders) },
        { label: 'UNITS TO DEDUCT', value: String(input.totalUnitsDeducted) },
        { label: 'ONLINE REVENUE', value: formatMoney(input.totalRevenueKes) },
        { label: 'PENDING / SYNCED', value: `${input.pendingCount} / ${input.syncedCount}` },
      ];
      kpis.forEach((kpi, idx) => {
        const bx = MARGIN_L + idx * (boxW + 6);
        stream += drawRect(bx, y - 36, boxW, 36, '0.96 0.97 0.98', '0.84 0.86 0.89');
        stream += drawText(bx + 8, y - 13, kpi.label, 6.8, true, '0.38 0.42 0.48');
        stream += drawText(bx + 8, y - 28, kpi.value, 10, true, '0.07 0.10 0.14');
      });
      y -= 50;
    } else {
      stream += drawText(
        MARGIN_L,
        y - 10,
        `SPHERE PHARMACY - Batch ${input.exportBatchId} (Continued)`,
        9.5,
        true,
        '0.06 0.31 0.25'
      );
      y -= 24;
    }

    // Table Header
    const colX = {
      product: MARGIN_L + 6,
      sku: MARGIN_L + 186,
      posId: MARGIN_L + 258,
      qty: MARGIN_L + 312,
      price: MARGIN_L + 350,
      total: MARGIN_L + 408,
      target: MARGIN_L + 465,
    };

    stream += drawRect(MARGIN_L, y - 20, CONTENT_W, 20, '0.93 0.95 0.96', '0.80 0.83 0.86');
    stream += drawText(colX.product, y - 13, 'Medication / Order Ref', 7.5, true, '0.2 0.25 0.3');
    stream += drawText(colX.sku, y - 13, 'SKU', 7.5, true, '0.2 0.25 0.3');
    stream += drawText(colX.posId, y - 13, 'POS UU', 7.5, true, '0.2 0.25 0.3');
    stream += drawText(colX.qty, y - 13, 'Qty', 7.5, true, '0.2 0.25 0.3');
    stream += drawText(colX.price, y - 13, 'Price', 7.5, true, '0.2 0.25 0.3');
    stream += drawText(colX.total, y - 13, 'Total KES', 7.5, true, '0.2 0.25 0.3');
    stream += drawText(colX.target, y - 13, 'Target / St', 7.5, true, '0.2 0.25 0.3');
    y -= 22;

    if (pageRows.length === 0) {
      stream += drawText(MARGIN_L + 8, y - 18, 'No matching online sales or stock adjustments found for this selection.', 9, false, '0.4 0.45 0.5');
      y -= 30;
    } else {
      pageRows.forEach((row, rIdx) => {
        if (rIdx % 2 === 1) {
          stream += drawRect(MARGIN_L, y - 17, CONTENT_W, 17, '0.98 0.985 0.99');
        }
        const label = row.orderReference
          ? `${truncateText(row.productName, 24)} (${row.orderReference})`
          : truncateText(row.productName, 34);
        const posSuffix = row.externalPosId ? row.externalPosId.slice(0, 8) : 'UNMAPPED';
        const targetLabel = row.targetPosStock != null ? `${row.targetPosStock} (${row.status.slice(0, 4)})` : row.status.slice(0, 9);

        stream += drawText(colX.product, y - 12, label, 7.8, false);
        stream += drawText(colX.sku, y - 12, truncateText(row.sku || '-', 12), 7.5, false, '0.3 0.35 0.4');
        stream += drawText(colX.posId, y - 12, posSuffix, 7.3, false, '0.3 0.35 0.4');
        stream += drawText(colX.qty, y - 12, String(row.qtyDeducted), 8, true);
        stream += drawText(colX.price, y - 12, row.unitPrice.toFixed(0), 7.8, false);
        stream += drawText(colX.total, y - 12, row.lineTotal.toFixed(2), 7.8, true);
        stream += drawText(colX.target, y - 12, targetLabel, 7.2, false, '0.25 0.3 0.35');
        stream += drawLine(MARGIN_L, y - 17, MARGIN_L + CONTENT_W, y - 17, '0.90 0.91 0.93');
        y -= 17;
      });
    }

    if (isLastPage) {
      const signY = Math.max(82, y - 24);
      stream += drawRect(MARGIN_L, signY - 46, CONTENT_W, 46, '0.97 0.97 0.98', '0.78 0.80 0.84');
      stream += drawText(MARGIN_L + 10, signY - 14, 'PHARMACIST BANDAGO POS ENTRY SIGN-OFF', 8, true, '0.12 0.16 0.22');
      stream += drawText(
        MARGIN_L + 10,
        signY - 30,
        'Entered by: ________________________   BandaGo Doc #: ______________   Date / Sign: __________________',
        8,
        false,
        '0.25 0.28 0.34'
      );
    }

    // Footer
    stream += drawLine(MARGIN_L, 42, MARGIN_L + CONTENT_W, 42);
    stream += drawText(
      MARGIN_L,
      28,
      'Zero-PHI Commercial Reconciliation Export - Sphere Pharmacy Kenya',
      7.5,
      false,
      '0.45 0.48 0.54'
    );
    stream += drawText(
      PAGE_W - MARGIN_R - 55,
      28,
      `Page ${pageIndex + 1} of ${totalPages}`,
      7.5,
      true,
      '0.35 0.38 0.44'
    );

    const streamBytes = Buffer.byteLength(stream, 'utf8');
    const contentObjIdx = 5 + pageIndex * 2;
    objects.push(`<< /Length ${streamBytes} >>\nstream\n${stream}endstream`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjIdx} 0 R >>`
    );
  });

  // Assemble PDF binary with exact byte-offset xref table
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((body, idx) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}
