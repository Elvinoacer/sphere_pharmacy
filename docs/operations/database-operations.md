# Database Operations Runbook

Operational procedures for the Sphere Pharmacy PostgreSQL database: connection resolution, migration workflow, the guarded seed, safe schema change practice, production safety rules, monitoring queries, and the Prisma errors you are most likely to meet. Deep schema reference: [../database/migrations.md](../database/migrations.md).

| Audience | Status | Verified |
| --- | --- | --- |
| Developers, operators | **Implemented** | November 2026 |

## Connection management

`src/lib/db.ts`:

- Resolves the connection URL in this order: `DATABASE_URL` → `sphere_pharmacy_PRISMA_DATABASE_URL` → `sphere_pharmacy_DATABASE_URL` → `sphere_pharmacy_POSTGRES_URL`, and **throws** when none is set.
- Maintains a **singleton client** on `globalThis` (prevents connection exhaustion from hot-reload in dev).
- Detects pooled Neon URLs (hostname contains `-pooler.`) and appends `statement_cache_size=0` unless already present — this prevents the PgBouncer stale-prepared-plan error (`0A000`) after schema changes.
- Logs at `["warn", "error"]` only.
- Exposes `db` and `prisma` as the same instance; `db.productCategory` aliases `db.category` (kept for blueprint compatibility).

Practical rules: use the pooled URL for the app, the direct (non-pooler) URL for one-off `prisma migrate` commands when the provider distinguishes them, and never point more environments than intended at one database.

## Migration workflow

- **Local development:** edit `prisma/schema.prisma`, then `npm run db:migrate` (`prisma migrate dev`) to generate + apply a named migration.
- **CI / production:** `npx prisma migrate deploy` — applies **committed** migrations only, never generates. CI runs this after typecheck/lint and before tests.
- **Status check:** `npx prisma migrate status`.
- `migration_lock.toml` pins the provider to `postgresql` — do not change it.

The ten committed migrations (chronological, 2026 timestamps):

| # | Migration | One-liner |
| --- | --- | --- |
| 1 | `20260902000000_initial` | Initial schema for the platform build. |
| 2 | `20260903000000_security_hardening` | Adds `lastSeenAt`, `authVersion`, drops the plaintext OTP code column. |
| 3 | `20260905100000_notification_delivery` | Durable `NotificationDelivery` outbox (+ suppression / delivery-event support). |
| 4 | `20261022000000_medicine_requests` | Guest medicine-request queue with private photo storage. |
| 5 | `20261027170000_booking_management_lookup_indexes` | Lookup indexes for service-booking management. |
| 6 | `20261027183500_promotion_redemption_limits` | Per-user/IP/browser promotion redemption limits. |
| 7 | `20261028000000_order_payment_intent` | Nullable order payment-intent fields for safe cash-on-delivery dispatch. |
| 8 | `20261028190000_private_promotion_visibility` | `isPublic` gating for share-only promotion codes. |
| 9 | `20261028194500_admin_live_cursor_indexes` | Cursor-pair indexes (`updatedAt,id` / `createdAt,id`) for low-cost admin live updates. |
| 10 | `20261104200000_add_bandago_pos_support` | POS/CRM tables and columns: `externalPosId`, `ProductBatch`, `PosSyncLog`, CRM user fields. |

## `db:push` — development only

`npm run db:push` runs `prisma db push --accept-data-loss`: it force-syncs the schema with **no migration history** and **accepts data loss** by design (the flag is baked into the script). It is acceptable only for a throwaway local database or a brand-new empty database. **Never run it against production or any database with real data** — prefer `migrate deploy`, and if the schema has drifted, resolve the drift deliberately (see [Common Prisma errors](#common-prisma-errors)).

## Seed (guarded)

`prisma/seed.ts` is deliberately minimal: 7 categories, plus optionally one dev ADMIN (requires `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` ≥ 14 chars). Guards: refuses when `NODE_ENV=production`; requires `ALLOW_DESTRUCTIVE_SEED=true`; non-localhost hosts require `SEED_DATABASE_ACK` equal to the host. It never creates products, customers, orders, prescriptions, or clinical history. Full detail and the older-README correction: [local-development.md](local-development.md).

## Adding schema changes safely

A schema change in this codebase touches **four** places, not one:

1. **Migration** — `prisma/schema.prisma` + a named migration via `prisma migrate dev`.
2. **Constants** — most statuses are **strings validated in code, not Prisma enums** (`src/lib/constants.ts`, workflow guards). The only schema-level enums are the BandaGo `PosSyncTrigger`/`PosSyncStatus` pair (see [../governance/architecture-decisions.md](../governance/architecture-decisions.md) ADR-004). Add new status values to the canonical lists first.
3. **DTO layer** — `src/lib/dto.ts` serializes to API shapes (`moneyNumber`, ISO dates, status casts). New columns need explicit DTO mapping; note `toPrescriptionDTO` hardcodes `fileUrl: null` / `storageKey: null` so storage keys never leak.
4. **API contract** — update [../api/api-reference.md](../api/api-reference.md) and `openapi/sphere-api.yaml`, and extend the relevant test suite (`tests/*.test.mjs`).

Also remember raw-SQL touchpoints: the inventory decrements quote snake_case columns (`"virtual_reserved_stock"`, `"in_stock"`), so column renames must update the raw SQL too.

Worked example — adding a nullable `preferredContact` column to `User`:

1. `schema.prisma`: add `preferredContact String?` → `npm run db:migrate` → name it e.g. `add_user_preferred_contact`.
2. No new status values involved, so constants are untouched (had it been a status, extend the canonical list in `src/lib/constants.ts` **and** any workflow guards first).
3. `dto.ts`: expose it on the user DTO only if the client needs it (never expose `passwordHash`, storage keys, or POS internals).
4. Update [../api/api-reference.md](../api/api-reference.md) / `openapi/sphere-api.yaml` and add assertions to the relevant `tests/*.test.mjs` suite.
5. Commit migration + code together; CI applies the migration before tests run, so a missing migration fails loudly.

## Production database safety

- **Never seed production.** The seed refuses `NODE_ENV=production` by design; do not work around it.
- **Backups are an operational responsibility** — no automated backup tooling exists in-repo. See [backup-and-restore.md](backup-and-restore.md).
- **Connection limits** — external providers cap connections. The app uses a single Prisma client (singleton), the pooled URL is expected on Neon, and `statement_cache_size=0` is applied automatically. Avoid ad-hoc long-lived connections from scripts against the pooled endpoint.
- **Serializable transactions** — checkout, payment callbacks, cash-confirm, refunds, payment-attempt reservation, and refills use `Serializable` isolation with bounded timeouts (15–30s; the BandaGo sync chunks use `maxWait 10s` / `timeout 30s`). Keep any new transactional code within those budgets; long Serializable transactions are the classic cause of pool starvation under load.
- **Destructive operations** — `prisma migrate reset` (db:reset) drops data; production refund/`REFUNDED` transitions and prescription retention deletions are deliberate, audited application paths, not substitutes for ops tooling.

## Monitoring queries

Useful targets for ad-hoc checks (run with the Prisma console or SQL client; scope reads narrowly):

- **PosSyncLog** (`pos_sync_logs`) — BandaGo sync health: `status` (SUCCESS/PARTIAL/FAILED), `itemsReceived/Upserted/Failed`, `durationMs`, `details` (errors capped at 50). Surfaced in-app via `GET /api/admin/pos-status`.
- **NotificationDelivery** — dispatcher health: group by `status` (PENDING/PROCESSING/SENT/FAILED/…), `oldestPendingAt`, `attempts`, `lastError`. Surfaced via `GET /api/admin/notification-health` (ADMIN) — prefer the endpoint; it leaks no message bodies.
- **RateLimitBucket** — `windowEnds` index exists for sweeping stale fixed-window buckets; if the table grows unbounded, sweep rows with `windowEnds < now()` during a quiet window.
- **AuditLog** — the admin audit trail (`GET /api/admin/audit`, latest 200).
- **EmailSuppression / EmailDeliveryEvent** — bounced/complained addresses and unprocessed provider events.

Illustrative SQL (read-only):

```sql
-- Notification queue depth and age
SELECT status, channel, count(*), min(available_at) AS oldest
FROM "NotificationDelivery" GROUP BY status, channel ORDER BY status;

-- BandaGo sync outcomes, last 7 days
SELECT status, count(*), avg("durationMs") AS avg_ms
FROM pos_sync_logs WHERE "startedAt" > now() - interval '7 days'
GROUP BY status;

-- Stale rate-limit buckets eligible for a sweep
SELECT count(*) FROM "RateLimitBucket" WHERE "windowEnds" < now();

-- Payments stuck in PROCESSING (reconciliation backlog — see ADR-008)
SELECT id, "orderId", provider, "failureReason", "createdAt"
FROM "Payment" WHERE status = 'PROCESSING' ORDER BY "createdAt";
```

## Transaction budget reference

| Path | Isolation | Budget |
| --- | --- | --- |
| Order creation (stock decrement, promo, loyalty) | Serializable | maxWait 10s / timeout 30s |
| BandaGo sync chunks (50 items, per-item fallback) | Serializable | maxWait 10s / timeout 30s |
| Payment callbacks / cash-confirm / refunds | Serializable | ~15–30s |
| `reservePaymentAttempt`, refills | Serializable | ~15s |
| Notification enqueue | joins caller tx | 15s |

Keep new code inside these budgets; anything longer risks pool starvation on the pooled connection (see [Common Prisma errors](#common-prisma-errors)).

## Routine operational tasks

| Cadence | Task | Command / target |
| --- | --- | --- |
| Every deploy | Apply migrations, check status | `npx prisma migrate deploy` → `npx prisma migrate status` |
| Daily (via cron) | Let retention/expiry jobs run | [scheduled-jobs.md](scheduled-jobs.md) |
| Weekly | Review sync + notification health | `/api/admin/pos-status`, `/api/admin/notification-health` |
| Weekly | Review PROCESSING payments backlog | monitoring SQL above; escalate per [troubleshooting.md](troubleshooting.md) |
| Monthly | Sweep stale rate-limit buckets (if grown) | delete `RateLimitBucket` rows with `windowEnds < now()` in a quiet window |
| Monthly | Verify backups restored-clean | [backup-and-restore.md](backup-and-restore.md) verification steps |
| Quarterly | Access review on database credentials and dump storage | [backup-and-restore.md](backup-and-restore.md) security section |

## Common Prisma errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `P2021` / `P2022` | Table/column does not exist — **migrations pending** (schema expects objects the database lacks) | Run `npx prisma migrate deploy`; verify with `npx prisma migrate status`. Never `db:push` production. |
| `P1001` / `P1002` | Database unreachable / timed out connecting | Check the URL variables (all four unset → `db.ts` throws its own error first), network/firewall, and provider status; see [troubleshooting.md](troubleshooting.md). |
| `0A000` | Stale prepared statement on a pooled connection (plan cached across a schema change) | Confirm the app is using the `-pooler` URL so `db.ts` sets `statement_cache_size=0`; restart the app to clear in-memory plans after migrating. |
| Pool starvation (slow/`timed out` under load) | Too many concurrent long transactions | Keep Serializable transactions within the 15–30s budgets; the BandaGo sync already chunks at 50 items with per-item fallback. |

## Command cheat-sheet

```bash
npm run db:generate     # prisma generate (also runs on postinstall)
npm run db:migrate      # prisma migrate dev  — local: generate + apply + commit
npm run db:push         # prisma db push --accept-data-loss — DEV ONLY
npm run db:reset        # prisma migrate reset — drops and replays (dev only)
npx prisma migrate deploy   # CI/production: apply committed migrations only
npx prisma migrate status   # audit applied/pending state
ALLOW_DESTRUCTIVE_SEED=true bun prisma/seed.ts   # guarded minimal seed (dev)
```

## Related reading

- [../database/migrations.md](../database/migrations.md) — migration-by-migration detail.
- [environment-variables.md](environment-variables.md) — the four accepted URL variables and pooling notes.
- [scheduled-jobs.md](scheduled-jobs.md) — jobs that write to these tables on a schedule.
- [backup-and-restore.md](backup-and-restore.md) — dumps, restore drills, and the system's own deletion paths.
- [troubleshooting.md](troubleshooting.md) — the Prisma-error table is cross-linked from there.
