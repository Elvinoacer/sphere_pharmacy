import { NextRequest, NextResponse } from 'next/server';
import { BandaGoNormalizer, parseCsv, type IngestedProductItem } from '@/lib/bandago-normalizer';
import { requireStaff } from '@/lib/session';
import { POST as handleSync } from '../sync/route';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.BANDAGO_SYNC_API_KEY;

    // Authenticate via Bearer token OR active staff session (for browser admin CSV uploads)
    const isBearerValid = Boolean(expectedSecret && authHeader === `Bearer ${expectedSecret}`);
    if (!isBearerValid) {
      const { session, error } = await requireStaff(['ADMIN', 'PHARMACIST']);
      if (error || !session) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid POS Sync Credentials or Staff Session' },
          { status: 401 }
        );
      }
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'CSV file must be provided as multipart/form-data' }, { status: 400 });
    }

    const text = await file.text();
    const rows = parseCsv(text);

    if (rows.length < 2) {
      return NextResponse.json({ error: 'CSV must contain headers and at least 1 record' }, { status: 400 });
    }

    const headers = rows[0].map((h) => h.replace(/["']/g, '').trim());
    const dataRows = rows.slice(1);

    const items: IngestedProductItem[] = [];
    for (const values of dataRows) {
      if (values.length === 0 || (values.length === 1 && !values[0])) continue;

      const recordLower: Record<string, string> = {};
      headers.forEach((h, idx) => {
        const val = values[idx] ?? '';
        recordLower[h.toLowerCase().replace(/[^a-z0-9]/g, '')] = val.trim();
      });

      const getCol = (...aliases: string[]): string => {
        for (const alias of aliases) {
          const key = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (recordLower[key] !== undefined && recordLower[key] !== '') {
            return recordLower[key];
          }
        }
        return '';
      };

      const externalPosId = getCol('externalPosId', 'uu', 'id', 'M_Product_UU', 'productId');
      const name = getCol('name', 'productName', 'itemName', 'description');
      const rawPrice = getCol('price', 'BH_SellPrice', 'sellPrice', 'unitPrice');
      const price = BandaGoNormalizer.parseNumber(rawPrice, 0);

      const rawCost = getCol('costPrice', 'BH_CostPrice', 'cost', 'purchasePrice');
      const costPrice = rawCost ? BandaGoNormalizer.parseNumber(rawCost) : null;

      const rawStock = getCol('stock', 'quantityOnHand', 'QtyOnHand', 'qtyOnHand', 'stockQty', 'qty');
      const stock = BandaGoNormalizer.parseInteger(rawStock, 0);

      const categoryRaw = getCol('categorySlug', 'category', 'categoryName', 'group');
      const categorySlug = BandaGoNormalizer.normalizeCategorySlug(categoryRaw);

      const rxRaw = getCol('requiresPrescription', 'rx', 'isPrescription', 'pom');
      const nearestExpiry = getCol('nearestExpiryDate', 'expiryDate', 'GuaranteeDate', 'guaranteeDate', 'expiry') || null;
      const batchNumber = getCol('batchNumber', 'batch', 'lot', 'lotNumber', 'bhLotNumber');
      const sku = getCol('sku', 'value', 'code', 'barcode') || null;
      const dosageForm = getCol('dosageForm', 'dosage', 'form') || undefined;
      const strength = getCol('strength', 'dose') || undefined;
      const rawImageUrl = getCol('imageUrl', 'image', 'photo');
      const imageUrl = rawImageUrl || undefined;
      const customSlug = getCol('slug', 'urlSlug');
      const slug = customSlug || BandaGoNormalizer.slugify(name);

      if (externalPosId && name && !isNaN(price)) {
        const requiresPrescription = BandaGoNormalizer.classifyRequiresPrescription(
          name,
          categorySlug,
          rxRaw
        );

        const batches = batchNumber
          ? [
              {
                batchNumber,
                qtyOnHand: stock,
                expiryDate: nearestExpiry,
              },
            ]
          : undefined;

        items.push({
          externalPosId,
          name,
          sku,
          slug,
          categorySlug,
          price,
          costPrice: costPrice && !isNaN(costPrice) ? costPrice : null,
          stock,
          requiresPrescription,
          imageUrl,
          nearestExpiryDate: nearestExpiry,
          dosageForm,
          strength,
          batches,
        });
      }
    }

    // Delegate into the main sync handler logic internally
    const effectiveSecret = expectedSecret || process.env.BANDAGO_SYNC_API_KEY || 'sphere_bandago_live_sync_secret_key_2026';
    const syncHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${effectiveSecret}`,
    };
    const incomingCookie = req.headers.get('cookie');
    if (incomingCookie) {
      syncHeaders['cookie'] = incomingCookie;
    }

    const syncReq = new NextRequest(new URL('/api/integrations/bandago/sync', req.url), {
      method: 'POST',
      headers: syncHeaders,
      body: JSON.stringify({
        trigger: 'CSV_IMPORT',
        items,
      }),
    });

    return await handleSync(syncReq);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to process CSV file', details: message }, { status: 500 });
  }
}
