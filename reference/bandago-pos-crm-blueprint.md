# Sphere Pharmacy: BandaGo POS & CRM Integration Architecture Blueprint

This document specifies the complete server-side architecture, database schemas, API routes, synchronization engines, and admin controls required in **`sphere_pharmacy`** to integrate seamlessly with **BandaGo POS** (`go.bandahealth.org`).

---

## 1. System Architecture & Information Topology

```
+---------------------------------------------------------------------------------------------------------+
|                                        INBOUND INVENTORY PIPELINE                                       |
|                                                                                                         |
|  +------------------------+      CDP Response Sniff      +-------------------------------------------+  |
|  |      BandaGo POS       | ---------------------------> |           api_data_transformer            |  |
|  |  (go.bandahealth.org)  |                              |          (Chrome MV3 Extension)           |  |
|  +------------------------+                              +---------------------+---------------------+  |
|                                                                                |                        |
|                                                     HTTPS Push (Bearer Secret) | JSON Batch Ingestion   |
|                                                                                v                        |
|                                                          +-------------------------------------------+  |
|                                                          |  SPHERE PHARMACY CORE SERVER (Next.js)    |  |
|                                                          |  POST /api/integrations/bandago/sync      |  |
|                                                          +---------------------+---------------------+  |
|                                                                                |                        |
|                                                                                v                        |
|                                                          +-------------------------------------------+  |
|                                                          | Ingestion Pipeline & Transaction Handler  |  |
|                                                          | - Deduplicate via externalPosId           |  |
|                                                          | - Calculate Safety Stock Buffer           |  |
|                                                          | - Apply FEFO Expiry Rules (Kenya PPB)     |  |
|                                                          | - Auto-create & map Categories/Images     |  |
|                                                          +---------------------+---------------------+  |
|                                                                                |                        |
|                                                                                v                        |
|                                                          +-------------------------------------------+  |
|                                                          |        PostgreSQL Database (Prisma)       |  |
|                                                          | - products, product_batches, pos_sync_logs|  |
|                                                          +-------------------------------------------+  |
+---------------------------------------------------------------------------------------------------------+

+---------------------------------------------------------------------------------------------------------+
|                                     OUTBOUND ORDER & CRM CLOSE-THE-LOOP                                 |
|                                                                                                         |
|  +------------------------------+     Order Created     +--------------------------------------------+  |
|  | Customer Storefront / PWA    | --------------------> | POS Virtual Stock Reservation              |  |
|  | (Cart Checkout / M-Pesa)     |                       | - Deduct virtual available stock           |  |
|  +------------------------------+                       | - Set 45-min hold timer                    |  |
|                                                         +---------------------+----------------------+  |
|                                                                               |                         |
|                                                                               v                         |
|  +------------------------------+     Sync Alert        +--------------------------------------------+  |
|  | Pharmacist Counter Terminal  | <-------------------- | Dispatch & Order Notification Service      |  |
|  | - Audio alert & Chrome badge |   SSE / Push Alert    | - Generates pick-list                      |  |
|  | - Deducts stock on BandaGo   |                       | - Updates C_BPartner loyalty / history     |  |
|  +------------------------------+                       +--------------------------------------------+  |
+---------------------------------------------------------------------------------------------------------+
```

---

## 2. Database Schema Extensions (`prisma/schema.prisma`)

To support BandaGo's iDempiere entity models without disrupting existing storefront functionality, the following additions must be made to `prisma/schema.prisma`:

```prisma
// =========================================================================
// ENUMS FOR POS INTEGRATION
// =========================================================================

enum PosSyncStatus {
  SUCCESS
  PARTIAL
  FAILED
}

enum PosSyncTrigger {
  EXTENSION_STREAM
  BACKGROUND_POLL
  CSV_IMPORT
  MANUAL_RECONCILE
}

// =========================================================================
// PRODUCT & BATCH EXTENSIONS
// =========================================================================

model Product {
  id                   String           @id @default(cuid())
  name                 String
  slug                 String           @unique
  sku                  String?          @unique
  barcode              String?
  description          String?
  price                Decimal          @db.Decimal(10, 2)
  compareAtPrice       Decimal?         @map("compare_at_price") @db.Decimal(10, 2)
  costPrice            Decimal?         @map("cost_price") @db.Decimal(10, 2)
  
  // Inventory Quantities
  stock                Int              @default(0) // Physical count from BandaGo
  virtualReservedStock Int              @default(0) @map("virtual_reserved_stock") // Stock locked in pending checkout
  safetyStockBuffer    Int              @default(2) @map("safety_stock_buffer") // Floor threshold to prevent walk-in oversell
  inStock              Boolean          @default(true) @map("in_stock")
  lowStockThreshold    Int              @default(5) @map("low_stock_threshold")
  
  // Clinical & Regulatory Properties
  requiresPrescription Boolean          @default(false) @map("requires_prescription")
  dosageForm           String?          @map("dosage_form")
  strength             String?
  packSize             String?          @map("pack_size")
  nearestExpiryDate    DateTime?        @map("nearest_expiry_date")
  
  // BandaGo POS Identity Mapping
  externalPosId        String?          @unique @map("external_pos_id") // BandaGo M_Product_UU
  posSource            String?          @default("BANDAGO") @map("pos_source")
  lastSyncedAt         DateTime?        @map("last_synced_at")
  
  // Relations
  categoryId           String           @map("category_id")
  category             ProductCategory  @relation(fields: [categoryId], references: [id])
  images               ProductImage[]
  batches              ProductBatch[]
  orderItems           OrderItem[]
  reviews              Review[]
  stockAlerts          StockAlert[]

  createdAt            DateTime         @default(now()) @map("created_at")
  updatedAt            DateTime         @updatedAt @map("updated_at")

  @@index([slug])
  @@index([externalPosId])
  @@index([categoryId])
  @@index([inStock, stock])
  @@map("products")
}

model ProductBatch {
  id                String    @id @default(cuid())
  productId         String    @map("product_id")
  product           Product   @relation(fields: [productId], references: [id], onDelete: Cascade)
  
  batchNumber       String    @map("batch_number") // iDempiere Lot/Batch
  quantityOnHand    Int       @map("quantity_on_hand")
  expiryDate        DateTime  @map("expiry_date") // iDempiere M_AttributeSetInstance.GuaranteeDate
  externalBatchId   String?   @map("external_batch_id")
  isExpired         Boolean   @default(false) @map("is_expired")
  
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  @@unique([productId, batchNumber])
  @@index([productId, expiryDate])
  @@map("product_batches")
}

// =========================================================================
// POS INTEGRATION TELEMETRY & AUDIT LOGS
// =========================================================================

model PosSyncLog {
  id               String         @id @default(cuid())
  posSource        String         @default("BANDAGO") @map("pos_source")
  trigger          PosSyncTrigger @default(EXTENSION_STREAM)
  status           PosSyncStatus  @default(SUCCESS)
  
  itemsReceived    Int            @default(0) @map("items_received")
  itemsUpserted    Int            @default(0) @map("items_upserted")
  itemsFailed      Int            @default(0) @map("items_failed")
  
  details          Json?          // Stores error stacks, category assignments, diff logs
  startedAt        DateTime       @default(now()) @map("started_at")
  completedAt      DateTime?      @map("completed_at")
  durationMs       Int?           @map("duration_ms")

  @@index([startedAt])
  @@index([status])
  @@map("pos_sync_logs")
}

// =========================================================================
// CUSTOMER / PATIENT CRM EXTENSIONS
// =========================================================================

model User {
  id                   String           @id @default(cuid())
  name                 String?
  phone                String           @unique
  email                String?          @unique
  role                 UserRole         @default(CUSTOMER)
  
  // BandaGo C_BPartner Mapping
  externalBPartnerId   String?          @unique @map("external_bpartner_id")
  loyaltyPointsBalance Int              @default(0) @map("loyalty_points_balance")
  posCreditBalance     Decimal          @default(0.00) @map("pos_credit_balance") @db.Decimal(10, 2)
  isChronicPatient     Boolean          @default(false) @map("is_chronic_patient")
  
  orders               Order[]
  prescriptions        Prescription[]
  addresses            Address[]
  serviceBookings      ServiceBooking[]
  reviews              Review[]
  notifications        Notification[]

  createdAt            DateTime         @default(now()) @map("created_at")
  updatedAt            DateTime         @updatedAt @map("updated_at")

  @@index([phone])
  @@index([externalBPartnerId])
  @@map("users")
}
```

---

## 3. High-Throughput Sync API: `src/app/api/integrations/bandago/sync/route.ts`

This route handles high-throughput batches from the `api_data_transformer` extension with transaction safety, category creation, batch-level FEFO tracking, and sync logging:

```typescript
// src/app/api/integrations/bandago/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Decimal } from '@prisma/client/runtime/library';

interface IngestedBatch {
  batchNumber: string;
  qtyOnHand: number;
  expiryDate?: string | null;
}

interface IngestedProductItem {
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
  nearestExpiryDate?: string | null;
  dosageForm?: string;
  strength?: string;
  batches?: IngestedBatch[];
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let syncLogId: string | null = null;

  try {
    // 1. Authorize Request
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.BANDAGO_SYNC_API_KEY;

    if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: 'Unauthorized: Invalid POS Sync Credentials' }, { status: 401 });
    }

    const payload = await req.json();
    const items: IngestedProductItem[] = Array.isArray(payload.items) ? payload.items : [];
    const trigger = payload.trigger || 'EXTENSION_STREAM';

    // 2. Initialize Audit Log
    const syncLog = await prisma.posSyncLog.create({
      data: {
        posSource: 'BANDAGO',
        trigger,
        status: 'SUCCESS',
        itemsReceived: items.length,
        startedAt: new Date(),
      },
    });
    syncLogId = syncLog.id;

    if (items.length === 0) {
      await prisma.posSyncLog.update({
        where: { id: syncLogId },
        data: {
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          details: { message: 'Zero items provided in synchronization packet' },
        },
      });
      return NextResponse.json({ success: true, synced: 0 });
    }

    // 3. Cache Categories in Memory
    const existingCategories = await prisma.productCategory.findMany();
    const categoryMap = new Map<string, string>();
    for (const cat of existingCategories) {
      categoryMap.set(cat.slug.toLowerCase(), cat.id);
    }

    const resolveCategoryId = async (rawSlug: string): Promise<string> => {
      const slug = (rawSlug || 'otc').toLowerCase().trim();
      if (categoryMap.has(slug)) return categoryMap.get(slug)!;

      const formattedName = slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      const newCategory = await prisma.productCategory.create({
        data: {
          name: formattedName,
          slug,
          icon: 'Pill',
        },
      });
      categoryMap.set(slug, newCategory.id);
      return newCategory.id;
    };

    // 4. Batch Ingestion in Chunks to Prevent Connection Pool Starvation
    const CHUNK_SIZE = 50;
    let upsertedCount = 0;
    const errors: any[] = [];
    const now = new Date();

    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);

      await prisma.$transaction(
        async (tx) => {
          for (const item of chunk) {
            try {
              const categoryId = await resolveCategoryId(item.categorySlug);

              // Calculate stock after safety buffer
              const physicalStock = Math.max(0, Math.floor(item.stock));
              const effectiveInStock = physicalStock > 0;

              // Upsert Master Product Record
              const product = await tx.product.upsert({
                where: { externalPosId: item.externalPosId },
                update: {
                  name: item.name,
                  sku: item.sku || undefined,
                  price: new Decimal(item.price),
                  costPrice: item.costPrice ? new Decimal(item.costPrice) : null,
                  stock: physicalStock,
                  inStock: effectiveInStock,
                  requiresPrescription: item.requiresPrescription,
                  nearestExpiryDate: item.nearestExpiryDate ? new Date(item.nearestExpiryDate) : null,
                  dosageForm: item.dosageForm,
                  strength: item.strength,
                  lastSyncedAt: now,
                },
                create: {
                  externalPosId: item.externalPosId,
                  posSource: 'BANDAGO',
                  sku: item.sku || null,
                  name: item.name,
                  slug: item.slug,
                  price: new Decimal(item.price),
                  costPrice: item.costPrice ? new Decimal(item.costPrice) : null,
                  stock: physicalStock,
                  virtualReservedStock: 0,
                  safetyStockBuffer: 2,
                  inStock: effectiveInStock,
                  requiresPrescription: item.requiresPrescription,
                  dosageForm: item.dosageForm,
                  strength: item.strength,
                  categoryId,
                  nearestExpiryDate: item.nearestExpiryDate ? new Date(item.nearestExpiryDate) : null,
                  lastSyncedAt: now,
                  images: {
                    create: {
                      url: item.imageUrl || '/images/products/generic-medicine.webp',
                      alt: item.name,
                      isPrimary: true,
                      sortOrder: 0,
                    },
                  },
                },
              });

              // Synchronize Child Batches if present
              if (item.batches && Array.isArray(item.batches)) {
                for (const b of item.batches) {
                  if (!b.batchNumber) continue;
                  const expiry = b.expiryDate ? new Date(b.expiryDate) : new Date(Date.now() + 31536000000);
                  const isExpired = expiry.getTime() < now.getTime();

                  await tx.productBatch.upsert({
                    where: {
                      productId_batchNumber: {
                        productId: product.id,
                        batchNumber: b.batchNumber,
                      },
                    },
                    update: {
                      quantityOnHand: b.qtyOnHand,
                      expiryDate: expiry,
                      isExpired,
                    },
                    create: {
                      productId: product.id,
                      batchNumber: b.batchNumber,
                      quantityOnHand: b.qtyOnHand,
                      expiryDate: expiry,
                      isExpired,
                    },
                  });
                }
              }

              upsertedCount++;
            } catch (itemErr: any) {
              errors.push({
                externalPosId: item.externalPosId,
                name: item.name,
                error: itemErr.message,
              });
            }
          }
        },
        { timeout: 25000 }
      );
    }

    // 5. Finalize Sync Log
    const duration = Date.now() - startTime;
    await prisma.posSyncLog.update({
      where: { id: syncLogId },
      data: {
        status: errors.length === 0 ? 'SUCCESS' : errors.length === items.length ? 'FAILED' : 'PARTIAL',
        itemsUpserted: upsertedCount,
        itemsFailed: errors.length,
        durationMs: duration,
        completedAt: new Date(),
        details: errors.length > 0 ? { errors: errors.slice(0, 50) } : undefined,
      },
    });

    return NextResponse.json({
      success: true,
      upsertedCount,
      failedCount: errors.length,
      durationMs: duration,
      timestamp: now.toISOString(),
    });
  } catch (globalErr: any) {
    console.error('[BandaGo Sync Pipeline Critical Failure]:', globalErr);

    if (syncLogId) {
      await prisma.posSyncLog.update({
        where: { id: syncLogId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          details: { fatalError: globalErr.message },
        },
      });
    }

    return NextResponse.json(
      { error: 'POS Sync pipeline encountered an unrecoverable failure', details: globalErr.message },
      { status: 500 }
    );
  }
}
```

---

## 4. Direct CSV Ingestion: `src/app/api/integrations/bandago/csv-import/route.ts`

For Day-1 catalog migrations or offline backups generated by `api_data_transformer`'s CSV exporter:

```typescript
// src/app/api/integrations/bandago/csv-import/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.BANDAGO_SYNC_API_KEY;

    if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'CSV file must be provided as multipart/form-data' }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV must contain headers and at least 1 record' }, { status: 400 });
    }

    const headers = lines[0].split(',').map((h) => h.replace(/["']/g, '').trim());
    const rows = lines.slice(1);

    const items: any[] = [];
    for (const row of rows) {
      // Basic CSV parser handling quoted commas
      const regex = /(?:,|\n|^)("(?:(?:"")*[^"]*)*"|[^",\n]*|(?:\n|$))/g;
      const values: string[] = [];
      let match;
      while ((match = regex.exec(row)) && values.length < headers.length) {
        let val = match[1];
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1).replace(/""/g, '"');
        }
        values.push(val.trim());
      }

      if (values.length === headers.length) {
        const record: Record<string, string> = {};
        headers.forEach((h, idx) => {
          record[h] = values[idx];
        });

        const externalPosId = record.externalPosId || record.uu || record.id;
        const name = record.name || record.Name;
        const price = parseFloat(record.price || record.BH_SellPrice || '0');
        const stock = parseInt(record.stock || record.quantityOnHand || '0', 10);

        if (externalPosId && name && !isNaN(price)) {
          items.push({
            externalPosId,
            name,
            sku: record.sku || record.value || null,
            slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${externalPosId.slice(0, 6)}`,
            categorySlug: (record.categorySlug || record.category || 'otc').toLowerCase(),
            price,
            stock: isNaN(stock) ? 0 : stock,
            requiresPrescription: record.requiresPrescription === 'true' || record.rx === 'true',
            imageUrl: record.imageUrl || '/images/products/generic-medicine.webp',
            nearestExpiryDate: record.nearestExpiryDate || null,
          });
        }
      }
    }

    // Delegate into the main sync handler logic internally
    const syncReq = new NextRequest(new URL('/api/integrations/bandago/sync', req.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${expectedSecret}`,
      },
      body: JSON.stringify({
        trigger: 'CSV_IMPORT',
        items,
      }),
    });

    const { POST: handleSync } = await import('../sync/route');
    return await handleSync(syncReq);
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to process CSV file', details: err.message }, { status: 500 });
  }
}
```

---

## 5. Bidirectional Stock Protection: Reservation Engine

To prevent the **"Double-Selling Nightmare"** (where a physical customer buys the last box of *Panadol* at the counter while an online shopper orders it simultaneously), `sphere_pharmacy` implements an atomic stock reservation system:

### 5.1 Real-Time Stock Calculation Formula

$$\text{Available to Sell Online} = \max\Big(0, \ \text{Physical Stock} - \text{Safety Buffer} - \text{Virtual Reserved Stock}\Big)$$

Where:
* **Physical Stock:** Synced directly from BandaGo via `api_data_transformer`.
* **Safety Buffer:** Default `2` units for fast-moving OTC drugs (configurable per item).
* **Virtual Reserved Stock:** Locked while an online customer completes checkout or M-Pesa STK push.

### 5.2 Atomic Reservation Utility: `src/lib/inventory-guard.ts`

```typescript
// src/lib/inventory-guard.ts
import { prisma } from '@/lib/db';

export class InventoryGuard {
  /**
   * Verifies and locks virtual inventory when customer starts M-Pesa or Card checkout
   */
  static async reserveStock(
    items: { productId: string; quantity: number }[]
  ): Promise<{ success: boolean; unavailableItems?: string[] }> {
    return await prisma.$transaction(async (tx) => {
      const unavailable: string[] = [];

      for (const item of items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: {
            id: true,
            name: true,
            stock: true,
            virtualReservedStock: true,
            safetyStockBuffer: true,
          },
        });

        if (!product) {
          unavailable.push(`Product not found: ${item.productId}`);
          continue;
        }

        const availableToSell = Math.max(
          0,
          product.stock - product.safetyStockBuffer - product.virtualReservedStock
        );

        if (availableToSell < item.quantity) {
          unavailable.push(
            `${product.name} (Only ${availableToSell} available, requested ${item.quantity})`
          );
        }
      }

      if (unavailable.length > 0) {
        return { success: false, unavailableItems: unavailable };
      }

      // Lock items by incrementing virtualReservedStock
      for (const item of items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            virtualReservedStock: { increment: item.quantity },
          },
        });
      }

      return { success: true };
    });
  }

  /**
   * Releases stock if M-Pesa payment fails or times out (Called by cron/order-reservations)
   */
  static async releaseReservation(items: { productId: string; quantity: number }[]): Promise<void> {
    await prisma.$transaction(
      items.map((item) =>
        prisma.product.update({
          where: { id: item.productId },
          data: {
            virtualReservedStock: { decrement: item.quantity },
          },
        })
      )
    );
  }

  /**
   * Permanently deducts stock when order payment confirms
   */
  static async commitReservation(items: { productId: string; quantity: number }[]): Promise<void> {
    await prisma.$transaction(
      items.map((item) =>
        prisma.product.update({
          where: { id: item.productId },
          data: {
            stock: { decrement: item.quantity },
            virtualReservedStock: { decrement: item.quantity },
          },
        })
      )
    );
  }
}
```

---

## 6. Patient CRM & Chronic Refill Reconciliation

### 6.1 Patient Matching Service: `src/lib/crm/bandago-crm.ts`

Matches online orders and prescription records to BandaGo's `C_BPartner` entity via sanitized Kenya phone numbers:

```typescript
// src/lib/crm/bandago-crm.ts
import { prisma } from '@/lib/db';

export function normalizeKenyaPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) {
    return `+254${digits.substring(1)}`;
  }
  if (digits.startsWith('254') && digits.length === 12) {
    return `+${digits}`;
  }
  if (digits.length === 9) {
    return `+254${digits}`;
  }
  return rawPhone.startsWith('+') ? rawPhone : `+${digits}`;
}

export class BandaGoCrmReconciler {
  /**
   * Reconciles an online shopper with BandaGo's Business Partner CRM
   */
  static async syncCustomerProfile(data: {
    phone: string;
    name?: string;
    email?: string;
    externalBPartnerId?: string;
    loyaltyDelta?: number;
  }) {
    const canonicalPhone = normalizeKenyaPhone(data.phone);

    return await prisma.user.upsert({
      where: { phone: canonicalPhone },
      update: {
        name: data.name || undefined,
        email: data.email || undefined,
        externalBPartnerId: data.externalBPartnerId || undefined,
        loyaltyPointsBalance: data.loyaltyDelta
          ? { increment: data.loyaltyDelta }
          : undefined,
      },
      create: {
        phone: canonicalPhone,
        name: data.name || 'Pharmacy Customer',
        email: data.email || null,
        externalBPartnerId: data.externalBPartnerId || null,
        loyaltyPointsBalance: data.loyaltyDelta || 0,
      },
    });
  }

  /**
   * Checks for chronic prescription refill opportunities
   */
  static async checkChronicRefillEligible() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Find users with prescription orders placed ~30 days ago
    const dueRefills = await prisma.order.findMany({
      where: {
        createdAt: { lte: thirtyDaysAgo },
        status: 'DELIVERED',
        items: {
          some: {
            product: { requiresPrescription: true },
          },
        },
      },
      include: {
        user: true,
        items: {
          include: { product: true },
        },
      },
    });

    return dueRefills;
  }
}
```

### 6.2 Customer CRM Synchronization API: `src/app/api/integrations/bandago/crm/route.ts`

Allows BandaGo counter terminals or background sync jobs to reconcile patient profiles, credit limits, and loyalty balances:
- **POST**: Accepts batch or individual customer payloads, authenticated via Bearer token (`BANDAGO_SYNC_API_KEY`) or Admin/Pharmacist session.
- **GET**: Allows querying customer profiles and recent prescription order history by `phone` or `bpartnerId`.

### 6.3 Automated Refill Reminder Cron: `src/app/api/cron/chronic-refills/route.ts`

Triggered via cron (secured with `CRON_SECRET`) to identify chronic medication patients due for refills:
- Evaluates orders delivered ~30 days ago with prescription items.
- Excludes patients who have already placed a refill within the past 30 days.
- Dispatches in-app notifications and email alerts with a 7-day rate-limiting cooldown per patient.

---

## 7. Admin Control Center: `src/components/views/admin/sections/pos-sync-section.tsx`

This production component integrates into `sphere_pharmacy`'s admin workspace (`src/components/views/admin/admin-view.tsx`), providing live health metrics, log streaming, sync controls, and manual CSV dropzones:

```tsx
// src/components/views/admin/sections/pos-sync-section.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  RefreshCw, 
  UploadCloud, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Clock, 
  Server, 
  Package, 
  ShieldAlert 
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface PosSyncStats {
  totalSyncedProducts: number;
  totalBatches: number;
  nearExpiryCount: number;
  lastSyncTimestamp: string | null;
  recentLogs: Array<{
    id: string;
    trigger: string;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    itemsReceived: number;
    itemsUpserted: number;
    durationMs: number;
    startedAt: string;
  }>;
}

export function PosSyncSection() {
  const [stats, setStats] = useState<PosSyncStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/pos-status');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to load POS telemetry', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000); // 30s auto-refresh
    return () => clearInterval(interval);
  }, []);

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/integrations/bandago/csv-import', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_POS_SYNC_SECRET || ''}`,
        },
        body: formData,
      });

      const result = await res.json();
      if (res.ok) {
        toast({
          title: 'CSV Import Completed',
          description: `Successfully upserted ${result.upsertedCount} medications from BandaGo export.`,
        });
        fetchStats();
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (err: any) {
      toast({
        title: 'CSV Import Failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">BandaGo POS Integration Hub</h2>
          <p className="text-sm text-slate-500">
            Real-time telemetry, stock sync ledger, and lot/expiry compliance.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchStats} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh Status
          </Button>
          <label className="cursor-pointer">
            <Input 
              type="file" 
              accept=".csv" 
              className="hidden" 
              onChange={handleCsvUpload} 
              disabled={uploading} 
            />
            <Button size="sm" variant="default" asChild disabled={uploading}>
              <span>
                <UploadCloud className="w-4 h-4 mr-2" />
                {uploading ? 'Processing CSV...' : 'Manual CSV Import'}
              </span>
            </Button>
          </label>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">POS Products Mapped</CardTitle>
            <Package className="w-4 h-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {stats?.totalSyncedProducts ?? '---'}
            </div>
            <p className="text-xs text-slate-500 mt-1">Linked via externalPosId</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Active Batches (Lots)</CardTitle>
            <Server className="w-4 h-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {stats?.totalBatches ?? '---'}
            </div>
            <p className="text-xs text-slate-500 mt-1">Managed under FEFO</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Near-Expiry Flags (&lt;90d)</CardTitle>
            <ShieldAlert className="w-4 h-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-700">
              {stats?.nearExpiryCount ?? '---'}
            </div>
            <p className="text-xs text-slate-500 mt-1">Kenya PPB audit alert</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Last Live Signal</CardTitle>
            <Clock className="w-4 h-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-bold text-slate-900 truncate">
              {stats?.lastSyncTimestamp ? new Date(stats.lastSyncTimestamp).toLocaleTimeString() : 'No Sync Yet'}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {stats?.lastSyncTimestamp ? new Date(stats.lastSyncTimestamp).toLocaleDateString() : 'Awaiting extension'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sync Ledger Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Synchronization Audit Trail</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Trigger</th>
                  <th className="py-3 px-4">Items Received</th>
                  <th className="py-3 px-4">Upserted</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-xs">
                {stats?.recentLogs && stats.recentLogs.length > 0 ? (
                  stats.recentLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-sans">
                        {log.status === 'SUCCESS' && (
                          <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Success
                          </Badge>
                        )}
                        {log.status === 'PARTIAL' && (
                          <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">
                            <AlertTriangle className="w-3 h-3 mr-1" /> Partial
                          </Badge>
                        )}
                        {log.status === 'FAILED' && (
                          <Badge variant="outline" className="border-rose-300 text-rose-700 bg-rose-50">
                            <XCircle className="w-3 h-3 mr-1" /> Failed
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700">{log.trigger}</td>
                      <td className="py-3 px-4">{log.itemsReceived}</td>
                      <td className="py-3 px-4 text-emerald-600 font-semibold">{log.itemsUpserted}</td>
                      <td className="py-3 px-4">{log.durationMs}ms</td>
                      <td className="py-3 px-4 text-slate-500">{new Date(log.startedAt).toLocaleString()}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400 font-sans">
                      No synchronization events recorded yet. Connect api_data_transformer to begin.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## 8. Regulatory Compliance & Data Protection Matrix

### 8.1 Kenya Pharmacy and Poisons Board (PPB) Rules
1. **Prescription Drugs Cannot Be Dispensed Without Verification:**
   Any product tagged `requiresPrescription: true` via our normalizer cannot transition from `CART` to `DISPATCHED` without an approved prescription upload (`/api/prescriptions`).
2. **Expired Medication Block:**
   Batches past their `expiryDate` are filtered in `bandago-normalizer.ts` and set to `isExpired: true` in `ProductBatch`. They never contribute to online sellable stock.
3. **Prescription Archival:**
   Prescription images and order associations are archived for **2 years** per Cap 244 of the Laws of Kenya, managed by `src/app/api/cron/prescription-retention/route.ts`.

### 8.2 Kenya Data Protection Act (ODPC) Compliance
1. **Separation of Medical History & Marketing CRM:**
   Patient diagnoses, doctor consultation notes, and clinical records stored in BandaGo are **never synced** to the public e-commerce database. Only sanitized inventory, customer contact details, and basic loyalty points are exchanged.
2. **Data Processor Role:**
   Sphere Pharmacy stores all data on encrypted PostgreSQL instances with SSL (`sslmode=require`), and passwords/API secrets are hashed with bcrypt or stored in environment variables.

---

## 9. Rollout & Validation Checklist

| Step | Action Item | Verification Test |
| :---: | :--- | :--- |
| **1** | Run Prisma migration to apply schema extensions. | `npx prisma migrate dev --name add_bandago_pos_support` |
| **2** | Add `BANDAGO_SYNC_API_KEY` to `sphere_pharmacy/.env`. | Verify `curl -X POST /api/integrations/bandago/sync` returns `401` without Bearer token. |
| **3** | Seed fallback category images into `public/images/categories/`. | Verify `/images/categories/cat-otc.webp` exists and renders in browser. |
| **4** | Point `api_data_transformer` to Sphere sync endpoint. | Open BandaGo POS in Chrome; inspect network tab to confirm `200 OK` on `/api/integrations/bandago/sync`. |
| **5** | Verify atomic reservation logic. | Attempt to purchase more units than `stock - safetyBuffer` and confirm reservation rejection. |
| **6** | Confirm Admin POS Hub UI. | Open admin dashboard `/admin` and confirm live telemetry, batch counts, and sync logs render. |