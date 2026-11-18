# Scheduled Jobs (Cron) Runbook

Sphere Pharmacy exposes five authenticated cron endpoints that together drain the notification outbox, expire stale inventory reservations, send service-booking reminders, prompt chronic refills, and enforce the prescription retention policy. **The repository contains no scheduler** — the platform (Vercel Cron config, a system crontab, or an external monitor) must call these endpoints on schedule. This runbook documents each job, the required cadences, example crontab lines, monitoring, failure modes, and manual recovery.

| Audience | Status | Verified |
| --- | --- | --- |
| Operators, DevOps | **Implemented** (endpoints) / **Environment-dependent** (scheduling) | November 2026 |

## Scheduler setup checklist

When bringing up any environment, in order:

1. Generate a ≥ 32-character `CRON_SECRET` unique to that environment ([environment-variables.md](environment-variables.md)).
2. Choose the scheduling mechanism: system crontab (standalone/Caddy deployments), Vercel Cron (Vercel deployments), or an external uptime/cron service issuing authenticated GETs.
3. Register the five endpoints at their cadences (table above) and verify each returns its `{"ok":…}` shape manually once.
4. Set `ORDER_RESERVATION_TTL_MINUTES` (15–10,080) and `PRESCRIPTION_RETENTION_DAYS` (30–36,500) — otherwise those two jobs will 503 on every run.
5. Point `NEXT_PUBLIC_APP_URL` at the HTTPS production origin (notification links depend on it).
6. Add alerting: non-2xx responses from the scheduler, and `oldestPendingAt` growth in `/api/admin/notification-health`.
7. Document the chosen mechanism in the deployment record — this is per-environment configuration the repo cannot carry.

## Authentication

All five endpoints are **GET** and require:

```
Authorization: Bearer <CRON_SECRET>
```

`CRON_SECRET` must be ≥ 32 characters or every call fails. `/api/cron/notifications` compares the token with `timingSafeEqual` (via `authorizedJob()`); the other four use a plain comparison — a known LOW-severity issue in [../governance/technical-debt.md](../governance/technical-debt.md). Configure the secret per [environment-variables.md](environment-variables.md).

## Runbook table

| Endpoint | Cadence | What it does | Required env (else 503) | Response shape |
| --- | --- | --- | --- | --- |
| `/api/cron/notifications` | **Every minute** | Dispatches ≤ 10 `NotificationDelivery` jobs (email via Resend, push via FCM); claims leases, honors backoff (max 8 attempts, `min(3600, 60·2^(attempts−1))` s), reconciles email delivery events. `maxDuration 300`. | `CRON_SECRET` | `{accepted, failed, skipped}` |
| `/api/cron/service-booking-reminders` | **≥ every 15 min** | Queues 24h (23.5–24.5h ahead) and 2h (1.5–2.5h) `SERVICE_BOOKING_REMINDER_*` notifications for PENDING/CONFIRMED/RESCHEDULED bookings; stable dedupe keys `${event}:${bookingId}:${scheduledStart}`; fail-fast 503 "Could not queue all reminders. Retry this job." on the first error. | `CRON_SECRET` | `{ok, queued}` |
| `/api/cron/order-reservations` | TTL-driven (see env) | Cancels stale unpaid orders in batches of 100, restores stock, re-credits redeemed points (`expire:{orderId}`), fails dangling payments, writes status history (actor SYSTEM). | `ORDER_RESERVATION_TTL_MINUTES` (15–10,080) | `{ok, released}` |
| `/api/cron/chronic-refills` | Daily is typical | Finds customers with a ≥ 30-day-old completed order containing a prescription item and no newer Rx order; sends IN_APP + email reminders with a ≤ 7-day per-patient throttle; time-based only (no dosage inference). | `CRON_SECRET` | `{ok, eligible, notified}` |
| `/api/cron/prescription-retention` | Daily is typical | Hard-deletes prescriptions soft-deleted more than `PRESCRIPTION_RETENTION_DAYS` ago, in batches of 100; deletes the R2 object first; **skips storage keys shared with another row** (refill copies); R2 failure skips the row. | `PRESCRIPTION_RETENTION_DAYS` (30–36,500) | `{ok, removed}` |

Notes on the two env-gated jobs: both return **503** without their variable — a deliberate fail-closed design so retention/TTL never runs with an accidental default. CI sets `ORDER_RESERVATION_TTL_MINUTES=60` and `PRESCRIPTION_RETENTION_DAYS=365`. The BandaGo blueprint cites a 2-year (Kenya PPB Cap 244) retention intent; choose the production value deliberately.

## CRITICAL: scheduling is external

There is **no in-repo scheduler and no `vercel.json`**. If nothing calls these endpoints:

- notification jobs pile up `PENDING` (emails/push never send — including password-adjacent and order/prescription updates),
- unpaid orders hold reserved stock indefinitely,
- booking reminders never fire,
- chronic-refill outreach stops,
- soft-deleted prescriptions are retained forever (compliance exposure).

The payment/notification audit's operational requirements make this explicit: schedule `/api/cron/notifications` **every minute** and reminders **at least every 15 minutes**, set `NEXT_PUBLIC_APP_URL` to the HTTPS production origin, monitor `/api/admin/notification-health`, and define a **retention policy for queued payloads** (decide how long undeliverable `NotificationDelivery` rows may remain before pruning — none is automated in-repo).

### Example crontab (system scheduler)

```cron
# Sphere Pharmacy cron — replace https://app.example.com and load CRON_SECRET
# from a root-only file (e.g. /etc/sphere-cron-secret) to keep it out of ps output.
* * * * *   curl -fsS -H "Authorization: Bearer $(cat /etc/sphere-cron-secret)" https://app.example.com/api/cron/notifications
*/15 * * * * curl -fsS -H "Authorization: Bearer $(cat /etc/sphere-cron-secret)" https://app.example.com/api/cron/service-booking-reminders
*/5 * * * * curl -fsS -H "Authorization: Bearer $(cat /etc/sphere-cron-secret)" https://app.example.com/api/cron/order-reservations
0 7 * * *   curl -fsS -H "Authorization: Bearer $(cat /etc/sphere-cron-secret)" https://app.example.com/api/cron/chronic-refills
30 2 * * *  curl -fsS -H "Authorization: Bearer $(cat /etc/sphere-cron-secret)" https://app.example.com/api/cron/prescription-retention
```

Cadence rationale: notifications is every minute because dispatch is bounded at 10 jobs per run (steady-state drain; tighten temporarily to drain a backlog). Reminders run at least every 15 minutes because the 24h/2h reminder windows are ± 30 minutes wide — a 15-minute cadence guarantees every eligible booking is caught. Order-reservations is shown at */5 (any sub-TTL cadence works; the TTL env defines staleness, the cron defines how promptly stock is returned). Chronic-refills and retention are daily housekeeping (retention at 02:30 local, off-peak).

On Vercel, declare the same cadences with Vercel Cron entries (or any external monitor that issues the authenticated GETs). `/api/cron/notifications` already sets `maxDuration 300`.

### Manual invocation (verification / recovery)

```bash
# All jobs are idempotent — safe to run by hand at any time.
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.example.com/api/cron/notifications
# → {"accepted":N,"failed":N,"skipped":N}

curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.example.com/api/cron/service-booking-reminders
# → {"ok":true,"queued":N}

curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.example.com/api/cron/order-reservations
# → {"ok":true,"released":N}   (503 if ORDER_RESERVATION_TTL_MINUTES is unset/out of range)

curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.example.com/api/cron/chronic-refills
# → {"ok":true,"eligible":N,"notified":N}

curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.example.com/api/cron/prescription-retention
# → {"ok":true,"removed":N}   (503 if PRESCRIPTION_RETENTION_DAYS is unset/out of range)
```

A `401` on any of these means the `Authorization` header/secret is wrong (or below 32 chars); a `503` on the two env-gated jobs means their variable is missing or out of range.

## Monitoring

- **`GET /api/admin/notification-health`** (ADMIN) — the primary health surface: counts by channel/status, `oldestPendingAt`, last 20 FAILED/BOUNCED/COMPLAINED jobs (id, attempts, lastError), and configured flags for email/email-webhook/push/scheduler secret. Alert when `oldestPendingAt` exceeds a few minutes or FAILED counts grow.
- **`GET /api/admin/pos-status`** (staff) — PosSyncLog tail, if BandaGo is in use.
- Scheduler-side: alert on non-2xx (401 = secret wrong/missing; 503 = env-gated job misconfigured) and on the cron *itself* not running (dead-man's-switch monitor).

## Manual recovery

**Re-running any job is safe** — they are idempotent by design:

- **notifications** — jobs are claimed atomically (lease `lockToken` + `lockedUntil`); crashed jobs revert to claimable when the 120s lease expires; `PROCESSING` rows with expired leases are picked back up.
- **service-booking-reminders** — stable dedupe keys make retries no-op for already-queued reminders.
- **order-reservations** — orders are claimed via optimistic `version` guards; released orders are excluded by status.
- **chronic-refills** — 7-day per-patient throttle and dedupe keys prevent duplicates.
- **prescription-retention** — deleted rows are simply absent next run; shared-key skips are deterministic.

If the queue backs up: fix the scheduler/secret, then let the every-minute dispatcher drain (10 jobs/minute steady-state); for a large backlog, temporarily tighten the scheduler interval rather than raising the batch (the limit is fixed at 10 per run).

## Failure modes per job

| Job | Failure mode | Operator action |
| --- | --- | --- |
| notifications | 401 → wrong `CRON_SECRET`; provider failures → retries with backoff, FAILED after 8 attempts / 23h window; emails to suppressed addresses → SKIPPED | Verify secret; check Resend/FCM config; inspect `lastError` in notification-health; prune or investigate suppressed recipients. |
| service-booking-reminders | 503 fail-fast if any reminder fails to queue | Retry the job (safe); check database health and `NotificationDelivery` writes. |
| order-reservations | 503 without `ORDER_RESERVATION_TTL_MINUTES` (or out of 15–10,080 range) | Set the variable and redeploy/restart; then re-run. |
| chronic-refills | Email failures surface later in the dispatcher, not the cron itself | Check notification-health after the run; reminder queuing itself is transactional. |
| prescription-retention | 503 without `PRESCRIPTION_RETENTION_DAYS`; R2 failure skips rows (soft-fail) | Set the variable; check R2 credentials/`R2_ENDPOINT`; the job will pick up skipped rows next run. |

## Job-by-job notes

### `/api/cron/notifications` — the dispatcher (every minute)

Claims due jobs (`PENDING` with `availableAt ≤ now`, plus `PROCESSING` rows whose 120s lease has expired — crash recovery), marks them `PROCESSING` with a random `lockToken`, re-validates recipient existence/activation and preferences (opt-out ⇒ `SKIPPED`), and enforces a 23-hour retry window (expiry ⇒ `FAILED` "Retry window expired"). Email sends carry an `Idempotency-Key` equal to the job id (provider-side dedupe); push re-verifies token ownership before sending. After the batch it reconciles up to 100 unprocessed `EmailDeliveryEvent` rows (events can arrive before the send response returns), maps delivered/bounced/complained, and upserts `EmailSuppression`. Backoff between attempts is `min(3600, 60·2^(attempts−1))` seconds, hard stop at 8 attempts.

### `/api/cron/service-booking-reminders` — ≥ every 15 minutes

Eligible bookings are PENDING/CONFIRMED/RESCHEDULED (rescheduled bookings are reminded at their **new** time). The dedupe key `${event}:${bookingId}:${scheduledStart ISO}` makes retries no-ops, so the fail-fast 503 ("Could not queue all reminders. Retry this job.") is always safe to honor with an immediate retry.

### `/api/cron/order-reservations` — TTL-driven

Targets orders in `[RECEIVED, UNDER_REVIEW, PRESCRIPTION_VERIFIED, AVAILABILITY_CONFIRMED, AWAITING_PAYMENT]` (plus legacy `PENDING`) whose `inventoryReservedAt` predates the TTL cutoff and which have no SUCCESS payment, claimed through optimistic `version` guards in batches of 100. Release side-effects, all idempotent: stock restored, redeemed points re-credited (`expire:{orderId}` → `RESERVATION_EXPIRED`), dangling PENDING/PROCESSING payments failed, status history written with actor SYSTEM ("Inventory reservation expired before payment."). This is the release path for ADR-005's physical reservations — without it, unpaid orders hold stock forever.

### `/api/cron/chronic-refills` — outreach

Eligibility: an order ≥ 30 days old in a completed-delivery status containing at least one prescription item, with no newer non-CANCELLED/REJECTED Rx order for that identity. Reminders are IN_APP + email listing prescription-only medicine names, throttled to one `CHRONIC_REFILL_REMINDER` per patient per 7 days, linking to `${NEXT_PUBLIC_APP_URL}/orders/{id}`. Purely time-based — no dosage inference.

### `/api/cron/prescription-retention` — compliance

Cutoff is computed from the **soft-delete time** (`deletedAt`), not creation. Rows are processed in batches of 100; the R2 object is deleted before the database row, and a storage key shared with any other row (refill copies share keys) is deliberately skipped so a refill's live prescription is never destroyed by an older copy's expiry. R2 failures skip the row for a later run.

## Related reading

- [deployment.md](deployment.md) — where scheduling plugs into each deployment pattern.
- [environment-variables.md](environment-variables.md) — `CRON_SECRET`, TTL and retention variables.
- [../payment-notification-audit.md](../payment-notification-audit.md) — the audit's operational requirements for the notification pipeline.
- [troubleshooting.md](troubleshooting.md) — "queue not draining" and related symptoms.
- [database-operations.md](database-operations.md) — the tables these jobs write (NotificationDelivery, orders, prescriptions).
- [../governance/architecture-decisions.md](../governance/architecture-decisions.md) — ADR-005 (reservations) and ADR-006 (outbox) explain the job designs.
