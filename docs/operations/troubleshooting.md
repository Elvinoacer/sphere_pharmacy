# Troubleshooting Guide

Symptom → likely cause → fix, organized by area, plus a "where to look" evidence map and escalation guidance. Commands reference the scripts in `package.json` and endpoints documented in [../api/api-reference.md](../api/api-reference.md).

| Audience | Status | Verified |
| --- | --- | --- |
| Staff, developers, operators | **Implemented** | November 2026 |

## Startup

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `db.ts` throws on first DB access ("Database configuration missing...") | No `DATABASE_URL` / `sphere_pharmacy_*` URL variable in the environment | Set one of the four accepted variables ([environment-variables.md](environment-variables.md)); `db.ts` uses a lazy `Proxy` so builds pass, while the standalone `start.sh` hard-fails on boot. |
| TypeScript errors about `@prisma/client` after install | Prisma client not generated | `npx prisma generate` (or reinstall — `postinstall` runs it). |
| Standalone deployment boots but health checks time out | `.next/standalone/server.js` missing from the artifact (build produced non-standalone output) | The `.zscripts/build.sh` guard self-heals this at build time; if deploying manually, ensure `STANDALONE=true` build and that `build:standalone` copied `.next/static` + `public/` in. See [deployment.md](deployment.md). |
| App runs but every page 500s after a schema edit | Prisma client generated from an older schema, or migrations pending | Regenerate client; `npx prisma migrate status`; see Database below. |

## Database

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Prisma `0A000` (stale prepared statement) after deploying a migration | Pooler cached a plan across the schema change | Use the `-pooler` URL so `db.ts` sets `statement_cache_size=0`; restart the app to clear in-memory plans. |
| `P2021` / `P2022` (table/column missing) | Migrations not applied in this environment | `npx prisma migrate deploy`, re-check `migrate status`. |
| `P1001` / `P1002` (unreachable / connect timeout) | Wrong URL, network/firewall, or provider outage | Verify URL variables, provider status page, local network; check you are not exhausting provider connection limits with ad-hoc clients. |
| Requests stall under load | Connection-pool starvation from long Serializable transactions | Keep transactions within the 15–30s budgets; the BandaGo sync already chunks at 50 items — do not add unbounded serial writes. See [database-operations.md](database-operations.md). |

## Payments

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| STK push never arrives on the phone | Sandbox vs production mismatch, wrong shortcode, or callback URL/token misconfigured | Confirm `MPESA_ENVIRONMENT`, Daraja credentials, `MPESA_CALLBACK_URL` (HTTPS in production) and `MPESA_CALLBACK_TOKEN` (≥ 24 chars) — the audit found these missing in the original local env. |
| Webhooks return 401 | `?token=` does not match `MPESA_CALLBACK_TOKEN`, or IntaSend signature/secret mismatch, or Resend `whsec_` secret wrong | Re-align provider dashboard values with env; all three webhooks verify signatures/tokens timing-safe. |
| Payment stuck `PROCESSING` | Uncertain provider outcome — **by design never auto-reset**; the row carries a "reconcile before another attempt" note | Reconciliation is webhook/callback-driven (read-only status endpoints do not reconcile). One active attempt per order is enforced (`reservePaymentAttempt`). Late/historical payment recovery is a known open gap — see [../payment-notification-audit.md](../payment-notification-audit.md). |
| Refund needed for M-Pesa | M-Pesa Express refunds are a manual B2C process | Complete and verify in the M-Pesa organisation portal first; the refund endpoint then refuses to record M-Pesa refunds until that is done. IntaSend refunds are initiated via API (`REFUND_PENDING` → COMPLETED); cash refunds need an explicit till reference. |
| Card checkout returns, order still unpaid | Returning from IntaSend hosted checkout **never** establishes success | Only the verified webhook (which re-fetches the invoice) sets SUCCESS. Check webhook config and `Payment` rows. |

## Notifications

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Queue not draining (`PENDING` grows) | Cron scheduler missing/misconfigured, or `CRON_SECRET` wrong (< 32 chars fails) | Schedule `/api/cron/notifications` every minute ([scheduled-jobs.md](scheduled-jobs.md)); check `GET /api/admin/notification-health`. |
| Emails not arriving but jobs SENT | Recipient previously bounced/complained (EmailSuppression) or Resend from-address unverified | Inspect suppression entries and notification-health; production refuses unverified `@resend.dev` senders. |
| Push not delivered | Device token not registered, VAPID key missing, or FCM service account unset | Client requires secure context + service worker + `NEXT_PUBLIC_FIREBASE_*` + VAPID key; use the ADMIN dispatch-test endpoint to distinguish "no registered device" from provider failure. |
| Old emails still being retried | Backoff window (max 8 attempts / 23h) | Wait or accept FAILED; define the queued-payload retention policy the audit asked for. |

## Prescriptions

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Upload rejected 400 | Ownership/metadata mismatch on direct R2 upload | The route verifies key prefix `prescriptions/{userId}/`, HeadObject `ownerid`, category and size — re-upload through the UI flow; see [../security/file-storage-security.md](../security/file-storage-security.md). |
| Download returns 503 | R2 presign failure (credentials/endpoint/key) | Check `R2_*` env; confirm the object exists at the stored key. |
| Refill blocked | Eligibility: refills exhausted, validity expired, or stock insufficient | Pharmacist review flow; refills always create a new PENDING prescription for re-verification. |
| Retention never deletes | `PRESCRIPTION_RETENTION_DAYS` unset (503) or rows share storage keys with refills | Set the variable; shared-key skips are intentional (refill copies). |

## BandaGo sync

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Sync returns 401 "Invalid POS Sync Credentials" | Bearer ≠ `BANDAGO_SYNC_API_KEY`, variable unset (route fails closed on Bearer auth), or staff session lacks ADMIN/PHARMACIST | Set a strong random `BANDAGO_SYNC_API_KEY` (never the retired placeholder); admin CSV uploads use the `sphere_session` cookie automatically. |
| Sync returns 403 `TENANT_MISMATCH` | Chrome bridge sent a packet from a different BandaGo clinic (`AD_Client_UU`) than `policy.expectedTenantUU` | Switch BandaGo back to Sphere Pharmacy's clinic tab, or update `expectedTenantUU` in Admin → POS Sync → Policy. |
| Inbound sync answers `{ paused: true, upsertedCount: 0 }` | `policy.inboundEnabled` is toggled off (only `MANUAL_RECONCILE` runs while paused) | Re-enable inbound sync in Admin → POS Sync → Overview & Policy when ready. |
| Sync reports PARTIAL | Per-item errors (bad rows) — chunk failure fell back to isolated transactions | Read `errors[]` in the response, `PosSyncLog.details` (capped 50), and the POS Error Console via `/api/admin/pos-status`. |
| Products not linking | `externalPosId` missing on the incoming item, or slug/SKU collision resolution kicked in | Ensure the extension/CSV maps `uu`/`M_Product_UU`/`id` to `externalPosId`; matching is `externalPosId` first, then slug-based linking for legacy rows. |
| Stock looks wrong or `POSSIBLE_MANUAL_RECONCILE` warning | Expired/short-shelf-life batches excluded (`minShelfLifeDays`), stagnant-POS drift offset active (`computeReconciledStock`), or manual POS drop detected | Check Live Stock Variance Inspector (`POS Sync → Sales Export & Reconciliation`), confirm already-entered sales via **Confirm Entered**, or run an Admin `SET_BASELINE_NOW` cutover. |
| `NO_POS_TAB` / `AUTH_EXPIRED` / `AUTO_SYNC` stalled | No open authenticated `go.bandahealth.org` Chrome tab or BandaGo session expired | Re-authenticate in BandaGo Chrome tab, or download the Daily Sales PDF/CSV from POS Sync and confirm manual entry. |

## Orders

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| 409 on transitions ("order changed") | Optimistic `version` conflict — concurrent staff edits | Reload and retry; by design. |
| 409 stock/points conflicts at checkout | Concurrent checkout consumed stock or points balance changed | Cart re-validates server-side; retry with current availability/points. |
| Reservation never releasing | Order-reservations cron not running (503 without `ORDER_RESERVATION_TTL_MINUTES`) | Schedule the cron; released orders restore stock and re-credit points idempotently. |
| Cancel blocked with "captured payment" message | SUCCESS payment exists — captured payments are never auto-refunded on cancel | Use the ADMIN refund endpoint; note the customer-facing toast promising auto-refunds is a known contradiction (technical-debt). |

## Assistant

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Answers feel "canned" / no LLM | `GROQ_API_KEY` unset — deterministic-first mode | Intentional; set the key (and optionally `GROQ_MODEL`) to enable LLM mode. |
| 429 from assistant | Rate limit 40/hour per IP (`/api/assistant`) or 20/hour per IP (`/api/docs-assistant`) | Expected behavior; retry later. |
| Private-data questions refused | Session-scoped access by design — the assistant route gets no session cookie | See [../security/ai-access-and-authorized-sessions.md](../security/ai-access-and-authorized-sessions.md). |

## Admin

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Live changes not updating | Admin views poll on a ~15s cadence; role changes bump `authVersion` and force re-auth | Wait a cycle; re-sign-in after role/password changes. |
| Compliance fields blank | Redacted below ADMIN/PHARMACIST by design | Sign in with the right role. |

## Services & bookings (supplement)

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Booking slot rejected as "just booked" | Capacity is strictly 1 per slot; concurrent booking won the Serializable check (409) | Re-choose a slot; by design. |
| "price changed" on booking confirm | `expectedPrice` must equal the current service price exactly (409) | Refresh and re-confirm; prices are snapshotted at booking time. |
| Slot times off by hours | Nairobi is hard-coded UTC+3 in slot math | Server clock/timezone is not the cause — check the client's timezone display only. |
| `PAY_AT_PHARMACY` booking never marked paid | It is an **intent marker**; no in-store cash-settlement endpoint exists (known gap) | Record settlement per pharmacy procedure; see [../governance/technical-debt.md](../governance/technical-debt.md) H3. |
| Reminder emails missing for a booking | Booking rescheduled after the 24h reminder already sent — the 2h reminder uses the new time | Expected; dedupe keys are per `scheduledStart`. |

## Guests & OTP (supplement)

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| OTP SMS never arrives | Africa's Talking unset/misconfigured (`AFRICAS_TALKING_*`) | Configure the SMS env; there is no demo code path (by design — static tests assert this). |
| Guest cannot re-open their order | Guest access token is one-time, stored in `sessionStorage`, valid 7 days; cleared on OTP claim | Use the OTP claim flow (same phone) to attach the order to an account. |
| 429 on OTP request | 3 requests / 10 min per IP+phone | Wait for the window; expected abuse protection. |

## Where to look (evidence map)

| Source | What it tells you |
| --- | --- |
| `AuditLog` (`GET /api/admin/audit`, ADMIN) | Staff/admin actions: settings, staff changes, order transitions, refunds, Rx decisions, POS CSV imports. |
| `PosSyncLog` (`GET /api/admin/pos-status`) | BandaGo sync runs (`direction`: INBOUND/OUTBOUND): trigger, status, item counts, duration, error details. |
| `PosOutboundJob` & `PosSyncIncident` (`GET /api/admin/pos-sync/reconcile`) | Outbound deductions/restocks awaiting export or `AUTO_SYNC` writeback, stock variance offsets, and deduplicated Zero-PHI bridge incidents. |
| `NotificationDelivery` via `/api/admin/notification-health` | Queue depth, oldest pending, failed/bounced jobs, config flags. |
| `dev.log` / `server.log` | Dev (`npm run dev` tees to `dev.log`) and standalone server output. |
| Provider dashboards | M-Pesa portal (STK results, B2C refunds), IntaSend (invoices/chargebacks), Resend (deliveries/bounces), FCM console, Cloudflare R2 (objects). |
| `PaymentWebhookEvent` / `Payment` rows | Webhook idempotency ledger and per-attempt provider state. |

## Collecting diagnostics before escalating

When preparing a report (internal or to a provider), gather in this order — most issues are diagnosable from the first three:

1. **The exact response** — status code, body (`publicError()` responses include a random `errorId`; server logs carry the matching detail), and the time it happened.
2. **The actor and object** — who was signed in (customer/staff/role), and the entity ids involved (order reference `SPH-…`, booking `SPB-…`, payment/providerReference, prescription id).
3. **The in-app trail** — AuditLog / PosSyncLog / notification-health output covering the window.
4. **Env posture** — which integrations are configured (notification-health exposes config flags without leaking values; never paste secret values into tickets).
5. **Scheduler evidence** — last cron run outcomes if queue behavior is involved.
6. **Reproduction steps** — from the relevant [recording journey](../recording/recording-checklist.md) if one covers the flow; note deviations.

## Severity triage

| Severity | Definition | Examples | Response |
| --- | --- | --- | --- |
| S1 | Money or medical data at risk; storefront or payments down | Payments stuck with customers charged; prescription access failures; total outage | Immediate: triage here, escalate per below, consider rollback ([deployment.md](deployment.md)) |
| S2 | Core flows degraded but workarounds exist | Notification queue stalled; POS sync failing (manual entry possible); cron 503s | Same day: fix config/scheduler, monitor |
| S3 | Cosmetic / single-user | Toast wording, stale labels, minor UI defects | Next sprint; log in [technical-debt.md](../governance/technical-debt.md) if systemic |

## Confusing-but-correct behaviors (not bugs)

Before escalating, check whether the "bug" is a deliberate invariant:

- Webhook body rejected after provider retry — replays are **acked benignly** only when the payload hash matches; a conflicting replay is a 409 by design (idempotency ledger).
- Staff cannot set REFUNDED/REJECTED — REFUNDED is refund-endpoint-only (ADMIN); REJECTED is a pharmacist decision flow.
- An order cannot move to COMPLETED_* without a SUCCESS payment matching the fulfillment type; OUT_FOR_DELIVERY requires an assigned rider.
- Prescription DTOs always show `fileUrl: null` in **lists** — links are minted per-detail-view as short-lived presigned URLs (30–300s), and each view is logged.
- A second payment attempt while one is PROCESSING returns 409 (`PAYMENT_ATTEMPT_EXISTS`) — one active attempt per order.
- Deterministic assistant answers without any AI credentials — intended (ADR-011).
- `GET /api/payments/mpesa/query` never changes payment state — read-only by design (ADR-007).

## Escalation

- **Clinical/judgement questions** (Rx validity, therapy, PPB licence scope) → escalate to the pharmacist / superintendent pharmacist; compliance settings are internal records, not PPB verification.
- **Regulatory exposure** (retention gaps, prescription access incidents) → pharmacy owner + PPB framework (Cap 244); check `PrescriptionAccessLog` for the access trail.
- **Provider outages or disputed transactions** → provider support with reference IDs (`providerReference`, `checkoutRequestId`, Resend message id); keep the reconciliation-only principle — do not hand-edit payment rows.
- **Data protection** (ODPC/Kenya DPA) → pharmacy owner; Sphere is data processor for the synced BandaGo subset.
