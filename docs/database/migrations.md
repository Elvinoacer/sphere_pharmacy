# Database Migrations

This document records every Prisma migration in `prisma/migrations/` in chronological order, explains how migrations are applied in CI and locally, defines the workflow for adding new models or fields, and states the verified truth about `prisma/seed.ts` (which is far more minimal than older documentation claims). For day-to-day operational procedures see [../operations/database-operations.md](../operations/database-operations.md); for the schema itself see [schema-overview.md](schema-overview.md).

| Audience | Status | Verified |
| --- | --- | --- |
| Engineers, AI coding agents | Implemented — verified against code | November 2026 |

## Applying migrations

| Environment | Command | Notes |
| --- | --- | --- |
| CI / deployment | `npx prisma migrate deploy` | Non-interactive; applies pending migrations in order. CI (`.github/workflows/ci.yml`) runs it against a `postgres:16` service; `tests/security-static.test.mjs` asserts the workflow contains it. **Implemented.** |
| Local development | `bun run db:migrate` (→ `prisma migrate dev`) | Creates a new migration from schema changes, applies it, regenerates the client. |
| Local reset | `bun run db:reset` (→ `prisma migrate reset`) | Drops and replays all migrations, then runs the seed (which will refuse unless its guards are satisfied — see below). |
| Prototyping only | `bun run db:push` (→ `prisma db push --accept-data-loss`) | Pushes schema without creating a migration file. **Never use on a shared or production database** — the `--accept-data-loss` flag is part of the script itself. |
| Client generation | `prisma generate` | Runs on `build` (`prisma generate && next build`) and on `postinstall`. |

`prisma/migrations/migration_lock.toml` contains `provider = "postgresql"` — Prisma's guard that prevents migrations from being applied to a database of a different provider.

## Migration history (chronological)

Ten migrations, year-2026 timestamps. `prisma migrate deploy` applies them in this order.

| # | Migration | One-line summary |
| --- | --- | --- |
| 1 | `20260902000000_initial` | Baseline schema: 33 tables across all domains. |
| 2 | `20260903000000_security_hardening` | Security/integrity pass: session + OTP hardening, money precision, guest access, idempotency keys, exclusion constraint, staff session purge. |
| 3 | `20260905100000_notification_delivery` | Durable notification outbox: `NotificationDelivery`, `EmailSuppression`, `EmailDeliveryEvent`. |
| 4 | `20261022000000_medicine_requests` | Guest medicine-sourcing requests: `MedicineRequest` table with status CHECK. |
| 5 | `20261027170000_booking_management_lookup_indexes` | Additive `ServiceBooking` indexes for queues/filters/staff schedules. |
| 6 | `20261027183500_promotion_redemption_limits` | Per-IP and per-browser promotion limits with hashed redemption scope. |
| 7 | `20261028000000_order_payment_intent` | `Order.paymentMethod` — persist the checkout payment choice. |
| 8 | `20261028190000_private_promotion_visibility` | `Promotion.isPublic` — code-only (private) promotions. |
| 9 | `20261028194500_admin_live_cursor_indexes` | Cursor pagination indexes for the staff live monitor. |
| 10 | `20261104200000_add_bandago_pos_support` | BandaGo/iDempiere POS integration: enums, POS columns, `product_batches`, `pos_sync_logs`. |
| 11 | `20261119120000_add_bandago_bidirectional_sync` | Bi-directional POS reconciliation & telemetry: `pos_outbound_jobs`, `pos_sync_incidents`, POS drift baseline columns, `PosSyncDirection` & outbound enums. |

### 1. `20260902000000_initial`

Creates the 33 baseline tables: `User`, `Address`, `Session`, `OtpCode`, `StaffUser`, `Category`, `Product`, `Review`, `ProductAlert`, `Order`, `OrderItem`, `OrderStatusHistory`, `Prescription`, `PrescriptionAccessLog`, `Payment`, `Promotion`, `PromotionRedemption`, `LoyaltyLedger`, `AuditLog`, `Notification`, `NotificationPref`, `PushToken`, `Service`, `ServiceImage`, `ServiceAvailability`, `ServiceBooking`, `ServiceBookingStatusHistory`, `ServicePayment`, `PaymentWebhookEvent`, `ServiceReview`, `Setting`, `RateLimitBucket`, `ScheduledJobDelivery` — plus their uniques (e.g. `Order.reference`, `Payment.(provider, providerReference)`, `LoyaltyLedger.eventKey`, `ServiceAvailability` interval). `OtpCode` still stored a plaintext `code` at this point.

### 2. `20260903000000_security_hardening`

A large hardening pass, written defensively (`IF NOT EXISTS` / `IF NOT EXISTS` guards) so it also repairs databases that predate the baseline. Key changes:

- **Session & OTP hardening:** `User.phoneVerifiedAt`, `StaffUser.authVersion`, `Session.lastSeenAt` + `Session.authVersion`; `OtpCode.codeHash` (backfilled with random sha256, then `NOT NULL`) and `OtpCode.attempts`; **drops the plaintext `OtpCode.code` column**. Purges all staff sessions (`DELETE FROM "Session" WHERE "staffId" IS NOT NULL`).
- **Money precision:** re-types all money columns to `DECIMAL(12,2)` with 2-dp rounding (`Product`, `Order`, `OrderItem`, `Payment`, `Service`, `ServiceBooking`, `ServicePayment`).
- **Order integrity:** adds `guestEmail`, `guestAccessTokenHash`, `guestAccessExpiresAt`, `inventoryReservedAt`, `inventoryReleasedAt`, `version` (optimistic lock) to `Order`; `deletedAt` to `Prescription`.
- **Payment idempotency:** `currency` (default `KES`), `eventId`, `idempotencyKey` on `Payment`/`ServicePayment`; `refundReference` on `Payment`.
- **Promotion limits:** `maxUses`, `perUserLimit`, `minimumSpend` on `Promotion`.
- **Duplicate normalization before uniques:** invalidates duplicate promo codes, pickup codes and provider references (keeps the earliest, NULLs the rest), then creates the unique indexes — including the partial unique `Address_one_default_per_user` (one default address per user) and the `ServiceAvailability` interval unique.
- **Hot-path indexes:** session, OTP, order, order-item, status-history, prescription, payment, review and audit lookups.
- **New tables (idempotent):** `PrescriptionAccessLog`, `PromotionRedemption`, `LoyaltyLedger`, `RateLimitBucket`, `ScheduledJobDelivery`, `PaymentWebhookEvent` — created here for pre-baseline databases.
- **Booking integrity:** PostgreSQL exclusion constraint `ServiceBooking_no_overlap` (gist, `serviceId` + `tsrange(scheduledStart, scheduledEnd)`, live statuses only) and the `btree_gist`/`pgcrypto` extensions it needs.

### 3. `20260905100000_notification_delivery`

Adds the durable email/push delivery outbox and its email-safety companions — **additive only**: `NotificationDelivery` (unique `dedupeKey`, `(status, availableAt)` index), `EmailSuppression` (natural-key `email`), `EmailDeliveryEvent` (`(processed, createdAt)` index).

### 4. `20261022000000_medicine_requests`

Creates `MedicineRequest` (guest-submitted medicine sourcing requests) with a `CHECK` constraint pinning `status` to `NEW`/`CONTACTED`/`FULFILLED`/`UNAVAILABLE` and a `(status, createdAt)` queue index.

### 5. `20261027170000_booking_management_lookup_indexes`

Three additive `ServiceBooking` indexes for the booking management console at scale: `(scheduledStart, id)`, `(status, scheduledStart, id)`, `(assignedStaffId, scheduledStart)`. No data changes.

### 6. `20261027183500_promotion_redemption_limits`

Adds `Promotion.perIpLimit` and `Promotion.perBrowserLimit`, plus `PromotionRedemption.ipHash`/`browserHash` (pseudonymous HMAC scope) with the two indexes backing those limit checks.

### 7. `20261028000000_order_payment_intent`

Adds nullable `Order.paymentMethod` so unpaid delivery orders record the checkout payment choice (existing orders stay `NULL` — unknown intent, cannot be auto-enabled for COD).

### 8. `20261028190000_private_promotion_visibility`

Adds `Promotion.isPublic BOOLEAN NOT NULL DEFAULT true`; existing promotions remain public, private codes still redeem when supplied.

### 9. `20261028194500_admin_live_cursor_indexes`

Cursor pairs `(updatedAt, id)` and `(createdAt, id)` on `Order` and `ServiceBooking` for the staff live-change monitor's latest-change/latest-arrival lookups. No data modified.

### 10. `20261104200000_add_bandago_pos_support`

The BandaGo/iDempiere POS integration layer:

- **Enums:** `PosSyncStatus` (`SUCCESS`/`PARTIAL`/`FAILED`) and `PosSyncTrigger` (`EXTENSION_STREAM`/`BACKGROUND_POLL`/`CSV_IMPORT`/`MANUAL_RECONCILE`).
- **`User`:** `external_bpartner_id` (unique + index), `loyalty_points_balance`, `pos_credit_balance DECIMAL(10,2)`, `is_chronic_patient`.
- **`Product`:** `slug` (unique), `barcode`, `cost_price`, `stock`, `virtual_reserved_stock`, `safety_stock_buffer`, `in_stock`, `dosage_form`, `strength`, `nearest_expiry_date`, `external_pos_id` (unique + index), `pos_source` (default `BANDAGO`), `last_synced_at`, plus the `(in_stock, stock)` index.
- **New tables:** `product_batches` (unique `(product_id, batch_number)`, index `(product_id, expiry_date)`) and `pos_sync_logs` (indexes `started_at`, `status`), both snake_case-mapped.

### 11. `20261119120000_add_bandago_bidirectional_sync`

Adds durable bi-directional POS reconciliation, daily sales export batching, and error reporting:

- **Enums:** adds `PosSyncDirection`, `PosOutboundStatus`, `PosOutboundEventType`, and extends `PosSyncTrigger` (`OUTBOUND_WRITEBACK`, `MANUAL_EXPORT_RECONCILE`, `BRIDGE_ERROR`).
- **`Product`:** adds `last_pos_stock`, `last_pos_sellable_stock`, `external_warehouse_id`, `external_locator_id`, `external_org_id`, `external_client_id`.
- **`PosSyncLog`:** adds `direction` (`PosSyncDirection`, default `INBOUND`).
- **New tables:** `pos_outbound_jobs` (unique `idempotency_key`, indexes `(status, created_at)`, `(product_id, status)`, `order_id`, `export_batch_id`) and `pos_sync_incidents` (indexes `(resolved, severity, last_seen_at)`, `(code, resolved)`).

## Adding a new model or field

1. Edit `prisma/schema.prisma`. Keep the house rules: `cuid` ids (or a documented natural key), `Decimal(12,2)` for money, plain `String` statuses with canonical values added to `src/lib/constants.ts`, cascade only for true children, `@@map` snake_case only inside the POS block.
2. Run `bun run db:migrate` — Prisma diffs the schema, generates `prisma/migrations/<timestamp>_<name>/migration.sql`, applies it locally and regenerates the client. Give the migration a descriptive snake_case name.
3. **Review the generated SQL** before committing. Check for: unintended column drops, missing `IF NOT EXISTS` tolerance for environments that drift, indexes needed by your new query paths, and defaults/backfill for existing rows (see how `20261028000000_order_payment_intent` left existing rows `NULL` on purpose).
4. Commit both `schema.prisma` and the new migration folder together. CI/deployment applies it with `prisma migrate deploy`.
5. Never edit a migration that has already been applied anywhere shared — write a new one instead.
6. If the change adds status values, update `src/lib/constants.ts` and the status tables in [schema-overview.md](schema-overview.md#3-string-statuses-canonical-values-in-srclibconstants-ts) and [data-dictionary.md](data-dictionary.md) in the same change.

## Seed truth (`prisma/seed.ts`)

**The seed is minimal and guarded.** Verified behavior:

- Refuses to run when `NODE_ENV=production` **or** `ALLOW_DESTRUCTIVE_SEED≠true` ("Destructive seed refused. Set ALLOW_DESTRUCTIVE_SEED=true only for an approved non-production database.").
- Non-localhost databases additionally require `SEED_DATABASE_ACK` to equal the database hostname.
- Upserts exactly **7 categories**: `prescription`, `otc`, `pain-fever`, `cold-flu`, `vitamins`, `personal-care`, `medical-devices`.
- Optionally upserts **one dev ADMIN** — only when **both** `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are set, with the password ≥14 chars (otherwise it throws). On update it re-hashes the password, keeps `role: "ADMIN"`, `active: true`, increments `authVersion`, and purges that admin's sessions.
- Creates **no products, demo customers, orders, prescriptions, loyalty balances or clinical history** — ever.

**Correction of `PROJECT_README.md` claims.** The README instructs *"Apply the Prisma schema with `bun run db:push`, then seed it with `bun prisma/seed.ts`"* and lists a demo accounts table (`admin@spherepharmacy.co.ke` / `admin123`, a customer preloaded with 620 points, a rider with an assigned delivery) plus a demo catalogue. None of that data is produced by the seed: those accounts and datasets do not exist unless someone creates them manually, `db:push` is the prototyping path (see the `--accept-data-loss` warning above), and the seed's guards will refuse a bare `bun prisma/seed.ts` run against anything it considers unapproved. Treat the README's demo-account section as aspirational; treat this section as the verified behavior. **Requires live verification** only for what a fresh deployment's operator manually provisions on top of the seed.

## Production safety notes

- **Never run `db:push`, `db:reset` or the seed against production.** `db:push` carries `--accept-data-loss`; `db:reset` drops the database; the seed refuses `NODE_ENV=production` by design.
- **Deploy with `prisma migrate deploy` only.** It is non-interactive, applies pending migrations in filename order, and never generates drift.
- **Apply migrations in order, always.** `20260903000000_security_hardening` normalizes duplicates (invalidating some promo codes/pickup codes/provider references) and purges staff sessions — skipping it and applying later migrations directly is unsupported.
- **Connection strings:** set one of the four supported variables (see [schema-overview.md](schema-overview.md#provider-and-connection-resolution)); on Neon pooled endpoints the app appends `statement_cache_size=0` automatically — do not strip it.
- **Backup before wide migrations.** Migrations 2 and 10 alter many rows/columns; snapshot first.
- **CI parity:** CI runs the full migration chain on `postgres:16` with `PRESCRIPTION_RETENTION_DAYS=365` and `ORDER_RESERVATION_TTL_MINUTES=60`, so an unappliable migration fails the build before it can reach a real environment.

## Related documents

- [schema-overview.md](schema-overview.md) / [data-dictionary.md](data-dictionary.md) — the schema these migrations produce.
- [data-lifecycle.md](data-lifecycle.md) — retention driven by env vars the migrations' columns support.
- [../operations/database-operations.md](../operations/database-operations.md) — operational runbooks (backups, env provisioning, incident procedures).
- [../operations/scheduled-jobs.md](../operations/scheduled-jobs.md) — cron jobs that read/write these tables.
- [../../README.md](../../README.md) — project root.
