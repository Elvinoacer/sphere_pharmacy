# Backup and Restore

What must be backed up to recover Sphere Pharmacy, with restore procedures, RPO/RTO guidance, and verification steps. **Honest status: no automated backup tooling exists in this repository** — backups are an explicit operational responsibility of whoever runs the database, the R2 bucket, and the secrets store.

| Audience | Status | Verified |
| --- | --- | --- |
| Operators, DevOps | **Requires live verification** | November 2026 |

## What to back up

| Asset | Contents | Backup mechanism |
| --- | --- | --- |
| **PostgreSQL database** | Orders, payments, prescriptions (rows + storage keys), loyalty ledger, users/staff, settings, audit trail, PosSyncLog — 39 models. | Logical dumps (`pg_dump`) **plus** the provider's own snapshots. On Neon, use built-in backups/restore points; if you use pointer/branch workflows, tag the branches you may restore from. |
| **R2 objects** | Private: `prescriptions/{userId}/{uuid}.{ext}` (compliance-relevant), `medicine-requests/{uuid}.{ext}` photos. Public: product/service imagery, avatars, general uploads. | Bucket-level copy to a second bucket/account or an S3-compatible mirror. Do not rely on versioning alone — confirm it is enabled for the private prefixes at minimum. |
| **Env / secrets vault** | All server-secrets from [environment-variables.md](environment-variables.md): database URLs, `CRON_SECRET`, `MPESA_CALLBACK_TOKEN`, provider keys, the three hash secrets, `BANDAGO_SYNC_API_KEY`. | Encrypted secret store (password manager / KMS / provider vault) with access review. `.env.example` structure + real values held separately. |
| **Setting table contents** | `pharmacy`, `delivery`, `compliance` JSON blobs — pharmacy identity, delivery zones/fees, internal PPB compliance record. | Covered by the PostgreSQL dump, but note it: it is hand-curated data with no code-level regeneration path. |

Example nightly logical dump (run from a host with network access to the **direct** (non-pooler) database URL):

```bash
pg_dump --format=custom --no-owner --no-privileges \
  "$DIRECT_DATABASE_URL" \
  | gpg --encrypt --recipient backups@example.com \
  > sphere-$(date +%F).dump.gpg
```

Store the encrypted artifact off-provider (the point is surviving the provider, not just the database).

Not backed up (regenerable): `node_modules`, `.next` build output, the standalone tarball (rebuild from source), `RateLimitBucket` rows (ephemeral), code (Git is the source of truth).

## What the system deletes on its own

Backups must outlive the application's own deletion paths — know them before setting retention:

| Deletion path | Trigger | What disappears |
| --- | --- | --- |
| Prescription retention cron | Soft-deleted older than `PRESCRIPTION_RETENTION_DAYS` | R2 object **and** database row (hard delete, batch 100, shared keys skipped) |
| Order reservation expiry | Unpaid order older than `ORDER_RESERVATION_TTL_MINUTES` | Order cancelled + stock/points returned (rows retained as CANCELLED) |
| Medicine-request orphan cleanup | Photo upload succeeded but row creation failed | The just-uploaded R2 object |
| Expired sessions / OTP codes | Lazy invalidation on access | `Session` rows; used/expired `OtpCode` rows remain until pruned |

None of these are reversible from inside the app — the backup is the only recovery path.

## RPO / RTO guidance

Define targets before choosing tooling — suggested starting points for a single-pharmacy operation:

- **RPO (data loss tolerance):** 24h for a nightly `pg_dump` is the minimum; provider continuous backup (e.g. Neon restore points) gets you to minutes. Prescription records and the payment/loyalty ledgers argue for the tighter end.
- **RTO (recovery time):** target < 4h for full stack: restore database → `prisma migrate status` → restore R2 → restore secrets → redeploy tarball. Rehearse the sequence; an untested backup is a hope, not a backup.

### Suggested backup schedule

| Asset | Frequency | Retention | Notes |
| --- | --- | --- | --- |
| PostgreSQL logical dump (`pg_dump`) | Nightly | 30 days + monthly keeps ≥ 1 year | Restores anywhere; provider-independent. |
| Provider snapshots / restore points | Continuous or hourly per provider | Per provider policy | Fastest point-in-time recovery on Neon. |
| R2 bucket copy | Nightly incremental | 30 days | Prioritize `prescriptions/` and `medicine-requests/` prefixes. |
| Secrets vault export | On every change | Indefinite (versioned) | Export **after** rotating — never ahead of use. |
| Restore rehearsal | Quarterly | — | Run the verification steps below against a scratch environment. |

## Disaster-recovery walkthrough

When the platform is down and data must be rebuilt:

1. **Stand up the runtime** — deploy the last known-good tarball (or Vercel project) against a fresh environment; it will hard-fail on missing database env, which is expected at this stage.
2. **Restore the database** — create the database, restore the latest good dump / branch, then run `npx prisma migrate status`; apply `migrate deploy` if the dump predates the newest migration.
3. **Restore R2** — sync objects back preserving keys exactly (see below).
4. **Restore secrets** — load the vault export; confirm webhook/callback configuration at each provider still points at the (possibly new) origin.
5. **Re-point traffic** — DNS/proxy to the recovered environment; confirm the cron scheduler is re-registered against the new origin.
6. **Verify** — run the verification checklist below before announcing recovery.

## Restore procedures

Before restoring, decide scope: **app-only rollback** (see [deployment.md](deployment.md) — no data restore) versus **data restore** (this section). A data restore should also consider *when* to restore to: point-in-time restores must be paired with the same-era R2 state, otherwise prescriptions will reference objects that do not exist yet (or reference deleted ones).

### 1. Database

```bash
# From a logical dump
pg_restore --clean --if-exists -d "$DATABASE_URL" dumpfile   # or psql for plain SQL dumps
npx prisma migrate status   # MUST report all 10 migrations applied, none pending
```

If `migrate status` reports pending migrations after restore, apply `npx prisma migrate deploy` **before** accepting traffic. If it reports applied-but-missing drift, stop and reconcile deliberately ([database-operations.md](database-operations.md)).

### 2. R2 bucket

Restore objects into the bucket preserving keys **exactly** — database rows reference storage keys (`prescriptions/{userId}/{uuid}.{ext}`) and a mismatched key is indistinguishable from a lost file. Keep the private/public prefixes and their cache-control semantics intact.

### 3. Secrets

Restore from the vault into the deployment environment. **Rotation considerations:**

- `TOKEN_HASH_SECRET` — rotation breaks HMAC comparability for existing promotion IP/browser hashes and guest-order token hashes. Rotate only with an explicit migration plan; this is why the secret must never rotate casually ([environment-variables.md](environment-variables.md)).
- `SESSION_SECRET` / `OTP_HASH_SECRET` — rotation invalidates sessions / in-flight OTPs; schedule during a quiet window.
- Provider keys (`RESEND_API_KEY`, Daraja, IntaSend, R2, FCM, `BANDAGO_SYNC_API_KEY`) — rotate per provider, then update webhook/callback configuration to match.
- If any credential ever equaled a value shipped in `.env.example` (notably the BandaGo default pair), **treat rotation as mandatory, not optional** — those values are public by construction ([../governance/technical-debt.md](../governance/technical-debt.md) H1).

### 4. Cron and integrations after restore

- Re-register the cron scheduler against the restored environment and re-run `/api/cron/notifications` once; the dispatcher's lease design tolerates the gap (expired leases are reclaimed), but queued jobs older than the 23-hour retry window will have FAILED — review them in notification-health and decide whether to re-enqueue.
- Re-point the BandaGo extension (if live) at the restored origin and confirm one sync lands in `PosSyncLog` before declaring recovery.

## Verifying a restore

1. **Spot-check orders** — a known order shows correct items, totals (`Decimal(12,2)` KES), status history, and payment rows with provider references.
2. **Spot-check payments** — `Payment` rows for recent M-Pesa receipts and IntaSend invoices reconcile against provider dashboards (amount, currency, phone, receipt format).
3. **Spot-check prescriptions** — open a restored prescription as its owner (or ADMIN/PHARMACIST): the presigned R2 URL resolves and downloads within its 30–300s window, and a `PrescriptionAccessLog` row appears (VIEW/DOWNLOAD). If presigning fails → 503, the object or `R2_*` config is wrong.
4. **Settings** — `GET /api/settings` returns the pharmacy/delivery blocks; compliance is visible only to ADMIN/PHARMACIST (redacted otherwise).
5. **Cron** — re-run `/api/cron/notifications` once ([scheduled-jobs.md](scheduled-jobs.md)) and confirm it drains without unexpected failures.

## Backup security

- Encrypt dumps at rest and in transit; a database dump contains password hashes (scrypt), phone numbers, and prescription metadata — treat it as PHI-adjacent under the Kenya DPA (ODPC).
- Restrict dump/storage credentials; review access quarterly; never store dumps in the R2 public prefix or any public bucket.
- Remember clinical records live in BandaGo, not here (Sphere syncs only sanitized inventory/customer-contact/loyalty data) — the compliance boundary is documented in [../integrations/bandago-pos-crm.md](../integrations/bandago-pos-crm.md); coordinate backups across both systems with the pharmacy.
- Treat any log or ticket that captured a webhook `?token=` value as secret-bearing ([../governance/technical-debt.md](../governance/technical-debt.md) L9) and rotate accordingly.

## Data-loss sensitivity map (what hurts most if lost)

| Data | Why it matters for backup priority |
| --- | --- |
| `Prescription` rows + R2 objects | Medical records with PPB Cap 244 retention duties; unrecoverable once R2 object and row are both gone (retention cron hard-deletes). |
| `Payment` / `PaymentWebhookEvent` / `ServicePayment` | Financial audit trail and reconciliation truth; provider dashboards help but do not reconstruct the ledger. |
| `LoyaltyLedger` / user loyalty balances | Customer-facing money-equivalent balances; event-keyed and idempotent, but not regenerable without orders. |
| `Order` / `OrderItem` / status history | Business record + the basis for chronic-refill outreach and reports. |
| `Setting` blobs | Hand-curated pharmacy/delivery/compliance configuration — no regeneration path. |
| `User` / `StaffUser` | Password hashes and roles; staff can be re-created but history (audit, assignments) is not. |
| `PosSyncLog` / `AuditLog` | Operational telemetry; loss degrades forensics, not service. |

## Testing backups (the rehearsal)

A backup is only real if a restore has been rehearsed. Quarterly, against a scratch database and scratch bucket:

1. Restore the latest nightly dump into the scratch database; run `npx prisma migrate status` (expect: all applied).
2. Run the **verification checklist** below (orders, payments, prescriptions, settings, cron).
3. Time the whole sequence — this measures your true RTO; if it exceeds the target, fix the process before you need it.
4. Record the rehearsal date and duration in the deployment log; a missed quarter is itself an incident.

## Compliance context

- **Kenya PPB (Cap 244):** prescription records are expected to be archived ~2 years; the retention cron enforces the *deletion* side (`PRESCRIPTION_RETENTION_DAYS`), which makes backups the only long-term archive — align backup retention with the PPB retention intent.
- **Kenya DPA (ODPC):** Sphere is a data processor for the sanitized BandaGo subset; dumps containing customer identifiers must be encrypted, access-logged where possible, and deleted when no longer justified.
- **Payment records:** retain financial data per the pharmacy's accountant/auditor requirements; provider dashboards are a cross-check, not the system of record.

## Related reading

- [database-operations.md](database-operations.md) — migration status, connection safety, monitoring queries.
- [deployment.md](deployment.md) — rollback procedure (redeploy previous tarball + `migrate status`).
- [environment-variables.md](environment-variables.md) — the full secret inventory to vault.
