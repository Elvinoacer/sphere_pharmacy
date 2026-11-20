# Entity Relationship Diagram

This document maps the Sphere Pharmacy database as Mermaid ER diagrams, one block per domain, followed by a prose walkthrough of the core relationships. Entities are trimmed to ~5–8 key attributes for readability — the complete field set for every model is in [data-dictionary.md](data-dictionary.md). Crow's-foot notation: `||--o{` = exactly one to zero-or-many, `|o--o{` = zero-or-one to zero-or-many, `||--o|` = one to zero-or-one, `||--||` = one to exactly one.

| Audience | Status | Verified |
| --- | --- | --- |
| Engineers, AI coding agents | Implemented — verified against code | November 2026 |

## Identity / auth

```mermaid
erDiagram
    USER ||--o{ ADDRESS : saves
    USER ||--o{ SESSION : opens
    USER ||--o| NOTIFICATION_PREF : configures
    STAFF_USER ||--o{ SESSION : opens

    USER {
        string id PK "cuid"
        string phone UK "unique"
        string email UK "unique"
        string passwordHash "scrypt, nullable"
        int loyaltyPoints "web spendable balance"
        int loyaltyPointsBalance "POS-synced balance"
    }
    STAFF_USER {
        string id PK "cuid"
        string email UK
        string role "ADMIN PHARMACIST STAFF RIDER"
        boolean active
        int authVersion "session invalidation"
    }
    SESSION {
        string id PK "cuid"
        string token UK
        string role "CUSTOMER or staff role"
        datetime expiresAt
        datetime lastSeenAt
        int authVersion
    }
    ADDRESS {
        string id PK "cuid"
        string userId FK "cascade"
        string label
        string text
        boolean isDefault "one per user"
    }
    NOTIFICATION_PREF {
        string id PK "cuid"
        string userId FK "unique, 1:1"
        boolean email "enforced"
        boolean push "enforced"
    }
```

`OtpCode` is standalone (keyed by `phone`, no FK). Deleting a `User` cascades sessions, addresses, prefs and tokens, but **not** orders or prescriptions (see walkthrough).

## Commerce

```mermaid
erDiagram
    USER |o--o{ ORDER : places
    ORDER ||--|{ ORDER_ITEM : contains
    ORDER ||--o{ ORDER_STATUS_HISTORY : records
    ORDER ||--o{ PAYMENT : billed
    ORDER |o--o{ PRESCRIPTION : requires
    PAYMENT ||--o{ PAYMENT_WEBHOOK_EVENT : audited
    SERVICE_BOOKING ||--o{ SERVICE_PAYMENT : billed
    SERVICE_PAYMENT ||--o{ PAYMENT_WEBHOOK_EVENT : audited

    ORDER {
        string id PK "cuid"
        string reference UK "SPB + 12 hex"
        string type "OTC PRESCRIPTION MIXED RESERVATION"
        string status "14 canonical values"
        string fulfillment "PICKUP DELIVERY"
        decimal total "Decimal 12,2 KES"
        int version "optimistic lock"
    }
    ORDER_ITEM {
        string id PK "cuid"
        string orderId FK "cascade"
        string productId FK "nullable, snapshot survives"
        string name
        decimal price
        int qty
        decimal lineTotal
    }
    ORDER_STATUS_HISTORY {
        string id PK "cuid"
        string orderId FK "cascade"
        string status
        string note
        string actor "SYSTEM CUSTOMER staff"
    }
    PAYMENT {
        string id PK "cuid"
        string orderId FK "cascade"
        string provider "MPESA INTASEND CASH"
        string status "6 canonical values"
        decimal amount
        string idempotencyKey UK
        string providerReference
    }
    SERVICE_PAYMENT {
        string id PK "cuid"
        string bookingId FK "cascade"
        string provider "MPESA INTASEND IN_STORE"
        string status "6 canonical values"
        decimal amount
        string idempotencyKey UK
    }
    PAYMENT_WEBHOOK_EVENT {
        string id PK "cuid"
        string provider
        string eventId UK "idempotency"
        string payloadHash "sha256 raw body"
        string paymentId FK "either-or"
        string servicePaymentId FK "either-or"
    }
    USER {
        string id PK "cuid"
        string phone UK
    }
    SERVICE_BOOKING {
        string id PK "cuid"
        string reference UK
    }
    PRESCRIPTION {
        string id PK "cuid"
        string status
    }
```

`Order.riderId` is a plain string snapshot of a `StaffUser` id — there is **no** foreign key. `PAYMENT_WEBHOOK_EVENT` is the shared ledger for both payment tables; exactly one of `paymentId` / `servicePaymentId` is set per row.

## Prescriptions

```mermaid
erDiagram
    USER |o--o{ PRESCRIPTION : uploads
    ORDER |o--o{ PRESCRIPTION : links
    ORDER |o--o{ ORDER : refills
    PRESCRIPTION |o--o{ PRESCRIPTION : spawns_refill
    STAFF_USER |o--o{ PRESCRIPTION : reviews
    PRESCRIPTION ||--o{ PRESCRIPTION_ACCESS_LOG : logs

    PRESCRIPTION {
        string id PK "cuid"
        string userId FK "nullable, no cascade"
        string orderId FK "nullable, no cascade"
        string parentPrescriptionId FK "nullable, SetNull"
        int refillNumber "1-based refill sequence"
        datetime refillReleasedAt "idempotent rollback"
        string fileName
        string status "5 canonical values"
        string storageKey "private R2 key"
        int refillsAllowed "0-6 (0 on refill copies)"
        datetime deletedAt "soft delete"
    }
    PRESCRIPTION_ACCESS_LOG {
        string id PK "cuid"
        string prescriptionId FK "cascade"
        string actorId
        string actorRole
        string action "VIEW DOWNLOAD"
        datetime createdAt
    }
    USER {
        string id PK "cuid"
    }
    ORDER {
        string id PK "cuid"
        string reference UK
        string refillOfOrderId FK "nullable, SetNull"
    }
    STAFF_USER {
        string id PK "cuid"
        string role
    }
```

`Prescription.reviewedById` → `StaffUser` uses the named relation `"RxReviewer"`. `Prescription.parentPrescriptionId` → `Prescription` (`"PrescriptionRefills"`) and `Order.refillOfOrderId` → `Order` (`"OrderRefills"`) capture refill lineage structurally: refills create a **new** `Prescription` row sharing the same `storageKey` (with `refillsAllowed = 0` and parent validity inherited) and a new `Order` pointing back to its source order. The file bytes never live in Postgres — `storageKey` points at a private R2 object `prescriptions/{userId}/{uuid}{ext}`.

## Products / inventory

```mermaid
erDiagram
    CATEGORY ||--o{ PRODUCT : groups
    PRODUCT ||--o{ PRODUCT_BATCH : has
    PRODUCT ||--o{ PRODUCT_ALERT : watched
    PRODUCT ||--o{ REVIEW : receives
    USER ||--o{ PRODUCT_ALERT : sets
    USER ||--o{ REVIEW : writes
    ORDER_ITEM }o--o| PRODUCT : references

    PRODUCT {
        string id PK "cuid"
        string sku UK
        decimal price "Decimal 12,2"
        int stockQty "effective authority"
        int stock "legacy counter"
        boolean requiresPrescription
        string externalPosId UK "BandaGo POS"
        string stockStatus "4 canonical values"
    }
    CATEGORY {
        string id PK "cuid"
        string slug UK
        string name
        int sortOrder
        boolean active
    }
    PRODUCT_BATCH {
        string id PK "cuid"
        string productId FK "cascade"
        string batchNumber "iDempiere lot, unique per product"
        int quantityOnHand
        datetime expiryDate
        boolean isExpired "excluded from sellable"
    }
    PRODUCT_ALERT {
        string id PK "cuid"
        string productId FK "cascade"
        string userId FK "cascade"
        datetime notifiedAt
    }
    REVIEW {
        string id PK "cuid"
        string productId FK "cascade"
        string userId FK "cascade"
        int rating
        string status "PUBLISHED HIDDEN"
    }
    USER {
        string id PK "cuid"
    }
    ORDER_ITEM {
        string id PK "cuid"
        string productId "nullable"
    }
```

`Product.categoryId` → `Category` is a nullable, **non-cascading** FK (products survive category deletion). `REVIEW` is documented under the Reviews domain in [data-dictionary.md](data-dictionary.md#6-reviews); it is drawn here because its parent is `Product`.

## Promotions / loyalty

```mermaid
erDiagram
    PROMOTION ||--o{ PROMOTION_REDEMPTION : redeemed
    ORDER ||--o| PROMOTION_REDEMPTION : grants
    USER |o--o{ LOYALTY_LEDGER : accrues
    ORDER ||--o{ LOYALTY_LEDGER : drives

    PROMOTION {
        string id PK "cuid"
        string code UK "required when private"
        int discountPct "1-90 percent"
        boolean isPublic
        int maxUses "global ceiling"
        int perUserLimit
        decimal minimumSpend "Decimal 12,2"
    }
    PROMOTION_REDEMPTION {
        string id PK "cuid"
        string promotionId FK "cascade"
        string orderId UK "exactly one promo per order"
        string userId "nullable for guests"
        string ipHash "HMAC, limit enforcement"
        string browserHash "HMAC, limit enforcement"
    }
    LOYALTY_LEDGER {
        string id PK "cuid"
        string eventKey UK "idempotency prefix + orderId"
        string userId FK "cascade"
        string orderId FK "cascade"
        int delta "signed points"
        string reason "5 canonical values"
    }
    USER {
        string id PK "cuid"
        int loyaltyPoints "sum of deltas"
    }
    ORDER {
        string id PK "cuid"
        string reference UK
    }
```

`perIpLimit` / `perBrowserLimit` on `PROMOTION` (not drawn) pair with the hashed columns on `PROMOTION_REDEMPTION` — each limit check is backed by its own index.

## Services

```mermaid
erDiagram
    SERVICE ||--o{ SERVICE_IMAGE : shows
    SERVICE ||--o{ SERVICE_AVAILABILITY : schedules
    SERVICE ||--o{ SERVICE_BOOKING : receives
    USER ||--o{ SERVICE_BOOKING : makes
    STAFF_USER |o--o{ SERVICE_BOOKING : assigned
    SERVICE_BOOKING ||--o{ SERVICE_BOOKING_STATUS_HISTORY : records
    SERVICE_BOOKING ||--o{ SERVICE_PAYMENT : billed
    SERVICE_BOOKING ||--o| SERVICE_REVIEW : reviewed

    SERVICE {
        string id PK "cuid"
        string slug UK
        string name
        int durationMinutes "default 15"
        decimal price "nullable = POA"
        boolean active
        int sortOrder
    }
    SERVICE_IMAGE {
        string id PK "cuid"
        string serviceId FK "cascade"
        string url
        string storageKey "R2 when managed"
        int sortOrder
    }
    SERVICE_AVAILABILITY {
        string id PK "cuid"
        string serviceId FK "cascade"
        int dayOfWeek "0-6"
        string startTime "HH:MM"
        string endTime "HH:MM"
        boolean enabled
    }
    SERVICE_BOOKING {
        string id PK "cuid"
        string reference UK "SPB + 12 hex"
        string serviceId FK "no cascade"
        string userId FK "cascade"
        datetime scheduledStart
        datetime scheduledEnd
        string status "9 canonical values"
        string paymentStatus "UNPAID PAID PAY_AT_PHARMACY"
    }
    SERVICE_BOOKING_STATUS_HISTORY {
        string id PK "cuid"
        string bookingId FK "cascade"
        string status
        string note
        string actor
    }
    SERVICE_REVIEW {
        string id PK "cuid"
        string bookingId FK "cascade"
        string userId FK "cascade"
        string staffId FK "assigned staff, no cascade"
        int rating
        string status "PUBLISHED HIDDEN"
    }
    SERVICE_PAYMENT {
        string id PK "cuid"
        string bookingId FK "cascade"
        string provider
        string status
    }
    USER {
        string id PK "cuid"
    }
    STAFF_USER {
        string id PK "cuid"
    }
```

`ServiceBooking.assignedStaffId` → `StaffUser` uses the named relation `"ServiceAssignedStaff"` and does not cascade (unassigning happens logically). A PostgreSQL exclusion constraint (`ServiceBooking_no_overlap`, gist on service + time range for live statuses) additionally prevents overlapping bookings at the database level — see [data-dictionary.md](data-dictionary.md#servicebooking).

## Notifications

```mermaid
erDiagram
    USER |o--o{ NOTIFICATION : receives
    STAFF_USER |o--o{ NOTIFICATION : receives
    USER ||--o| NOTIFICATION_PREF : configures
    USER |o--o{ PUSH_TOKEN : registers
    STAFF_USER |o--o{ PUSH_TOKEN : registers
    USER |o--o{ NOTIFICATION_DELIVERY : targets
    STAFF_USER |o--o{ NOTIFICATION_DELIVERY : targets

    NOTIFICATION {
        string id PK "cuid"
        string userId FK "either-or"
        string staffId FK "either-or"
        string channel "always IN_APP"
        string title
        string message
        boolean read
        string metadata "JSON with link"
    }
    NOTIFICATION_PREF {
        string id PK "cuid"
        string userId FK "unique 1:1"
        boolean email "enforced at dispatch"
        boolean push "enforced at dispatch"
    }
    PUSH_TOKEN {
        string id PK "cuid"
        string token UK "FCM"
        string userId FK "either-or"
        string staffId FK "either-or"
        string platform
    }
    NOTIFICATION_DELIVERY {
        string id PK "cuid"
        string dedupeKey UK "email or push job"
        string channel "EMAIL or PUSH"
        json payload
        string status "PENDING SENT FAILED and more"
        int attempts "max 8"
        datetime availableAt "backoff schedule"
        datetime lockedUntil "120s lease"
        string providerId "matches email events"
    }
    SCHEDULED_JOB_DELIVERY {
        string key PK "vestigial, unreferenced"
        datetime sentAt
    }
    EMAIL_SUPPRESSION {
        string email PK "natural key"
        string reason "BOUNCED COMPLAINED"
    }
    EMAIL_DELIVERY_EVENT {
        string id PK "svix id, no default"
        string providerId "matches delivery"
        string status
        boolean processed
    }
```

`NOTIFICATION_DELIVERY.userId` / `staffId` are **not** foreign keys (soft targeting); `EMAIL_SUPPRESSION` and `EMAIL_DELIVERY_EVENT` have no FK relations at all — the dispatcher matches `EmailDeliveryEvent.providerId` to `NotificationDelivery.providerId` logically during reconciliation. See [data-lifecycle.md](data-lifecycle.md#notifications) for the delivery flow.

## Operations

These models keep operational state, POS reconciliation jobs, and telemetry. `PosOutboundJob` carries foreign keys to `Product` (cascade) and `Order` (SetNull), whereas `MedicineRequest`, `AuditLog`, `Setting`, `RateLimitBucket`, `PosSyncLog`, and `PosSyncIncident` have **no foreign keys**.

```mermaid
erDiagram
    PRODUCT ||--o{ POS_OUTBOUND_JOB : queues
    ORDER |o--o{ POS_OUTBOUND_JOB : triggers

    MEDICINE_REQUEST {
        string id PK "cuid"
        string medicineName
        string phone "guest callback"
        string status "NEW CONTACTED FULFILLED UNAVAILABLE"
        string storageKey "private R2 photo"
    }
    AUDIT_LOG {
        string id PK "cuid"
        string actor
        string actorRole
        string action
        string entity "plain string, no FK"
        string entityId
        datetime createdAt
    }
    SETTING {
        string key PK "natural key"
        string value "JSON for structured keys"
    }
    RATE_LIMIT_BUCKET {
        string key PK "natural key"
        int count
        datetime windowEnds
    }
    POS_SYNC_LOG {
        string id PK "cuid"
        string posSource "default BANDAGO"
        string direction "INBOUND or OUTBOUND"
        string trigger "PosSyncTrigger enum"
        string status "PosSyncStatus enum"
        int itemsUpserted
        datetime startedAt
    }
    POS_OUTBOUND_JOB {
        string id PK "cuid"
        string idempotencyKey UK "event dedupe key"
        string eventType "ONLINE_SALE ADMIN_STOCK_ADJUST REFUND_RESTOCK"
        string status "PosOutboundStatus enum"
        string productId FK "cascade"
        string orderId FK "nullable SetNull"
        int qtyDelta "signed stock delta"
        string exportBatchId "daily export tag"
    }
    POS_SYNC_INCIDENT {
        string id PK "cuid"
        string direction "INBOUND or OUTBOUND"
        string severity "CRITICAL ERROR WARNING"
        string code "remediation key"
        int occurrences
        boolean resolved
    }
    PRODUCT {
        string id PK "cuid"
        string externalPosId UK
    }
    ORDER {
        string id PK "cuid"
        string reference UK
    }
```

## Core relationship walkthrough

**User → Orders → Items → Products.** A signed-in customer owns orders via `Order.userId` (nullable for guest checkout, and deliberately **non-cascading** so order history survives account deletion). Each `Order` contains 1–50 `OrderItem` rows (cascading) that snapshot `name`, `price` and `lineTotal`; `OrderItem.productId` is nullable and only points at `Product` when the product still exists — deleted or custom items keep their snapshot. Products optionally belong to a `Category` (nullable FK, no cascade). `Product.stockQty` is the authoritative sellable count that order placement decrements.

**Order → Payments → PaymentWebhookEvent.** An `Order` accumulates `Payment` attempts (cascade), one active attempt at a time, enforced by unique `idempotencyKey` and the `(provider, providerReference)` / `(provider, checkoutRequestId)` uniques. Providers confirm asynchronously: every verified callback/webhook first upserts a `PaymentWebhookEvent` (unique `eventId`, `payloadHash` for replay detection) pointing at the resolved `Payment` (or `ServicePayment`), then updates the payment inside a Serializable transaction. The ledger is the audit trail of exactly which provider events moved money.

**Prescription → Order + PrescriptionAccessLog.** At checkout, owned, unused, non-deleted prescriptions are attached by setting `Prescription.orderId` (non-cascading) and the order moves to `UNDER_REVIEW`. A pharmacist (`reviewedById` → `StaffUser`) decides each Rx; aggregated outcomes drive the order status (`PRESCRIPTION_VERIFIED` / `REJECTED`). Every owner-or-staff fetch of a prescription file writes a `PrescriptionAccessLog` row (`VIEW`/`DOWNLOAD`) — a write-only compliance record.

**User → LoyaltyLedger.** All Sphere Points movement is journalled: each row is `(eventKey unique, userId, orderId, signed delta, reason)`. Earn on payment capture, debit at redemption, and reversals on cancel/expiry/refund all land here; `User.loyaltyPoints` is the materialized sum the app spends against. `loyaltyPointsBalance` is the separate POS-synced counter (see [schema-overview.md](schema-overview.md#2-loyaltypoints-vs-loyaltypointsbalance)).

**ServiceBooking → ServicePayment.** A booking is billed by `ServicePayment` attempts mirroring the order-payment model (M-Pesa, IntaSend hosted checkout, or `IN_STORE` pay-at-pharmacy intent). Successful webhooks set both the payment row (`SUCCESS`) and `ServiceBooking.paymentStatus` (`PAID`); the shared `PaymentWebhookEvent` table records the provider events with the `mpesa-service:` id prefix.

**Product → ProductBatch.** Each product owns per-lot rows unique on `(productId, batchNumber)` with `expiryDate` from iDempiere. The BandaGo normalizer aggregates lots, flags `isExpired`, and computes sellable `stockQty` excluding expired lots (FEFO, PPB-compliant); `nearestExpiryDate` on the product tracks the earliest live expiry.

**User → PushToken / NotificationDelivery.** A user (or staff member) registers device tokens (`PushToken.token` unique; either `userId` or `staffId`). Enqueueing a notification writes the in-app `Notification` row plus one `NotificationDelivery` job per channel target — `{key}:email` for the recipient and `{key}:push:{tokenId}` per registered device — keyed unique by `dedupeKey`. Dispatch, retries, leases and reconciliation are covered in [data-lifecycle.md](data-lifecycle.md#notifications).

**Product / Order → PosOutboundJob.** Whenever an online order is paid or prepared (`enqueueOrderPosDeduction`) or staff edit `stockQty` (`enqueueAdminStockEdit`), an idempotent `PosOutboundJob` row (`idempotencyKey` unique, deterministic UUIDv4-formatted `externalInventoryUU`) records the signed `qtyDelta` so inbound POS syncs protect unreconciled sales from stale-POS resurrection (`computeReconciledStock`) and either Daily Sales Export or opt-in `AUTO_SYNC` can reconcile BandaGo. Order cancellation/rejection/refund/expiry calls `cancelOrderPosDeduction` to cancel unsynced jobs or queue a compensating `REFUND_RESTOCK` job. Deleting a `Product` cascades its outbound jobs; deleting an `Order` nulls `orderId` (`SetNull`).

## Reading notes

- Relationship lines reflect **foreign-key reality**, including where FKs are absent (`Order.riderId`, `NotificationDelivery.userId/staffId`, `AuditLog.entity*`).
- Cascade behavior matters: children of `Order`/`Product`/`ServiceBooking` cascade; the orphan-preserving exceptions (`Order.user`, `Order.prescriptions`, `Product.category`, `Prescription.user`, `Prescription.order`, `ServiceBooking.service`, `ServiceBooking.assignedStaff`) are listed in [schema-overview.md](schema-overview.md#5-orphan-preserving-non-cascade-relations).
- Status value sets shown in entity comments are abbreviated; the canonical tables live in [schema-overview.md](schema-overview.md#3-string-statuses-canonical-values-in-srclibconstants-ts).
