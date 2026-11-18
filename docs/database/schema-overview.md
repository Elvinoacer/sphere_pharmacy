# Database Schema Overview

This document is the entry point to the Sphere Pharmacy PostgreSQL schema: how the application connects to the database, what the 39 Prisma models are and what each is for, and the design decisions an engineer or AI agent must know before touching `prisma/schema.prisma` or writing queries. Field-level detail lives in [data-dictionary.md](data-dictionary.md); relationships in [entity-relationship-diagram.md](entity-relationship-diagram.md); DDL history in [migrations.md](migrations.md); record lifetimes in [data-lifecycle.md](data-lifecycle.md).

| Audience | Status | Verified |
| --- | --- | --- |
| Engineers, AI coding agents | Implemented — verified against code | November 2026 |

## Provider and connection resolution

- **Provider:** `postgresql` (declared in `prisma/schema.prisma` `datasource db`).
- **Generator:** `prisma-client-js`. **Prisma version:** 6 (`prisma` / `@prisma/client` `^6.11.1`).
- **Status:** **Implemented**.

### Environment variable resolution order

`src/lib/db.ts` resolves the connection string from the **first** non-empty variable in this order:

1. `DATABASE_URL`
2. `sphere_pharmacy_PRISMA_DATABASE_URL`
3. `sphere_pharmacy_DATABASE_URL`
4. `sphere_pharmacy_POSTGRES_URL`

If none is set, module import throws: *"Database configuration missing. Set DATABASE_URL, sphere_pharmacy_PRISMA_DATABASE_URL, sphere_pharmacy_DATABASE_URL, or sphere_pharmacy_POSTGRES_URL."* The Prisma datasource block itself reads `env("DATABASE_URL")`; the runtime client overrides it via `datasourceUrl` with the resolved value.

### Neon pooler handling (`statement_cache_size=0`)

Neon pooled endpoints (hostname containing `-pooler.`) sit behind PgBouncer. Prisma's client-side prepared-statement cache can hold stale plans that survive a schema change and then fail with PostgreSQL error `0A000` ("cached plan must not change result type"). `databaseUrlForPrisma()` therefore appends `statement_cache_size=0` to any pooled URL — **unless** the parameter is already explicitly set, in which case the operator's value is left untouched. Malformed URLs are passed through unchanged so Prisma reports them with its normal error.

### Client singleton and the `productCategory` alias

- The `PrismaClient` instance is cached on `globalThis` (survives Next.js hot reload in dev), constructed with `log: ["warn", "error"]`.
- The module exports `db` and `prisma` — **the same instance** under two names.
- A `db.productCategory` getter aliases `db.category` "for blueprint compatibility" with the BandaGo/iDempiere integration blueprint's naming. Read it as `Category`; do not assume a second model exists.

## Model inventory — 39 models in 9 domains

### Identity / auth (5)

| Model | Purpose |
| --- | --- |
| `User` | Customer account: contact details, credentials, loyalty balances, POS (BandaGo C_BPartner) linkage. |
| `StaffUser` | Pharmacy staff account (ADMIN / PHARMACIST / STAFF / RIDER) with required password and `authVersion` session invalidation counter. |
| `Session` | Cookie session row for customers and staff (`token` unique, `role`, `expiresAt`, `lastSeenAt`, `authVersion`). |
| `OtpCode` | Phone login OTP — stored as `codeHash` only (plaintext `code` column was dropped in `20260903000000_security_hardening`). |
| `Address` | Customer saved delivery address with optional GPS coordinates and a default flag. |

### Products / inventory (4)

| Model | Purpose |
| --- | --- |
| `Category` | Product taxonomy (slug-keyed, sortable, deactivatable). |
| `Product` | Catalogue item: pricing, the stock field family, merchandising, prescription flag, POS linkage (`externalPosId`, `posSource`, `lastSyncedAt`). |
| `ProductBatch` | Per-lot stock from iDempiere (table `product_batches`): `batchNumber`, `quantityOnHand`, `expiryDate`, `isExpired` — drives FEFO sellable-stock computation. |
| `ProductAlert` | Customer "notify me when back in stock" subscription (unique per product + user). |

### Commerce (6)

| Model | Purpose |
| --- | --- |
| `Order` | Customer order header: guest fields, money totals, fulfillment, status, rider, points, reservation timestamps, optimistic-lock `version`. |
| `OrderItem` | Order line snapshot (`name`, `price`, `qty`, `lineTotal`) — `productId` nullable so deleted/custom items survive. |
| `OrderStatusHistory` | Append-only status audit per order (`status`, `note`, `actor` = SYSTEM / CUSTOMER / staff name). |
| `Payment` | Order payment attempt (M-Pesa / IntaSend / cash) with idempotency and provider references. |
| `ServicePayment` | Service-booking payment attempt — same provider/idempotency fields as `Payment`, minus `refundReference`/`cardLast4`. |
| `PaymentWebhookEvent` | Idempotency ledger of inbound provider webhooks for both payment tables (`eventId` unique, `payloadHash`). |

### Prescriptions (2)

| Model | Purpose |
| --- | --- |
| `Prescription` | Uploaded Rx: file metadata, private R2 `storageKey`, review outcome, refills, validity window, soft delete `deletedAt`. |
| `PrescriptionAccessLog` | Write-only compliance record of every VIEW/DOWNLOAD of a prescription (no API reads it back). |

### Promotions / loyalty (3)

| Model | Purpose |
| --- | --- |
| `Promotion` | Percentage-discount promo: `discountPct` (1–90), unique `code`, `isPublic` visibility, usage limits, `minimumSpend`. |
| `PromotionRedemption` | One row per redeemed order (`orderId` unique) with pseudonymous `ipHash`/`browserHash` for limit enforcement. |
| `LoyaltyLedger` | Append-only Sphere Points journal; `eventKey` unique for idempotent earn/redeem/reversal events. |

### Reviews (2)

| Model | Purpose |
| --- | --- |
| `Review` | Product rating (unique per product + user; `status` PUBLISHED/HIDDEN moderation). |
| `ServiceReview` | Service-booking rating (unique per booking + user; may credit the assigned staff member). |

### Services (5)

| Model | Purpose |
| --- | --- |
| `Service` | Bookable clinical service (slug, duration, price or `priceLabel`, featured/active flags). |
| `ServiceImage` | Ordered gallery image per service (managed URL or R2 `storageKey`). |
| `ServiceAvailability` | Weekly availability window (`dayOfWeek` 0–6, `HH:MM` start/end, `enabled`). |
| `ServiceBooking` | Customer booking (`reference` "SPB-"+12 hex, schedule, status, `paymentStatus`, assigned staff). |
| `ServiceBookingStatusHistory` | Append-only booking status audit (mirrors `OrderStatusHistory`). |

### Notifications (7)

| Model | Purpose |
| --- | --- |
| `Notification` | In-app inbox row for a user or staff member (`channel` always "IN_APP" in practice). |
| `NotificationPref` | Per-user channel opt-outs; only `email` and `push` influence delivery. |
| `PushToken` | Registered FCM device token bound to a user or staff member. |
| `NotificationDelivery` | Durable outbox for EMAIL/PUSH jobs: dedupe key, attempts, backoff scheduling, lease lock, provider result. |
| `ScheduledJobDelivery` | **Vestigial** — zero code references; the active queue is `NotificationDelivery`. |
| `EmailSuppression` | Addresses that bounced or complained; email dispatch skips them. |
| `EmailDeliveryEvent` | Resend/Svix delivery webhook events awaiting reconciliation. |

### Operations (5)

| Model | Purpose |
| --- | --- |
| `MedicineRequest` | Guest "find this medicine" request with optional private R2 photo. |
| `AuditLog` | Staff/system action audit (`actor`, `action`, `entity`, `entityId`, `details`). |
| `Setting` | Key/value app settings (JSON values for `pharmacy`/`delivery`/`compliance` keys). |
| `RateLimitBucket` | Fixed-window rate-limit counters (natural key). |
| `PosSyncLog` | BandaGo POS sync telemetry (table `pos_sync_logs`; uses the schema's only two Prisma enums). |

## Design decisions

### 1. Stock field authority

`Product` carries a family of overlapping stock fields. Their authority rules (enforced in `src/lib/inventory-guard.ts` and the order-creation SQL) are:

- **`stockQty` is the effective authority.** It counts sellable units; expired batch stock is excluded from it, which "enforces Kenya PPB regulatory rules so expired stock … can never contribute to online available stock."
- **`stock`** is the legacy/POS-facing counter. The primary order flow decrements **both** `stockQty` and `stock` (COALESCE, clamped) in one bulk `UPDATE`, then recomputes `inStock` and `stockStatus` from the post-decrement `stockQty` (`<= 0` → `OUT_OF_STOCK`; `<= lowStockThreshold` → `LOW_STOCK`; else `IN_STOCK`).
- **Available-to-promise formula** (`getAvailableStock`):

  ```
  max(0, min(stock, stockQty) − safetyStockBuffer − max(0, virtualReservedStock))
  ```

  with `safetyStockBuffer` defaulting to 2 when null, and a fallback of `stock ?? stockQty ?? 0` when neither counter is set. Reservation `WHERE` clauses use this same formula.
- **Physical deduct-and-restore, not virtual counters.** Reserving stock at checkout physically decrements `stockQty`/`stock`; cancellation or reservation expiry physically restores them and recomputes the status fields. `virtualReservedStock` remains in the formula for the legacy virtual path (`reserveStockForCheckout`/`releaseReservation`/`commitReservation`), of which only `getAvailableStock` and the 45-minute `cleanupExpiredReservations` are still invoked (the latter from the BandaGo sync).
- Raw SQL that touches these columns must quote the snake_case names `"virtual_reserved_stock"`, `"in_stock"` and the camelCase `"stockStatus"`, `"lowStockThreshold"` exactly as they appear in the database.

### 2. `loyaltyPoints` vs `loyaltyPointsBalance`

Two integer balance fields on `User`, deliberately not merged:

| Field | Meaning | Written by |
| --- | --- | --- |
| `loyaltyPoints` | Live web-app spendable balance (the loyalty engine in `src/lib/loyalty.ts`; surfaced as DTO `balance`). | Checkout redemption debit, payment-capture earn, refunds/expiry reversals. |
| `loyaltyPointsBalance` | BandaGo/iDempiere **POS-side** synced balance. | `BandaGoCrmReconciler` (increments both via `loyaltyDelta`). Not used by the app loyalty engine. |

Loyalty rules (constants `LOYALTY` in `src/lib/constants.ts`): earn 1 pt per KSh 100; 1 pt = KSh 1; minimum redemption 100 pts; redemption capped at 25% of the post-promo subtotal.

### 3. String statuses, canonical values in `src/lib/constants.ts`

Domain statuses are plain `String` columns — the schema defines **no** enums for them (the only Prisma enums are `PosSyncTrigger` and `PosSyncStatus` for POS sync). The canonical value sets live in `src/lib/constants.ts`. Write these exact strings — never new spellings.

**`Order.status`** (`ORDER_STATUSES`, 14 values):

| Value | Group |
| --- | --- |
| `RECEIVED` | ACTIVE |
| `UNDER_REVIEW` | ACTIVE |
| `PRESCRIPTION_VERIFIED` | ACTIVE |
| `AVAILABILITY_CONFIRMED` | ACTIVE |
| `AWAITING_PAYMENT` | ACTIVE |
| `PAID` | ACTIVE, DISPATCH |
| `PREPARING` | ACTIVE, DISPATCH |
| `READY_FOR_PICKUP` | ACTIVE, DISPATCH |
| `OUT_FOR_DELIVERY` | ACTIVE, DISPATCH, RIDER-SETTABLE |
| `COMPLETED_PICKUP` | TERMINAL |
| `COMPLETED_DELIVERY` | TERMINAL, RIDER-SETTABLE |
| `REJECTED` | TERMINAL |
| `CANCELLED` | TERMINAL |
| `REFUNDED` | TERMINAL |

ACTIVE = first 9; TERMINAL = last 5; DISPATCH = `PAID`/`PREPARING`/`READY_FOR_PICKUP`/`OUT_FOR_DELIVERY`; RIDER-SETTABLE = `OUT_FOR_DELIVERY`/`COMPLETED_DELIVERY`. Two **legacy** values are still queried: `'PENDING'` (by inventory-guard expiry cleanup) and `'DELIVERED'` (treated as completed by BandaGo CRM / chronic-refills).

**Other order enums:** `Order.type` = `OTC` | `PRESCRIPTION` | `MIXED` | `RESERVATION`. `Order.fulfillment` = `PICKUP` | `DELIVERY`.

**`Payment`** (and `ServicePayment`): `status` = `PENDING` | `PROCESSING` | `SUCCESS` | `FAILED` | `REFUND_PENDING` | `REFUNDED`; `provider` = `MPESA` | `INTASEND` | `CASH` for orders, plus `IN_STORE` on `ServicePayment` (pay-at-pharmacy intent); `method` = `STK_PUSH` | `CARD` | `PAYBILL` | `CASH_ON_PICKUP` | `CASH_ON_DELIVERY` (labels in `PAYMENT_METHOD_LABELS`), with `HOSTED_CHECKOUT` written by the IntaSend initiate routes and `PAY_AT_PHARMACY` by the service pay-at-pharmacy route.

**`Prescription.status`** (`RX_STATUSES`): `PENDING` | `APPROVED` | `REJECTED` | `CLARIFICATION_REQUESTED` | `PARTIALLY_APPROVED`.

**`Product.stockStatus`** (`STOCK_STATUSES`): `IN_STOCK` | `LOW_STOCK` | `OUT_OF_STOCK` | `DISCONTINUED`.

**`ServiceBooking.status`**: `PENDING` | `CONFIRMED` | `RESCHEDULED` | `ARRIVED` | `IN_PROGRESS` | `COMPLETED` | `CANCELLED` | `NO_SHOW` | `REJECTED`. **`paymentStatus`**: `UNPAID` | `PAID` | `PAY_AT_PHARMACY` (intent marker — no cash-settlement endpoint exists).

**`MedicineRequest.status`**: `NEW` | `CONTACTED` | `FULFILLED` | `UNAVAILABLE` (also a DB `CHECK` constraint from its migration).

**Channels:** `Notification.channel` is always `IN_APP` in practice; `NotificationDelivery.channel` is `EMAIL` or `PUSH`. The `NOTIFICATION_CHANNELS` constant additionally lists `SMS`/`WHATSAPP` (stored in prefs, never dispatched by the queue).

**`Review.status` / `ServiceReview.status`** (`REVIEW_STATUSES`): `PUBLISHED` | `HIDDEN`.

**Roles** (`ROLES`): `ADMIN` | `PHARMACIST` | `STAFF` | `RIDER`, plus the pseudo-role `CUSTOMER` used in `Session.role` and history `actor` fields.

**`NotificationDelivery.status`**: writer states `PENDING`/`SENT`/`FAILED` plus `PROCESSING`/`SKIPPED`/`DELIVERED`/`BOUNCED`/`COMPLAINED` set via dispatch/reconciliation. See [data-lifecycle.md](data-lifecycle.md#notifications).

### 4. Money is `Decimal`, serialized as `Number`

All monetary columns are `Decimal(12,2)` (`User.posCreditBalance` is `Decimal(10,2)`); currency is hardcoded KES. `src/lib/dto.ts` converts for the API boundary: `moneyNumber()` coerces Decimal → `Number`, nullable money → `null`, `DateTime` → ISO string, and statuses are cast without runtime validation. `ORDER_INCLUDE` is the shared order include; `attachRatings()` adds `avgRating`/`reviewCount` from `PUBLISHED` reviews; `toReviewDTO` masks the author as "First L."; `toPrescriptionDTO` hardcodes `fileUrl: null` and `storageKey: null` so storage keys never leave the server.

### 5. Orphan-preserving (non-cascade) relations

Cascade deletes are the norm for true children (`OrderItem`, `OrderStatusHistory`, `Payment`, `ProductBatch`, availability windows, etc.). These relations deliberately do **not** cascade, so historical records survive the loss of their parent:

- `Order.user` — deleting a user leaves orders (and their financial history) intact.
- `Order.prescriptions` — unlinking happens logically, not by deletion.
- `Product.category` — deleting a category nulls `Product.categoryId` (products survive).
- `Prescription.user` and `Prescription.order` — prescription rows survive user/order deletion.

### 6. Natural String keys (everything else is `cuid`)

All models default to `cuid` ids except these five natural-key tables:

| Model | Natural key |
| --- | --- |
| `Setting` | `key` |
| `RateLimitBucket` | `key` |
| `ScheduledJobDelivery` | `key` |
| `EmailSuppression` | `email` |
| `EmailDeliveryEvent` | `id` (Svix event id, **no default**) |

### 7. Column naming

`@@map` snake_case mapping is used heavily in the BandaGo POS block (`User` POS fields, `Product` stock fields, `ProductBatch` → table `product_batches`, `PosSyncLog` → table `pos_sync_logs`), while `Order` and most core tables keep camelCase columns. Raw SQL must respect each table's actual column casing (see the quoting note in design decision 1).

## Related documents

- [data-dictionary.md](data-dictionary.md) — every field of all 39 models.
- [entity-relationship-diagram.md](entity-relationship-diagram.md) — per-domain ER diagrams.
- [migrations.md](migrations.md) — the 10 migrations and how to apply them.
- [data-lifecycle.md](data-lifecycle.md) — creation → terminal state → retention per data class.
- [../api/api-reference.md](../api/api-reference.md) — endpoints that read/write these tables.
- [../operations/database-operations.md](../operations/database-operations.md) — operational runbooks.
- [../../README.md](../../README.md) — project root.
