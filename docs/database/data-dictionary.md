# Database Data Dictionary

This document enumerates every field of all 39 Prisma models, organized into the 9 domains used across the database documentation set. For each model it lists fields with type, constraints/defaults, and meaning, followed by relations and notable indexes/uniques. Status fields list their allowed values (canonical sets defined in `src/lib/constants.ts`, not in the schema). See [schema-overview.md](schema-overview.md) for connection handling and design rationale, and [entity-relationship-diagram.md](entity-relationship-diagram.md) for visual relationships.

| Audience | Status | Verified |
| --- | --- | --- |
| Engineers, AI coding agents | Implemented — verified against code | November 2026 |

Conventions: `?` = nullable. Money is `Decimal(12,2)` unless noted. `cuid` ids are omitted from relation tables but listed as fields. Column maps (`@map`) are noted where the DB column name differs from the field name.

---

## 1. Identity / auth

### `User`

Customer account row. One row per customer identity (phone or email based).

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `name` | String? | — | Display name. |
| `phone` | String? | `@unique` | Phone in `+254…` form; OTP login identity. |
| `email` | String? | `@unique` | Email login identity. |
| `passwordHash` | String? | — | scrypt hash; null for OTP-only accounts. |
| `phoneVerifiedAt` | DateTime? | — | Set on first OTP verification. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-updated. |
| `loyaltyPoints` | Int | `@default(0)` | Live web-app spendable Sphere Points balance (loyalty engine). |
| `externalBPartnerId` | String? | `@unique @map("external_bpartner_id")` | BandaGo/iDempiere C_BPartner mapping key. |
| `loyaltyPointsBalance` | Int | `@default(0) @map("loyalty_points_balance")` | POS-side synced balance (BandaGoCrmReconciler); not used by the app engine. |
| `posCreditBalance` | Decimal(10,2) | `@default(0.00) @map("pos_credit_balance")` | POS credit balance (BandaGo). |
| `isChronicPatient` | Boolean | `@default(false) @map("is_chronic_patient")` | Chronic-care flag (BandaGo block). |
| `avatar` | String? | — | Avatar image reference. |

**Relations:** `addresses` (1:N `Address`), `notificationPref` (1:1 `NotificationPref`), `orders` (1:N `Order`, no cascade), `prescriptions` (1:N `Prescription`, no cascade), `stockAlerts` (1:N `ProductAlert`), `pushTokens` (1:N `PushToken`), `reviews` (1:N `Review`), `serviceBookings` (1:N `ServiceBooking`), `serviceReviews` (1:N `ServiceReview`), `sessions` (1:N `Session`), `loyaltyEntries` (1:N `LoyaltyLedger`).

**Indexes:** `@@index([externalBPartnerId])` (backs the POS lookup in addition to the unique).

### `StaffUser`

Pharmacy staff account. `role` values: `ADMIN` | `PHARMACIST` | `STAFF` | `RIDER`.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `name` | String | — | Staff display name. |
| `email` | String | `@unique` | Login identity. |
| `phone` | String? | — | Contact phone. |
| `passwordHash` | String | required | scrypt hash (always present for staff). |
| `role` | String | — | `ADMIN` / `PHARMACIST` / `STAFF` / `RIDER`. |
| `title` | String? | — | Job title. |
| `active` | Boolean | `@default(true)` | Disabled accounts cannot sign in; sessions die. |
| `authVersion` | Int | `@default(0)` | Bumped to invalidate existing sessions. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `avatar` | String? | — | Avatar image reference. |

**Relations:** `notifications` (1:N `Notification`), `prescriptions` (1:N `Prescription`, named `"RxReviewer"`), `pushTokens` (1:N `PushToken`), `assignedBookings` (1:N `ServiceBooking`, named `"ServiceAssignedStaff"`), `serviceReviews` (1:N `ServiceReview`), `sessions` (1:N `Session`).

**Indexes/uniques:** `email` unique.

### `Session`

Cookie session for customers and staff. Either `userId` or `staffId` is set — never both.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `token` | String | `@unique` | Opaque session token (cookie `sphere_session`). |
| `userId` | String? | FK → `User` | Customer owner (cascade delete). |
| `staffId` | String? | FK → `StaffUser` | Staff owner (cascade delete). |
| `role` | String | — | `CUSTOMER` or staff role snapshot. |
| `expiresAt` | DateTime | — | 30 days (customer) / 7 days (staff) after creation. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `lastSeenAt` | DateTime | `@default(now())` | Throttled activity heartbeat; staff idle > 12h invalidates. |
| `authVersion` | Int | `@default(0)` | Snapshot of owner's authVersion at issue; mismatch invalidates. |

**Relations:** `staff`, `user` (both cascade).

**Indexes:** `@@index([userId, expiresAt])`, `@@index([staffId, expiresAt])`.

### `OtpCode`

Phone login one-time code. Only the hash is stored.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `phone` | String | — | Phone the code was sent to (`+254…`). |
| `codeHash` | String | required | Hash of the 6-digit code (plaintext `code` column dropped by security hardening migration). |
| `expiresAt` | DateTime | — | 5 minutes after issue. |
| `used` | Boolean | `@default(false)` | Consumed flag; new request marks prior unused codes `used`. |
| `attempts` | Int | `@default(0)` | Failed verify attempts; ≥5 blocks the code. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |

**Indexes:** `@@index([phone, used, expiresAt, createdAt])` — exactly the verify lookup.

### `Address`

Saved delivery address.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `userId` | String | FK → `User`, cascade | Owner. |
| `label` | String | — | Short label ("Home", "Work"). |
| `text` | String | — | Full address text. |
| `area` | String | — | Delivery zone/area name. |
| `notes` | String? | — | Delivery instructions. |
| `isDefault` | Boolean | `@default(false)` | Default address flag (partial unique index enforces one default per user — see migrations). |
| `latitude` | Float? | — | GPS latitude. |
| `longitude` | Float? | — | GPS longitude. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |

**Relations:** `user` (cascade).

**Indexes:** `@@index([userId, isDefault])`; DB partial unique `Address_one_default_per_user ON ("userId") WHERE "isDefault" = true` (from `20260903000000_security_hardening`).

---

## 2. Products / inventory

### `Category`

Product taxonomy node.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `name` | String | — | Display name. |
| `slug` | String | `@unique` | URL key. |
| `description` | String? | — | Long description. |
| `icon` | String? | — | Icon reference. |
| `sortOrder` | Int | `@default(0)` | Display order. |
| `active` | Boolean | `@default(true)` | Soft visibility toggle. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |

**Relations:** `products` (1:N `Product`).

### `Product`

Catalogue item. The stock field family's authority rules are documented in [schema-overview.md](schema-overview.md#1-stock-field-authority).

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `name` | String | — | Display name. |
| `slug` | String? | `@unique` | URL key (added with BandaGo POS support). |
| `sku` | String | `@unique` | Internal SKU. |
| `barcode` | String? | — | Retail barcode. |
| `categoryId` | String? | FK → `Category` (no cascade; nulls on category delete) | Taxonomy assignment. |
| `brand` | String? | — | Brand name. |
| `packSize` | String? | — | Pack size description. |
| `price` | Decimal(12,2) | required | Selling price (KES). |
| `compareAtPrice` | Decimal(12,2)? | — | Strike-through reference price. |
| `costPrice` | Decimal(12,2)? | `@map("cost_price")` | Unit cost. |
| `stockStatus` | String | `@default("IN_STOCK")` | `IN_STOCK` / `LOW_STOCK` / `OUT_OF_STOCK` / `DISCONTINUED`; recomputed from `stockQty`. |
| `stockQty` | Int | `@default(0)` | Effective sellable quantity (expired stock excluded; PPB rule). |
| `stock` | Int? | `@default(0)` | Legacy/POS counter; decremented alongside `stockQty` (COALESCE, clamped). |
| `virtualReservedStock` | Int | `@default(0) @map("virtual_reserved_stock")` | Legacy virtual reservation counter (kept in availability formula). |
| `safetyStockBuffer` | Int | `@default(2) @map("safety_stock_buffer")` | Units withheld from available stock. |
| `inStock` | Boolean | `@default(true) @map("in_stock")` | Boolean sellability flag. |
| `lowStockThreshold` | Int | `@default(5)` | Threshold at which `stockStatus` becomes `LOW_STOCK`. |
| `requiresPrescription` | Boolean | `@default(false)` | Rx-controlled item flag. |
| `dosageForm` | String? | `@map("dosage_form")` | e.g. "Tablets", "Syrup". |
| `strength` | String? | — | e.g. "500 mg". |
| `nearestExpiryDate` | DateTime? | `@map("nearest_expiry_date")` | Earliest unexpired batch expiry (tracked by BandaGo normalizer). |
| `externalPosId` | String? | `@unique @map("external_pos_id")` | iDempiere/BandaGo product key. |
| `posSource` | String? | `@default("BANDAGO") @map("pos_source")` | Which POS system the row syncs from. |
| `lastSyncedAt` | DateTime? | `@map("last_synced_at")` | Last successful POS sync. |
| `description` | String | `@default("")` | Long description. |
| `usageInfo` | String? | — | Usage guidance. |
| `warnings` | String? | — | Safety warnings. |
| `image` | String? | — | Primary image URL. |
| `active` | Boolean | `@default(true)` | Catalogue visibility. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-updated. |
| `images` | String[] | `@default([])` | Additional image URLs. |

**Relations:** `category` (optional, non-cascade), `stockAlerts` (1:N `ProductAlert`), `reviews` (1:N `Review`), `batches` (1:N `ProductBatch`, cascade).

**Indexes:** `@@index([externalPosId])`, `@@index([inStock, stock])`, `@@index([categoryId])`; uniques on `slug`, `sku`, `externalPosId`.

### `ProductBatch` (table `product_batches`)

Per-lot inventory from iDempiere. All columns snake_case-mapped.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `productId` | String | `@map("product_id")`, FK → `Product`, cascade | Owning product. |
| `batchNumber` | String | `@map("batch_number")` | iDempiere Lot/Batch number. |
| `quantityOnHand` | Int | `@map("quantity_on_hand")` | Units in this lot. |
| `expiryDate` | DateTime | `@map("expiry_date")` | iDempiere M_AttributeSetInstance.GuaranteeDate. |
| `externalBatchId` | String? | `@map("external_batch_id")` | External batch identifier. |
| `isExpired` | Boolean | `@default(false) @map("is_expired")` | Flagged when `expiryDate` ≤ now; expired lots are excluded from sellable stock (PPB). |
| `createdAt` | DateTime | `@default(now()) @map("created_at")` | Row creation. |
| `updatedAt` | DateTime | `@updatedAt @map("updated_at")` | Auto-updated. |

**Relations:** `product` (cascade).

**Indexes/uniques:** `@@unique([productId, batchNumber])`, `@@index([productId, expiryDate])` (FEFO ordering).

### `ProductAlert`

Back-in-stock subscription.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `productId` | String | FK → `Product`, cascade | Watched product. |
| `userId` | String | FK → `User`, cascade | Subscriber. |
| `notifiedAt` | DateTime? | — | Set when the back-in-stock notification fired. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |

**Indexes/uniques:** `@@unique([productId, userId])`.

---

## 3. Commerce

### `Order`

Order header. Money fields `Decimal(12,2)`. Statuses/groups per [schema-overview.md](schema-overview.md#3-string-statuses-canonical-values-in-srclibconstants-ts).

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `reference` | String | `@unique` | Human reference `SPH-` + 12 hex. |
| `userId` | String? | FK → `User` (no cascade) | Owning customer; null for guest orders. |
| `guestName` | String? | — | Guest checkout name. |
| `guestPhone` | String? | — | Guest callback phone (`+254…`). |
| `guestEmail` | String? | — | Guest email (optional). |
| `guestAccessTokenHash` | String? | `@unique` | HMAC hash of the one-time guest access token. |
| `guestAccessExpiresAt` | DateTime? | — | Token expiry (7 days after placement). |
| `type` | String | — | `OTC` / `PRESCRIPTION` / `MIXED` / `RESERVATION`. |
| `status` | String | — | 14-value order status (see overview). |
| `fulfillment` | String | — | `PICKUP` / `DELIVERY`. |
| `paymentMethod` | String? | — | Checkout choice (`MPESA`/`CARD`/`CASH`/`LATER` mapping to stored values); null for historical orders. |
| `deliveryAddress` | String? | — | Delivery address text. |
| `deliveryArea` | String? | — | Zone name for fee computation. |
| `deliveryNotes` | String? | — | Rider instructions. |
| `deliveryFee` | Decimal(12,2) | `@default(0)` | Computed delivery fee. |
| `deliveryLatitude` | Float? | — | Delivery GPS lat. |
| `deliveryLongitude` | Float? | — | Delivery GPS lon. |
| `subtotal` | Decimal(12,2) | required | Σ price × qty before discount. |
| `discountAmount` | Decimal(12,2) | `@default(0)` | Promotion discount (never applies to delivery fee). |
| `promotionCode` | String? | — | Applied promo code snapshot (server re-validates via `PromotionRedemption`). |
| `total` | Decimal(12,2) | required | `max(0, subtotal − discount + deliveryFee − pointsRedeemed value)`. |
| `notes` | String? | — | Customer order notes. |
| `pickupCode` | String? | `@unique` | Store pickup verification code. |
| `riderId` | String? | — | Assigned rider staff id (plain string, no FK). |
| `riderName` | String? | — | Rider name snapshot. |
| `pointsEarned` | Int | `@default(0)` | Sphere Points awarded on payment capture. |
| `pointsRedeemed` | Int | `@default(0)` | Points debited at checkout. |
| `inventoryReservedAt` | DateTime? | — | When stock was physically reserved. |
| `inventoryReleasedAt` | DateTime? | — | When stock was restored (cancel/expiry). |
| `version` | Int | `@default(0)` | Optimistic-concurrency counter (guarded `updateMany` on every transition). |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-updated. |

**Relations:** `user` (no cascade), `items` (1:N `OrderItem`, cascade), `statusHistory` (1:N `OrderStatusHistory`, cascade), `payments` (1:N `Payment`, cascade), `prescriptions` (1:N `Prescription`, no cascade), `loyaltyEntries` (1:N `LoyaltyLedger`, cascade).

**Indexes:** `@@index([status, createdAt])`, `@@index([userId, createdAt])`, `@@index([riderId, status, createdAt])`, `@@index([guestPhone, createdAt])`, `@@index([updatedAt, id])` and `@@index([createdAt, id])` (live-monitor cursor pairs).

### `OrderItem`

Immutable line snapshot.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `orderId` | String | FK → `Order`, cascade | Parent order. |
| `productId` | String? | — | Nullable so deleted/custom items survive. |
| `name` | String | — | Product name snapshot. |
| `price` | Decimal(12,2) | required | Unit price snapshot. |
| `qty` | Int | — | Quantity (1–99 per line). |
| `requiresPrescription` | Boolean | `@default(false)` | Rx flag snapshot. |
| `lineTotal` | Decimal(12,2) | required | `price × qty`. |

**Indexes:** `@@index([orderId])`, `@@index([productId])`.

### `OrderStatusHistory`

Append-only order status audit.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `orderId` | String | FK → `Order`, cascade | Parent order. |
| `status` | String | — | Status entered. |
| `note` | String? | — | Human context ("Rider assigned: X"). |
| `actor` | String | — | `SYSTEM` / `CUSTOMER` / staff name. |
| `createdAt` | DateTime | `@default(now())` | Transition time. |

**Indexes:** `@@index([orderId, createdAt])`.

### `Payment`

Order payment attempt. `provider`: `MPESA` | `INTASEND` | `CASH`. `status`: `PENDING` | `PROCESSING` | `SUCCESS` | `FAILED` | `REFUND_PENDING` | `REFUNDED`. `method` observed values: `STK_PUSH`, `CARD`, `HOSTED_CHECKOUT`, `PAYBILL`, `CASH_ON_PICKUP`, `CASH_ON_DELIVERY`.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `orderId` | String | FK → `Order`, cascade | Parent order. |
| `provider` | String | — | Payment provider. |
| `method` | String? | — | Provider method (see values above). |
| `status` | String | `@default("PENDING")` | Payment status. |
| `amount` | Decimal(12,2) | required | Attempted amount (whole KSh for M-Pesa). |
| `currency` | String | `@default("KES")` | Always KES. |
| `phone` | String? | — | Payer phone (normalized `+254…`). |
| `cardLast4` | String? | — | Declared but never populated. |
| `providerReference` | String? | — | Provider transaction id (M-Pesa receipt, IntaSend invoice id, `CASH-<ref>`). |
| `checkoutRequestId` | String? | — | M-Pesa CheckoutRequestID / IntaSend checkout id. |
| `idempotencyKey` | String? | `@unique` | Client-supplied attempt key (`order:{id}:mpesa|intasend:{key}`, `staff:{orderId}:mpesa:{key}`, `cash:{orderId}`). |
| `eventId` | String? | `@unique` | Idempotency stamp from the webhook that resolved the attempt. |
| `refundReference` | String? | `@unique` | Refund id (IntaSend) or `CASH:<ref>`. |
| `failureReason` | String? | — | Provider/user failure description. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-updated. |

**Relations:** `order` (cascade), `webhookEvents` (1:N `PaymentWebhookEvent`, cascade).

**Indexes/uniques:** `@@unique([provider, providerReference])`, `@@unique([provider, checkoutRequestId])`, `@@index([orderId, status, createdAt])`; field uniques `idempotencyKey`, `eventId`, `refundReference`.

### `ServicePayment`

Service-booking payment attempt. Same provider/status vocabulary as `Payment`, plus provider `IN_STORE` with method `PAY_AT_PHARMACY` (intent marker only — no cash-settlement endpoint exists).

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `bookingId` | String | FK → `ServiceBooking`, cascade | Parent booking. |
| `provider` | String | — | `MPESA` / `INTASEND` / `IN_STORE`. |
| `method` | String? | — | `STK_PUSH` / `HOSTED_CHECKOUT` / `PAY_AT_PHARMACY`. |
| `status` | String | `@default("PENDING")` | Same six statuses as `Payment`. |
| `amount` | Decimal(12,2) | required | Attempted amount. |
| `currency` | String | `@default("KES")` | Always KES. |
| `phone` | String? | — | Payer phone. |
| `providerReference` | String? | — | Provider transaction id. |
| `checkoutRequestId` | String? | — | M-Pesa CheckoutRequestID / IntaSend checkout id. |
| `idempotencyKey` | String? | `@unique` | `service:{id}:mpesa|intasend:{key}`, `service:{id}:pay-at-pharmacy`. |
| `eventId` | String? | `@unique` | Webhook idempotency stamp. |
| `failureReason` | String? | — | Failure description. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-updated. |

**Relations:** `booking` (cascade), `webhookEvents` (1:N `PaymentWebhookEvent`, cascade).

**Indexes/uniques:** `@@unique([provider, providerReference])`, `@@unique([provider, checkoutRequestId])`, `@@index([bookingId, status])`; field uniques `idempotencyKey`, `eventId`. No `refundReference` or `cardLast4` fields.

### `PaymentWebhookEvent`

Idempotency ledger for inbound provider webhooks (both order and service flows). `payloadHash` = sha256 of the raw body; benign replays are acknowledged, conflicting payloads rejected with 409.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `provider` | String | — | `MPESA` / `INTASEND`. |
| `eventId` | String | `@unique` | Provider event id (e.g. `mpesa:{checkoutRequestId}:{resultCode}:{receipt|none}`). |
| `payloadHash` | String | — | sha256 of raw request body. |
| `paymentId` | String? | FK → `Payment`, cascade | Resolved order payment (mutually exclusive with `servicePaymentId`). |
| `servicePaymentId` | String? | FK → `ServicePayment`, cascade | Resolved service payment. |
| `createdAt` | DateTime | `@default(now())` | Receipt time. |

**Indexes:** `@@index([paymentId, createdAt])`, `@@index([servicePaymentId, createdAt])`.

---

## 4. Prescriptions

### `Prescription`

Uploaded prescription. File bytes live in private R2 at `storageKey` (`prescriptions/{userId}/{uuid}{ext}`); the legacy inline `fileData`/`fileUrl` columns are always null now.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `userId` | String? | FK → `User` (no cascade) | Owning customer (null for legacy/system rows). |
| `orderId` | String? | FK → `Order` (no cascade) | Order the Rx was attached to at checkout. |
| `fileName` | String | — | Original file name (≤120). |
| `fileType` | String | — | `png/jpeg/jpg/webp/heic/pdf`. |
| `fileData` | String? | — | Legacy inline base64 — always null. |
| `notes` | String? | — | Customer notes (≤1000). |
| `status` | String | `@default("PENDING")` | `PENDING` / `APPROVED` / `REJECTED` / `CLARIFICATION_REQUESTED` / `PARTIALLY_APPROVED`. |
| `reviewNotes` | String? | — | Pharmacist notes (≤2000; required unless APPROVED/PARTIALLY_APPROVED). |
| `reviewedById` | String? | FK → `StaffUser` (`"RxReviewer"`) | Reviewing pharmacist/admin. |
| `reviewedAt` | DateTime? | — | Review completion time. |
| `refillsAllowed` | Int | `@default(0)` | Authorized refills (0–6). |
| `refillsUsed` | Int | `@default(0)` | Optimistically claimed refill counter. |
| `validUntil` | DateTime? | — | Validity window end (now + validDays ∈ {30,60,90,180}); only set when approved. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `fileUrl` | String? | — | Legacy — null; API substitutes a presigned URL at read time. |
| `storageKey` | String? | — | Private R2 object key; never exposed by DTOs. |
| `deletedAt` | DateTime? | — | Soft-delete timestamp; retention clock starts here. |

**Relations:** `order` (no cascade), `reviewedBy` (StaffUser), `user` (no cascade), `accessLogs` (1:N `PrescriptionAccessLog`, cascade).

**Indexes:** `@@index([userId, createdAt])`, `@@index([orderId, status])`, `@@index([status, createdAt])` (review queue).

### `PrescriptionAccessLog`

Write-only compliance log — no API reads it.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `prescriptionId` | String | FK → `Prescription`, cascade | Accessed prescription. |
| `actorId` | String | — | Viewer id (user or staff). |
| `actorRole` | String | — | Viewer role. |
| `action` | String | — | `VIEW` / `DOWNLOAD`. |
| `createdAt` | DateTime | `@default(now())` | Access time. |

**Indexes:** `@@index([prescriptionId, createdAt])`.

---

## 5. Promotions / loyalty

### `Promotion`

Percentage-discount promotion. Only rule type: `discountPct` off the subtotal (1–90). No fixed-amount or free-shipping types.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `title` | String | — | Display title. |
| `description` | String | — | Display description. |
| `badge` | String? | — | UI badge text. |
| `code` | String? | `@unique` | Redemption code (`^[A-Z0-9_-]{3,32}$`); required for private promos. |
| `discountPct` | Int? | — | Percent off subtotal (1–90). |
| `color` | String? | — | UI accent color. |
| `active` | Boolean | `@default(true)` | Enabled flag (archive sets false). |
| `isPublic` | Boolean | `@default(true)` | false = code-only visibility. |
| `startsAt` | DateTime? | — | Window start (Kenya-local day T00:00:00+03:00). |
| `endsAt` | DateTime? | — | Window end (Kenya-local day T23:59:59.999+03:00). |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `maxUses` | Int? | — | Global redemption ceiling (1–1,000,000). |
| `perUserLimit` | Int? | — | Per-account ceiling. |
| `perIpLimit` | Int? | — | Per-IP ceiling (HMAC-hashed). |
| `perBrowserLimit` | Int? | — | Per-browser ceiling (cookie hash). |
| `minimumSpend` | Decimal(12,2)? | — | Minimum pre-discount subtotal (0–10M). |

**Relations:** `redemptions` (1:N `PromotionRedemption`, cascade).

### `PromotionRedemption`

One row per order that redeemed a promotion (`orderId` unique — exactly one promo per order).

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `promotionId` | String | FK → `Promotion`, cascade | Redeemed promotion. |
| `orderId` | String | `@unique` | Redeeming order. |
| `userId` | String? | — | Redeeming user (null for guests). |
| `ipHash` | String? | — | HMAC-SHA256 of client IP (null if no ≥32-char secret — IP-limited offers fail closed). |
| `browserHash` | String? | — | HMAC of the `sphere_promo_device` cookie. |
| `createdAt` | DateTime | `@default(now())` | Redemption time. |

**Indexes:** `@@index([promotionId, createdAt])`, `@@index([promotionId, userId])`, `@@index([promotionId, ipHash])`, `@@index([promotionId, browserHash])` — one index per limit check.

### `LoyaltyLedger`

Append-only Sphere Points journal. `eventKey` unique gives idempotency; families: `earn:`, `redeem:`, `cancel:`, `expire:`, `refund-earn:`, `refund-redeem:` (each `+ orderId`); a generic `reverse:` family exists in the helper. `reason` values: `ORDER_REDEMPTION`, `ORDER_CANCELLED`, `RESERVATION_EXPIRED`, `PAYMENT_CAPTURED`, `PAYMENT_REFUNDED`.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `eventKey` | String | `@unique` | Idempotency key (prefix + orderId). |
| `userId` | String | FK → `User`, cascade | Points owner. |
| `orderId` | String | FK → `Order`, cascade | Driving order. |
| `delta` | Int | — | Signed point change. |
| `reason` | String | — | Event reason (values above). |
| `createdAt` | DateTime | `@default(now())` | Event time. |

**Indexes:** `@@index([userId, createdAt])`, `@@index([orderId, createdAt])`.

---

## 6. Reviews

### `Review`

Product rating. Unique per (product, user).

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `productId` | String | FK → `Product`, cascade | Reviewed product. |
| `userId` | String | FK → `User`, cascade | Author. |
| `rating` | Int | — | Star rating. |
| `comment` | String? | — | Free-text review. |
| `status` | String | `@default("PUBLISHED")` | `PUBLISHED` / `HIDDEN` (moderation). |
| `createdAt` | DateTime | `@default(now())` | Row creation. |

**Indexes/uniques:** `@@unique([productId, userId])`, `@@index([productId, status, createdAt])` (only `PUBLISHED` feed ratings).

### `ServiceReview`

Service-booking rating. Unique per (booking, user).

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `bookingId` | String | FK → `ServiceBooking`, cascade | Reviewed booking. |
| `userId` | String | FK → `User`, cascade | Author. |
| `staffId` | String? | FK → `StaffUser` (no cascade) | Assigned staff credited (snapshot of `assignedStaffId`). |
| `rating` | Int | — | Star rating (1–5). |
| `comment` | String? | — | Free-text review (≤1000). |
| `status` | String | `@default("PUBLISHED")` | `PUBLISHED` / `HIDDEN`. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |

**Indexes/uniques:** `@@unique([bookingId, userId])`, `@@index([userId])`.

---

## 7. Services

### `Service`

Bookable clinical service.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `name` | String | — | Display name. |
| `slug` | String | `@unique` | URL key (auto-suffixed on collision). |
| `shortDescription` | String? | — | Card blurb. |
| `description` | String? | — | Long description. |
| `category` | String? | — | Free-string grouping (not a FK). |
| `durationMinutes` | Int | `@default(15)` | Slot length (5–480). |
| `price` | Decimal(12,2)? | — | Price; null = free/POA (`priceLabel` shown). |
| `priceLabel` | String? | — | Custom price label. |
| `heroImage` | String? | — | Hero image (managed `/images/...` or R2 public URL). |
| `featured` | Boolean | `@default(false)` | Homepage feature flag. |
| `active` | Boolean | `@default(true)` | Bookable/visible flag (DELETE = soft deactivate). |
| `sortOrder` | Int | `@default(0)` | Display order (−10,000..10,000). |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-updated. |

**Relations:** `images` (1:N `ServiceImage`), `availability` (1:N `ServiceAvailability`), `bookings` (1:N `ServiceBooking`).

### `ServiceImage`

Ordered gallery image.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `serviceId` | String | FK → `Service`, cascade | Parent service. |
| `url` | String | — | Managed image URL (≤10 per service). |
| `storageKey` | String? | — | R2 key when managed by the image library. |
| `alt` | String? | — | Alt text. |
| `sortOrder` | Int | — | Display order. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |

**Indexes:** `@@index([serviceId])`.

### `ServiceAvailability`

Weekly availability window (≤35 rules per service; non-overlapping; `endTime > startTime`).

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `serviceId` | String | FK → `Service`, cascade | Parent service. |
| `dayOfWeek` | Int | — | 0–6 (Sunday-based). |
| `startTime` | String | — | `"HH:MM"` window start (Nairobi time). |
| `endTime` | String | — | `"HH:MM"` window end. |
| `enabled` | Boolean | `@default(true)` | Active window flag. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-updated. |

**Indexes/uniques:** `@@unique([serviceId, dayOfWeek, startTime, endTime])`, `@@index([serviceId, dayOfWeek, enabled])`.

### `ServiceBooking`

Customer booking. `status`: `PENDING` | `CONFIRMED` | `RESCHEDULED` | `ARRIVED` | `IN_PROGRESS` | `COMPLETED` | `CANCELLED` | `NO_SHOW` | `REJECTED`. `paymentStatus`: `UNPAID` | `PAID` | `PAY_AT_PHARMACY`.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `reference` | String | `@unique` | `SPB-` + 12 uppercase hex. |
| `serviceId` | String | FK → `Service` (no cascade) | Booked service. |
| `userId` | String | FK → `User`, cascade | Customer. |
| `scheduledStart` | DateTime | — | Slot start (Nairobi UTC+3). |
| `scheduledEnd` | DateTime | — | Slot end (= start + durationMinutes). |
| `status` | String | `@default("PENDING")` | Booking status (values above). |
| `customerNotes` | String? | — | Customer notes (≤1000). |
| `staffNotes` | String? | — | Internal staff notes. |
| `price` | Decimal(12,2)? | — | Price snapshot at booking time. |
| `paymentStatus` | String | `@default("UNPAID")` | Payment state (values above). |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-updated. |
| `assignedStaffId` | String? | FK → `StaffUser` (`"ServiceAssignedStaff"`, no cascade) | Assigned staff member. |

**Relations:** `assignedStaff`, `service`, `user`, `statusHistory` (1:N `ServiceBookingStatusHistory`, cascade), `payments` (1:N `ServicePayment`, cascade), `reviews` (1:N `ServiceReview`, cascade).

**Indexes:** `@@index([serviceId, scheduledStart, scheduledEnd])` (overlap checks), `@@index([userId, scheduledStart])`, `@@index([status])`, `@@index([scheduledStart, id])`, `@@index([status, scheduledStart, id])`, `@@index([assignedStaffId, scheduledStart])`, `@@index([updatedAt, id])`, `@@index([createdAt, id])`. **DB-level:** PostgreSQL exclusion constraint `ServiceBooking_no_overlap` (gist on `serviceId` + `tsrange(scheduledStart, scheduledEnd)` for statuses `PENDING`/`CONFIRMED`/`PAID`) created by the security-hardening migration — not expressed in schema.prisma.

### `ServiceBookingStatusHistory`

Append-only booking status audit.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `bookingId` | String | FK → `ServiceBooking`, cascade | Parent booking. |
| `status` | String | — | Status entered. |
| `note` | String? | — | Transition context. |
| `actor` | String | — | `CUSTOMER` / `SYSTEM` / staff name. |
| `createdAt` | DateTime | `@default(now())` | Transition time. |

**Indexes:** `@@index([bookingId, createdAt])`.

---

## 8. Notifications

### `Notification`

In-app inbox row. Exactly one of `userId` / `staffId` is set. `channel` is always `"IN_APP"` in practice (SMS/WHATSAPP values exist in the constant but are never dispatched).

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `userId` | String? | FK → `User`, cascade | Recipient customer. |
| `staffId` | String? | FK → `StaffUser`, cascade | Recipient staff member. |
| `channel` | String | — | Always `IN_APP`. |
| `event` | String? | — | Event key (e.g. `NEW_PRESCRIPTION`, `PAYMENT_RECEIVED`). |
| `title` | String | — | Notification title. |
| `message` | String | — | Notification body. |
| `read` | Boolean | `@default(false)` | Read flag (per-row or mark-all). |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `metadata` | String? | — | JSON string, includes `link`. |

**Indexes:** `@@index([userId])`, `@@index([staffId])`.

### `NotificationPref`

Per-user channel preferences. Only `email` and `push` influence delivery; `sms`/`whatsapp` are stored but never dispatched.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `userId` | String | `@unique`, FK → `User`, cascade | Owner (1:1). |
| `sms` | Boolean | `@default(true)` | Stored only. |
| `whatsapp` | Boolean | `@default(true)` | Stored only. |
| `email` | Boolean | `@default(true)` | Enforced at dispatch. |
| `push` | Boolean | `@default(true)` | Enforced at dispatch. |

### `PushToken`

Registered FCM device token.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `token` | String | `@unique` | FCM registration token (32–4096 chars). |
| `userId` | String? | FK → `User`, cascade | Owner customer. |
| `staffId` | String? | FK → `StaffUser`, cascade | Owner staff member. |
| `role` | String? | — | Role snapshot at registration. |
| `platform` | String? | — | Platform string (≤200). |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-updated. |

**Indexes:** `@@index([userId])`, `@@index([staffId])`, `@@index([role])`.

### `NotificationDelivery`

Durable outbox for EMAIL/PUSH provider deliveries. "SENT means provider accepted." Statuses: writer `PENDING`/`SENT`/`FAILED`; dispatcher adds `PROCESSING` (lease claim), `SKIPPED` (opt-out/suppression); reconciliation adds `DELIVERED`/`BOUNCED`/`COMPLAINED`.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key; also the provider idempotency key. |
| `dedupeKey` | String | `@unique` | `{key}:email` per recipient, `{key}:push:{tokenId}` per device. |
| `userId` | String? | — | Recipient customer (no FK relation). |
| `staffId` | String? | — | Recipient staff (no FK relation). |
| `channel` | String | — | `EMAIL` or `PUSH` (never `IN_APP`). |
| `payload` | Json | — | Email `{to, subject, html, text}` or push `{token, title, body, link, data}`. |
| `status` | String | `@default("PENDING")` | See values above. |
| `attempts` | Int | `@default(0)` | Dispatch attempts; max 8. |
| `availableAt` | DateTime | `@default(now())` | Next eligible dispatch time (backoff). |
| `lockedUntil` | DateTime? | — | Lease expiry (claim sets now + 120s). |
| `lockToken` | String? | — | Random lease token (crash recovery). |
| `providerId` | String? | — | Provider-accepted message id. |
| `lastError` | String? | — | Last failure text. |
| `sentAt` | DateTime? | — | Provider acceptance time. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-updated. |

**Indexes:** `@@index([status, availableAt])` — the dispatcher's due-job scan.

### `ScheduledJobDelivery`

**Vestigial** — zero code references. The active queue is `NotificationDelivery`. Do not write to it.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `key` | String | `@id` (natural key) | Job identity. |
| `sentAt` | DateTime? | — | Legacy sent marker. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |

### `EmailSuppression`

Addresses excluded from email dispatch. `reason`: `BOUNCED` / `COMPLAINED`.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `email` | String | `@id` (natural key) | Suppressed address. |
| `reason` | String | — | Why suppressed. |
| `createdAt` | DateTime | `@default(now())` | Suppression time. |

### `EmailDeliveryEvent`

Raw Resend/Svix delivery events, persisted by the webhook **before** acknowledging (events can precede the send response).

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id` (Svix id, **no default**) | Provider event id. |
| `providerId` | String | — | Matches `NotificationDelivery.providerId`. |
| `status` | String | — | Provider delivery status (e.g. `delivered`, `bounced`, `complained`). |
| `processed` | Boolean | `@default(false)` | Reconciled flag. |
| `createdAt` | DateTime | `@default(now())` | Receipt time. |

**Indexes:** `@@index([processed, createdAt])` — the reconciliation scan.

---

## 9. Operations

### `MedicineRequest`

Guest "find this medicine" request. Created without authentication by design.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `medicineName` | String | — | Requested medicine (2–200 chars). |
| `phone` | String | — | Callback phone (`+254…`, normalized). |
| `status` | String | `@default("NEW")` | `NEW` / `CONTACTED` / `FULFILLED` / `UNAVAILABLE` (DB CHECK constraint). |
| `staffNotes` | String? | — | Internal notes (≤1000). |
| `photoName` | String? | — | Original photo file name. |
| `photoType` | String? | — | Photo MIME type (jpeg/png/webp). |
| `storageKey` | String? | — | Private R2 key `medicine-requests/{uuid}.{ext}`. |
| `createdAt` | DateTime | `@default(now())` | Row creation. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-updated. |

**Indexes:** `@@index([status, createdAt])`.

### `AuditLog`

Staff/system action audit trail.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `actor` | String | — | Acting identity (name/label). |
| `actorRole` | String? | — | Acting role when staff. |
| `action` | String | — | Action code (e.g. `ORDER_STATUS_PAID`, `RX_APPROVED`, `CASH_CONFIRMED`, `RIDER_ASSIGNED`, `PROMOTION_ARCHIVED`, `NOTIFICATION_TEST`). |
| `entity` | String | — | Entity type label (e.g. `Order`, `Prescription`). |
| `entityId` | String? | — | Entity reference (often the human reference, not cuid). |
| `details` | String? | — | Free-text context. |
| `createdAt` | DateTime | `@default(now())` | Event time. |

**Indexes:** `@@index([createdAt])`, `@@index([entity, entityId, createdAt])`.

### `Setting`

Key/value application settings. Values for `pharmacy`, `delivery`, `compliance` keys are JSON documents.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `key` | String | `@id` (natural key) | Setting key. |
| `value` | String | — | Setting value (JSON string for structured keys). |

### `RateLimitBucket`

Fixed-window rate limiter counters.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `key` | String | `@id` (natural key) | Bucket identity (action + subject). |
| `count` | Int | `@default(0)` | Hits in the current window. |
| `windowEnds` | DateTime | — | Window close time. |
| `updatedAt` | DateTime | `@updatedAt` | Auto-updated. |

**Indexes:** `@@index([windowEnds])`.

### `PosSyncLog` (table `pos_sync_logs`)

BandaGo POS sync telemetry per run.

| Field | Type | Constraints/Default | Description |
| --- | --- | --- | --- |
| `id` | String | `@id @default(cuid())` | Primary key. |
| `posSource` | String | `@default("BANDAGO") @map("pos_source")` | POS system tag. |
| `trigger` | `PosSyncTrigger` | `@default(EXTENSION_STREAM)` | `EXTENSION_STREAM` / `BACKGROUND_POLL` / `CSV_IMPORT` / `MANUAL_RECONCILE`. |
| `status` | `PosSyncStatus` | `@default(SUCCESS)` | `SUCCESS` / `PARTIAL` / `FAILED`. |
| `itemsReceived` | Int | `@default(0) @map("items_received")` | Items in the payload. |
| `itemsUpserted` | Int | `@default(0) @map("items_upserted")` | Items applied. |
| `itemsFailed` | Int | `@default(0) @map("items_failed")` | Items rejected. |
| `details` | Json? | — | Error stacks / category assignments / diff logs (capped at 50 entries). |
| `startedAt` | DateTime | `@default(now()) @map("started_at")` | Run start. |
| `completedAt` | DateTime? | `@map("completed_at")` | Run end. |
| `durationMs` | Int? | `@map("duration_ms")` | Run duration. |

**Indexes:** `@@index([startedAt])`, `@@index([status])`. **Relations:** none — standalone telemetry.

### Enums

| Enum | Values |
| --- | --- |
| `PosSyncTrigger` | `EXTENSION_STREAM`, `BACKGROUND_POLL`, `CSV_IMPORT`, `MANUAL_RECONCILE` |
| `PosSyncStatus` | `SUCCESS`, `PARTIAL`, `FAILED` |

These are the **only** two Prisma enums in the schema; every other status-like column is a plain `String` with canonical values defined in `src/lib/constants.ts` (see [schema-overview.md](schema-overview.md#3-string-statuses-canonical-values-in-srclibconstants-ts)).

---

## Cross-references

- Field authority rules (stock, loyalty, money): [schema-overview.md](schema-overview.md#design-decisions).
- Relationship diagrams: [entity-relationship-diagram.md](entity-relationship-diagram.md).
- How this schema evolved: [migrations.md](migrations.md).
- Record lifetimes and retention: [data-lifecycle.md](data-lifecycle.md).
- API surface reading/writing these tables: [../api/api-reference.md](../api/api-reference.md).
