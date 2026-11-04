/**
 * BandaGo POS & iDempiere Data Normalizer
 * Enforces Kenya PPB regulatory compliance:
 * 1. Expired batches are flagged and never contribute to online sellable stock (FEFO).
 * 2. Near-expiry batches (<90 days) are tagged for compliance monitoring.
 * 3. Prescription medications (POM, Rx, antibiotics) require pharmacist approval.
 */

export interface IngestedBatch {
  batchNumber: string;
  qtyOnHand?: number;
  quantityOnHand?: number;
  expiryDate?: string | Date | null;
  externalBatchId?: string | null;
  isExpired?: boolean;
}

export interface IngestedProductItem {
  externalPosId: string;
  sku?: string | null;
  name: string;
  slug: string;
  categorySlug: string;
  price: number;
  costPrice?: number | null;
  stock: number;
  requiresPrescription: boolean;
  imageUrl?: string;
  nearestExpiryDate?: string | Date | null;
  dosageForm?: string;
  strength?: string;
  batches?: IngestedBatch[];
}

export interface ProcessedBatchesResult {
  batches: Array<IngestedBatch & { isExpired: boolean; parsedExpiry: Date; quantityOnHand: number }>;
  validStock: number;
  nearestExpiryDate: Date | null;
  hasNearExpiry: boolean; // < 90 days
}

export class BandaGoNormalizer {
  /**
   * Robust number parser that strips currency symbols, commas, and formatting
   * e.g. "1,250.50", "KSh 3,400", "KES 150" -> number
   */
  static parseNumber(raw: any, fallback = 0): number {
    if (typeof raw === 'number') {
      return isNaN(raw) ? fallback : raw;
    }
    if (!raw) return fallback;
    const cleaned = String(raw).replace(/[^0-9.-]/g, '');
    if (!cleaned) return fallback;
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? fallback : parsed;
  }

  /**
   * Robust integer parser clamped to non-negative whole numbers
   * e.g. "1,000" -> 1000, -5 -> 0
   */
  static parseInteger(raw: any, fallback = 0): number {
    const num = BandaGoNormalizer.parseNumber(raw, fallback);
    return Math.max(0, Math.floor(num));
  }

  /**
   * Generates a URL-friendly slug with POS external ID suffix
   */
  static slugify(name: string, externalPosId?: string): string {
    const base = (name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const cleanSuffix = externalPosId
      ? externalPosId.slice(0, 6).toLowerCase().replace(/[^a-z0-9-]/g, '')
      : '';
    const suffix = cleanSuffix ? `-${cleanSuffix}` : '';
    return `${base || 'product'}${suffix}`;
  }

  /**
   * Normalizes category slugs to canonical lowercase slugs
   */
  static normalizeCategorySlug(rawSlug?: string | null): string {
    if (!rawSlug) return 'otc';
    const cleaned = rawSlug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return cleaned || 'otc';
  }

  /**
   * Safely parses any date string/number/Date without returning Invalid Date
   */
  static safeParseDate(raw: string | number | Date | null | undefined, fallback?: Date): Date | null {
    if (!raw) return fallback ?? null;
    const d = raw instanceof Date ? raw : new Date(raw);
    return isNaN(d.getTime()) ? (fallback ?? null) : d;
  }

  /**
   * Identifies Kenya PPB prescription requirement from item name, category, and POS flags
   */
  static classifyRequiresPrescription(
    name: string,
    categorySlug?: string,
    rawFlag?: boolean | string
  ): boolean {
    if (rawFlag === true || rawFlag === 'true' || rawFlag === '1' || rawFlag === 'yes') {
      return true;
    }
    const lowerName = (name || '').toLowerCase();
    const lowerCategory = (categorySlug || '').toLowerCase();

    // Check category: Rx, Prescription, POM with word boundary
    if (/\b(prescription|rx|pom)\b/i.test(lowerCategory)) {
      return true;
    }

    // Explicit acronym word boundaries (avoids false positives like 'pomegranate')
    if (/\b(pom|rx)\b/i.test(lowerName)) {
      return true;
    }

    const rxKeywords = [
      'prescription only',
      'antibiotic',
      'amoxicillin',
      'augmentin',
      'azithromycin',
      'ciprofloxacin',
      'metronidazole',
      'prednisone',
      'losartan',
      'atorvastatin',
      'insulin',
      'salbutamol inhaler',
      'metformin',
      'amlodipine',
      'doxycycline',
      'ceftriaxone',
      'cefixime',
      'cefuroxime',
      'clindamycin',
      'levofloxacin',
      'erythromycin',
      'enalapril',
      'lisinopril',
      'atenolol',
      'hydrochlorothiazide',
      'telmisartan',
      'nifedipine',
      'glibenclamide',
      'glimepiride',
      'vildagliptin',
      'fluconazole',
      'tramadol',
      'codeine',
      'diazepam',
    ];

    return rxKeywords.some((keyword) => lowerName.includes(keyword));
  }

  /**
   * Applies First-Expired, First-Out (FEFO) rules per Kenya PPB:
   * - Aggregates duplicate batches by batchNumber across multi-locator bins
   * - Batches past expiry are flagged `isExpired = true`
   * - Expired units are excluded from valid sellable stock
   * - Calculates nearest expiry date among active batches
   * - Flags near-expiry (<90 days) for regulatory auditing
   */
  static processBatches(batches: IngestedBatch[] = [], referenceDate = new Date()): ProcessedBatchesResult {
    const now = referenceDate.getTime();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const ninetyDaysThreshold = now + ninetyDaysMs;

    // Deduplicate / aggregate by batchNumber across warehouse locators
    const aggregated = new Map<string, IngestedBatch & { qty: number; earliestExpiry: Date }>();

    for (const b of batches) {
      if (!b || typeof b.batchNumber !== 'string') continue;
      const batchNum = b.batchNumber.trim();
      if (!batchNum) continue;

      const parsedExpiry = BandaGoNormalizer.safeParseDate(
        b.expiryDate,
        new Date(now + 365 * 24 * 60 * 60 * 1000)
      )!;
      const rawQty = b.qtyOnHand ?? b.quantityOnHand ?? 0;
      const qty = BandaGoNormalizer.parseInteger(rawQty);

      if (aggregated.has(batchNum)) {
        const existing = aggregated.get(batchNum)!;
        existing.qty += qty;
        if (parsedExpiry.getTime() < existing.earliestExpiry.getTime()) {
          existing.earliestExpiry = parsedExpiry;
        }
      } else {
        aggregated.set(batchNum, {
          ...b,
          batchNumber: batchNum,
          qty,
          earliestExpiry: parsedExpiry,
        });
      }
    }

    let validStock = 0;
    let nearestExpiryDate: Date | null = null;
    let hasNearExpiry = false;

    const processedBatches: Array<IngestedBatch & { isExpired: boolean; parsedExpiry: Date; quantityOnHand: number }> = [];

    for (const entry of aggregated.values()) {
      const isExpired = entry.earliestExpiry.getTime() <= now;

      if (!isExpired) {
        validStock += entry.qty;

        if (!nearestExpiryDate || entry.earliestExpiry.getTime() < nearestExpiryDate.getTime()) {
          nearestExpiryDate = entry.earliestExpiry;
        }

        if (entry.earliestExpiry.getTime() <= ninetyDaysThreshold) {
          hasNearExpiry = true;
        }
      }

      processedBatches.push({
        ...entry,
        batchNumber: entry.batchNumber,
        qtyOnHand: entry.qty,
        quantityOnHand: entry.qty,
        isExpired,
        parsedExpiry: entry.earliestExpiry,
        externalBatchId: entry.externalBatchId || null,
      });
    }

    return {
      batches: processedBatches,
      validStock,
      nearestExpiryDate,
      hasNearExpiry,
    };
  }

  /**
   * Computes available online stock enforcing safety buffers and virtual checkout locks:
   * Available = max(0, physicalStock - safetyBuffer - virtualReservedStock)
   */
  static calculateAvailableStock(
    physicalStock: number,
    safetyBuffer = 2,
    virtualReserved = 0
  ): number {
    return Math.max(0, physicalStock - safetyBuffer - virtualReserved);
  }

  /**
   * Normalizes Kenyan phone numbers to canonical E.164 format (+254...)
   */
  static normalizePhone(rawPhone?: string | null): string {
    return normalizeKenyaPhone(rawPhone);
  }
}

/**
 * Normalizes Kenyan phone numbers to canonical E.164 (+254XXXXXXXXX) format
 */
export function normalizeKenyaPhone(rawPhone?: string | null): string {
  if (!rawPhone) return '';
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('0') && digits.length === 10) {
    return `+254${digits.substring(1)}`;
  }
  if (digits.startsWith('254') && digits.length === 12) {
    return `+${digits}`;
  }
  if (digits.length === 9) {
    return `+254${digits}`;
  }
  return rawPhone.startsWith('+') ? `+${digits}` : `+${digits}`;
}

/**
 * Robust CSV parser that handles multiline quoted values, escaped quotes, commas, and UTF-8 BOM
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  const cleanText = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\r') {
        if (nextChar === '\n') i++; // CRLF
        currentRow.push(currentField.trim());
        if (currentRow.some((field) => field.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((field) => field.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((field) => field.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}
